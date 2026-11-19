import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LibreChatConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { llmRunStateFile, readLlmRunState } from "./llm-run-state.js";
import {
  LIBRECHAT_COMPOSE_PROJECT,
  LIBRECHAT_OWNER_EMAIL,
  librechatComposeFiles,
  librechatEnvText,
  librechatSecretValues,
  librechatYaml,
  type LibreChatSecrets,
} from "./librechat-env.js";
import {
  interestingLogLines,
  LIBRECHAT_APP_CONTAINER,
  mcpContainerFor,
  redactionValues,
  redactText,
  streamMcpProbe,
} from "./librechat-diag.js";
import {
  createOwnerArgs,
  librechatMcpEnv,
  librechatMongoUri,
  loginRequest,
  tokenFromLogin,
} from "./librechat-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import { waitForMcpServers } from "./librechat-mcp-wait.js";

const POLL_MS = 2000;

/**
 * LibreChat chat host (ADR 0007). It boots against LiteLLM by alias and attaches the Part A MCP servers by alias.
 * B1 proves health, the seeded login, and that each configured MCP server is connected and lists tools (review answers
 * 0.6 and 0.7). On a timeout it prints redacted diagnostics before it throws.
 */
export class LibreChatAdapter extends BaseAdapter<LibreChatConfig> {
  readonly id = "librechat" as const;

