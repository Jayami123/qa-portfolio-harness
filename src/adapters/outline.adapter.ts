import fs from "node:fs";
import path from "node:path";
import type { OutlineConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run, runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { mcpReadinessFor } from "./mcp-ready.js";
import {
  OUTLINE_COMPOSE_PROJECT,
  OUTLINE_OWNER_EMAIL,
  OUTLINE_OWNER_USERNAME,
  OUTLINE_SECOND_EMAIL,
  OUTLINE_SECOND_NAME,
  type OutlineSecrets,
  outlineComposeEnv,
  outlineComposeFiles,
  outlineSecretsFromText,
} from "./outline-env.js";
import {
  authInfoRequest,
  maskOutlineApiKeys,
  outlineSeedExecEnv,
  ownerEmailMatches,
  parseAuthInfoEmail,
  parseOutlineSeedOutput,
  secondEmailMatches,
} from "./outline-seed.js";
import {
  p4RunStateFile,
  readP4McpCredentials,
  removeP4RunState,
  requireMcpAuthorization,
  writeP4RunState,
} from "./p4-run-state.js";
import { type SecondIdentityProbe, secondIdentityProduct } from "./p4-second-identity.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import type { McpReadiness } from "./types.js";

const HEALTH_POLL_MS = 2000;
const HEALTH_REQUEST_MS = 5000;
const SEED_TIMEOUT_MS = 5 * 60 * 1000;
const MIGRATE_TIMEOUT_MS = 15 * 60 * 1000;
/** Services that must be running before the migration runs. The app itself starts after the migration. */
const PRE_MIGRATE_SERVICES = ["db", "redis", "mail"];

/**
 * Outline with its built-in MCP (ADR 0006). Starts db, redis and mail; runs the migration with the
 * production-ssl-disabled config; starts the app; waits for /_health; seeds one fake owner and one API key through
 * Outline's models; waits for a real MCP handshake made with that key.
 */
export class OutlineAdapter extends BaseAdapter<OutlineConfig> {
  readonly id = "outline" as const;
  private secrets: OutlineSecrets | undefined;

  constructor(cfg: OutlineConfig) {
    super(cfg);
  }

  mcpRunStateFile(): string {
    return p4RunStateFile("outline");
  }

  /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
  secondRunStateFile(): string {
    return p4RunStateFile(secondIdentityProduct("outline"));
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private secretsFromDisk(): OutlineSecrets {
    const file = this.secretsFile();
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    return outlineSecretsFromText(text);
  }

  private writeSecrets(secrets: OutlineSecrets): void {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
  }

  private composeOpts(): ComposeOptions {
    return {
      projectName: OUTLINE_COMPOSE_PROJECT,
      files: outlineComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: outlineComposeEnv(process.env, this.secrets ?? this.secretsFromDisk()),
    };
  }

  private composeArgs(extra: string[]): string[] {
    const opts = this.composeOpts();
    return ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), ...extra];
  }

  async up(): Promise<void> {
    // The compose file declares qa-harness-p4 as external, so it must exist before any compose call.
    await ensureP4Network();
    this.secrets = this.secretsFromDisk();
    this.writeSecrets(this.secrets);
    const opts = this.composeOpts();

    await composeUp(opts, { wait: true, waitServices: PRE_MIGRATE_SERVICES });
    // The migration uses the production-ssl-disabled config. The app itself runs with NODE_ENV=production (see compose).
    await run(
      "docker",
      this.composeArgs([
        "run",
        "--rm",
        "--no-deps",
        "-e",
        "NODE_ENV=production-ssl-disabled",
        "outline",
        "sh",
        "-c",
        "cd /opt/outline && node_modules/.bin/sequelize db:migrate",
      ]),
      { cwd: opts.cwd, env: opts.env, timeoutMs: MIGRATE_TIMEOUT_MS },
    );
    await composeUp(opts, { wait: true });
    await this.waitHealthy();
    await this.seed();
    await this.waitMcp();
    if (this.cfg.secondIdentity) {
      await this.waitSecondMcp();
    }
    console.log(
      `Outline is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}). The MCP credential is in ${this.mcpRunStateFile()} and is not printed.`,
    );
  }

  async down(): Promise<void> {
    removeP4RunState(this.mcpRunStateFile());
    removeP4RunState(this.secondRunStateFile());
    const opts = this.composeOpts();
    if (process.env.OUTLINE_DOWN_VOLUMES === "1") {
      await run("docker", this.composeArgs(["down", "-v"]), { cwd: opts.cwd, env: opts.env });
      fs.rmSync(this.secretsFile(), { force: true });
      return;
    }
    await composeDown(opts, ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/_health`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/_health`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_REQUEST_MS) });
        if (response.status === 200) {
          return;
        }
        last = `HTTP ${response.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
    throw new Error(`Timed out waiting for ${url} to become healthy (last: ${last})`);
  }

  /** Runs the seed script inside the container, then stores the owner's key in the run state. */
  async seed(): Promise<SeedResult> {
    const opts = this.composeOpts();
    // redactLine: runCapture echoes stdout while it runs. The seed prints the API key on stdout, so mask it on the way out.
    const { stdout } = await runCapture(
      "docker",
      this.composeArgs(["exec", "-T", ...outlineSeedExecEnv(this.cfg.secondIdentity), "outline", "node", "/opt/harness/outline-seed.cjs"]),
      { cwd: opts.cwd, env: opts.env, timeoutMs: SEED_TIMEOUT_MS, redactLine: maskOutlineApiKeys },
    );
    const seeded = parseOutlineSeedOutput(stdout);
    writeP4RunState(this.mcpRunStateFile(), {
      version: 1,
      product: "outline",
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: `Bearer ${seeded.apiKey}`,
      owner: { username: OUTLINE_OWNER_USERNAME, email: OUTLINE_OWNER_EMAIL },
    });
    const users: SeedResult["users"] = [
      { email: OUTLINE_OWNER_EMAIL, role: "admin", notes: "owner created through Outline models; API key scope *" },
    ];
    if (this.cfg.secondIdentity) {
      if (!seeded.second) {
        throw new Error("OUTLINE_SECOND_IDENTITY_MISSING: the seed printed no second identity although P4_SECOND_IDENTITY=1 (not printed)");
      }
      // H2: the second key is written to its own run state; the MCP credential reader uses it the same way.
      writeP4RunState(this.secondRunStateFile(), {
        version: 1,
        product: secondIdentityProduct("outline"),
        mcpUrl: this.cfg.mcpUrl,
        mcpAuthorization: `Bearer ${seeded.second.apiKey}`,
        owner: { username: OUTLINE_SECOND_NAME, email: OUTLINE_SECOND_EMAIL },
      });
      users.push({ email: OUTLINE_SECOND_EMAIL, role: "member", notes: "second identity (H2); API key in its own run state" });
    }
    return {
      product: this.id,
      created: true,
      users,
      notes: "Created one team, one owner and one API key through Outline models. The key is in the run state (not printed).",
    };
  }

  async authenticate(): Promise<AuthSession> {
    const creds = readP4McpCredentials("outline", this.mcpRunStateFile());
    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: requireMcpAuthorization(creds, "outline"),
      raw: { source: "run-state" },
    };
  }

  /** Reads auth.info for one key and returns the authenticated user's email. The key is never printed. */
  private async emailFor(authorization: string): Promise<string> {
    const req = authInfoRequest(this.cfg.baseUrl, authorization);
    const response = await fetch(req.url, req.init);
    if (response.status !== 200) {
      throw new Error(`Outline proveAuth auth.info returned HTTP ${response.status}`);
    }
    return parseAuthInfoEmail(await response.json());
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const email = await this.emailFor(session.authorizationHeader);
    if (!ownerEmailMatches(email)) {
      throw new Error(`Outline proveAuth: expected ${OUTLINE_OWNER_EMAIL}, got a different user`);
    }
    console.log("Outline auth probe: auth.info user matches the seeded owner (HTTP 200)");
  }

  async waitMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials("outline", this.mcpRunStateFile());
    const readiness = await mcpReadinessFor("outline", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "outline"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: 1,
    });
    await this.proveAuth(await this.authenticate());
    return readiness;
  }

  /** H2: MCP readiness and the auth.info identity for the second key (its own run state). */
  async waitSecondMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials(secondIdentityProduct("outline"), this.secondRunStateFile());
    const readiness = await mcpReadinessFor("outline", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "outline"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: 1,
    });
    const email = await this.emailFor(requireMcpAuthorization(creds, "outline"));
    if (!secondEmailMatches(email)) {
      throw new Error("Outline second identity: auth.info did not name the second user");
    }
    return readiness;
  }

  /**
   * H2 live probe. Both identities authenticate, they are different users, and the MCP accepts both keys.
   * Returns the emails and tool counts only; no key is returned or printed.
   */
  async probeSecondIdentity(): Promise<SecondIdentityProbe> {
    const owner = requireMcpAuthorization(readP4McpCredentials("outline", this.mcpRunStateFile()), "outline");
    const second = requireMcpAuthorization(readP4McpCredentials(secondIdentityProduct("outline"), this.secondRunStateFile()), "outline");
    const ownerEmail = await this.emailFor(owner);
    const secondEmail = await this.emailFor(second);
    const ownerMcp = await mcpReadinessFor("outline", { url: this.cfg.mcpUrl, authorization: owner, timeoutMs: p4WaitBudgetMs(), minTools: 1 });
    const secondMcp = await mcpReadinessFor("outline", { url: this.cfg.mcpUrl, authorization: second, timeoutMs: p4WaitBudgetMs(), minTools: 1 });
    return {
      product: this.id,
      owner: ownerEmail,
      second: secondEmail,
      distinct: ownerEmail !== secondEmail,
      ownerTools: ownerMcp.toolNames.length,
      secondTools: secondMcp.toolNames.length,
    };
  }
}
