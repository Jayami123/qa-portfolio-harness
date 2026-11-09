import { execFileSync, execSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { CalConfig } from "../config.js";
import { createPgClient } from "../db/pg.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { withHeapDefault } from "../internal/node-options.js";
import { enablePgStatsExtension, pgStatsComposeFilePaths, pgStatsEnabled } from "./pg-stats.js";
import { detectPackageManager, run, runCapture } from "../internal/run.js";
import { resolveYarn, spawnLogged } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { calDbHostPort, calReadinessError } from "./cal-readiness.js";
import { BaseAdapter } from "./base.js";
import { CAL_SEED_USER_SQL, outputNamesCoreSeedUser, redactSeedOutput } from "./cal-seed.js";
import {
  assertListenerIsRecorded,
  calWebSpawnSpec,
  readCalWebPidRecord,
  recordedWebState,
  settleCalWebStop,
  stopRecordedCalWeb,
  writeCalWebPid,
} from "./cal-web-pid.js";
import { calDownArgs, calUpPrelude, CAL_DB_VOLUME, ensureCalRootEnv, type CalEnvFs } from "./cal-env.js";
import { calWebStopDeps, listenerPids, readWebStartArgs, resolveNextBin } from "./cal-web-process.js";
import { buildCalApiEnv, describeCalApiEnv } from "./cal-api-env.js";
import {
  assertApiListenerIsRecorded,
  calApiSpawnSpec,
  calApiStopDeps,
  type CalApiState,
  classifyCalApiState,
  describeCalApiRecord,
  readCalApiPidRecord,
  settleCalApiStop,
  writeCalApiPid,
} from "./cal-api-pid.js";
import { appendNodeOptions, elPreloadFromEnv } from "./telemetry-env.js";

const COMPOSE_PROJECT = "qa-harness-cal";

/** The real file system for the Cal root .env writer (src/adapters/cal-env.ts). */
const calEnvFs: CalEnvFs = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
  writeFileSync: (p, data, opts) => fs.writeFileSync(p, data, opts),
  copyFileSync: (from, to) => fs.copyFileSync(from, to),
  chmodSync: (p, mode) => fs.chmodSync(p, mode),
  renameSync: (a, b) => fs.renameSync(a, b),
  rmSync: (p, o) => fs.rmSync(p, o),
};
/** The fork's Postgres service. --wait must name it: the fork's one-shot postgres_is_ready container exits, and --wait fails on any exit (docker/compose#10596). */
export const CAL_POSTGRES_SERVICE = "postgres";
export const CAL_REDIS_SERVICE = "redis";
const CAL_WEB_STOP_WAIT_MS = 30_000;
const COPY_STATIC_TIMEOUT_MS = 3 * 60_000;
const TRPC_BUILD_TIMEOUT_MS = 10 * 60_000;
/** Cal API v2 build: the fork's own build:docker plus build. Reuses the tRPC build default (README: CAL_TRPC_BUILD_MS). */
const CAL_API_BUILD_MS = 10 * 60_000;
/** The API readiness wait. Reuses the web wait default (up's CAL_WEB_WAIT_MS); not raised. */
const CAL_API_WAIT_MS = 10 * 60_000;
const CAL_API_BUILD_MARKER = "cal-api-build.json";
/** Host port of the harness Redis overlay (docker/cal.redis.compose.yml). 6380 is Medusa's. */
const CAL_REDIS_HOST_PORT = 6381;
/** Product .env keys the API reads from the root env file. The first three are required. */
const CAL_API_REQUIRED_ENV = ["DATABASE_URL", "NEXTAUTH_SECRET", "CALENDSO_ENCRYPTION_KEY"] as const;
const CAL_API_OPTIONAL_ENV = [
  "DATABASE_READ_URL",
  "DATABASE_WRITE_URL",
  "DATABASE_DIRECT_URL",
  "JWT_SECRET",
  "CALCOM_SERVICE_ACCOUNT_ENCRYPTION_KEY",
] as const;
const DEFAULT_NEXT_BUILD_TIMEOUT_MS = 45 * 60_000;
const MIN_NEXT_BUILD_TIMEOUT_MS = 120_000;
const MIN_TRPC_BUILD_TIMEOUT_MS = 120_000;
const HARNESS_BUILD_MARKER = "harness-build.json";
const TRPC_APP_ROUTER_RELATIVE = path.join(
  "packages",
  "trpc",
  "types",
  "server",
  "routers",
  "_app.d.ts",
);

interface HarnessBuildRecord {
  readonly gitSha: string;
}

/** Cal's default old-space limit. The caller's own limit in NODE_OPTIONS wins; otherwise the default is merged in. */
export const CAL_HEAP_MB = 8192;

/** The heap-only env every Cal process gets (the default for all callers except the web server). */
/** The order of down(): the API first, then the web, then compose (which also removes Redis). Exported so the order is tested. */
export async function calDownSequence(steps: {
  readonly stopApi: () => Promise<void>;
  readonly stopWeb: () => Promise<void>;
  readonly composeDown: () => Promise<void>;
}): Promise<void> {
  await steps.stopApi();
  await steps.stopWeb();
  await steps.composeDown();
}

/** The readiness timeout for the API, with the API log tail. Exported so the message is tested. */
export function apiTimeoutMessage(url: string, logTail: string): string {
  return `Timed out waiting for ${url} to answer OK. Last log:
${logTail}`;
}