  constructor(cfg: LibreChatConfig) {
    super(cfg);
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private envFile(): string {
    return path.join(this.cfg.productRoot, "librechat.env");
  }

  private configFile(): string {
    return path.join(this.cfg.productRoot, "librechat.yaml");
  }

  /** Reads the saved secrets, or creates them (mode 0600). Creates nothing on down. */
  private secrets(create: boolean): LibreChatSecrets {
    if (fs.existsSync(this.secretsFile())) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.secretsFile(), "utf8")) as Partial<LibreChatSecrets>;
        if (typeof parsed.mongoPassword === "string" && typeof parsed.ownerPassword === "string" && parsed.credsKey) {
          return parsed as LibreChatSecrets;
        }
      } catch {
        // damaged file: replaced below when create is true
      }
    }
    if (!create) {
      return { ...librechatSecretValues() }; // throwaway values for `down`, never written
    }
    const made = librechatSecretValues();
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify(made), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    return made;
  }

  private composeOpts(mongoPassword: string): ComposeOptions {
    return {
      projectName: LIBRECHAT_COMPOSE_PROJECT,
      files: librechatComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: {
        ...process.env,
        LIBRECHAT_ENV_FILE: this.envFile(),
        LIBRECHAT_CONFIG_FILE: this.configFile(),
        LIBRECHAT_MONGO_PASSWORD: mongoPassword,
      },
    };
  }

  async up(): Promise<void> {
    // The compose file declares qa-harness-p4 as external, so it must exist before any compose call.
    await ensureP4Network();
    const liteLlm = readLlmRunState("litellm", llmRunStateFile("litellm")); // throws P4_RUN_STATE_MISSING if LiteLLM is down
    const secrets = this.secrets(true);
    const mcp = librechatMcpEnv(this.cfg.mcpProducts);

    fs.writeFileSync(this.configFile(), librechatYaml({ models: this.cfg.models, servers: mcp.servers, toolApproval: this.cfg.toolApproval }), {
      encoding: "utf8",
      mode: 0o644,
    });
    const values: Record<string, string> = {
      MONGO_URI: librechatMongoUri(secrets.mongoPassword),
      PORT: "3080",
      HOST: "0.0.0.0", // inside the container; the host publish stays on 127.0.0.1 (review answer 0.1)
      JWT_SECRET: secrets.jwtSecret,
      JWT_REFRESH_SECRET: secrets.jwtRefreshSecret,
      CREDS_KEY: secrets.credsKey,
      CREDS_IV: secrets.credsIv,
      ALLOW_REGISTRATION: "false", // stays false at all times (review answer 0.6)
      CONFIG_PATH: "/app/librechat.yaml",
      P4_LITELLM_API_KEY: liteLlm.apiKey,
      ...mcp.env,
    };
    fs.writeFileSync(this.envFile(), librechatEnvText(values), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.envFile(), 0o600);

    await composeUp(this.composeOpts(secrets.mongoPassword), { wait: true });
    await this.waitHealthy();
    await this.seed();
    await this.waitMcpProofs();
    console.log(
      `LibreChat is up: ${this.cfg.baseUrl}. MCP servers: ${mcp.servers.map((s) => s.name).join(", ")}. The owner password and the MCP values are in ${this.secretsFile()} and ${this.envFile()} (mode 0600) and are not printed.`,
    );
  }

  /** Removes containers only. It never creates secrets. */
  async down(): Promise<void> {
    await composeDown(this.composeOpts("unused-on-down"), ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/health`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** /health and /api/config both 200 (VERIFIED in the spike). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const a = await fetch(`${this.cfg.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const b = await fetch(`${this.cfg.baseUrl}/api/config`, { signal: AbortSignal.timeout(5000) });
        if (a.status === 200 && b.status === 200) {
          return;
        }
        last = `health ${a.status}, api/config ${b.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for ${this.cfg.baseUrl}/health and /api/config to be ready (last: ${last})`);
  }

  /**
   * Creates the fake owner once. If the login already works, nothing is created (idempotent on a kept volume).
   * create-user takes the password as an argument. It runs through runCapture with the password redacted, so neither
   * npm's output nor a thrown error carries it. npm runs with --silent, so it does not echo the command.
   */
  async seed(): Promise<SeedResult> {
    const secrets = this.secrets(true);
    const probe = loginRequest(this.cfg.baseUrl, LIBRECHAT_OWNER_EMAIL, secrets.ownerPassword);
    const existing = await fetch(probe.url, probe.init);
    if (existing.status === 200) {
      return { product: this.id, created: false, users: [{ email: LIBRECHAT_OWNER_EMAIL, role: "owner" }], notes: "Owner already present. Login works." };
    }
    await runCapture("docker", ["exec", LIBRECHAT_APP_CONTAINER, "npm", ...createOwnerArgs(secrets.ownerPassword)], {
      cwd: HARNESS_DOCKER_DIR,
      redact: [secrets.ownerPassword],
    });
    const again = await fetch(probe.url, probe.init);
    if (again.status !== 200) {
      throw new Error(`LIBRECHAT_LOGIN_FAILED: the seeded owner cannot log in (HTTP ${again.status})`);
    }
    return { product: this.id, created: true, users: [{ email: LIBRECHAT_OWNER_EMAIL, role: "owner" }], notes: "Owner created with create-user. Password in secrets.json (mode 0600)." };
  }

  /**
   * Logs in, then polls the supported MCP routes until every configured server is connected and lists tools. On timeout it
   * prints every server's state and redacted diagnostics, then throws. The error names each state, never a value.
   */
  async waitMcpProofs(timeoutMs?: number): Promise<Record<string, number>> {
    const names = [...this.cfg.mcpProducts];
    const token = await this.token();
    const get = async (path: string): Promise<unknown> => {
      const r = await fetch(`${this.cfg.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      return r.json();
    };
    return waitForMcpServers(
      {
        openTools: () => get("/api/mcp/tools"),
        readStatus: () => get("/api/mcp/connection/status"),
        onFirstNotConnected: async (states) => {
          console.log(`LibreChat MCP: not all servers are connected yet (${Object.entries(states).map(([n, s]) => `${n}=${s}`).join(", ")}). Running the in-container probe now.`);
          await streamMcpProbe(names, this.redactionValues());
        },
        onTimeout: (states) => this.diagnoseMcp(names, states),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
      },
      { names, timeoutMs: timeoutMs ?? p4WaitBudgetMs(), pollMs: POLL_MS, reopenMs: 15000 },
    );
  }

  /**
   * Redacted diagnostics for a failed MCP wait: every state, LibreChat's MCP and allow-list lines, the tail of each failing
   * MCP container's log, and a probe run inside the LibreChat container (DNS address and HTTP status per server). Only
   * names, addresses, statuses and log lines are printed. Every line is redacted with the env-file values and the secrets.
   */
  private diagnoseMcp(names: string[], states: Record<string, string>): void {
    const envText = fs.existsSync(this.envFile()) ? fs.readFileSync(this.envFile(), "utf8") : "";
    const secrets = fs.existsSync(this.secretsFile()) ? (JSON.parse(fs.readFileSync(this.secretsFile(), "utf8")) as Record<string, unknown>) : {};
    const values = redactionValues(envText, secrets);
    const print = (text: string): void => {
      for (const line of redactText(text, values).split("\n")) {
        if (line.trim() !== "") console.log(`  ${line}`);
      }
    };

    console.log("LibreChat MCP diagnostics (every value redacted; no header is printed):");
    for (const name of names) {
      console.log(`  state ${name}: ${states[name] ?? "no status reported"}`);
    }

    const app = spawnSync("docker", ["logs", "--tail", "400", LIBRECHAT_APP_CONTAINER], { encoding: "utf8" });
    console.log(`LibreChat log lines about MCP, allow lists and errors (${LIBRECHAT_APP_CONTAINER}):`);
    print(interestingLogLines(`${app.stdout}\n${app.stderr}`).join("\n"));

    for (const name of names) {
      if (states[name] === "connected") continue;
      const container = mcpContainerFor(name);
      if (container === undefined) continue;
      const mcp = spawnSync("docker", ["logs", "--tail", "40", container], { encoding: "utf8" });
      console.log(`last lines of ${container} (${name}):`);
      print(`${mcp.stdout}\n${mcp.stderr}`);
    }

  }

  /** Every env-file value and secret, for redaction of anything printed from the probe or the logs. */
  private redactionValues(): string[] {
    const envText = fs.existsSync(this.envFile()) ? fs.readFileSync(this.envFile(), "utf8") : "";
    const secrets = fs.existsSync(this.secretsFile()) ? (JSON.parse(fs.readFileSync(this.secretsFile(), "utf8")) as Record<string, unknown>) : {};
    return redactionValues(envText, secrets);
  }

  private async token(): Promise<string> {
    const secrets = this.secrets(false);
    const req = loginRequest(this.cfg.baseUrl, LIBRECHAT_OWNER_EMAIL, secrets.ownerPassword);
    const r = await fetch(req.url, req.init);
    if (r.status !== 200) {
      throw new Error(`LIBRECHAT_LOGIN_FAILED: login returned HTTP ${r.status}`);
    }
    return tokenFromLogin(await r.json());
  }

  async authenticate(): Promise<AuthSession> {
    return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${await this.token()}`, raw: { source: "login" } };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const r = await fetch(`${session.baseUrl}/api/mcp/connection/status`, { headers: { authorization: session.authorizationHeader } });
    if (r.status !== 200) {
      throw new Error(`LibreChat proveAuth /api/mcp/connection/status returned HTTP ${r.status}`);
    }
  }
}
