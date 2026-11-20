import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { composeDown, composeUp } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run, runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR, HARNESS_ROOT } from "../paths.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { callMcpTool, mcpReadinessFor } from "./mcp-ready.js";
import { p4RunStateFile, readP4McpCredentials, removeP4RunState, writeP4RunState } from "./p4-run-state.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import { derivedSecondPassword, secondIdentityProduct } from "./p4-second-identity.js";
import { PENPOT_PLUGIN_CODE, PENPOT_PLUGIN_FILE, PENPOT_PLUGIN_READY, fileNameFromToolText, parsePluginState, perUserPluginOk, pluginStateFileName, withUserToken, } from "./penpot-plugin.js";
import { PENPOT_COMPOSE_PROJECT, PENPOT_OWNER_EMAIL, PENPOT_OWNER_NAME, PENPOT_SECOND_EMAIL, PENPOT_SECOND_NAME, penpotComposeEnv, penpotComposeFiles, penpotSecretsFromText, } from "./penpot-env.js";
import { authTokenFromSetCookie, createProfileArgs, loginRequest, profileEmail } from "./penpot-seed.js";
import { decodeTransit } from "./penpot-transit.js";
const POLL_MS = 2000;
const REQUEST_MS = 10_000;
const CREATE_PROFILE_TIMEOUT_MS = 5 * 60 * 1000;
/** The MCP plugin's tools; the check that the list is the real one, not a stub. */
const REQUIRED_TOOL = "execute_code";
const MIN_TOOLS = 4;
const PLUGIN_TABS_TIMEOUT_MS = 5 * 60 * 1000;
const PLUGIN_TABS_POLL_MS = 2000;
/** True while a process with this pid exists. Signal 0 checks without sending anything. */
function processAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Penpot with its official MCP server (ADR 0006). Starts the stack; creates the fake owner through the backend's
 * manage.py CLI; logs in over RPC to prove the owner works; waits for a real MCP handshake and the four tools.
 * Tool calls that edit a design need a browser with the MCP plugin connected: that is proven by the spike, not here.
 */
