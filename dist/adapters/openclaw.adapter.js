import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { composeDown, composeExecArgs, composeRestart, composeUp } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { llmRunStateFile, readLlmRunState } from "./llm-run-state.js";
import { assertOpenClawPinIsRelease, generateOpenClawGatewayToken, generateOpenClawMockChannelToken, OPENCLAW_COMPOSE_PROJECT, OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME, openClawComposeFiles, openClawConfig, openClawEnvText, } from "./openclaw-env.js";
import { OPENCLAW_APPROVALS_GET_COMMAND, OPENCLAW_APPROVALS_PENDING_COMMAND, openClawCronCreateCommand, openClawMemoryPath, openClawResponsesBody, openClawRunResult, openClawSeedFileArgs, openClawSkillPath, openClawWriteConfigArgs, parseOpenClawApprovals, parseOpenClawPendingApprovals, readyzIsReady, } from "./openclaw-seed.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
/** OpenClaw gateway (ADR 0007). Approvals on, LiteLLM as the only provider, no channel in B1 (D19, review answer 0.3). */
export class OpenClawAdapter extends BaseAdapter {
    id = "openclaw";
    constructor(cfg) {
        super(cfg);
    }
    secretsFile() {
        return path.join(this.cfg.productRoot, "secrets.json");
    }
    envFile() {
        return path.join(this.cfg.productRoot, "env");
    }
    /** The gateway token, kept in secrets.json (mode 0600). Created on first use; never created by down. */
    tokenFor(create) {
        if (fs.existsSync(this.secretsFile())) {
            const parsed = JSON.parse(fs.readFileSync(this.secretsFile(), "utf8"));
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
    /**
     * H1: the per-run bot token for the mock channel, kept in secrets.json (mode 0600). Created on first use when `create` is
     * true. Returns undefined when the channel option is off or the file has none. Never printed.
     */
    mockChannelTokenFor(create) {
        let parsed = {};
        if (fs.existsSync(this.secretsFile())) {
            parsed = JSON.parse(fs.readFileSync(this.secretsFile(), "utf8"));
            if (typeof parsed.mockChannelToken === "string" && parsed.mockChannelToken !== "") {
                return parsed.mockChannelToken;
            }
        }
        if (!create) {
            return undefined;
        }
        const token = generateOpenClawMockChannelToken();
        fs.mkdirSync(this.cfg.productRoot, { recursive: true });
        fs.writeFileSync(this.secretsFile(), JSON.stringify({ ...parsed, mockChannelToken: token }), { encoding: "utf8", mode: 0o600 });
        fs.chmodSync(this.secretsFile(), 0o600);
        return token;
    }
    /** H1: the bot token the suite's mock channel must accept (Bot API path `/bot<token>/...`). Undefined unless OPENCLAW_CHANNEL_MOCK=1 ran `up`. */
    mockChannelBotToken() {
        return this.cfg.channelMock ? this.mockChannelTokenFor(false) : undefined;
    }
    composeOpts() {
        return {
            projectName: OPENCLAW_COMPOSE_PROJECT,
            files: openClawComposeFiles(),
            cwd: HARNESS_DOCKER_DIR,
            env: { ...process.env, OPENCLAW_ENV_FILE: this.envFile() },
        };
    }
    /** Streams the config to a one-off container that runs as uid 1000 with no network (review answer 0.5). */
    writeConfigInVolume(json) {
        return this.dockerWithStdin(openClawWriteConfigArgs(OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME), json, "OPENCLAW_CONFIG_WRITE_FAILED");
    }
    /** Runs `docker <args>` with `input` on stdin. Output is never printed; only the exit code and the stderr size are reported. */
    dockerWithStdin(args, input, failureCode) {
        return new Promise((resolve, reject) => {
            const child = spawn("docker", args, {
                stdio: ["pipe", "ignore", "pipe"],
            });
            let stderrLength = 0;
            child.stderr.on("data", (chunk) => {
                stderrLength += chunk.length;
            });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`${failureCode}: docker exited ${code} (stderr ${stderrLength} bytes, not printed)`));
                }
            });
            child.stdin.end(input);
        });
    }
    /** Runs a command in the running gateway container and returns stdout. Nothing is printed; a failure reports only the exit code. */
    execInGateway(command, failureCode) {
        const opts = this.composeOpts();
        return new Promise((resolve, reject) => {
            const child = spawn("docker", composeExecArgs(opts, "openclaw", command), {
                cwd: opts.cwd,
                env: opts.env,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            let stderrLength = 0;
            child.stdout.on("data", (chunk) => {
                out += chunk.toString();
            });
            child.stderr.on("data", (chunk) => {
                stderrLength += chunk.length;
            });
            child.on("error", reject);
            child.on("close", (code) => {
                if (code === 0) {
                    resolve(out);
                }
                else {
                    reject(new Error(`${failureCode}: the command exited ${code} (stderr ${stderrLength} bytes, not printed)`));
                }
            });
        });
    }
    // ---- H2: seed primitive. Files go into the state volume as uid 1000 with no network; nothing is printed. ----
    /** Writes `content` to `<workspace>/<relPath>`. The path is validated (relative, no `..`). */
    async seedWorkspaceFile(relPath, content) {
        await this.dockerWithStdin(openClawSeedFileArgs(OPENCLAW_IMAGE, OPENCLAW_STATE_VOLUME, relPath), content, "OPENCLAW_SEED_FAILED");
    }
    /** Writes MEMORY.md, or memory/<name>.md. */
    async seedMemory(name, content) {
        await this.seedWorkspaceFile(openClawMemoryPath(name), content);
    }
    /** Writes <workspace>/skills/<name>/SKILL.md. */
    async seedSkill(name, skillMarkdown) {
        await this.seedWorkspaceFile(openClawSkillPath(name), skillMarkdown);
    }
    /** Creates one automation (cron job) in the running gateway through the CLI. Needs the gateway up. */
    async seedCron(spec) {
        await this.execInGateway(openClawCronCreateCommand(spec), "OPENCLAW_SEED_FAILED");
    }
    // ---- H3: approvals read primitive. Read-only; the `socket` token is dropped before anything is returned. ----
    /** `openclaw approvals get --json` in the gateway container: the effective exec policy and the approvals document. */
    async readApprovals() {
        return parseOpenClawApprovals(await this.execInGateway(OPENCLAW_APPROVALS_GET_COMMAND, "OPENCLAW_APPROVALS_READ_FAILED"));
    }
    /** `openclaw approvals pending --json`: approvals waiting for a decision. */
    async readPendingApprovals() {
        return parseOpenClawPendingApprovals(await this.execInGateway(OPENCLAW_APPROVALS_PENDING_COMMAND, "OPENCLAW_APPROVALS_READ_FAILED"));
    }
    // ---- H6: restart primitive. ----
    /**
     * Restarts the gateway container and waits for /healthz and /readyz. The state volume, the env file and the config are
     * kept as they are, so no option can change across a restart. `up` and `down` stay the only start and stop commands.
     */
    async restart() {
        await composeRestart(this.composeOpts(), "openclaw");
        await this.waitHealthy();
    }
    async up() {
        assertOpenClawPinIsRelease(OPENCLAW_IMAGE);
        await ensureP4Network();
        const liteLlm = readLlmRunState("litellm", llmRunStateFile("litellm")); // LiteLLM must be up first
        const token = this.tokenFor(true);
        fs.mkdirSync(this.cfg.productRoot, { recursive: true });
        const mockChannelToken = this.cfg.channelMock ? this.mockChannelTokenFor(true) : undefined;
        fs.writeFileSync(this.envFile(), openClawEnvText({ gatewayToken: token, liteLlmKey: liteLlm.apiKey, mockChannelToken }), {
            encoding: "utf8",
            mode: 0o600,
        });
        fs.chmodSync(this.envFile(), 0o600);
        await run("docker", ["volume", "create", OPENCLAW_STATE_VOLUME], { cwd: HARNESS_DOCKER_DIR });
        await this.writeConfigInVolume(`${JSON.stringify(openClawConfig({
            responsesApi: this.cfg.responsesApi,
            channelMock: this.cfg.channelMock,
            loopDetection: this.cfg.loopDetection,
            webFetchAllowedHosts: this.cfg.webFetchAllowedHosts,
            webFetchPrivateNetwork: this.cfg.webFetchPrivateNetwork,
            nightlyModel: this.cfg.nightlyModel,
        }), null, 2)}\n`);
        await composeUp(this.composeOpts(), { wait: true });
        await this.waitHealthy();
        console.log(`OpenClaw is up: ${this.cfg.baseUrl}. The gateway token and the provider key are in ${this.envFile()} (mode 0600) and are not printed.`);
    }
    /** Removes containers only. It never creates the token or the env file. The volume goes only with OPENCLAW_DOWN_VOLUMES=1. */
    async down() {
        await composeDown(this.composeOpts(), ["--remove-orphans"]);
        if (process.env.OPENCLAW_DOWN_VOLUMES === "1") {
            await run("docker", ["volume", "rm", "-f", OPENCLAW_STATE_VOLUME], { cwd: HARNESS_DOCKER_DIR });
            fs.rmSync(this.secretsFile(), { force: true });
            fs.rmSync(this.envFile(), { force: true });
        }
    }
    async health() {
        return pollHealth(`${this.cfg.baseUrl}/healthz`, { timeoutMs: 0, isOk: (status) => status === 200 });
    }
    /** /healthz 200, then /readyz with ready: true (VERIFIED: ready after about 30 s). */
    async waitHealthy(timeoutMs) {
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
                }
                else {
                    last = `healthz HTTP ${h.status}`;
                }
            }
            catch {
                last = "connection failed";
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        throw new Error(`Timed out waiting for ${this.cfg.baseUrl}/healthz and /readyz (last: ${last})`);
    }
    async seed() {
        return { product: this.id, created: true, users: [], notes: "Config written into the state volume as uid 1000. No channel and no user in B1." };
    }
    async authenticate() {
        return { product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: `Bearer ${this.tokenFor(false)}`, raw: { source: "secrets.json" } };
    }
    /**
     * Headless agent run: sends one task through POST /v1/responses (the supported gateway API, same codepath as
     * `openclaw agent`) and returns the tool-call trace. It needs OPENCLAW_RESPONSES_API=1 at `up`. The tools are client-side
     * function tools: the gateway returns each call as a function_call item and does not execute it. It never prints the
     * token or the response body. Throws OPENCLAW_RUN_FAILED with the HTTP status on a non-200 (for example 502 when a
     * required tool was not called, or 404 when the endpoint is not enabled).
     */
    async runTask(task, opts = {}) {
        const tools = opts.tools ?? [];
        const r = await fetch(`${this.cfg.baseUrl}/v1/responses`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${this.tokenFor(false)}` },
            body: JSON.stringify(openClawResponsesBody(task, tools, opts.requireTool ?? tools.length > 0)),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
        });
        if (r.status !== 200) {
            throw new Error(`OPENCLAW_RUN_FAILED: POST /v1/responses returned HTTP ${r.status}${this.cfg.responsesApi ? "" : " (OPENCLAW_RESPONSES_API=1 was not set when the config was written)"}`);
        }
        return openClawRunResult(r.status, await r.json());
    }
    /** Health only in B1. An authenticated gateway call is a B2 proof. */
    async proveAuth(session) {
        const r = await fetch(`${session.baseUrl}/healthz`);
        if (r.status !== 200) {
            throw new Error(`OpenClaw proveAuth /healthz returned HTTP ${r.status}`);
        }
    }
}
//# sourceMappingURL=openclaw.adapter.js.map