export function calHeapEnv(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: withHeapDefault(processEnv.NODE_OPTIONS, CAL_HEAP_MB),
  };
}

/** The Cal web server env: the heap env, plus the event-loop preload when HARNESS_EL_PRELOAD is set. */
export function calNodeHeapEnv(processEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base = calHeapEnv(processEnv);
  const el = elPreloadFromEnv(processEnv);
  if (!el) {
    return base;
  }
  return {
    ...base,
    NODE_OPTIONS: appendNodeOptions(base.NODE_OPTIONS, el.preload),
    HARNESS_EL_OUT: el.out,
    HARNESS_EL_ROLE: "server",
  };
}

export class CalAdapter extends BaseAdapter<CalConfig> {
  readonly id = "cal" as const;
  private seededApiKey?: string;
  private seedResult?: SeedResult;
  private webProcess?: ChildProcess;
  private apiProcess?: ChildProcess;

  constructor(cfg: CalConfig) {
    super(cfg);
  }

  private webRootUrl(): string {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}/`;
  }

  private harnessStateDir(): string {
    return path.join(HARNESS_ROOT, ".harness");
  }

  private prismaDir(): string {
    return path.join(this.productRoot, "packages", "prisma");
  }

  private productComposeFile(): string {
    return path.join(this.prismaDir(), "docker-compose.yml");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [
        this.productComposeFile(),
        harnessComposeFile("cal.compose.yml"),
        harnessComposeFile("cal.redis.compose.yml"),
        ...pgStatsComposeFilePaths({ env: process.env, product: "cal" }),
      ],
      cwd: this.prismaDir(),
    };
  }

  private readLogTail(logFile: string, max = 4000): string {
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(-max) : "(no log)";
  }

  /** Turbopack dev crashes on this fork/Windows with a bogus instrumentation.ts miss, so webpack is the Windows default. */
  private bundler(): "webpack" | "turbopack" {
    const raw = (process.env.CAL_WEB_BUNDLER ?? "").trim().toLowerCase();
    if (raw === "webpack" || raw === "turbopack") {
      return raw;
    }
    return platform() === "win32" ? "webpack" : "turbopack";
  }

  /** Default is production (`next build` + `next start`). `CAL_WEB_MODE=dev` keeps next-dev. */
  private webMode(): "prod" | "dev" {
    return (process.env.CAL_WEB_MODE ?? "prod").trim().toLowerCase() === "dev" ? "dev" : "prod";
  }

  private nodeHeapEnv(): NodeJS.ProcessEnv {
    return calHeapEnv(process.env);
  }

  private nextDir(): string {
    return path.join(this.productRoot, "apps", "web", ".next");
  }

  private prodMarkerPath(): string {
    return path.join(this.nextDir(), "required-server-files.json");
  }

  private harnessBuildMarkerPath(): string {
    return path.join(this.nextDir(), HARNESS_BUILD_MARKER);
  }

  private trpcAppRouterDts(): string {
    return path.join(this.productRoot, TRPC_APP_ROUTER_RELATIVE);
  }

  private timeoutFromEnv(envName: string, defaultMs: number, minMs: number): number {
    const raw = process.env[envName];
    if (raw === undefined || raw.trim() === "") {
      return defaultMs;
    }
    const requested = Number(raw);
    return Number.isFinite(requested) && requested >= minMs ? requested : defaultMs;
  }

  private nextBuildTimeoutMs(): number {
    return this.timeoutFromEnv("CAL_WEB_BUILD_MS", DEFAULT_NEXT_BUILD_TIMEOUT_MS, MIN_NEXT_BUILD_TIMEOUT_MS);
  }

  private trpcBuildTimeoutMs(): number {
    return this.timeoutFromEnv("CAL_TRPC_BUILD_MS", TRPC_BUILD_TIMEOUT_MS, MIN_TRPC_BUILD_TIMEOUT_MS);
  }

  private currentProductGitSha(): string | undefined {
    try {
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: this.productRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return sha.length > 0 ? sha : undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`Cal product git HEAD could not be read (${detail}); rebuilding.`);
      return undefined;
    }
  }

  private readHarnessBuildGitSha(): string | undefined {
    const file = this.harnessBuildMarkerPath();
    if (!fs.existsSync(file)) {
      console.log("Cal harness-build.json is absent; rebuilding.");
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "gitSha" in parsed &&
        typeof parsed.gitSha === "string" &&
        parsed.gitSha.trim().length > 0
      ) {
        return parsed.gitSha.trim();
      }
      console.log("Cal harness-build.json is missing a gitSha; rebuilding.");
      return undefined;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`Cal harness-build.json is unreadable (${detail}); rebuilding.`);
      return undefined;
    }
  }

  private writeHarnessBuildMarker(gitSha: string): void {
    const dir = this.nextDir();
    fs.mkdirSync(dir, { recursive: true });
    const record: HarnessBuildRecord = { gitSha };
    fs.writeFileSync(this.harnessBuildMarkerPath(), `${JSON.stringify(record)}\n`, "utf8");
  }

  private shouldSkipProdBuild(): boolean {
    if (process.env.CAL_WEB_REBUILD === "1") {
      console.log("CAL_WEB_REBUILD=1; rebuilding Cal web.");
      return false;
    }
    if (!fs.existsSync(this.prodMarkerPath())) {
      console.log("Cal production .next marker missing; running next build.");
      return false;
    }
    const recorded = this.readHarnessBuildGitSha();
    if (recorded === undefined) {
      return false;
    }
    const current = this.currentProductGitSha();
    if (current === undefined) {
      return false;
    }
    if (recorded !== current) {
      console.log(`Cal .next is for ${recorded}; HEAD is ${current}; rebuilding.`);
      return false;
    }
    console.log(
      `Cal production .next matches HEAD ${current}; skipping next build (set CAL_WEB_REBUILD=1 to rebuild).`,
    );
    return true;
  }

  /**
   * packages/trpc/react/trpc.ts imports AppRouter from ../types/server/routers/_app,
   * which is gitignored output of @calcom/trpc#build. turbo's @calcom/web#build gets
   * it via ^build; a direct `next build` does not.
   */
  private async generateTrpcTypes(yarn: string): Promise<void> {
    const expected = this.trpcAppRouterDts();
    const missingTypesMessage = `Cal tRPC types were not generated (expected ${expected})`;
    const trpcWait = this.trpcBuildTimeoutMs();
    try {
      console.log(`Generating Cal tRPC types (turbo @calcom/trpc, up to ${String(trpcWait)}ms)…`);
      await run(yarn, ["turbo", "run", "build", "--filter=@calcom/trpc"], {
        cwd: this.productRoot,
        timeoutMs: trpcWait,
        env: { ...this.nodeHeapEnv(), TURBO_TELEMETRY_DISABLED: "1" },
      });
    } catch (error) {
      throw new Error(missingTypesMessage, { cause: error });
    }
    if (!fs.existsSync(expected)) {
      throw new Error(missingTypesMessage);
    }
  }

  private async ensureProdBuild(yarn: string): Promise<void> {
    if (this.shouldSkipProdBuild()) {
      return;
    }
    fs.rmSync(this.harnessBuildMarkerPath(), { force: true });
    console.log("Preparing Cal static assets (copy-app-store-static)…");
    await run(yarn, ["workspace", "@calcom/web", "run", "copy-app-store-static"], {
      cwd: this.productRoot,
      timeoutMs: COPY_STATIC_TIMEOUT_MS,
      env: this.nodeHeapEnv(),
    });
    await this.generateTrpcTypes(yarn);
    const buildWait = this.nextBuildTimeoutMs();
    console.log(`Building Cal web (next build, up to ${String(buildWait)}ms)…`);
    await run(yarn, ["workspace", "@calcom/web", "exec", "next", "build"], {
      cwd: this.productRoot,
      timeoutMs: buildWait,
      env: this.nodeHeapEnv(),
    });
    const gitSha = this.currentProductGitSha();
    if (gitSha !== undefined) {
      this.writeHarnessBuildMarker(gitSha);
    }
  }

  private webListen(): { host: string; port: string } {
    const parsed = new URL(this.cfg.baseUrl);
    return {
      host: parsed.hostname || "127.0.0.1",
      port: parsed.port || "3000",
    };
  }

  private isWebPortOpen(): Promise<boolean> {
    const { host, port } = this.webListen();
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

  private killOccupyingWebPort(): void {
    if (platform() !== "win32") {
      return;
    }
    const { port } = this.webListen();
    try {
      const out = execSync("netstat -ano", { encoding: "utf8" });
      const pids = new Set<number>();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${port} `) || !/LISTENING/i.test(line)) {
          continue;
        }
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isFinite(pid) && pid > 0) {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
          console.log(`Freed Cal port ${port} (killed pid ${pid}).`);
        } catch {
          // already gone
        }
      }
    } catch {
      // best-effort
    }
  }

  private async waitForWeb(logFile: string, timeoutMs: number): Promise<void> {
    const url = this.webRootUrl();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.webProcess && this.webProcess.exitCode !== null) {
        throw new Error(
          `Cal web process exited (code ${this.webProcess.exitCode}). Last log:\n${this.readLogTail(logFile)}`,
        );
      }
      const log = this.readLogTail(logFile, 12_000);
      if (/Ready in /i.test(log) || /Local:\s+http/i.test(log) || /Failed to start server/i.test(log)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    let last = await pollHealth(url, { timeoutMs: 0, requestTimeoutMs: 180_000 });
    while (!last.ok && Date.now() < deadline) {
      if (this.webProcess && this.webProcess.exitCode !== null) {
        throw new Error(
          `Cal web process exited (code ${this.webProcess.exitCode}). Last log:\n${this.readLogTail(logFile)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      last = await pollHealth(url, { timeoutMs: 0, requestTimeoutMs: 180_000 });
    }
    if (!last.ok) {
      throw new Error(
        `Timed out waiting for ${url} to become healthy` +
          (last.statusCode !== undefined ? ` (last HTTP ${last.statusCode})` : "") +
          (last.error ? `: ${last.error}` : "") +
          `\nLast log:\n${this.readLogTail(logFile)}`,
      );
    }
  }

  /** The web and API states for up(). A held API port that is neither healthy nor the recorded pid throws here. */
  private async readyState(): Promise<{ web: "ok" | "down"; api: "ok" | "starting" | "down" }> {
    const web = await pollHealth(this.webRootUrl(), { timeoutMs: 0, requestTimeoutMs: 30_000 });
    return { web: web.ok ? "ok" : "down", api: await this.apiState() };
  }

  /** 200 with the body "OK" (the fork's health route, apps/api/v2/src/app.controller.ts:7). Anything else is not healthy. */
  private async apiHealthOk(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.apiBaseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
      return res.status === 200 && (await res.text()).trim() === "OK";
    } catch {
      return false;
    }
  }

  private async apiState(): Promise<CalApiState> {
    const { port } = this.apiListen();
    const healthy = await this.apiHealthOk();
    const record = readCalApiPidRecord();
    return classifyCalApiState({
      healthy,
      portOpen: healthy || (await this.isApiPortOpen()),
      listeners: listenerPids(port),
      record,
      recordLive: record !== undefined && recordedWebState(record, calApiStopDeps()) === "live",
      port,
      healthUrl: `${this.cfg.apiBaseUrl}/health`,
    });
  }

  private apiListen(): { host: string; port: number } {
    const parsed = new URL(this.cfg.apiBaseUrl);
    return { host: parsed.hostname || "127.0.0.1", port: Number(parsed.port || "5555") };
  }

  private isApiPortOpen(): Promise<boolean> {
    const { host, port } = this.apiListen();
    return new Promise((resolve) => {
      const socket = net.connect({ host, port, timeout: 1000 }, () => {
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

  private apiLogFile(): string {
    return path.join(this.harnessStateDir(), "cal-api.log");
  }

  /** The API process env: the no-fallback keys from the product root .env, the generated test secret, and the port and Redis URL. */
  private apiSpawnEnv(): Record<string, string> {
    const rootEnvFile = path.join(this.productRoot, ".env");
    const rootEnv = loadDotenv({ path: rootEnvFile, processEnv: {} }).parsed ?? {};
    return buildCalApiEnv({
      rootEnv,
      processEnv: process.env,
      dbUrl: this.cfg.dbUrl,
      apiPort: this.apiListen().port,
      redisUrl: `redis://127.0.0.1:${String(CAL_REDIS_HOST_PORT)}`,
    });
  }

  /** Builds the fork's API v2 with its own scripts. Skips when the build marker matches the fork HEAD and main.js exists. */
  private async ensureApiBuild(mainJs: string): Promise<void> {
    const head = (await runCapture("git", ["rev-parse", "HEAD"], { cwd: this.productRoot, timeoutMs: 60_000 })).stdout.trim();
    const markerFile = path.join(this.harnessStateDir(), CAL_API_BUILD_MARKER);
    const marker = fs.existsSync(markerFile)
      ? (JSON.parse(fs.readFileSync(markerFile, "utf8")) as HarnessBuildRecord)
      : undefined;
    if (fs.existsSync(mainJs) && marker?.gitSha === head) {
      console.log(`Cal API v2 build matches HEAD ${head.slice(0, 7)}; skipping the build.`);
      return;
    }
    const yarn = resolveYarn();
    const env = calHeapEnv(process.env);
    for (const script of ["build:docker", "build"]) {
      await run(yarn, ["workspace", "@calcom/api-v2", "run", script], {
        cwd: this.productRoot,
        env,
        timeoutMs: CAL_API_BUILD_MS,
      });
    }
    fs.mkdirSync(this.harnessStateDir(), { recursive: true });
    fs.writeFileSync(markerFile, `${JSON.stringify({ gitSha: head })}\n`, "utf8");
  }

  /** Starts the built API v2 as a detached node process, records its pid, and checks that it stayed up. */
  private async startApi(): Promise<void> {
    const apiDir = path.join(this.productRoot, "apps", "api", "v2");
    const mainJs = path.join(apiDir, "dist", "apps", "api", "v2", "src", "main.js");
    const apiEnv = this.apiSpawnEnv();
    console.log(`Cal API v2 env: ${describeCalApiEnv(apiEnv)}`);
    await this.ensureApiBuild(mainJs);
    const logFile = this.apiLogFile();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, "");
    const spec = calApiSpawnSpec({ execPath: process.execPath, mainJs });
    console.log(`Starting Cal API v2: ${spec.command} ${spec.args.join(" ")} (cwd ${apiDir}; logs: ${logFile})`);
    this.apiProcess = spawnLogged(spec.command, spec.args, {
      cwd: apiDir,
      logFile,
      env: { ...calHeapEnv(process.env), ...apiEnv },
      detached: spec.detached,
      shell: spec.shell,
    });
    if (this.apiProcess.pid !== undefined) {
      writeCalApiPid(this.apiProcess.pid);
    }
    this.apiProcess.unref();
    await new Promise((resolve) => setTimeout(resolve, 8000));
    if (this.apiProcess.exitCode !== null) {
      throw new Error(
        `Cal API v2 exited immediately (code ${String(this.apiProcess.exitCode)}). Last log:\n${this.readLogTail(logFile)}`,
      );
    }
  }

  /** Polls `${apiBaseUrl}/health` until 200. A process that exits, or a timeout, throws with the API log tail. */
  /** Polls the API health until OK. A process that exits, or a timeout, throws with the API log tail. */
  private async waitForApi(logFile: string, timeoutMs: number): Promise<void> {
    const url = `${this.cfg.apiBaseUrl}/health`;
    const deadline = Date.now() + timeoutMs;
    let healthy = await this.apiHealthOk();
    while (!healthy && Date.now() < deadline) {
      if (this.apiProcess && this.apiProcess.exitCode !== null) {
        throw new Error(
          `Cal API v2 process exited (code ${String(this.apiProcess.exitCode)}). Last log:
${this.readLogTail(logFile)}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      healthy = await this.apiHealthOk();
    }
    if (!healthy) {
      throw new Error(apiTimeoutMessage(url, this.readLogTail(logFile)));
    }
  }

  private verifyApiListenerIsRecorded(): void {
    const { host, port } = this.apiListen();
    assertApiListenerIsRecorded({
      address: `${host}:${String(port)}`,
      listeners: listenerPids(port),
      record: readCalApiPidRecord(),
    });
  }

  /** Stops the recorded API pid when its start mark matches, waits for the port, and removes the pid file only when it is free. */
  private async stopApi(): Promise<void> {
    const deps = calApiStopDeps(HARNESS_ROOT);
    const stopped = stopRecordedCalWeb(deps);
    if (stopped?.state === "stale") {
      console.log(
        `Cal API v2 pid file is stale: pid ${String(stopped.record.pid)} is not the recorded process (start mark ${stopped.record.startMark ?? "none"} does not match). Not signaling it.`,
      );
    }
    const { host, port } = this.apiListen();
    const deadline = Date.now() + CAL_WEB_STOP_WAIT_MS;
    while (Date.now() < deadline && (await this.isApiPortOpen())) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const portHeld = await this.isApiPortOpen();
    settleCalApiStop({
      address: `${host}:${String(port)}`,
      portHeld,
      listeners: portHeld ? listenerPids(port) : [],
      record: stopped?.record,
      removePidFile: deps.removePidFile,
    });
  }

  async up(): Promise<void> {
    if (!fs.existsSync(this.productComposeFile())) {
      throw new Error(
        `Cal prisma compose not found at ${this.productComposeFile()}. Expected the cal.diy fork under ${this.productRoot}.`,
      );
    }

    // The extension needs a healthy database, so the pg_stat_statements path waits for the healthcheck.
    const pgStats = pgStatsEnabled(process.env);
    // The volume list is read once before compose up. The writer refuses a new encryption key over an existing database volume.
    const volumeNames = (
      await runCapture("docker", ["volume", "ls", "--format", "{{.Name}}"], { cwd: this.productRoot, timeoutMs: 60_000 })
    ).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
    await calUpPrelude({
      ensureEnv: () => {
        const result = ensureCalRootEnv({
          productRoot: this.productRoot,
          fs: calEnvFs,
          randomBytes,
          calDbVolumeExists: () => volumeNames.includes(CAL_DB_VOLUME),
        });
        if (result.createdFromExample || result.generated.length > 0) {
          console.log(
            `Cal root .env: ${result.createdFromExample ? "created from .env.example; " : ""}generated ${result.generated.join(", ") || "nothing"} (values not printed).`,
          );
        }
      },
      composeUp: () =>
        composeUp(this.composeOpts(), { wait: true, waitServices: [CAL_POSTGRES_SERVICE, CAL_REDIS_SERVICE] }),
    });
    if (pgStats) {
      await enablePgStatsExtension({
        project: COMPOSE_PROJECT,
        files: this.composeOpts().files,
        service: CAL_POSTGRES_SERVICE,
        user: "postgres",
        db: "calendso",
        cwd: this.prismaDir(),
      });
    }
    console.log("Cal Postgres compose is up (host port 5450, db calendso).");

    const state = await this.readyState();
    if (state.web === "ok" && state.api === "ok") {
      await this.assertApiReadsDatabase();
      console.log(`Cal already healthy: web ${this.webRootUrl()}, API v2 ${this.cfg.apiBaseUrl}/health.`);
      return;
    }

    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(`Cal node_modules missing at ${this.productRoot}. Run \`yarn\` there first.`);
    }
    if (!fs.existsSync(path.join(this.productRoot, ".env"))) {
      throw new Error(
        `Cal .env missing at ${this.productRoot}. Copy .env.example → .env and set NEXTAUTH_SECRET + CALENDSO_ENCRYPTION_KEY.`,
      );
    }

    if (state.web !== "ok") {
      await this.ensureWeb();
    }
    if (state.api !== "ok") {
      if (state.api === "down") {
        await this.startApi();
      }
      await this.waitForApi(this.apiLogFile(), CAL_API_WAIT_MS);
      this.verifyApiListenerIsRecorded();
    }
    await this.assertApiReadsDatabase();
    console.log(`Cal is up: web ${this.webRootUrl()}, API v2 ${this.cfg.apiBaseUrl}/health.`);
  }

  /**
   * One DB-backed read through the API (GET /v2/me). `/health` does not touch the database, so it cannot show a
   * missing DATABASE_URL. Fails with a harness: error; the key is used in the request header only, never printed.
   */
  private async assertApiReadsDatabase(): Promise<void> {
    const key = this.cfg.apiKey ?? this.seededApiKey ?? this.apiKeyFromSeedScript();
    if (!key) {
      throw new Error(
        "harness: Cal readiness read needs an API key (CAL_API_KEY, or the seeded key after `yarn db-seed`). None found.",
      );
    }
    const res = await fetch(`${this.cfg.apiBaseUrl}/v2/me`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const message = calReadinessError(res.status, calDbHostPort(this.cfg.dbUrl));
    if (message !== undefined) {
      throw new Error(message);
    }
  }

  /** The web server path of up(): seed, start or reuse the recorded web process, wait for it to answer. */
  private async ensureWeb(): Promise<void> {
    if (process.env.CAL_SKIP_WEB_START === "1") {
      throw new Error(
        `Cal web is not reachable at ${this.webRootUrl()} and CAL_SKIP_WEB_START=1. Start it yourself: cd ${this.productRoot} && yarn workspace @calcom/web exec next start (or CAL_WEB_MODE=dev for next dev).`,
      );
    }

    console.log("Seeding Cal while Postgres is idle (before web start)…");
    await this.seed();

    const logFile = path.join(this.harnessStateDir(), "cal-web.log");
    const requestedWait = process.env.CAL_WEB_WAIT_MS ? Number(process.env.CAL_WEB_WAIT_MS) : 10 * 60_000;
    const timeoutMs =
      Number.isFinite(requestedWait) && requestedWait >= 120_000 ? requestedWait : 10 * 60_000;
    if (process.env.CAL_WEB_WAIT_MS && requestedWait < 120_000) {
      console.warn(
        `CAL_WEB_WAIT_MS=${process.env.CAL_WEB_WAIT_MS} is too short for Cal's first compile; using ${timeoutMs}ms`,
      );
    }

    const recorded = readCalWebPidRecord();
    const recordedState = recorded === undefined ? undefined : recordedWebState(recorded, calWebStopDeps(HARNESS_ROOT));
    if (recordedState === "stale") {
      console.log(
        `Cal pid file is stale: pid ${String(recorded?.pid)} is not the recorded process (start mark ${recorded?.startMark ?? "none"} does not match). Ignoring it and checking the port.`,
      );
    }
    if (recorded !== undefined && recordedState === "live" && !(await this.isWebPortOpen())) {
      console.log(
        `Cal web (pid ${String(recorded.pid)}) is still starting; waiting for it instead of starting another.`,
      );
      await this.waitForWeb(logFile, timeoutMs);
      this.verifyListenerIsRecorded();
      console.log(`Cal web is up at ${this.webRootUrl()}`);
      return;
    }

    if (await this.isWebPortOpen()) {
      const bound = await pollHealth(this.webRootUrl(), { timeoutMs: 0, requestTimeoutMs: 30_000 });
      if (bound.ok) {
        console.log(`Cal already listening at ${bound.url} (HTTP ${bound.statusCode}).`);
        return;
      }
      console.log(
        `Cal port ${this.webListen().port} is bound but not healthy (HTTP ${bound.statusCode ?? "none"}). Restarting the web process.`,
      );
      this.killOccupyingWebPort();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const yarn = resolveYarn();
    const mode = this.webMode();
    const bundler = this.bundler();
    const { host, port } = this.webListen();

    if (!this.webProcess || this.webProcess.exitCode !== null) {
      // The server is node running the fork's Next.js bin, from apps/web (the cwd yarn's workspace used).
      const webDir = path.join(this.productRoot, "apps", "web");
      let nextArgs: string[];
      if (mode === "prod") {
        await this.ensureProdBuild(yarn);
        nextArgs = [...readWebStartArgs(webDir), "-H", host, "-p", port];
      } else {
        if (bundler === "webpack") {
          console.log("Preparing Cal static assets (copy-app-store-static)…");
          await run(yarn, ["workspace", "@calcom/web", "run", "copy-app-store-static"], {
            cwd: this.productRoot,
            timeoutMs: 3 * 60_000,
            env: this.nodeHeapEnv(),
          });
        }
        nextArgs = ["dev", ...(bundler === "webpack" ? ["--webpack"] : []), "-H", host, "-p", port];
      }
      const spec = calWebSpawnSpec({
        platform: platform(),
        execPath: process.execPath,
        nextBin: resolveNextBin(webDir),
        args: nextArgs,
      });

      console.log(`Starting Cal web (${mode}): ${spec.command} ${spec.args.join(" ")} (cwd ${webDir}; logs: ${logFile})`);
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, "");
      this.webProcess = spawnLogged(spec.command, spec.args, {
        cwd: webDir,
        logFile,
        env: calNodeHeapEnv(process.env),
        detached: spec.detached,
        shell: spec.shell,
      });
      if (this.webProcess.pid !== undefined) {
        writeCalWebPid(this.webProcess.pid);
      }
      // Keep the web server running after this CLI exits. `down` stops it from the pid record.
      this.webProcess.unref();
      await new Promise((resolve) => setTimeout(resolve, 8000));
      if (this.webProcess.exitCode !== null) {
        throw new Error(
          `Cal web start exited immediately (code ${this.webProcess.exitCode}). Last log:\n${this.readLogTail(logFile)}`,
        );
      }
    } else {
      console.log(`Cal web already started in this process (pid ${this.webProcess.pid}).`);
    }

    await this.waitForWeb(logFile, timeoutMs);
    this.verifyListenerIsRecorded();
    console.log(`Cal web is up at ${this.webRootUrl()}`);
  }

  /** After Cal answers, the port listener must be the recorded pid. Otherwise up fails and does not guess. */
  private verifyListenerIsRecorded(): void {
    const { host, port } = this.webListen();
    assertListenerIsRecorded({
      address: `${host}:${port}`,
      listeners: listenerPids(Number(port)),
      record: readCalWebPidRecord(),
    });
  }

  async down(): Promise<void> {
    await calDownSequence({
      stopApi: () => this.stopApi(),
      stopWeb: () => this.stopWeb(),
      composeDown: () => composeDown(this.composeOpts(), [...calDownArgs(process.env)]),
    });
    console.log("Cal API v2 and web stopped; compose stack torn down (Postgres and Redis).");
  }

  /**
   * Signals the recorded pid, waits for the port to close, and removes the pid file only when the port is
   * free. A held port keeps the file and throws, saying whether the listener matches the record.
   */
  private async stopWeb(): Promise<void> {
    const deps = calWebStopDeps(HARNESS_ROOT);
    const stopped = stopRecordedCalWeb(deps);
    if (stopped?.state === "stale") {
      console.log(
        `Cal pid file is stale: pid ${String(stopped.record.pid)} is not the recorded process (start mark ${stopped.record.startMark ?? "none"} does not match). Not signaling it.`,
      );
    }
    const { host, port } = this.webListen();
    const deadline = Date.now() + CAL_WEB_STOP_WAIT_MS;
    while (Date.now() < deadline && (await this.isWebPortOpen())) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const portHeld = await this.isWebPortOpen();
    settleCalWebStop({
      address: `${host}:${port}`,
      portHeld,
      listeners: portHeld ? listenerPids(Number(port)) : [],
      record: stopped?.record,
      removePidFile: deps.removePidFile,
    });
  }

  async health(): Promise<HealthStatus> {
    const apiHealth = `${this.cfg.apiBaseUrl}/health`;
    const webRoot = `${this.cfg.baseUrl}/`;

    const api = await pollHealth(apiHealth, { timeoutMs: 0 });
    if (api.ok) {
      return api;
    }

    // This fork has no web /api/health. Do not probe it: webpack compiles a 404
    // and the health check times out while a working GET / is already up.
    return pollHealth(webRoot, { timeoutMs: 0, requestTimeoutMs: 30_000 });
  }

  private seedUsers(): SeedResult["users"] {
    return [
      { email: "free@example.com", role: "free", notes: "password is documented in the cal.diy README" },
      { email: "pro@example.com", role: "pro" },
      { email: "trial@example.com", role: "trial" },
      { email: "admin@example.com", role: "admin" },
      { email: "onboarding@example.com", role: "onboarding" },
    ];
  }

  /** The fork only prints the key on first create. Recover it from scripts/seed.ts if skipped. */
  private apiKeyFromSeedScript(): string | undefined {
    const seedFile = path.join(this.productRoot, "scripts", "seed.ts");
    if (!fs.existsSync(seedFile)) {
      return undefined;
    }
    const text = fs.readFileSync(seedFile, "utf8");
    const hex = text.match(/seedApiKey\([^,]+,\s*"([0-9a-f]+)"/i)?.[1];
    if (!hex) {
      return undefined;
    }
    const prefix = text.match(/API_KEY_PREFIX\s*\?\?\s*"([^"]+)"/)?.[1] ?? "cal_";
    return `${prefix}${hex}`;
  }

  private hashCalApiKey(raw: string): string {
    const token = raw.replace(/^Bearer\s+/i, "");
    const prefix = process.env.API_KEY_PREFIX ?? "cal_";
    const body = token.startsWith(prefix) ? token.slice(prefix.length) : token;
    return createHash("sha256").update(body).digest("hex");
  }

  /** True only when the core seed user's row is in the database. A failed db-seed is accepted on this, not on output alone. */
  private async coreSeedUserRowExists(): Promise<boolean> {
    const pool = createPgClient(this.cfg.dbUrl);
    try {
      const users = await pool.query(CAL_SEED_USER_SQL);
      return (users.rowCount ?? users.rows.length) > 0;
    } catch (error) {
      console.warn(
        `Cal seed user check failed (${error instanceof Error ? error.message : error}); the failed db-seed is not accepted.`,
      );
      return false;
    } finally {
      await pool.end();
    }
  }

  private async seedAlreadyPresent(): Promise<boolean> {
    const pool = createPgClient(this.cfg.dbUrl);
    try {
      const users = await pool.query(CAL_SEED_USER_SQL);
      if ((users.rowCount ?? users.rows.length) < 1) {
        return false;
      }
      const printed = this.cfg.apiKey ?? this.apiKeyFromSeedScript();
      if (!printed) {
        return true;
      }
      const keys = await pool.query(`SELECT 1 AS ok FROM "ApiKey" WHERE "hashedKey" = $1 LIMIT 1`, [
        this.hashCalApiKey(printed),
      ]);
      return (keys.rowCount ?? keys.rows.length) > 0;
    } catch (error) {
      console.warn(
        `Cal seed presence check failed (${error instanceof Error ? error.message : error}); running yarn db-seed.`,
      );
      return false;
    } finally {
      await pool.end();
    }
  }

  private captureApiKeyFromSeedOutput(output: string): void {
    const printed = output.match(/Created seeded API Key:\s*(\S+)/i);
    if (printed?.[1]) {
      this.seededApiKey = printed[1];
      console.log("Captured API key from yarn db-seed output. Set CAL_API_KEY in harness .env to persist it.");
      return;
    }
    if (/API Key already exists/i.test(output)) {
      this.seededApiKey = this.apiKeyFromSeedScript();
      if (this.seededApiKey) {
        console.log("Seed skipped an existing API key; using the hex from the fork's scripts/seed.ts.");
      }
    }
  }

  async seed(): Promise<SeedResult> {
    if (this.seedResult) {
      return this.seedResult;
    }

    if (await this.seedAlreadyPresent()) {
      this.seededApiKey = this.cfg.apiKey ?? this.apiKeyFromSeedScript();
      this.seedResult = {
        product: this.id,
        created: false,
        users: this.seedUsers(),
        notes: "Cal seed users and API key already present; skipped yarn db-seed.",
      };
      console.log(this.seedResult.notes);
      return this.seedResult;
    }

    const pm = detectPackageManager(this.productRoot);
    if (pm !== "yarn") {
      console.warn(`Cal lockfile is yarn.lock; using ${pm} anyway.`);
    }
    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(
        `Cal node_modules missing at ${this.productRoot}. Run \`yarn\` there first, then \`yarn dx\` or \`yarn db-seed\`.`,
      );
    }

    let output = "";
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const captured = await runCapture(resolveYarn(), ["db-seed"], {
          cwd: this.productRoot,
          timeoutMs: 10 * 60 * 1000,
          redactLine: redactSeedOutput,
        });
        output = `${captured.stdout}\n${captured.stderr}`;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const extra = error as Error & { stdout?: string; stderr?: string };
        output = `${extra.stdout ?? ""}\n${extra.stderr ?? ""}`;
        this.captureApiKeyFromSeedOutput(output);
        const coreUsers = outputNamesCoreSeedUser(output) && (await this.coreSeedUserRowExists());
        if (attempt === 1) {
          console.warn(`Cal yarn db-seed attempt ${attempt} failed; retrying once (idle Postgres).`);
          continue;
        }
        if (coreUsers) {
          console.warn(
            "Cal yarn db-seed exited non-zero after core users existed (often a later org upsert). Continuing.",
          );
          lastError = undefined;
          break;
        }
      }
    }

    this.captureApiKeyFromSeedOutput(output);
    if (!this.seededApiKey) {
      this.seededApiKey = this.apiKeyFromSeedScript();
    }

    if (lastError) {
      throw lastError;
    }

    this.seedResult = {
      product: this.id,
      created: true,
      users: this.seedUsers(),
      notes:
        "Invoked the fork's `yarn db-seed` before web start so Prisma is not competing with Next. Copy `Created seeded API Key: cal_…` into CAL_API_KEY. Re-seed skips an existing key.",
    };
    return this.seedResult;
  }

  async authenticate(): Promise<AuthSession> {
    const key = this.cfg.apiKey ?? this.seededApiKey;
    if (!key) {
      throw new Error(
        "Cal authenticate() needs CAL_API_KEY in the harness .env (copy the `cal_…` line from `yarn db-seed`). " +
          "Re-seed skips an existing key and will not print it again.",
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.apiBaseUrl,
      authorizationHeader: key.startsWith("Bearer ") ? key : `Bearer ${key}`,
      raw: {
        webBaseUrl: this.cfg.baseUrl,
        apiBaseUrl: this.cfg.apiBaseUrl,
        source: "CAL_API_KEY",
      },
    };
  }

  /**
   * Prove the Bearer token against an authenticated API v2 route.
   * Public GET /health is not used — it does not require a key.
   */
  async proveAuth(session: AuthSession): Promise<void> {
    const probes = [
      process.env.CAL_AUTH_PROBE_URL,
      `${this.cfg.apiBaseUrl}/api/v2/me`,
      `${this.cfg.apiBaseUrl}/v2/me`,
      `${this.cfg.apiBaseUrl}/me`,
      `${this.cfg.baseUrl}/api/v1/me`,
      `${this.cfg.baseUrl}/api/me`,
    ].filter((url): url is string => Boolean(url));

    let lastError = "no probe attempted";
    for (const url of probes) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            Authorization: session.authorizationHeader,
          },
        });
        const isV2 = url.startsWith(this.cfg.apiBaseUrl);
        if (isV2 && (response.status === 401 || response.status === 403)) {
          throw new Error(
            `Cal auth probe ${url} returned HTTP ${response.status}. CAL_API_KEY is missing, expired, or not a valid API v2 key.`,
          );
        }
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          lastError = `HTTP ${response.status} at ${url}`;
          continue;
        }
        if (response.status >= 500) {
          lastError = `HTTP ${response.status} at ${url}`;
          continue;
        }
        console.log(`Cal auth probe ok: ${url} HTTP ${response.status}`);
        return;
      } catch (error) {
        if (error instanceof Error && error.message.includes("CAL_API_KEY")) {
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
      }
    }

    const inDb = await this.apiKeyRowExists(session.authorizationHeader);
    if (inDb) {
      console.log(
        `Cal API v2 is not running on ${this.cfg.apiBaseUrl}; hashed CAL_API_KEY matches "ApiKey" in Postgres. Start apps/api/v2 for an HTTP /me probe.`,
      );
      return;
    }

    throw new Error(
      `Cal auth probe failed (${lastError}). API v2 /me was unreachable and the hashed key was not in "ApiKey". Set CAL_AUTH_PROBE_URL or start apps/api/v2.`,
    );
  }

  private async apiKeyRowExists(raw: string): Promise<boolean> {
    const pool = createPgClient(this.cfg.dbUrl);
    try {
      const result = await pool.query(`SELECT 1 AS ok FROM "ApiKey" WHERE "hashedKey" = $1 LIMIT 1`, [
        this.hashCalApiKey(raw),
      ]);
      return (result.rowCount ?? 0) > 0;
    } finally {
      await pool.end();
    }
  }
}
