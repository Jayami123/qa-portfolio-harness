import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { llmRunStateFile, readLlmRunState } from "./llm-run-state.js";
import {
  assertOpenClawPinIsRelease,
  generateOpenClawGatewayToken,
  OPENCLAW_COMPOSE_PROJECT,
  OPENCLAW_IMAGE,
  OPENCLAW_STATE_VOLUME,
  openClawComposeFiles,
  openClawConfig,
  openClawEnvText,
} from "./openclaw-env.js";
import { openClawWriteConfigArgs, readyzIsReady } from "./openclaw-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";

/** OpenClaw gateway (ADR 0007). Approvals on, LiteLLM as the only provider, no channel in B1 (D19, review answer 0.3). */
export class OpenClawAdapter extends BaseAdapter<OpenClawConfig> {
  readonly id = "openclaw" as const;

  constructor(cfg: OpenClawConfig) {
    super(cfg);
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private envFile(): string {
    return path.join(this.cfg.productRoot, "env");
  }

  /** The gateway token, kept in secrets.json (mode 0600). Created on first use; never created by down. */
  private tokenFor(create: boolean): string {
    if (fs.existsSync(this.secretsFile())) {
      const parsed = JSON.parse(fs.readFileSync(this.secretsFile(), "utf8")) as { gatewayToken?: unknown };
      if (typeof parsed.gatewayToken === "string" && parsed.gatewayToken !== "") {
        return parsed.gatewayToken;
      }
    }
    if (!create) {
      return "unused-on-down";
    }
    const token = generateOpenClawGatewayToken();
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify({ gatewayToken: token }), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    return token;
  }

  private composeOpts(): ComposeOptions {
    return {
      projectName: OPENCLAW_COMPOSE_PROJECT,
      files: openClawComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: { ...process.env, OPENCLAW_ENV_FILE: this.envFile() },
    };
  }

  /** Streams the config to a one-off container that runs as uid 1000 with no network (review answer 0.5). */
  private writeConfigInVolume(json: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", openClawWriteConfigArgs(OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME), {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderrLength = 0;
      child.stderr.on("data", (chunk: Buffer) => {
        stderrLength += chunk.length;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`OPENCLAW_CONFIG_WRITE_FAILED: docker exited ${code} (stderr ${stderrLength} bytes, not printed)`));
        }
      });
      child.stdin.end(json);
    });
  }

  async up(): Promise<void> {
    assertOpenClawPinIsRelease(OPENCLAW_IMAGE);
    await ensureP4Network();
    const liteLlm = readLlmRunState("litellm", llmRunStateFile("litellm")); // LiteLLM must be up first
    const token = this.tokenFor(true);
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.envFile(), openClawEnvText({ gatewayToken: token, liteLlmKey: liteLlm.apiKey }), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.chmodSync(this.envFile(), 0o600);

    await run("docker", ["volume", "create", OPENCLAW_STATE_VOLUME], { cwd: HARNESS_DOCKER_DIR });
    await this.writeConfigInVolume(`${JSON.stringify(openClawConfig(), null, 2)}\n`);
    await composeUp(this.composeOpts(), { wait: true });
    await this.waitHealthy();
    console.log(
      `OpenClaw is up: ${this.cfg.baseUrl}. The gateway token and the provider key are in ${this.envFile()} (mode 0600) and are not printed.`,
    );
  }

  /** Removes containers only. It never creates the token or the env file. The volume goes only with OPENCLAW_DOWN_VOLUMES=1. */
  async down(): Promise<void> {
    await composeDown(this.composeOpts(), ["--remove-orphans"]);
    if (process.env.OPENCLAW_DOWN_VOLUMES === "1") {
      await run("docker", ["volume", "rm", "-f", OPENCLAW_STATE_VOLUME], { cwd: HARNESS_DOCKER_DIR });
      fs.rmSync(this.secretsFile(), { force: true });
      fs.rmSync(this.envFile(), { force: true });
    }
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/healthz`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** /healthz 200, then /readyz with ready: true (VERIFIED: ready after about 30 s). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const h = await fetch(`${this.cfg.baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
        if (h.status === 200) {
          const r = await fetch(`${this.cfg.baseUrl}/readyz`, { signal: AbortSignal.timeout(5000) });
          if (r.status === 200 && readyzIsReady(await r.json())) {
            return;
          }
          last = `readyz HTTP ${r.status}`;
        } else {
          last = `healthz HTTP ${h.status}`;
        }
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for ${this.cfg.baseUrl}/healthz and /readyz (last: ${last})`);
  }

  async seed(): Promise<SeedResult> {
    return { product: this.id, created: true, users: [], notes: "Config written into the state volume as uid 1000. No channel and no user in B1." };
  }

  async authenticate(): Promise<AuthSession> {
    return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${this.tokenFor(false)}`, raw: { source: "secrets.json" } };
  }

  /** Health only in B1. An authenticated gateway call is a B2 proof. */
  async proveAuth(session: AuthSession): Promise<void> {
    const r = await fetch(`${session.baseUrl}/healthz`);
    if (r.status !== 200) {
      throw new Error(`OpenClaw proveAuth /healthz returned HTTP ${r.status}`);
    }
  }
}
