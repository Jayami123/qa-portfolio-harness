import { execFileSync, execSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import path from "node:path";
import type { CalConfig } from "../config.js";
import { createPgClient } from "../db/pg.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { detectPackageManager, run, runCapture } from "../internal/run.js";
import { resolveYarn, spawnLogged } from "../internal/spawn-detached.js";
import { HARNESS_ROOT } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-cal";
const COPY_STATIC_TIMEOUT_MS = 3 * 60_000;
const TRPC_BUILD_TIMEOUT_MS = 10 * 60_000;
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

export class CalAdapter extends BaseAdapter<CalConfig> {
  readonly id = "cal" as const;
  private seededApiKey?: string;
  private seedResult?: SeedResult;
  private webProcess?: ChildProcess;

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
      files: [this.productComposeFile(), harnessComposeFile("cal.compose.yml")],
      cwd: this.prismaDir(),
    };
  }

  private readLogTail(logFile: string, max = 4000): string {
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(-max) : "(no log)";
  }

  /** Cal's `yarn dev` uses Turbopack, which crashes on this fork/Windows with a bogus instrumentation.ts miss. */
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
    return {
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: process.env.NODE_OPTIONS?.trim() || "--max-old-space-size=8192",
    };
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

  async up(): Promise<void> {
    if (!fs.existsSync(this.productComposeFile())) {
      throw new Error(
        `Cal prisma compose not found at ${this.productComposeFile()}. Expected the cal.diy fork under ${this.productRoot}.`,
      );
    }

    await composeUp(this.composeOpts());
    console.log("Cal Postgres compose is up (host port 5450, db calendso).");

    const already = await this.health();
    if (already.ok) {
      console.log(`Cal already healthy at ${already.url} (HTTP ${already.statusCode}).`);
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
      let args: string[];
      let label: string;
      if (mode === "prod") {
        await this.ensureProdBuild(yarn);
        args = ["workspace", "@calcom/web", "exec", "next", "start", "-H", host, "-p", port];
        label = `next start -H ${host} -p ${port}`;
      } else if (bundler === "webpack") {
        console.log("Preparing Cal static assets (copy-app-store-static)…");
        await run(yarn, ["workspace", "@calcom/web", "run", "copy-app-store-static"], {
          cwd: this.productRoot,
          timeoutMs: 3 * 60_000,
          env: this.nodeHeapEnv(),
        });
        args = ["workspace", "@calcom/web", "exec", "next", "dev", "--webpack", "-H", host, "-p", port];
        label = `next dev --webpack -H ${host} -p ${port}`;
      } else {
        args = ["dev"];
        label = "yarn dev";
      }

      console.log(`Starting Cal web (${mode}): ${yarn} ${label} (logs: ${logFile})`);
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.writeFileSync(logFile, "");
      this.webProcess = spawnLogged(yarn, args, {
        cwd: this.productRoot,
        logFile,
        env: this.nodeHeapEnv(),
      });
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
    console.log(`Cal web is up at ${this.webRootUrl()}`);
  }

  async down(): Promise<void> {
    await composeDown(this.composeOpts());
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

  private async seedAlreadyPresent(): Promise<boolean> {
    const pool = createPgClient(this.cfg.dbUrl);
    try {
      const users = await pool.query(`SELECT 1 AS ok FROM "User" WHERE email = 'free@example.com' LIMIT 1`);
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
        });
        output = `${captured.stdout}\n${captured.stderr}`;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const extra = error as Error & { stdout?: string; stderr?: string };
        output = `${extra.stdout ?? ""}\n${extra.stderr ?? ""}`;
        this.captureApiKeyFromSeedOutput(output);
        const coreUsers = /free@example\.com/i.test(output);
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
