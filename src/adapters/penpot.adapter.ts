import fs from "node:fs";
import path from "node:path";
import type { PenpotConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run, runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { mcpReadinessFor } from "./mcp-ready.js";
import { p4RunStateFile, readP4McpCredentials, removeP4RunState, writeP4RunState } from "./p4-run-state.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import { derivedSecondPassword, type SecondIdentityProbe, secondIdentityProduct } from "./p4-second-identity.js";
import {
  PENPOT_COMPOSE_PROJECT,
  PENPOT_OWNER_EMAIL,
  PENPOT_OWNER_NAME,
  PENPOT_SECOND_EMAIL,
  PENPOT_SECOND_NAME,
  type PenpotSecrets,
  penpotComposeEnv,
  penpotComposeFiles,
  penpotSecretsFromText,
} from "./penpot-env.js";
import { authTokenFromSetCookie, createProfileArgs, loginRequest, profileEmail } from "./penpot-seed.js";
import { decodeTransit } from "./penpot-transit.js";
import type { McpReadiness } from "./types.js";

const POLL_MS = 2000;
const REQUEST_MS = 10_000;
const CREATE_PROFILE_TIMEOUT_MS = 5 * 60 * 1000;
/** The MCP plugin's tools; the check that the list is the real one, not a stub. */
const REQUIRED_TOOL = "execute_code";
const MIN_TOOLS = 4;

/**
 * Penpot with its official MCP server (ADR 0006). Starts the stack; creates the fake owner through the backend's
 * manage.py CLI; logs in over RPC to prove the owner works; waits for a real MCP handshake and the four tools.
 * Tool calls that edit a design need a browser with the MCP plugin connected: that is proven by the spike, not here.
 */
export class PenpotAdapter extends BaseAdapter<PenpotConfig> {
  readonly id = "penpot" as const;
  private secrets: PenpotSecrets | undefined;

  constructor(cfg: PenpotConfig) {
    super(cfg);
  }

  mcpRunStateFile(): string {
    return p4RunStateFile("penpot");
  }

  /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
  secondRunStateFile(): string {
    return p4RunStateFile(secondIdentityProduct("penpot"));
  }

  /** H2: the second profile's password, derived from the owner-side secret so a kept volume reuses it. */
  private secondPassword(secrets: PenpotSecrets): string {
    return derivedSecondPassword(secrets.secretKey, "penpot");
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private secretsFromDisk(): PenpotSecrets {
    const file = this.secretsFile();
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    return penpotSecretsFromText(text);
  }

  private writeSecrets(secrets: PenpotSecrets): void {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
  }

  private composeOpts(): ComposeOptions {
    return {
      projectName: PENPOT_COMPOSE_PROJECT,
      files: penpotComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: penpotComposeEnv(process.env, this.secrets ?? this.secretsFromDisk()),
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
    await composeUp(this.composeOpts(), { wait: true });
    await this.waitHealthy();
    await this.seed();
    await this.waitMcp();
    if (this.cfg.secondIdentity) {
      await this.seedSecond();
    }
    console.log(
      `Penpot is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}, single-user). Open the MCP plugin in a browser to edit designs. The run state is ${this.mcpRunStateFile()} and is not printed.`,
    );
  }

  async down(): Promise<void> {
    removeP4RunState(this.mcpRunStateFile());
    removeP4RunState(this.secondRunStateFile());
    const opts = this.composeOpts();
    if (process.env.PENPOT_DOWN_VOLUMES === "1") {
      await run("docker", this.composeArgs(["down", "-v"]), { cwd: opts.cwd, env: opts.env });
      fs.rmSync(this.secretsFile(), { force: true });
      return;
    }
    await composeDown(opts, ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** Polls the backend through the frontend proxy until get-profile answers (the anonymous profile is enough). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/api/rpc/command/get-profile`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(REQUEST_MS) });
        if (response.status === 200) {
          return;
        }
        last = `HTTP ${response.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for ${url} to answer (last: ${last})`);
  }

  private async login(secrets: PenpotSecrets): Promise<string> {
    return this.loginAs(PENPOT_OWNER_EMAIL, secrets.ownerPassword);
  }

  /** login-with-password for any profile. Returns the auth-token cookie value; the password is never printed. */
  private async loginAs(email: string, password: string): Promise<string> {
    const req = loginRequest(this.cfg.baseUrl, email, password);
    const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (response.status !== 200) {
      throw new Error(`PENPOT_LOGIN_FAILED: login-with-password returned HTTP ${response.status}`);
    }
    return authTokenFromSetCookie(response.headers.getSetCookie());
  }

  /**
   * H2. Creates the second profile with manage.py when its login fails (not there yet), then logs in and checks that
   * get-profile names it. Writes penpot-b-run.json with a null credential, because the MCP is single-user (see below).
   */
  async seedSecond(): Promise<void> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const password = this.secondPassword(secrets);
    try {
      await this.loginAs(PENPOT_SECOND_EMAIL, password);
    } catch {
      await runCapture(
        "docker",
        this.composeArgs(["exec", "-T", "backend", ...createProfileArgs(PENPOT_SECOND_EMAIL, PENPOT_SECOND_NAME, password)]),
        { cwd: this.composeOpts().cwd, env: this.composeOpts().env, timeoutMs: CREATE_PROFILE_TIMEOUT_MS, redact: [password] },
      );
    }
    const token = await this.loginAs(PENPOT_SECOND_EMAIL, password);
    const email = await this.profileEmailWith(`auth-token=${token}`);
    if (email !== PENPOT_SECOND_EMAIL) {
      throw new Error("Penpot second identity: expected the second profile, got a different profile");
    }
    // Same MCP endpoint and same null credential as the owner (single-user mode takes none). The identity is the profile.
    writeP4RunState(this.secondRunStateFile(), {
      version: 1,
      product: secondIdentityProduct("penpot"),
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: null,
      owner: { username: PENPOT_SECOND_EMAIL, email: PENPOT_SECOND_EMAIL },
    });
  }

  /**
   * H2 live probe. Both profiles log in and get-profile names each one; the two emails differ. The MCP handshake and tools
   * list run for both run states. The MCP is single-user, so it cannot tell the two apart: the probe reports that.
   */
  async probeSecondIdentity(): Promise<SecondIdentityProbe> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const ownerToken = await this.loginAs(PENPOT_OWNER_EMAIL, secrets.ownerPassword);
    const secondToken = await this.loginAs(PENPOT_SECOND_EMAIL, this.secondPassword(secrets));
    const ownerEmail = await this.profileEmailWith(`auth-token=${ownerToken}`);
    const secondEmail = await this.profileEmailWith(`auth-token=${secondToken}`);
    const ownerMcp = await mcpReadinessFor("penpot", {
      url: readP4McpCredentials("penpot", this.mcpRunStateFile()).mcpUrl,
      timeoutMs: p4WaitBudgetMs(),
      minTools: MIN_TOOLS,
    });
    const secondMcp = await mcpReadinessFor("penpot", {
      url: readP4McpCredentials(secondIdentityProduct("penpot"), this.secondRunStateFile()).mcpUrl,
      timeoutMs: p4WaitBudgetMs(),
      minTools: MIN_TOOLS,
    });
    return {
      product: this.id,
      owner: ownerEmail ?? "",
      second: secondEmail ?? "",
      distinct: ownerEmail !== null && secondEmail !== null && ownerEmail !== secondEmail,
      ownerTools: ownerMcp.toolNames.length,
      secondTools: secondMcp.toolNames.length,
    };
  }

  /** Creates the owner with manage.py when login fails, then logs in and checks the profile email. */
  async seed(): Promise<SeedResult> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    let created = false;
    try {
      await this.login(secrets);
    } catch {
      // Not there yet (or a different password on a kept volume, which then fails below). Create it.
      await runCapture(
        "docker",
        this.composeArgs(["exec", "-T", "backend", ...createProfileArgs(PENPOT_OWNER_EMAIL, PENPOT_OWNER_NAME, secrets.ownerPassword)]),
        { cwd: this.composeOpts().cwd, env: this.composeOpts().env, timeoutMs: CREATE_PROFILE_TIMEOUT_MS, redact: [secrets.ownerPassword] },
      );
      created = true;
    }
    const token = await this.login(secrets);
    const email = await this.profileEmailWith(`auth-token=${token}`);
    if (email !== PENPOT_OWNER_EMAIL) {
      throw new Error(`Penpot seed: expected the owner profile, got a different profile`);
    }
    // Penpot's single-user MCP takes no credential, so the run state records null for the Authorization value.
    writeP4RunState(this.mcpRunStateFile(), {
      version: 1,
      product: "penpot",
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: null,
      owner: { username: PENPOT_OWNER_EMAIL, email: PENPOT_OWNER_EMAIL },
    });
    return {
      product: this.id,
      created,
      users: [{ email: PENPOT_OWNER_EMAIL, role: "owner", notes: "created with manage.py create-profile" }],
      notes: created ? "Created the owner profile." : "Owner profile already existed; login verified.",
    };
  }

  private async profileEmailWith(cookie: string): Promise<string | null> {
    const response = await fetch(`${this.cfg.baseUrl}/api/rpc/command/get-profile`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{}",
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (response.status !== 200) {
      throw new Error(`Penpot get-profile returned HTTP ${response.status}`);
    }
    return profileEmail(decodeTransit(await response.json()));
  }

  async authenticate(): Promise<AuthSession> {
    const token = await this.login(this.secrets ?? this.secretsFromDisk());
    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `auth-token=${token}`,
      raw: { source: "login-with-password" },
    };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const email = await this.profileEmailWith(session.authorizationHeader);
    if (email !== PENPOT_OWNER_EMAIL) {
      throw new Error("Penpot proveAuth: the session does not belong to the seeded owner");
    }
    console.log("Penpot auth probe: get-profile returned the seeded owner (HTTP 200)");
  }

  /** MCP readiness: handshake, tools/list with at least four tools, and the named tool present. */
  async waitMcp(timeoutMs?: number): Promise<McpReadiness> {
    const readiness = await mcpReadinessFor("penpot", {
      url: readP4McpCredentials("penpot", this.mcpRunStateFile()).mcpUrl,
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: MIN_TOOLS,
    });
    if (!readiness.toolNames.includes(REQUIRED_TOOL)) {
      throw new Error(`Penpot MCP tools/list does not include ${REQUIRED_TOOL}`);
    }
    await this.proveAuth(await this.authenticate());
    return readiness;
  }
}