export class PenpotAdapter extends BaseAdapter {
    id = "penpot";
    secrets;
    constructor(cfg) {
        super(cfg);
    }
    mcpRunStateFile() {
        return p4RunStateFile("penpot");
    }
    /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
    secondRunStateFile() {
        return p4RunStateFile(secondIdentityProduct("penpot"));
    }
    /** H2: the second profile's password, derived from the owner-side secret so a kept volume reuses it. */
    secondPassword(secrets) {
        return derivedSecondPassword(secrets.secretKey, "penpot");
    }
    secretsFile() {
        return path.join(this.cfg.productRoot, "secrets.json");
    }
    secretsFromDisk() {
        const file = this.secretsFile();
        const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
        return penpotSecretsFromText(text);
    }
    writeSecrets(secrets) {
        fs.mkdirSync(this.cfg.productRoot, { recursive: true });
        fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
        fs.chmodSync(this.secretsFile(), 0o600);
    }
    composeOpts() {
        return {
            projectName: PENPOT_COMPOSE_PROJECT,
            files: penpotComposeFiles(this.cfg.perUserPlugin),
            cwd: HARNESS_DOCKER_DIR,
            env: penpotComposeEnv(process.env, this.secrets ?? this.secretsFromDisk()),
        };
    }
    composeArgs(extra) {
        const opts = this.composeOpts();
        return ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), ...extra];
    }
    async up() {
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
        if (this.cfg.perUserPlugin) {
            await this.startPluginTabs();
        }
        const mode = this.cfg.perUserPlugin ? "multi-user, one browser tab per profile with the MCP plugin connected" : "single-user";
        console.log(`Penpot is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}, ${mode}). The run state is ${this.mcpRunStateFile()} and is not printed.`);
    }
    /**
     * H6. Starts scripts/penpot-plugin-tabs.mjs detached: it logs in as each profile, opens that profile's own file, starts
     * the MCP plugin and keeps the tab open. Waits until both tabs report the plugin connected. Its log holds no secrets.
     */
    async startPluginTabs() {
        const secrets = this.secrets ?? this.secretsFromDisk();
        const dir = this.cfg.productRoot;
        fs.mkdirSync(dir, { recursive: true });
        fs.rmSync(path.join(dir, PENPOT_PLUGIN_READY), { force: true });
        const logFd = fs.openSync(path.join(dir, "plugin-tabs.log"), "w", 0o600);
        const child = spawn(process.execPath, [path.join(HARNESS_ROOT, "scripts", "penpot-plugin-tabs.mjs")], {
            detached: true,
            stdio: ["ignore", logFd, logFd],
            env: {
                ...process.env,
                PENPOT_BASE_URL: this.cfg.baseUrl,
                PENPOT_PLUGIN_STATE_DIR: dir,
                PENPOT_OWNER_EMAIL: PENPOT_OWNER_EMAIL,
                PENPOT_OWNER_PASSWORD: secrets.ownerPassword,
                PENPOT_SECOND_EMAIL: PENPOT_SECOND_EMAIL,
                PENPOT_SECOND_PASSWORD: this.secondPassword(secrets),
            },
        });
        child.unref();
        fs.closeSync(logFd);
        if (child.pid === undefined) {
            throw new Error("PENPOT_PLUGIN_TABS_FAILED: the tab process did not start");
        }
        fs.writeFileSync(path.join(dir, "plugin-tabs.pid"), String(child.pid), { mode: 0o600 });
        const deadline = Date.now() + PLUGIN_TABS_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (fs.existsSync(path.join(dir, PENPOT_PLUGIN_READY))) {
                return;
            }
            if (!processAlive(child.pid)) {
                throw new Error("PENPOT_PLUGIN_TABS_FAILED: the tab process exited before both tabs connected (see plugin-tabs.log)");
            }
            await new Promise((resolve) => setTimeout(resolve, PLUGIN_TABS_POLL_MS));
        }
        throw new Error(`PENPOT_PLUGIN_TABS_TIMEOUT: the tabs did not both connect within ${PLUGIN_TABS_TIMEOUT_MS / 1000} s (see plugin-tabs.log)`);
    }
    /** Stops the tab process and removes its state files. Missing files are not an error. */
    stopPluginTabs() {
        const dir = this.cfg.productRoot;
        const pidFile = path.join(dir, "plugin-tabs.pid");
        if (fs.existsSync(pidFile)) {
            const pid = Number(fs.readFileSync(pidFile, "utf8"));
            if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) {
                process.kill(pid, "SIGTERM");
            }
        }
        for (const file of [pidFile, path.join(dir, PENPOT_PLUGIN_READY), path.join(dir, pluginStateFileName("owner")), path.join(dir, pluginStateFileName("second"))]) {
            fs.rmSync(file, { force: true });
        }
    }
    /**
     * H6 live probe. Each tab's user token reaches the MCP and the plugin answers for that user: execute_code returns the
     * name of the file that profile opened. The two names must differ and each must be its own profile's file.
     */
    async probePerUserPlugin() {
        const dir = this.cfg.productRoot;
        const read = (role) => parsePluginState(fs.readFileSync(path.join(dir, pluginStateFileName(role)), "utf8"), role);
        const owner = read("owner");
        const second = read("second");
        const ownerUrl = withUserToken(this.cfg.mcpUrl, owner.mcpToken);
        const secondUrl = withUserToken(this.cfg.mcpUrl, second.mcpToken);
        const ownerTools = (await mcpReadinessFor("penpot", { url: ownerUrl, timeoutMs: p4WaitBudgetMs(), minTools: MIN_TOOLS })).toolNames.length;
        const secondTools = (await mcpReadinessFor("penpot", { url: secondUrl, timeoutMs: p4WaitBudgetMs(), minTools: MIN_TOOLS })).toolNames.length;
        const ownerFile = fileNameFromToolText(await callMcpTool({ url: ownerUrl, name: "execute_code", args: { code: PENPOT_PLUGIN_CODE } }));
        const secondFile = fileNameFromToolText(await callMcpTool({ url: secondUrl, name: "execute_code", args: { code: PENPOT_PLUGIN_CODE } }));
        const fields = {
            ownerFile,
            secondFile,
            distinct: ownerFile !== secondFile,
            ownerMatches: ownerFile === PENPOT_PLUGIN_FILE.owner,
            secondMatches: secondFile === PENPOT_PLUGIN_FILE.second,
            ownerTools,
            secondTools,
        };
        return { product: this.id, ...fields, ok: perUserPluginOk(fields) };
    }
    async down() {
        this.stopPluginTabs();
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
    async health() {
        return pollHealth(`${this.cfg.baseUrl}/`, { timeoutMs: 0, isOk: (status) => status === 200 });
    }
    /** Polls the backend through the frontend proxy until get-profile answers (the anonymous profile is enough). */
    async waitHealthy(timeoutMs) {
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
            }
            catch {
                last = "connection failed";
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        throw new Error(`Timed out waiting for ${url} to answer (last: ${last})`);
    }
    async login(secrets) {
        return this.loginAs(PENPOT_OWNER_EMAIL, secrets.ownerPassword);
    }
    /** login-with-password for any profile. Returns the auth-token cookie value; the password is never printed. */
    async loginAs(email, password) {
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
    async seedSecond() {
        const secrets = this.secrets ?? this.secretsFromDisk();
        const password = this.secondPassword(secrets);
        try {
            await this.loginAs(PENPOT_SECOND_EMAIL, password);
        }
        catch {
            await runCapture("docker", this.composeArgs(["exec", "-T", "backend", ...createProfileArgs(PENPOT_SECOND_EMAIL, PENPOT_SECOND_NAME, password)]), { cwd: this.composeOpts().cwd, env: this.composeOpts().env, timeoutMs: CREATE_PROFILE_TIMEOUT_MS, redact: [password] });
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
    async probeSecondIdentity() {
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
    async seed() {
        const secrets = this.secrets ?? this.secretsFromDisk();
        let created = false;
        try {
            await this.login(secrets);
        }
        catch {
            // Not there yet (or a different password on a kept volume, which then fails below). Create it.
            await runCapture("docker", this.composeArgs(["exec", "-T", "backend", ...createProfileArgs(PENPOT_OWNER_EMAIL, PENPOT_OWNER_NAME, secrets.ownerPassword)]), { cwd: this.composeOpts().cwd, env: this.composeOpts().env, timeoutMs: CREATE_PROFILE_TIMEOUT_MS, redact: [secrets.ownerPassword] });
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
    async profileEmailWith(cookie) {
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
    async authenticate() {
        const token = await this.login(this.secrets ?? this.secretsFromDisk());
        return {
            product: this.id,
            baseUrl: this.cfg.baseUrl,
            authorizationHeader: `auth-token=${token}`,
            raw: { source: "login-with-password" },
        };
    }
    async proveAuth(session) {
        const email = await this.profileEmailWith(session.authorizationHeader);
        if (email !== PENPOT_OWNER_EMAIL) {
            throw new Error("Penpot proveAuth: the session does not belong to the seeded owner");
        }
        console.log("Penpot auth probe: get-profile returned the seeded owner (HTTP 200)");
    }
    /** MCP readiness: handshake, tools/list with at least four tools, and the named tool present. */
    async waitMcp(timeoutMs) {
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
//# sourceMappingURL=penpot.adapter.js.map