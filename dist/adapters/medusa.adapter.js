import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import path from "node:path";
import { createPgClient } from "../db/pg.js";
import { composeDown, composeUp, harnessComposeFile, } from "../internal/compose.js";
import { run } from "../internal/run.js";
import { isPidRunning, resolvePnpm, spawnLogged } from "../internal/spawn-detached.js";
import { HARNESS_DOCKER_DIR, HARNESS_ROOT } from "../paths.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { enablePgStatsExtension, pgStatsComposeFiles, pgStatsEnabled } from "./pg-stats.js";
import { elPreloadFromEnv, serverProcessEnv } from "./telemetry-env.js";
import { defaultKillProcessTree, readMedusaBackend2Record, stopMedusaBackend2FromPidFile, stopMedusaBackendFromPidFile, stopMedusaStorefrontFromPidFile, writeMedusaBackend2Pid, writeMedusaBackendPid, writeMedusaStorefrontPid, } from "./medusa-backend-pid.js";
import { MEDUSA_DEFAULT_REDIS_URL, MEDUSA_HTTP_MODE, MEDUSA_MIN_NODE, MEDUSA_MIN_PNPM, MEDUSA_REBUILD_PACKAGES, assertMedusaBackendPresent, assertMedusaNodeVersion, assertMedusaPnpmVersion, buildMedusaBackendEnvFile, readMedusaFfRbac, buildMedusaStorefrontEnvLocal, classifyMedusaProbe, decideMedusaBuildSkip, MEDUSA_BUILD_NODE_ENV, decideMedusaStorefrontBuildSkip, isMedusaHealthyStatus, medusaBackendStartArgs, medusaBuiltServerConfigPath, medusaBuiltServerPackagePath, medusaComposeFileNames, medusaHarnessBuildMarkerPath, medusaHealthUrl, medusaListen, parseMedusaEnvFile, parseMedusaHarnessSwitches, redactMedusaText, renderServerMedusaConfigJs, serializeMedusaHarnessBuildRecord, serializeMedusaStorefrontBuildRecord, } from "./medusa-env.js";
import { medusaComposeRecordFile, resolveMedusaComposeFiles, serializeMedusaComposeRecord, } from "./medusa-compose-record.js";
import { classifyHarnessLauncher, collectDescendants, parseCommandLine, parseWindowsCommandLine, parseLsofPids, parseNetstatListeningPids, } from "./medusa-listeners.js";
import { ensureMedusaAdminUser, readPublishableKeyFromDatabase, runMedusaSeed, } from "./medusa-seed.js";
const COMPOSE_PROJECT = "qa-harness-medusa";
const DEFAULT_BUILD_MS = 10 * 60_000;
const MIN_BUILD_MS = 120_000;
const DEFAULT_WAIT_MS = 2 * 60_000;
const MIN_WAIT_MS = 120_000;
const MIGRATE_TIMEOUT_MS = 10 * 60_000;
const PROBE_REQUEST_MS = 10_000;
const STOP_POLL_MS = 15_000;
const STOP_POLL_INTERVAL_MS = 200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class MedusaAdapter extends BaseAdapter {
    id = "medusa";
    backendProcess;
    storefrontProcess;
    seedResult;
    resolvedPublishableKey;
    constructor(cfg) {
        super(cfg);
    }
    harnessSwitches() {
        return parseMedusaHarnessSwitches(process.env);
    }
    backendDir() {
        return path.join(this.productRoot, "apps", "backend");
    }
    builtServerPackage() {
        return medusaBuiltServerPackagePath(this.backendDir());
    }
    buildMarkerPath() {
        return medusaHarnessBuildMarkerPath(this.backendDir());
    }
    logFile() {
        return path.join(HARNESS_ROOT, ".harness", "medusa-backend.log");
    }
    secondLogFile() {
        return path.join(HARNESS_ROOT, ".harness", "medusa-backend-2.log");
    }
    /** Seams for stopSecondBackend tests: the real record and pid file live under HARNESS_ROOT. */
    readSecondRecord() {
        return readMedusaBackend2Record(HARNESS_ROOT);
    }
    stopSecondPidFile() {
        stopMedusaBackend2FromPidFile(HARNESS_ROOT);
    }
    secondPidRunning(pid) {
        return isPidRunning(pid);
    }
    storefrontLogFile() {
        return path.join(HARNESS_ROOT, ".harness", "medusa-storefront.log");
    }
    storefrontDir() {
        return path.join(this.productRoot, "apps", "storefront");
    }
    composeOpts(fileNames = medusaComposeFileNames(this.harnessSwitches())) {
        return {
            projectName: COMPOSE_PROJECT,
            files: fileNames.map((name) => harnessComposeFile(name)),
            cwd: HARNESS_DOCKER_DIR,
        };
    }
    composeRecordPath() {
        return medusaComposeRecordFile(HARNESS_ROOT);
    }
    readComposeRecordText() {
        const file = this.composeRecordPath();
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    }
    writeComposeRecord(fileNames) {
        const file = this.composeRecordPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, serializeMedusaComposeRecord(fileNames), "utf8");
    }
    clearComposeRecord() {
        fs.rmSync(this.composeRecordPath(), { force: true });
    }
    timeoutFromEnv(envName, defaultMs, minMs) {
        const raw = process.env[envName];
        if (raw === undefined || raw.trim() === "") {
            return defaultMs;
        }
        const requested = Number(raw);
        return Number.isFinite(requested) && requested >= minMs
            ? requested
            : defaultMs;
    }
    buildTimeoutMs() {
        return this.timeoutFromEnv("MEDUSA_BUILD_MS", DEFAULT_BUILD_MS, MIN_BUILD_MS);
    }
    webWaitMs() {
        return this.timeoutFromEnv("MEDUSA_WEB_WAIT_MS", DEFAULT_WAIT_MS, MIN_WAIT_MS);
    }
    readLogTail(max = 4000) {
        const logFile = this.logFile();
        const raw = fs.existsSync(logFile)
            ? fs.readFileSync(logFile, "utf8").slice(-max)
            : "(no log)";
        return redactMedusaText(raw);
    }
    pnpmVersion() {
        try {
            return execFileSync(resolvePnpm(), ["--version"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                shell: platform() === "win32",
            }).trim();
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`Medusa needs pnpm ${MEDUSA_MIN_PNPM} or newer (DTC starter packageManager). \`pnpm --version\` failed: ${detail}`);
        }
    }
    assertToolchain() {
        assertMedusaNodeVersion(process.versions.node);
        assertMedusaPnpmVersion(this.pnpmVersion());
        assertMedusaBackendPresent(this.productRoot);
        if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
            throw new Error(`Medusa node_modules missing at ${this.productRoot}. Run \`pnpm install --frozen-lockfile\` there first (Node ${MEDUSA_MIN_NODE} or newer).`);
        }
    }
    writeBackendEnv() {
        const templatePath = path.join(this.backendDir(), ".env.template");
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Medusa backend .env.template missing at ${templatePath}.`);
        }
        const switches = this.harnessSwitches();
        const file = buildMedusaBackendEnvFile(fs.readFileSync(templatePath, "utf8"), {
            databaseUrl: this.cfg.dbUrl,
            redisUrl: switches.redis ? MEDUSA_DEFAULT_REDIS_URL : undefined,
            stripeApiKey: switches.stripe ? this.cfg.stripeApiKey : undefined,
            stripeWebhookSecret: switches.stripe
                ? this.cfg.stripeWebhookSecret
                : undefined,
            ffRbac: readMedusaFfRbac(process.env),
        });
        const envPath = path.join(this.backendDir(), ".env");
        fs.writeFileSync(envPath, file, "utf8");
        console.log(`Wrote Medusa backend env at ${envPath} (gitignored).`);
    }
    backendProcessEnv() {
        const envPath = path.join(this.backendDir(), ".env");
        if (!fs.existsSync(envPath)) {
            throw new Error(`Medusa backend .env missing at ${envPath}.`);
        }
        return parseMedusaEnvFile(fs.readFileSync(envPath, "utf8"));
    }
    productGitSha() {
        try {
            const sha = execFileSync("git", ["rev-parse", "HEAD"], {
                cwd: this.productRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }).trim();
            return sha.length > 0 ? sha : undefined;
        }
        catch {
            return undefined;
        }
    }
    readBuildMarkerText() {
        const file = this.buildMarkerPath();
        if (!fs.existsSync(file)) {
            return undefined;
        }
        return fs.readFileSync(file, "utf8");
    }
    logBuildSkipDecision(reason) {
        switch (reason) {
            case "skip_matches_head": {
                const head = this.productGitSha();
                console.log(`Medusa harness-build.json matches HEAD ${head ?? "(unknown)"}; skipping medusa build (set MEDUSA_WEB_REBUILD=1 to rebuild).`);
                break;
            }
            case "rebuild_forced":
                console.log("MEDUSA_WEB_REBUILD=1; rebuilding Medusa backend.");
                break;
            case "rebuild_missing_output":
                console.log("Medusa build output missing; running medusa build.");
                break;
            case "rebuild_missing_marker":
                console.log("Medusa harness-build.json is absent; running medusa build.");
                break;
            case "rebuild_bad_marker":
                console.log("Medusa harness-build.json is unreadable or missing gitSha; running medusa build.");
                break;
            case "rebuild_mode_mismatch":
                console.log("Medusa harness-build.json has no mode=production (cached development admin build); running medusa build.");
                break;
            case "rebuild_head_unknown":
                console.log("Medusa product git HEAD could not be read; running medusa build.");
                break;
            case "rebuild_sha_mismatch": {
                const head = this.productGitSha();
                console.log(`Medusa harness-build.json does not match HEAD ${head ?? "(unknown)"}; running medusa build.`);
                break;
            }
            default:
                break;
        }
    }
    shouldSkipBuild() {
        const decision = decideMedusaBuildSkip({
            httpMode: MEDUSA_HTTP_MODE,
            forceRebuild: process.env.MEDUSA_WEB_REBUILD === "1",
            builtServerPackageExists: fs.existsSync(this.builtServerPackage()),
            markerFileText: this.readBuildMarkerText(),
            headGitSha: this.productGitSha(),
        });
        if (decision.reason !== "skip_develop_mode") {
            this.logBuildSkipDecision(decision.reason);
        }
        return decision.skip;
    }
    writeBuildMarker() {
        const sha = this.productGitSha();
        if (sha === undefined) {
            return;
        }
        const marker = this.buildMarkerPath();
        fs.mkdirSync(path.dirname(marker), { recursive: true });
        fs.writeFileSync(marker, serializeMedusaHarnessBuildRecord(sha), "utf8");
    }
    async runPnpm(args, cwd, timeoutMs, extraEnv = {}) {
        const started = Date.now();
        await run(resolvePnpm(), args, {
            cwd,
            env: { ...this.backendProcessEnv(), ...extraEnv },
            timeoutMs,
        });
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`pnpm ${args.join(" ")} finished in ${seconds} s.`);
    }
    async rebuildProvenPackages() {
        if (MEDUSA_REBUILD_PACKAGES.length === 0) {
            return;
        }
        console.log(`Rebuilding ${MEDUSA_REBUILD_PACKAGES.join(", ")} (install scripts were skipped).`);
        await this.runPnpm(["rebuild", ...MEDUSA_REBUILD_PACKAGES], this.productRoot, this.buildTimeoutMs());
    }
    async migrate() {
        console.log("Running medusa db:migrate…");
        await this.runPnpm(["medusa", "db:migrate"], this.backendDir(), MIGRATE_TIMEOUT_MS);
    }
    async ensureBuild() {
        if (this.shouldSkipBuild()) {
            return;
        }
        console.log(`Building Medusa backend (up to ${String(this.buildTimeoutMs())} ms)…`);
        await this.runPnpm(["medusa", "build"], this.backendDir(), this.buildTimeoutMs(), { NODE_ENV: MEDUSA_BUILD_NODE_ENV });
        if (!fs.existsSync(this.builtServerPackage())) {
            throw new Error(`medusa build exited 0 but ${this.builtServerPackage()} is missing.`);
        }
        this.writeBuildMarker();
    }
    writeRuntimeMedusaConfig() {
        const target = medusaBuiltServerConfigPath(this.backendDir());
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, renderServerMedusaConfigJs(this.harnessSwitches(), this.cfg.baseUrl), "utf8");
    }
    async medusaStoreDataFingerprint() {
        const pool = createPgClient(this.cfg.dbUrl);
        try {
            const result = await pool.query(`SELECT COUNT(*)::int AS n FROM product_collection`);
            const collections = result.rows[0]?.n ?? 0;
            return `collections:${collections}`;
        }
        finally {
            await pool.end();
        }
    }
    async ensureStorefrontBuild(publishableKey) {
        this.writeStorefrontEnv(publishableKey);
        const nextDir = path.join(this.storefrontDir(), ".next");
        const marker = path.join(nextDir, "harness-build.json");
        const head = this.productGitSha();
        const storeDataFingerprint = await this.medusaStoreDataFingerprint();
        const markerText = fs.existsSync(marker)
            ? fs.readFileSync(marker, "utf8")
            : undefined;
        const skip = decideMedusaStorefrontBuildSkip({
            forceRebuild: process.env.MEDUSA_WEB_REBUILD === "1",
            nextBuildOutputExists: fs.existsSync(path.join(nextDir, "required-server-files.json")),
            markerFileText: markerText,
            headGitSha: head,
            publishableKey,
            storeDataFingerprint,
        });
        if (skip.skip) {
            console.log(`Medusa storefront .next matches HEAD ${head} and publishable key; skipping next build.`);
            return;
        }
        console.log(`Building Medusa storefront (up to ${String(this.buildTimeoutMs())} ms)…`);
        await this.runPnpm(["next", "build"], this.storefrontDir(), this.buildTimeoutMs());
        if (head !== undefined) {
            fs.mkdirSync(nextDir, { recursive: true });
            fs.writeFileSync(marker, serializeMedusaStorefrontBuildRecord(head, publishableKey, storeDataFingerprint), "utf8");
        }
    }
    writeStorefrontEnv(publishableKey) {
        const templatePath = path.join(this.storefrontDir(), ".env.template");
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Medusa storefront .env.template missing at ${templatePath}.`);
        }
        const switches = this.harnessSwitches();
        const file = buildMedusaStorefrontEnvLocal(fs.readFileSync(templatePath, "utf8"), {
            backendUrl: this.cfg.baseUrl,
            publishableKey,
            stripePublishableKey: switches.stripe
                ? this.cfg.stripePublishableKey
                : undefined,
        });
        const envPath = path.join(this.storefrontDir(), ".env.local");
        fs.writeFileSync(envPath, file, "utf8");
        console.log(`Wrote Medusa storefront env at ${envPath} (gitignored).`);
    }
    async waitForStorefrontReady(timeoutMs) {
        const url = `${this.cfg.storefrontUrl}/dk`;
        const started = Date.now();
        const deadline = Date.now() + timeoutMs;
        let lastStatus;
        while (Date.now() < deadline) {
            try {
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(10_000),
                });
                lastStatus = response.status;
                if (response.status === 200) {
                    const seconds = ((Date.now() - started) / 1000).toFixed(1);
                    console.log(`Medusa storefront GET /dk returned HTTP 200 in ${seconds} s (${url}).`);
                    return;
                }
            }
            catch {
                lastStatus = undefined;
            }
            if (this.storefrontProcess && this.storefrontProcess.exitCode !== null) {
                throw new Error(`Medusa storefront process exited (code ${this.storefrontProcess.exitCode}).`);
            }
            await sleep(2000);
        }
        throw new Error(`Timed out waiting for ${url} to return HTTP 200 (last ${lastStatus === undefined ? "no response" : `HTTP ${lastStatus}`}).`);
    }
    startStorefront() {
        if (this.storefrontProcess && this.storefrontProcess.exitCode === null) {
            return;
        }
        const logFile = this.storefrontLogFile();
        const cwd = this.storefrontDir();
        const { port } = medusaListen(this.cfg.storefrontUrl);
        const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
        if (!fs.existsSync(nextCli)) {
            throw new Error(`Medusa storefront Next.js CLI missing at ${nextCli}. Run pnpm install in the DTC starter.`);
        }
        console.log(`Starting Medusa storefront on port ${port} (logs: ${logFile})`);
        // node.exe + next CLI (shell:false) — pnpm.cmd with shell:false throws EINVAL on Windows.
        this.storefrontProcess = spawnLogged(process.execPath, [nextCli, "start", "-p", String(port)], {
            cwd,
            logFile,
            env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
            detached: true,
            shell: false,
        });
        if (this.storefrontProcess.pid !== undefined) {
            writeMedusaStorefrontPid(this.storefrontProcess.pid);
        }
        this.storefrontProcess.unref();
    }
    async stopStorefront() {
        if (this.storefrontProcess?.exitCode === null) {
            this.storefrontProcess.kill("SIGTERM");
            await sleep(1000);
        }
        stopMedusaStorefrontFromPidFile(HARNESS_ROOT);
        this.storefrontProcess = undefined;
        await this.reapProductListeners(medusaListen(this.cfg.storefrontUrl).port, "storefront");
    }
    listeningPids(port) {
        try {
            if (platform() === "win32") {
                const netstat = execFileSync("netstat", ["-ano"], {
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                });
                return parseNetstatListeningPids(netstat, port);
            }
            const lsof = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            return parseLsofPids(lsof);
        }
        catch {
            // lsof exits 1 when nothing listens on the port.
            return [];
        }
    }
    /** Full argv of `pid`. Windows reads the CIM command line; Linux reads /proc, then falls back to ps. */
    processArgv(pid) {
        if (platform() === "win32") {
            try {
                const out = execFileSync("powershell", [
                    "-NoProfile",
                    "-Command",
                    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
                ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
                return parseWindowsCommandLine(out.trim());
            }
            catch {
                return [];
            }
        }
        try {
            const argv = fs
                .readFileSync(`/proc/${pid}/cmdline`, "utf8")
                .split("\0")
                .filter((arg) => arg !== "");
            if (argv.length > 0) {
                return argv;
            }
        }
        catch {
            // No /proc (macOS): fall back to ps.
        }
        try {
            const out = execFileSync("ps", ["-o", "args=", "-p", String(pid)], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            });
            return parseCommandLine(out.trim());
        }
        catch {
            return [];
        }
    }
    /** Working directory of `pid`. Linux only (/proc/<pid>/cwd); undefined elsewhere. */
    processCwd(pid) {
        if (platform() === "win32") {
            return undefined;
        }
        try {
            return fs.readlinkSync(`/proc/${pid}/cwd`);
        }
        catch {
            return undefined;
        }
    }
    childPids(pid) {
        try {
            return parseLsofPids(execFileSync("pgrep", ["-P", String(pid)], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
            }));
        }
        catch {
            // pgrep exits 1 when there are no children.
            return [];
        }
    }
    signalPids(pids, signal) {
        for (const pid of pids) {
            try {
                process.kill(pid, signal);
            }
            catch {
                // Already gone.
            }
        }
    }
    pidAlive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            return error.code === "EPERM";
        }
    }
    /**
     * Windows: taskkill /T /F. Unix: walk all descendants with pgrep -P, SIGTERM them deepest first and
     * then the pid, wait 2 s, SIGKILL whatever is still alive. No process-group kill.
     */
    async killProcessTree(pid) {
        if (platform() === "win32") {
            execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            return;
        }
        const order = [
            ...collectDescendants(pid, (parent) => this.childPids(parent)),
            pid,
        ];
        this.signalPids(order, "SIGTERM");
        await sleep(2000);
        this.signalPids(order.filter((target) => this.pidAlive(target)), "SIGKILL");
    }
    /**
     * After the pid-file stop, kill leftover listeners on `port` only when they were launched through
     * the harness's own entry point for `expected` (see classifyHarnessLauncher). Anything else is left alone.
     */
    async reapProductListeners(port, expected) {
        for (const pid of this.listeningPids(port)) {
            const kind = classifyHarnessLauncher(this.processArgv(pid), this.productRoot, this.processCwd(pid));
            if (kind !== expected) {
                console.log(`Port ${port} is held by pid ${pid}, which is not the harness ${expected} launched from ${this.productRoot}; not killing it.`);
                continue;
            }
            try {
                await this.killProcessTree(pid);
                console.log(`Killed leftover Medusa ${expected} on port ${port}: pid ${pid} and its children.`);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                console.warn(`Could not kill leftover Medusa ${expected} pid ${pid} on port ${port}: ${detail}`);
            }
        }
    }
    isPortOpen(host, port) {
        return new Promise((resolve) => {
            const socket = net.connect({ host, port: Number(port), timeout: 1000 }, () => {
                socket.end();
                resolve(true);
            });
            socket.on("error", () => resolve(false));
            socket.on("timeout", () => {
                socket.destroy();
                resolve(false);
            });
        });
    }
    async waitForPortClosed(host, port, deadlineMs) {
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
            if (!(await this.isPortOpen(host, port))) {
                return true;
            }
            await sleep(STOP_POLL_INTERVAL_MS);
        }
        return !(await this.isPortOpen(host, port));
    }
    async probeStrict() {
        return pollHealth(medusaHealthUrl(this.cfg.baseUrl), {
            timeoutMs: 0,
            requestTimeoutMs: PROBE_REQUEST_MS,
            isOk: isMedusaHealthyStatus,
            alternateLoopback: false,
        });
    }
    async probe() {
        const strict = await this.probeStrict();
        if (strict.ok) {
            return { verdict: "healthy", status: strict };
        }
        const { port } = medusaListen(this.cfg.baseUrl);
        const localhost = await pollHealth(`http://localhost:${port}/health`, {
            timeoutMs: 0,
            requestTimeoutMs: PROBE_REQUEST_MS,
            isOk: isMedusaHealthyStatus,
            alternateLoopback: false,
        });
        return {
            verdict: classifyMedusaProbe(false, localhost.ok),
            status: strict,
            localhost,
        };
    }
    describeStatus(status) {
        return status.statusCode !== undefined
            ? `HTTP ${status.statusCode}`
            : (status.error ?? "no response");
    }
    environmentError(probe) {
        return new Error("ENVIRONMENT finding: Medusa answers on localhost but not 127.0.0.1; it may be bound only to IPv6 (::1). " +
            "Fix the bind before continuing. Not treated as healthy.\n" +
            `  checked ${probe.status.url}: ${this.describeStatus(probe.status)}\n` +
            `  checked ${probe.localhost?.url ?? "(none)"}: ${this.describeStatus(probe.localhost ?? probe.status)}`);
    }
    async waitReady(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        const started = Date.now();
        let last;
        for (;;) {
            last = await this.probe();
            if (last.verdict === "healthy") {
                const seconds = ((Date.now() - started) / 1000).toFixed(1);
                console.log(`Medusa GET /health returned HTTP 200 in ${seconds} s (${last.status.url}).`);
                return;
            }
            if (last.verdict === "environment") {
                throw this.environmentError(last);
            }
            if (this.backendProcess && this.backendProcess.exitCode !== null) {
                throw new Error(`Medusa backend process exited (code ${this.backendProcess.exitCode}). Last log:\n${this.readLogTail()}`);
            }
            if (Date.now() >= deadline) {
                break;
            }
            await sleep(2000);
        }
        throw new Error(`Timed out waiting for ${medusaHealthUrl(this.cfg.baseUrl)} to return HTTP 200 (last ${this.describeStatus(last.status)}).\n` +
            `Last log:\n${this.readLogTail()}`);
    }
    /**
     * Production `medusa start` resolves the admin build as `{cwd}/public/admin`.
     * `medusa build` writes that folder under `.medusa/server`, so start must run there.
     * Develop stays in `apps/backend`, where `medusa develop` compiles the admin itself.
     */
    backendStartCwd() {
        return MEDUSA_HTTP_MODE === "production"
            ? path.join(this.backendDir(), ".medusa", "server")
            : this.backendDir();
    }
    startBackend() {
        if (this.backendProcess && this.backendProcess.exitCode === null) {
            console.log(`Medusa backend already started in this process (pid ${String(this.backendProcess.pid)}).`);
            return;
        }
        const logFile = this.logFile();
        const cwd = this.backendStartCwd();
        if (!fs.existsSync(cwd)) {
            throw new Error(`Medusa backend start directory missing at ${cwd}.`);
        }
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        // `pnpm medusa start` from apps/backend looks for public/admin and misses the build.
        // The built server directory is not a pnpm workspace package, so start goes through the CLI file.
        const command = MEDUSA_HTTP_MODE === "production" ? process.execPath : resolvePnpm();
        const args = MEDUSA_HTTP_MODE === "production"
            ? [
                path.join(this.backendDir(), "node_modules", "@medusajs", "cli", "cli.js"),
                "start",
            ]
            : [...medusaBackendStartArgs(MEDUSA_HTTP_MODE)];
        if (MEDUSA_HTTP_MODE === "production" && !fs.existsSync(args[0] ?? "")) {
            throw new Error(`Medusa CLI missing at ${args[0] ?? "(unknown)"}. Run pnpm install in the DTC starter.`);
        }
        console.log(`Starting Medusa backend in ${cwd} (logs: ${logFile})`);
        this.backendProcess = spawnLogged(command, args, {
            cwd,
            logFile,
            env: serverProcessEnv(this.backendProcessEnv(), "server", elPreloadFromEnv(process.env)),
            // Detach so the server stays up after this CLI exits. shell:false so the recorded pid is node.exe, which down() can taskkill.
            detached: true,
            shell: false,
        });
        if (this.backendProcess.pid !== undefined) {
            writeMedusaBackendPid(this.backendProcess.pid);
        }
        this.backendProcess.unref();
    }
    async stopBackend(host, port) {
        if (this.backendProcess?.exitCode === null) {
            this.backendProcess.kill("SIGTERM");
            await sleep(1000);
        }
        let stopError;
        try {
            stopMedusaBackendFromPidFile(HARNESS_ROOT);
        }
        catch (error) {
            stopError = error instanceof Error ? error : new Error(String(error));
        }
        await this.reapProductListeners(port, "backend");
        const closed = await this.waitForPortClosed(host, port, STOP_POLL_MS);
        this.backendProcess = undefined;
        if (closed) {
            return;
        }
        if (stopError !== undefined) {
            throw stopError;
        }
        throw new Error(`Medusa backend still listening on ${host}:${port} after stopping the harness pid. Only processes running from ${this.productRoot} are reaped; this one was not.`);
    }
    /**
     * Starts the optional second backend on the same database. Called only after the primary is healthy.
     * PORT is set explicitly so an inherited PORT cannot move the primary backend.
     */
    /** Resolves true only when this call launched a process; false when it adopted a healthy one or had no URL. */
    async startSecondBackend() {
        const url = this.cfg.secondBaseUrl;
        if (url === undefined) {
            return false;
        }
        const { host, port } = medusaListen(url);
        if (await this.isPortOpen(host, port)) {
            const probe = await pollHealth(medusaHealthUrl(url), {
                timeoutMs: 0,
                requestTimeoutMs: PROBE_REQUEST_MS,
                isOk: isMedusaHealthyStatus,
                alternateLoopback: false,
            });
            if (!probe.ok) {
                throw new Error(`Port ${port} on 127.0.0.1 is in use, but /health is not HTTP 200. The harness did not stop anything. ` +
                    `Stop that process yourself, or change MEDUSA_SECOND_BASE_URL, then retry.`);
            }
            // A healthy listener is accepted only when the harness pid record for this baseUrl is still live.
            const record = this.readSecondRecord();
            if (record === undefined || record.baseUrl !== url || !this.secondPidRunning(record.pid)) {
                throw new Error(`Port ${port} on 127.0.0.1 answers /health with HTTP 200, but medusa-backend-2.pid does not record a live pid for ${url}. ` +
                    `The harness did not adopt it and did not stop anything. Stop that process yourself, then retry.`);
            }
            console.log(`Second Medusa backend already healthy at ${url} (recorded pid ${String(record.pid)}); not started again.`);
            return false;
        }
        // A live pid record means an earlier second backend is still running. Overwriting the record would
        // orphan it, because down() only stops the recorded pid. Reject instead; nothing is killed.
        const previous = this.readSecondRecord();
        if (previous !== undefined && this.secondPidRunning(previous.pid)) {
            throw new Error(`medusa-backend-2.pid still records live pid ${String(previous.pid)}${previous.baseUrl === undefined ? "" : ` at ${previous.baseUrl}`}. ` +
                `Run down first; the record was not overwritten and nothing was stopped.`);
        }
        const logFile = this.secondLogFile();
        const cwd = this.backendStartCwd();
        if (!fs.existsSync(cwd)) {
            throw new Error(`Medusa backend start directory missing at ${cwd}.`);
        }
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        const cli = path.join(this.backendDir(), "node_modules", "@medusajs", "cli", "cli.js");
        console.log(`Starting second Medusa backend on ${url} in ${cwd} (logs: ${logFile})`);
        const child = spawnLogged(process.execPath, [cli, "start"], {
            cwd,
            logFile,
            env: {
                ...serverProcessEnv(this.backendProcessEnv(), "server-2", elPreloadFromEnv(process.env)),
                PORT: port,
            },
            detached: true,
            shell: false,
        });
        if (child.pid !== undefined) {
            try {
                writeMedusaBackend2Pid(child.pid, url);
            }
            catch (error) {
                // Without a record, down() cannot find this launcher by pid, so kill it now and keep the original error.
                try {
                    defaultKillProcessTree(child.pid);
                }
                catch {
                    // The launcher may already be gone; the original error is what matters.
                }
                throw error;
            }
        }
        child.unref();
        return true;
    }
    /** Starts the second backend when needed and waits for /health. Stops it on a readiness failure only if this call launched it. */
    async startAndAwaitSecondBackend() {
        const url = this.cfg.secondBaseUrl;
        if (url === undefined) {
            return;
        }
        const launched = await this.startSecondBackend();
        try {
            await this.waitSecondReady(url, this.webWaitMs());
        }
        catch (error) {
            if (launched) {
                // Stop the half-started second backend, so the next up() can start it again.
                await this.stopSecondBackend();
            }
            throw error;
        }
    }
    async waitSecondReady(url, timeoutMs) {
        const status = await pollHealth(medusaHealthUrl(url), {
            timeoutMs,
            requestTimeoutMs: PROBE_REQUEST_MS,
            isOk: isMedusaHealthyStatus,
            alternateLoopback: false,
        });
        if (!status.ok) {
            throw new Error(`Second Medusa backend did not return HTTP 200 from ${medusaHealthUrl(url)} within ${String(timeoutMs)} ms. ` +
                `Log: ${this.secondLogFile()}`);
        }
        console.log(`Second Medusa backend GET /health returned HTTP 200 (${status.url}).`);
    }
    /**
     * The recorded baseUrl wins over the current env, so a second backend started earlier is still stopped
     * after MEDUSA_SECOND_BASE_URL is unset. With neither set this is a no-op.
     * A stop error from the pid file propagates; nothing is reaped after it.
     */
    async stopSecondBackend() {
        const record = this.readSecondRecord();
        const url = record?.baseUrl ?? this.cfg.secondBaseUrl;
        if (url === undefined) {
            return;
        }
        const { host, port } = medusaListen(url);
        this.stopSecondPidFile();
        // Second backend uses the same launcher shape as the primary, so reap it as "backend" on its own port.
        await this.reapProductListeners(port, "backend");
        const closed = await this.waitForPortClosed(host, port, STOP_POLL_MS);
        if (!closed) {
            throw new Error(`Second Medusa backend still listening on ${host}:${port}; not killed.`);
        }
    }
    async up() {
        this.assertToolchain();
        const { host, port } = medusaListen(this.cfg.baseUrl);
        const switches = this.harnessSwitches();
        const composeFiles = [
            ...medusaComposeFileNames(switches),
            ...pgStatsComposeFiles({ env: process.env, product: "medusa" }),
        ];
        // Recorded before compose starts, so down() can tear down a partial bring-up too.
        this.writeComposeRecord(composeFiles);
        await composeUp(this.composeOpts(composeFiles), { wait: true });
        if (pgStatsEnabled(process.env)) {
            await enablePgStatsExtension({
                project: COMPOSE_PROJECT,
                files: this.composeOpts(composeFiles).files,
                service: "postgres",
                user: "medusa",
                db: "medusa",
                cwd: HARNESS_DOCKER_DIR,
            });
        }
        if (switches.redis) {
            console.log("Medusa Postgres (127.0.0.1:5433) and Redis (127.0.0.1:6380) are up.");
        }
        else {
            console.log("Medusa Postgres (127.0.0.1:5433, database medusa) is up. Redis is not started (MEDUSA_REDIS unset).");
        }
        const already = await this.probe();
        if (already.verdict === "healthy") {
            await this.onAlreadyHealthy(already);
            return;
        }
        if (already.verdict === "environment") {
            throw this.environmentError(already);
        }
        this.writeBackendEnv();
        if (process.env.MEDUSA_SKIP_WEB_START === "1") {
            throw new Error(`Medusa backend is not reachable at ${medusaHealthUrl(this.cfg.baseUrl)} and MEDUSA_SKIP_WEB_START=1. ` +
                `Start it yourself from ${this.backendDir()} with pnpm ${medusaBackendStartArgs(MEDUSA_HTTP_MODE).join(" ")}.`);
        }
        if (await this.isPortOpen(host, port)) {
            throw new Error(`Port ${port} on 127.0.0.1 is in use, but /health is not HTTP 200. The harness did not stop anything. ` +
                `Stop that process yourself, or change MEDUSA_BASE_URL, then retry.`);
        }
        await this.rebuildProvenPackages();
        await this.migrate();
        await this.ensureBuild();
        this.writeRuntimeMedusaConfig();
        const bootStarted = Date.now();
        this.startBackend();
        await this.waitReady(this.webWaitMs());
        const bootSeconds = ((Date.now() - bootStarted) / 1000).toFixed(1);
        console.log(`Medusa backend is up at ${this.cfg.baseUrl} (${MEDUSA_HTTP_MODE}, ${bootSeconds} s from spawn to HTTP 200).`);
        // Second backend starts only after the primary has passed health.
        await this.startAndAwaitSecondBackend();
        await this.maybeStartStorefront();
    }
    /**
     * The backend was already running, so its env (MEDUSA_REDIS/MEDUSA_STRIPE) is not re-read.
     * The storefront still needs to come up.
     */
    async onAlreadyHealthy(already) {
        if (this.cfg.secondBaseUrl !== undefined) {
            // The second backend is only started alongside a primary this run starts, so it would be skipped silently here.
            throw new Error(`Medusa is already healthy at ${already.status.url}. Run down first; the second backend was not started (MEDUSA_SECOND_BASE_URL=${this.cfg.secondBaseUrl}).`);
        }
        console.log(`Medusa already healthy at ${already.status.url} (HTTP 200).`);
        console.warn("Medusa already running; MEDUSA_REDIS/MEDUSA_STRIPE changes need `npm run down -- medusa` first.");
        await this.maybeStartStorefront();
    }
    /**
     * Build and start the storefront after seed() so Next.js force-cache sees collections (smoke path).
     */
    async startStorefrontAfterSeed() {
        await this.maybeStartStorefront();
    }
    async storefrontAnswering() {
        const res = await fetch(`${this.cfg.storefrontUrl}/dk`, {
            signal: AbortSignal.timeout(10_000),
        }).catch(() => undefined);
        return res?.status === 200;
    }
    async maybeStartStorefront() {
        if (process.env.MEDUSA_SKIP_STOREFRONT === "1") {
            console.log("MEDUSA_SKIP_STOREFRONT=1; storefront not started.");
            return;
        }
        // Validate the listen URL first, so a bad URL fails even when /dk answers 200.
        const { host, port } = medusaListen(this.cfg.storefrontUrl);
        // Probe before any build or spawn: a running storefront keeps its pid file untouched.
        if (await this.storefrontAnswering()) {
            console.log(`Medusa storefront already running at ${this.cfg.storefrontUrl}/dk; skipping next build and start.`);
            return;
        }
        if (!(this.storefrontProcess && this.storefrontProcess.exitCode === null) &&
            (await this.isPortOpen(host, port))) {
            throw new Error(`Port ${port} on ${host} is in use, but /dk is not HTTP 200. The harness did not stop anything.`);
        }
        const publishableKey = await this.resolvePublishableKeyForStorefront();
        if (publishableKey === undefined) {
            console.log("Medusa publishable API key not found yet; skipping storefront (run seed() or set MEDUSA_PUBLISHABLE_API_KEY).");
            return;
        }
        await this.ensureStorefrontBuild(publishableKey);
        this.startStorefront();
        await this.waitForStorefrontReady(this.webWaitMs());
    }
    async resolvePublishableKeyForStorefront() {
        if (this.resolvedPublishableKey) {
            return this.resolvedPublishableKey;
        }
        if (this.cfg.publishableApiKey &&
            this.cfg.publishableApiKey.trim() !== "") {
            return this.cfg.publishableApiKey.trim();
        }
        return await readPublishableKeyFromDatabase(this.cfg.dbUrl);
    }
    async down() {
        await this.stopStorefront();
        const { host, port } = medusaListen(this.cfg.baseUrl);
        try {
            await this.stopBackend(host, port);
        }
        finally {
            // Runs even if the primary stop throws, so the second backend never outlives down().
            await this.stopSecondBackend();
        }
        const opts = this.composeOpts(resolveMedusaComposeFiles(this.readComposeRecordText(), this.harnessSwitches()));
        if (process.env.MEDUSA_DOWN_VOLUMES === "1") {
            await run("docker", [
                "compose",
                "-p",
                opts.projectName,
                ...opts.files.flatMap((f) => ["-f", f]),
                "down",
                "-v",
                "--remove-orphans",
            ], { cwd: opts.cwd });
            this.clearComposeRecord();
            console.log("Medusa backend stopped and compose stack torn down (volumes removed).");
            return;
        }
        await composeDown(opts, ["--remove-orphans"]);
        this.clearComposeRecord();
        console.log("Medusa backend stopped and compose stack torn down (volumes kept).");
    }
    async health() {
        return this.probeStrict();
    }
    async waitHealthy(timeoutMs) {
        await this.waitReady(timeoutMs ?? this.webWaitMs());
    }
    async seed() {
        if (this.seedResult) {
            return this.seedResult;
        }
        const email = this.cfg.adminEmail;
        const password = this.cfg.adminPassword;
        if (!email || !password) {
            throw new Error("Medusa seed() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.");
        }
        await ensureMedusaAdminUser(this.backendDir(), email, password, this.backendProcessEnv());
        const session = await this.authenticate();
        this.seedResult = await runMedusaSeed({
            cfg: this.cfg,
            switches: this.harnessSwitches(),
            authorizationHeader: session.authorizationHeader,
            backendDir: this.backendDir(),
            processEnv: this.backendProcessEnv(),
        });
        this.resolvedPublishableKey =
            (await readPublishableKeyFromDatabase(this.cfg.dbUrl)) ??
                this.cfg.publishableApiKey?.trim();
        return this.seedResult;
    }
    async authenticate() {
        const email = this.cfg.adminEmail;
        const password = this.cfg.adminPassword;
        if (!email || !password) {
            throw new Error("Medusa authenticate() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.");
        }
        const url = `${this.cfg.baseUrl}/auth/user/emailpass`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        const body = (await response.json().catch(() => undefined));
        if (!response.ok || !body?.token) {
            throw new Error(`Medusa POST ${url} failed (HTTP ${response.status}). Confirm the admin user exists and the app is running.`);
        }
        const publishableApiKey = this.resolvedPublishableKey ?? this.cfg.publishableApiKey;
        return {
            product: this.id,
            baseUrl: this.cfg.baseUrl,
            authorizationHeader: `Bearer ${body.token}`,
            raw: {
                token: body.token,
                publishableApiKey,
                storeHeader: publishableApiKey
                    ? { "x-publishable-api-key": publishableApiKey }
                    : undefined,
                note: "Admin JWT via POST /auth/user/emailpass. Store APIs also need x-publishable-api-key.",
            },
        };
    }
    async proveAuth(session) {
        const url = `${this.cfg.baseUrl}/admin/users/me`;
        const response = await fetch(url, {
            headers: {
                Authorization: session.authorizationHeader,
                Accept: "application/json",
            },
        });
        const body = (await response.json().catch(() => undefined));
        if (!response.ok) {
            throw new Error(`Medusa proveAuth GET ${url} failed (HTTP ${response.status}).`);
        }
        const email = body?.user?.email;
        const expected = this.cfg.adminEmail;
        if (!email || !expected || email !== expected) {
            throw new Error(`Medusa proveAuth: expected user email ${expected ?? "(unset)"}, got ${email ?? "(missing)"}.`);
        }
        console.log(`Medusa proveAuth: ${url} HTTP ${response.status}, email matches.`);
    }
}
//# sourceMappingURL=medusa.adapter.js.map