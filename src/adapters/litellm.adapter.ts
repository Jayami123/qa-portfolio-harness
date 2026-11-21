import fs from "node:fs";
import path from "node:path";
import type { LiteLlmConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { llmRunStateFile, readLlmRunState, writeLlmRunState } from "./llm-run-state.js";
import {
  LITELLM_COMPOSE_PROJECT,
  litellmComposeFiles,
  litellmSecretsFromText,
  liteLlmComposeEnv,
  liteLlmConfigYaml,
} from "./litellm-env.js";
import { assertEmptyToolsList, assertLiteLlmModels, assertNoNightlyCall, stubCompletionRequest, stubRouteFromHeaders } from "./litellm-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";

const POLL_MS = 2000;

/**
 * LiteLLM proxy (ADR 0007). One OpenAI-compatible endpoint with two aliases and no fallbacks (D14). Its MCP route is
 * never granted and is asserted empty (D15, review answer 0.4). The proxy is not an MCP server for the suite.
 */
export class LiteLlmAdapter extends BaseAdapter<LiteLlmConfig> {
  readonly id = "litellm" as const;

  constructor(cfg: LiteLlmConfig) {
    super(cfg);
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private configFile(): string {
    return path.join(this.cfg.productRoot, "config.yaml");
  }

  private readSecrets(): { masterKey: string } {
    const text = fs.existsSync(this.secretsFile()) ? fs.readFileSync(this.secretsFile(), "utf8") : undefined;
    return litellmSecretsFromText(text);
  }

  private composeOpts(masterKey: string): ComposeOptions {
    return {
      projectName: LITELLM_COMPOSE_PROJECT,
      files: litellmComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: liteLlmComposeEnv(process.env, { mode: this.cfg.mode, masterKey, configFile: this.configFile() }),
    };
  }

  async up(): Promise<void> {
    await ensureP4Network();
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    const secrets = this.readSecrets();
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
    // The config holds no secret, so it may be world-readable. The container reads it.
    fs.writeFileSync(
      this.configFile(),
      liteLlmConfigYaml({ stubApiBase: this.cfg.stubApiBase, nightlyProvider: this.cfg.nightlyProvider }),
      { encoding: "utf8", mode: 0o644 },
    );
    writeLlmRunState(llmRunStateFile("litellm"), {
      version: 1,
      product: "litellm",
      baseUrl: `${this.cfg.baseUrl}/v1`,
      apiKey: secrets.masterKey,
    });
    await composeUp(this.composeOpts(secrets.masterKey), { wait: true });
    await this.waitHealthy();
    await this.waitModels();
    await this.waitMcpEmpty();
    await this.waitStubRoute();
    console.log(
      `LiteLLM is up: ${this.cfg.baseUrl} (aliases p4-stub and p4-nightly; mode ${this.cfg.mode}). The master key is in ${llmRunStateFile("litellm")} and is not printed.`,
    );
  }

  /** Removes containers. Never creates secrets: a missing file is passed through as a placeholder. */
  async down(): Promise<void> {
    fs.rmSync(llmRunStateFile("litellm"), { force: true });
    const key = fs.existsSync(this.secretsFile()) ? this.readSecrets().masterKey : "unused-on-down";
    await composeDown(this.composeOpts(key), ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/health/liveliness`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  /** Liveliness only. It does not need the Gemini key (D14). */
  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/health/liveliness`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (r.status === 200) {
          return;
        }
        last = `HTTP ${r.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for ${url} to be ready (last: ${last})`);
  }

  /** The live config lists exactly the two aliases. GET /v1/models calls no model. */
  async waitModels(timeoutMs?: number): Promise<string[]> {
    const { baseUrl, apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${baseUrl}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (r.status === 200) {
          return assertLiteLlmModels(await r.json());
        }
        last = `HTTP ${r.status}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (message.startsWith("LITELLM_ALIASES_WRONG") || message.startsWith("LITELLM_MODELS_MISSING")) {
          throw new Error(message);
        }
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for LiteLLM aliases (last: ${last})`);
  }

  /** The MCP route answers an empty tools/list (no grants). Sent without a session, as the spike did. */
  async waitMcpEmpty(): Promise<void> {
    const { baseUrl, apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    const mcpUrl = baseUrl.replace(/\/v1$/, "/mcp");
    const r = await fetch(mcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(10000),
    });
    assertEmptyToolsList(await r.text());
  }

  /** One p4-stub call. Logs the route names from the headers, never the key. Never sends p4-nightly (D14). */
  async waitStubRoute(): Promise<void> {
    if (this.cfg.stubApiBase !== undefined) {
      // p4-stub routes to the suite's fixture stub, which needs an X-P4-Fixture header the harness cannot choose.
      // The ping is skipped; the suite's tests prove the route with a real fixture.
      console.log("LiteLLM route: p4-stub is routed to P4_STUB_API_BASE; the readiness ping is skipped (the stub needs a fixture header).");
      return;
    }
    const { baseUrl, apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    const req = stubCompletionRequest(baseUrl, apiKey);
    assertNoNightlyCall(req.init);
    const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(30000) });
    if (r.status !== 200) {
      throw new Error(`LiteLLM p4-stub call returned HTTP ${r.status}`);
    }
    const route = stubRouteFromHeaders(r.headers);
    console.log(`LiteLLM route: ${route.alias} answered via ${route.upstream}`);
  }

  async seed(): Promise<SeedResult> {
    return { product: this.id, created: true, users: [], notes: "No users. The master key is written to the run state (not printed)." };
  }

  /** baseUrl is the host url (no /v1). The run state's baseUrl already ends in /v1, so it is not used here. */
  async authenticate(): Promise<AuthSession> {
    const { apiKey } = readLlmRunState("litellm", llmRunStateFile("litellm"));
    return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${apiKey}`, raw: { source: "run-state" } };
  }

  /** Proves the key with a model list (no model call). /v1 is added once here. */
  async proveAuth(session: AuthSession): Promise<void> {
    const r = await fetch(`${session.baseUrl}/v1/models`, { headers: { authorization: session.authorizationHeader } });
    if (r.status !== 200) {
      throw new Error(`LiteLLM proveAuth /v1/models returned HTTP ${r.status}`);
    }
  }
}
