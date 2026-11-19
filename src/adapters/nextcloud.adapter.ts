import fs from "node:fs";
import path from "node:path";
import type { NextcloudConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import {
  appPasswordRequest,
  basicAuthorization,
  cloudUserRequest,
  ocsCreateUserRequest,
  ocsSetPasswordRequest,
  parseAppPassword,
  parseOcsProvisionStatus,
  parseOcsUserId,
} from "./nextcloud-seed.js";
import { type SecondIdentityProbe, secondIdentityProduct } from "./p4-second-identity.js";
import { randomBytes } from "node:crypto";
import {
  NEXTCLOUD_COMPOSE_PROJECT,
  NEXTCLOUD_OWNER_EMAIL,
  NEXTCLOUD_OWNER_USERNAME,
  NEXTCLOUD_SECOND_EMAIL,
  NEXTCLOUD_SECOND_USERNAME,
  type NextcloudSecrets,
  nextcloudComposeEnv,
  nextcloudComposeFiles,
  nextcloudSecretsFromText,
  parseNextcloudStatus,
} from "./nextcloud-env.js";
import { mcpReadinessFor } from "./mcp-ready.js";
import {
  p4RunStateFile,
  readP4McpCredentials,
  removeP4RunState,
  requireMcpAuthorization,
  writeP4RunState,
} from "./p4-run-state.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import { describeFetchFailure } from "../wait/readiness-error.js";
import { failIfContainerExited, printReadinessDiagnostics } from "../wait/readiness-diagnostics.js";

/** The Nextcloud app container (compose project qa-harness-nextcloud, service app). */
const NEXTCLOUD_APP_CONTAINER = "qa-harness-nextcloud-app-1";
import type { McpReadiness } from "./types.js";

const STATUS_POLL_MS = 2000;
const STATUS_REQUEST_MS = 5000;

/**
 * Nextcloud with its MCP server (ADR 0006, D9). Starts docker/nextcloud.compose.yml, waits for status.php to report
 * installed, mints one app password for the fake owner over OCS, then starts the MCP server in pass-through mode and
 * waits for a real initialize plus tools/list made with that app password.
 */
export class NextcloudAdapter extends BaseAdapter<NextcloudConfig> {
  readonly id = "nextcloud" as const;
  private secrets: NextcloudSecrets | undefined;

  constructor(cfg: NextcloudConfig) {
    super(cfg);
  }

  mcpRunStateFile(): string {
    return p4RunStateFile("nextcloud");
  }

  /** The second identity's run state (H2). Only written when the option is on. */
  secondRunStateFile(): string {
    return p4RunStateFile(secondIdentityProduct("nextcloud"));
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  /** Reads the secrets an earlier run kept, or makes new ones. Writes nothing. */
  private secretsFromDisk(): NextcloudSecrets {
    const file = this.secretsFile();
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    return nextcloudSecretsFromText(text);
  }

  /** Keeps the secrets next to the volumes they initialise, mode 0600. Never logged. */
  private writeSecrets(secrets: NextcloudSecrets): void {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
  }

  private composeOpts(withMcp: boolean): ComposeOptions {
    return {
      projectName: NEXTCLOUD_COMPOSE_PROJECT,
      files: nextcloudComposeFiles(withMcp),
      cwd: HARNESS_DOCKER_DIR,
      env: nextcloudComposeEnv(process.env, this.secrets ?? this.secretsFromDisk()),
    };
  }

  async up(): Promise<void> {
    // The compose file declares qa-harness-p4 as external, so it must exist before any compose call.
    await ensureP4Network();
    this.secrets = this.secretsFromDisk();
    this.writeSecrets(this.secrets);
    await composeUp(this.composeOpts(false), { wait: true });
    await this.waitHealthy();
    await this.seed();
    await composeUp(this.composeOpts(true), { wait: true });
    await this.waitMcp();
    console.log(
      `Nextcloud is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}). The MCP credential is in ${this.mcpRunStateFile()} and is not printed.`,
    );
  }

  async down(): Promise<void> {
    removeP4RunState(this.mcpRunStateFile());
    removeP4RunState(this.secondRunStateFile());
    const opts = this.composeOpts(true);
    if (process.env.NEXTCLOUD_DOWN_VOLUMES === "1") {
      // Removing volumes also removes the saved secrets, since the volumes they initialise are gone.
      await run("docker", ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), "down", "-v"], {
        cwd: opts.cwd,
        env: opts.env,
      });
      fs.rmSync(this.secretsFile(), { force: true });
      return;
    }
    await composeDown(opts, ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/status.php`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** Polls status.php until it reports installed, out of maintenance, with no upgrade pending. */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/status.php`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      failIfContainerExited(NEXTCLOUD_APP_CONTAINER, url);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(STATUS_REQUEST_MS) });
        if (response.status === 200) {
          const verdict = parseNextcloudStatus(await response.json());
          if (verdict.ready) {
            return;
          }
          last = verdict.reason ?? "not ready";
        } else {
          last = `HTTP ${response.status}`;
        }
      } catch (error) {
        last = describeFetchFailure(error);
      }
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
    }
    console.log(`Nextcloud readiness: the last attempt failed with ${last}`);
    printReadinessDiagnostics({ url, container: NEXTCLOUD_APP_CONTAINER });
    throw new Error(`Timed out waiting for ${url} to be ready (last: ${last})`);
  }

  /** Mints the owner's app password over OCS and writes the MCP credential to the run state. */
  async seed(): Promise<SeedResult> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const req = appPasswordRequest(this.cfg.baseUrl, NEXTCLOUD_OWNER_USERNAME, secrets.ownerPassword);
    const response = await fetch(req.url, req.init);
    if (response.status !== 200) {
      throw new Error(`Nextcloud getapppassword returned HTTP ${response.status}`);
    }
    const appPassword = parseAppPassword(await response.json());
    writeP4RunState(this.mcpRunStateFile(), {
      version: 1,
      product: "nextcloud",
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: basicAuthorization(NEXTCLOUD_OWNER_USERNAME, appPassword),
      owner: { username: NEXTCLOUD_OWNER_USERNAME, email: NEXTCLOUD_OWNER_EMAIL },
    });
    const users: SeedResult["users"] = [
      {
        email: NEXTCLOUD_OWNER_EMAIL,
        role: "admin",
        notes: "app password minted over OCS; the MCP uses it, not the login password",
      },
    ];
    if (this.cfg.secondIdentity) {
      await this.seedSecondIdentity(secrets.ownerPassword);
      users.push({ email: NEXTCLOUD_SECOND_EMAIL, role: "user", notes: "second identity (H2); app password in its own run state" });
    }
    return {
      product: this.id,
      created: true,
      users,
      notes: "Minted app passwords and wrote them to the run state (not printed).",
    };
  }

  /**
   * H2. Creates the second user over OCS as the owner, or resets its password when it already exists. The password is a
   * fresh random value for this run; it is never written to disk. The app password minted as that user goes to
   * nextcloud-b-run.json, which the MCP credential reader uses the same way as the owner's.
   */
  async seedSecondIdentity(ownerPassword: string): Promise<void> {
    const password = randomBytes(24).toString("base64url");
    const created = ocsCreateUserRequest(this.cfg.baseUrl, NEXTCLOUD_OWNER_USERNAME, ownerPassword, NEXTCLOUD_SECOND_USERNAME, password, NEXTCLOUD_SECOND_EMAIL);
    // The decision is the OCS status code, not the HTTP status: Nextcloud answers "user already exists" (OCS 102) with
    // HTTP 400, so a kept volume must not fail here (proved live: 2026-11-19, POST cloud/users on an existing user).
    const createdResponse = await fetch(created.url, created.init);
    if (parseOcsProvisionStatus(await createdResponse.json().catch(() => undefined)) === "exists") {
      const reset = ocsSetPasswordRequest(this.cfg.baseUrl, NEXTCLOUD_OWNER_USERNAME, ownerPassword, NEXTCLOUD_SECOND_USERNAME, password);
      const resetResponse = await fetch(reset.url, reset.init);
      parseOcsProvisionStatus(await resetResponse.json().catch(() => undefined));
    }
    const req = appPasswordRequest(this.cfg.baseUrl, NEXTCLOUD_SECOND_USERNAME, password);
    const response = await fetch(req.url, req.init);
    if (response.status !== 200) {
      throw new Error(`Nextcloud getapppassword (second identity) returned HTTP ${response.status}`);
    }
    const appPassword = parseAppPassword(await response.json());
    writeP4RunState(this.secondRunStateFile(), {
      version: 1,
      product: secondIdentityProduct("nextcloud"),
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: basicAuthorization(NEXTCLOUD_SECOND_USERNAME, appPassword),
      owner: { username: NEXTCLOUD_SECOND_USERNAME, email: NEXTCLOUD_SECOND_EMAIL },
    });
  }

  async authenticate(): Promise<AuthSession> {
    const creds = readP4McpCredentials("nextcloud", this.mcpRunStateFile());
    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: requireMcpAuthorization(creds, "nextcloud"),
      raw: { source: "run-state" },
    };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const req = cloudUserRequest(this.cfg.baseUrl, session.authorizationHeader);
    const response = await fetch(req.url, req.init);
    if (response.status !== 200) {
      throw new Error(`Nextcloud proveAuth cloud/user returned HTTP ${response.status}`);
    }
    const id = parseOcsUserId(await response.json());
    if (id !== NEXTCLOUD_OWNER_USERNAME) {
      throw new Error(`Nextcloud proveAuth: expected user ${NEXTCLOUD_OWNER_USERNAME}, got ${id}`);
    }
    console.log(`Nextcloud auth probe: cloud/user id=${id} (HTTP ${response.status})`);
  }

  /**
   * H2 live probe. Both app passwords resolve to their own users over OCS (different ids), and the MCP handshake and tools
   * list pass for both. Returns ids and counts only; no password is returned or printed.
   */
  async probeSecondIdentity(): Promise<SecondIdentityProbe> {
    const ownerCreds = readP4McpCredentials("nextcloud", this.mcpRunStateFile());
    const secondCreds = readP4McpCredentials(secondIdentityProduct("nextcloud"), this.secondRunStateFile());
    const ownerAuth = requireMcpAuthorization(ownerCreds, "nextcloud");
    const secondAuth = requireMcpAuthorization(secondCreds, "nextcloud");
    const ownerId = await this.cloudUserIdFor(ownerAuth);
    const secondId = await this.cloudUserIdFor(secondAuth);
    const ownerMcp = await mcpReadinessFor("nextcloud", { url: ownerCreds.mcpUrl, authorization: ownerAuth, timeoutMs: p4WaitBudgetMs(), minTools: 1 });
    const secondMcp = await mcpReadinessFor("nextcloud", { url: secondCreds.mcpUrl, authorization: secondAuth, timeoutMs: p4WaitBudgetMs(), minTools: 1 });
    return {
      product: this.id,
      owner: ownerId,
      second: secondId,
      distinct: ownerId !== secondId,
      ownerTools: ownerMcp.toolNames.length,
      secondTools: secondMcp.toolNames.length,
    };
  }

  private async cloudUserIdFor(authorization: string): Promise<string> {
    const req = cloudUserRequest(this.cfg.baseUrl, authorization);
    const response = await fetch(req.url, req.init);
    if (response.status !== 200) {
      throw new Error(`Nextcloud cloud/user returned HTTP ${response.status}`);
    }
    return parseOcsUserId(await response.json());
  }

  /** MCP readiness: a real handshake with the pass-through credential, then the Nextcloud user check. */
  async waitMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials("nextcloud", this.mcpRunStateFile());
    const readiness = await mcpReadinessFor("nextcloud", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "nextcloud"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: 1,
    });
    await this.proveAuth(await this.authenticate());
    return readiness;
  }
}
