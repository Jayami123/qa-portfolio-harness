import { execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import path from "node:path";
import type { DocumensoConfig } from "../config.js";
import { createPgClient } from "../db/pg.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { run } from "../internal/run.js";
import { resolveNpm, spawnLogged } from "../internal/spawn-detached.js";
import { HARNESS_DOCKER_DIR, HARNESS_ROOT } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { enablePgStatsExtension, pgStatsComposeFilePaths, pgStatsEnabled } from "./pg-stats.js";
import {
  assertDocumensoNodeVersion,
  assertDocumensoPublicHostResolvesToLoopback,
  assertDocumensoSigningCert,
  buildDocumensoAppEnv,
  classifyDocumensoProbe,
  documensoHealthUrls,
  documensoListen,
  isDocumensoHealthyStatus,
  localhostTwin,
  parseDocumensoRunningWebappUrl,
  parseNetstatListeningPids,
  parseTasklistImageName,
  runningWebappUrlMatches,
  type DocumensoProbeVerdict,
} from "./documenso-env.js";
import { stopDocumensoWebFromPidFile, writeDocumensoWebPid } from "./documenso-web-pid.js";

const COMPOSE_PROJECT = "qa-harness-documenso";
const SEED_EXAMPLE_EMAIL = "example@documenso.com";
const HARNESS_BUILD_MARKER = "harness-build.json";
const PROBE_REQUEST_MS = 30_000;
const FIRST_PROBE_REQUEST_MS = 180_000;
const DEFAULT_BUILD_MS = 45 * 60_000;
const MIN_BUILD_MS = 120_000;
const DEFAULT_WAIT_MS = 10 * 60_000;
const MIN_WAIT_MS = 120_000;
const PRISMA_TIMEOUT_MS = 10 * 60_000;
const DOCUMENSO_WEB_STOP_POLL_MS = 15_000;
const DOCUMENSO_WEB_STOP_POLL_INTERVAL_MS = 200;

interface HarnessBuildRecord {
  readonly gitSha: string;
}

interface DocumensoProbe {
  verdict: DocumensoProbeVerdict;
  status: HealthStatus;
  localhost?: HealthStatus;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DocumensoAdapter extends BaseAdapter<DocumensoConfig> {
  readonly id = "documenso" as const;
  private seedResult?: SeedResult;
  private webProcess?: ChildProcess;

  constructor(cfg: DocumensoConfig) {
    super(cfg);
  }

  private remixDir(): string {
    return path.join(this.productRoot, "apps", "remix");
  }

  private buildDir(): string {
    return path.join(this.remixDir(), "build");
  }

  private builtServerMain(): string {
    return path.join(this.buildDir(), "server", "main.js");
  }

  private buildMarkerPath(): string {
    return path.join(this.buildDir(), HARNESS_BUILD_MARKER);
  }

  private logFile(): string {
    return path.join(HARNESS_ROOT, ".harness", "documenso-web.log");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [
        harnessComposeFile("documenso.compose.yml"),
        ...pgStatsComposeFilePaths({ env: process.env, product: "documenso" }),
      ],
      cwd: HARNESS_DOCKER_DIR,
    };
  }

  private appEnv(): Record<string, string> {
    return buildDocumensoAppEnv(this.cfg);
  }

  private timeoutFromEnv(envName: string, defaultMs: number, minMs: number): number {
    const raw = process.env[envName];
    if (raw === undefined || raw.trim() === "") {
      return defaultMs;
    }
    const requested = Number(raw);
    return Number.isFinite(requested) && requested >= minMs ? requested : defaultMs;
  }

  private buildTimeoutMs(): number {
    return this.timeoutFromEnv("DOCUMENSO_WEB_BUILD_MS", DEFAULT_BUILD_MS, MIN_BUILD_MS);
  }

  private webWaitMs(): number {
    return this.timeoutFromEnv("DOCUMENSO_WEB_WAIT_MS", DEFAULT_WAIT_MS, MIN_WAIT_MS);
  }

  private readLogTail(logFile: string, max = 4000): string {
    return fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(-max) : "(no log)";
  }

  /** Ensures node_modules exists and a local .env is present (copied from .env.example in the fork). */
  private prepareProductFiles(): void {
    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(
        `Documenso node_modules missing at ${this.productRoot}. Run \`npm ci\` there first (under Node 24 or newer).`,
      );
    }
    const envPath = path.join(this.productRoot, ".env");
    if (!fs.existsSync(envPath)) {
      const example = path.join(this.productRoot, ".env.example");
      if (!fs.existsSync(example)) {
        throw new Error(`Documenso .env.example missing at ${example}.`);
      }
      fs.copyFileSync(example, envPath);
      console.log("Copied Documenso .env.example to .env in the fork working tree (local, uncommitted).");
    }
  }

  private productGitSha(): string | undefined {
    try {
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: this.productRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  private readBuildMarkerSha(): string | undefined {
    const file = this.buildMarkerPath();
    if (!fs.existsSync(file)) {
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
      return undefined;
    } catch {
      return undefined;
    }
  }

  private shouldSkipBuild(): boolean {
    if (process.env.DOCUMENSO_WEB_REBUILD === "1") {
      console.log("DOCUMENSO_WEB_REBUILD=1; rebuilding Documenso web.");
      return false;
    }
    if (!fs.existsSync(this.builtServerMain())) {
      console.log("Documenso build output missing; running the build.");
      return false;
    }
    const recorded = this.readBuildMarkerSha();
    const current = this.productGitSha();
    if (recorded === undefined || current === undefined || recorded !== current) {
      console.log("Documenso build marker does not match product HEAD; rebuilding.");
      return false;
    }
    console.log(
      `Documenso build matches HEAD ${current}; skipping the build (set DOCUMENSO_WEB_REBUILD=1 to rebuild).`,
    );
    return true;
  }

  /** Mirrors apps/remix/.bin/build.sh without bash, so it runs under Windows cmd. */
  private async ensureBuild(): Promise<void> {
    if (this.shouldSkipBuild()) {
      return;
    }
    fs.rmSync(this.buildMarkerPath(), { force: true });
    const npm = resolveNpm();
    const env = this.appEnv();
    const timeoutMs = this.buildTimeoutMs();
    console.log(`Building Documenso web (up to ${String(timeoutMs)}ms per step)…`);
    await run(npm, ["run", "translate:compile"], { cwd: this.productRoot, env, timeoutMs });
    await run(npm, ["run", "build:app", "-w", "@documenso/remix"], { cwd: this.productRoot, env, timeoutMs });
    await run(npm, ["run", "build:server", "-w", "@documenso/remix"], { cwd: this.productRoot, env, timeoutMs });

    fs.mkdirSync(path.dirname(this.builtServerMain()), { recursive: true });
    fs.copyFileSync(path.join(this.remixDir(), "server", "main.js"), this.builtServerMain());
    const translationsDest = path.join(this.buildDir(), "server", "hono", "packages", "lib", "translations");
    fs.cpSync(path.join(this.productRoot, "packages", "lib", "translations"), translationsDest, {
      recursive: true,
    });

    const sha = this.productGitSha();
    if (sha !== undefined) {
      const record: HarnessBuildRecord = { gitSha: sha };
      fs.writeFileSync(this.buildMarkerPath(), `${JSON.stringify(record)}\n`, "utf8");
    }
  }

  private async waitForPortClosed(host: string, port: string, deadlineMs: number): Promise<boolean> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      if (!(await this.isPortOpen(host, port))) {
        return true;
      }
      await sleep(DOCUMENSO_WEB_STOP_POLL_INTERVAL_MS);
    }
    return !(await this.isPortOpen(host, port));
  }

  private async stopListeningWeb(host: string, port: string): Promise<void> {
    if (this.webProcess?.exitCode === null) {
      this.webProcess.kill("SIGTERM");
      await sleep(3000);
    }
    let stopError: Error | undefined;
    try {
      stopDocumensoWebFromPidFile(HARNESS_ROOT);
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    }
    const closed = await this.waitForPortClosed(host, port, DOCUMENSO_WEB_STOP_POLL_MS);
    if (closed) {
      return;
    }
    if (stopError !== undefined) {
      throw stopError;
    }
    throw new Error(
      `Documenso web still listening on ${host}:${port} after stop attempt.\n` +
        `Listeners:\n${this.portOwnerReport(port)}`,
    );
  }

  private isPortOpen(host: string, port: string): Promise<boolean> {
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

  /**
   * Diagnostic only. Lists the listener PID and executable so Jayami can decide.
   * Never stops anything: no taskkill, no kill signal.
   */
  private portOwnerReport(port: string): string {
    if (platform() !== "win32") {
      return `  (owner lookup is Windows-only; use lsof -i :${port} to see the process)\n`;
    }
    try {
      const netstat = execFileSync("netstat", ["-ano"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const pids = parseNetstatListeningPids(netstat, port);
      if (pids.length === 0) {
        return "  (no LISTENING entry found in netstat)\n";
      }
      let report = "";
      for (const pid of pids) {
        const tasklist = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        report += `  pid ${pid}: ${parseTasklistImageName(tasklist) ?? "unknown executable"}\n`;
      }
      return report;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `  (owner lookup failed: ${detail})\n`;
    }
  }

  /** Strict 127.0.0.1 probe. Both /signin and /api/auth/csrf must answer 200. */
  private async probeBase(base: string, requestTimeoutMs: number): Promise<{ ok: boolean; status: HealthStatus }> {
    const urls = documensoHealthUrls(base);
    const options = {
      timeoutMs: 0,
      requestTimeoutMs,
      isOk: isDocumensoHealthyStatus,
      alternateLoopback: false,
    };
    const signin = await pollHealth(urls.signin, options);
    if (!signin.ok) {
      return { ok: false, status: signin };
    }
    const csrf = await pollHealth(urls.csrf, options);
    return { ok: csrf.ok, status: csrf.ok ? signin : csrf };
  }

  /**
   * Strict 127.0.0.1 probe. Localhost is probed only when the strict probe fails, and only to
   * classify the failure: a localhost-only 200 is an ENVIRONMENT finding, never a pass.
   */
  private async probe(requestTimeoutMs: number): Promise<DocumensoProbe> {
    const strict = await this.probeBase(this.cfg.baseUrl, requestTimeoutMs);
    if (strict.ok) {
      return { verdict: "healthy", status: strict.status };
    }
    const localhost = await this.probeBase(localhostTwin(this.cfg.baseUrl), requestTimeoutMs);
    return {
      verdict: classifyDocumensoProbe(strict.ok, localhost.ok),
      status: strict.status,
      localhost: localhost.status,
    };
  }

  private describeStatus(status: HealthStatus): string {
    return status.statusCode !== undefined ? `HTTP ${status.statusCode}` : (status.error ?? "no response");
  }

  private environmentError(probe: DocumensoProbe): Error {
    return new Error(
      "ENVIRONMENT finding: Documenso answers on localhost but not 127.0.0.1; it may be bound only to IPv6 (::1). " +
        "Fix the bind before continuing. Not treated as healthy.\n" +
        `  checked ${probe.status.url}: ${this.describeStatus(probe.status)}\n` +
        `  checked ${probe.localhost?.url ?? "(none)"}: ${this.describeStatus(probe.localhost ?? probe.status)}`,
    );
  }

  /** HTML of GET /signin on the listen URL. Used only to read window.__ENV__.NEXT_PUBLIC_WEBAPP_URL. */
  private async fetchSigninHtml(): Promise<string | undefined> {
    const { signin } = documensoHealthUrls(this.cfg.baseUrl);
    try {
      const response = await fetch(signin, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "text/html, */*" },
      });
      if (response.status !== 200) return undefined;
      return await response.text();
    } catch {
      return undefined;
    }
  }

  private stalePublicUrlError(found: string | undefined, expected: string, port: string): Error {
    const foundLabel = found ?? "(unreadable)";
    return new Error(
      `Documenso is already serving on 127.0.0.1:${port}, but NEXT_PUBLIC_WEBAPP_URL is ${foundLabel}, expected ${expected}. ` +
        `The harness did not stop anything.\n` +
        `Listeners:\n${this.portOwnerReport(port)}` +
        `Stop that process yourself, then retry so the new public URL (passkey RP ID) is used.`,
    );
  }

  private async waitReady(timeoutMs: number, firstRequestMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let requestMs = firstRequestMs;
    let last: DocumensoProbe;
    for (;;) {
      last = await this.probe(requestMs);
      requestMs = PROBE_REQUEST_MS;
      if (last.verdict === "healthy") {
        console.log(`Documenso health answered on ${new URL(last.status.url).host} (HTTP 200, ${last.status.url}).`);
        return;
      }
      if (last.verdict === "environment") {
        throw this.environmentError(last);
      }
      if (this.webProcess && this.webProcess.exitCode !== null) {
        throw new Error(
          `Documenso web process exited (code ${this.webProcess.exitCode}). Last log:\n${this.readLogTail(this.logFile())}`,
        );
      }
      if (Date.now() >= deadline) {
        break;
      }
      await sleep(2000);
    }
    throw new Error(
      `Timed out waiting for ${this.cfg.baseUrl}/signin to return HTTP 200 (last ${this.describeStatus(last.status)}).\n` +
        `Last log:\n${this.readLogTail(this.logFile())}`,
    );
  }

  async up(): Promise<void> {
    assertDocumensoNodeVersion(process.versions.node);
    assertDocumensoSigningCert(this.productRoot);
    const { host, port } = documensoListen(this.cfg.baseUrl);

    if (this.cfg.publicUrl !== undefined) {
      await assertDocumensoPublicHostResolvesToLoopback(new URL(this.cfg.publicUrl).hostname);
    }

    await composeUp(this.composeOpts(), { wait: true });
    if (pgStatsEnabled(process.env)) {
      await enablePgStatsExtension({
        project: COMPOSE_PROJECT,
        files: this.composeOpts().files,
        service: "postgres",
        user: "documenso",
        db: "documenso",
        cwd: HARNESS_DOCKER_DIR,
      });
    }
    console.log("Documenso Postgres (127.0.0.1:5451) and Inbucket (SMTP 127.0.0.1:2525) are up.");

    const already = await this.probe(FIRST_PROBE_REQUEST_MS);
    if (already.verdict === "healthy") {
      if (this.cfg.publicUrl !== undefined) {
        const html = await this.fetchSigninHtml();
        if (html === undefined || !runningWebappUrlMatches(html, this.cfg.publicUrl)) {
          throw this.stalePublicUrlError(
            html === undefined ? undefined : parseDocumensoRunningWebappUrl(html),
            this.cfg.publicUrl,
            port,
          );
        }
      }
      console.log(`Documenso already healthy at ${already.status.url} (HTTP 200).`);
      if (this.cfg.publicUrl !== undefined) {
        console.log(`Documenso public URL (passkeys): ${this.cfg.publicUrl}`);
      }
      return;
    }
    if (already.verdict === "environment") {
      throw this.environmentError(already);
    }

    this.prepareProductFiles();

    if (process.env.DOCUMENSO_SKIP_WEB_START === "1") {
      throw new Error(
        `Documenso web is not reachable at ${this.cfg.baseUrl}/signin and DOCUMENSO_SKIP_WEB_START=1. ` +
          `Start it yourself: cd ${this.productRoot} && npm run start -w @documenso/remix (after a build).`,
      );
    }

    if (await this.isPortOpen(host, port)) {
      throw new Error(
        `Port ${port} on 127.0.0.1 is in use, but /signin is not HTTP 200. The harness did not stop anything.\n` +
          `Listeners:\n${this.portOwnerReport(port)}` +
          `Decide whether to stop that process yourself, or change DOCUMENSO_BASE_URL, then retry.`,
      );
    }

    await this.migrate();
    await this.seed();
    await this.ensureBuild();
    this.startWeb();
    await this.waitReady(this.webWaitMs(), FIRST_PROBE_REQUEST_MS);
    console.log(`Documenso web is up at ${this.cfg.baseUrl}`);
    if (this.cfg.publicUrl !== undefined) {
      console.log(`Documenso public URL (passkeys): ${this.cfg.publicUrl}`);
    }
  }

  /** Generate the Prisma client (not run by `npm ci` for this fork), then apply migrations. */
  private async migrate(): Promise<void> {
    const opts = { cwd: this.productRoot, env: this.appEnv(), timeoutMs: PRISMA_TIMEOUT_MS };
    await run(resolveNpm(), ["run", "prisma:generate"], opts);
    await run(resolveNpm(), ["run", "prisma:migrate-deploy"], opts);
  }

  private startWeb(): void {
    if (this.webProcess && this.webProcess.exitCode === null) {
      console.log(`Documenso web already started in this process (pid ${String(this.webProcess.pid)}).`);
      return;
    }
    const logFile = this.logFile();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    console.log(`Starting Documenso web: npm run start -w @documenso/remix (logs: ${logFile})`);
    this.webProcess = spawnLogged(resolveNpm(), ["run", "start", "-w", "@documenso/remix"], {
      cwd: this.productRoot,
      logFile,
      env: this.appEnv(),
      detached: platform() !== "win32",
    });
    if (this.webProcess.pid !== undefined) {
      writeDocumensoWebPid(this.webProcess.pid);
    }
    // Keep the web server running after this CLI exits. Stop it yourself (it is not a container).
    this.webProcess.unref();
  }

  async down(): Promise<void> {
    const { host, port } = documensoListen(this.cfg.baseUrl);
    await this.stopListeningWeb(host, port);
    this.webProcess = undefined;
    await composeDown(this.composeOpts());
    console.log("Documenso web stopped and compose stack torn down.");
  }

  async health(): Promise<HealthStatus> {
    return (await this.probe(PROBE_REQUEST_MS)).status;
  }

  async waitHealthy(timeoutMs?: number): Promise<void> {
    await this.waitReady(timeoutMs ?? this.webWaitMs(), PROBE_REQUEST_MS);
  }

  private seedUsers(): SeedResult["users"] {
    return [
      { email: SEED_EXAMPLE_EMAIL, role: "user", notes: "from packages/prisma/seed/initial-seed.ts" },
      { email: "admin@documenso.com", role: "admin" },
    ];
  }

  /** Read-only check. If the table or DB is not ready yet, return false and let prisma:seed run. */
  private async seedAlreadyPresent(): Promise<boolean> {
    const pool = createPgClient(this.cfg.dbUrl);
    try {
      const result = await pool.query(`SELECT 1 AS ok FROM "User" WHERE email = $1 LIMIT 1`, [SEED_EXAMPLE_EMAIL]);
      return (result.rowCount ?? result.rows.length) > 0;
    } catch (error) {
      console.warn(
        `Documenso seed presence check failed (${error instanceof Error ? error.message : String(error)}); running prisma:seed.`,
      );
      return false;
    } finally {
      await pool.end();
    }
  }

  async seed(): Promise<SeedResult> {
    assertDocumensoNodeVersion(process.versions.node);
    if (this.seedResult) {
      return this.seedResult;
    }
    if (await this.seedAlreadyPresent()) {
      this.seedResult = {
        product: this.id,
        created: false,
        users: this.seedUsers(),
        notes: `Documenso seed user ${SEED_EXAMPLE_EMAIL} already present; skipped prisma:seed.`,
      };
      console.log(this.seedResult.notes);
      return this.seedResult;
    }

    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(`Documenso node_modules missing at ${this.productRoot}. Run \`npm ci\` there first.`);
    }
    await run(resolveNpm(), ["run", "prisma:seed"], {
      cwd: this.productRoot,
      env: this.appEnv(),
      timeoutMs: PRISMA_TIMEOUT_MS,
    });
    this.seedResult = {
      product: this.id,
      created: true,
      users: this.seedUsers(),
      notes: "Invoked the fork's `npm run prisma:seed`.",
    };
    return this.seedResult;
  }

  async authenticate(): Promise<AuthSession> {
    const token = this.cfg.apiToken;
    if (!token) {
      // TODO(verify): minting via tRPC api-token-router requires an authenticated
      // session. There is no unauthenticated HTTP helper in the fork for the first token.
      throw new Error(
        "Documenso authenticate() needs DOCUMENSO_API_TOKEN in the harness .env. " +
          "Start the app, sign in as a seeded user, open Settings → API tokens " +
          "(tRPC api-token-router), create a token, and paste it. " +
          "Do not commit the token.",
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${token}`,
      raw: { source: "DOCUMENSO_API_TOKEN" },
    };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const url = `${this.cfg.baseUrl}/api/v1/documents`;
    const response = await fetch(url, {
      headers: { Authorization: session.authorizationHeader, Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Documenso auth probe ${url} returned HTTP ${response.status}. Check DOCUMENSO_API_TOKEN.`);
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`Documenso auth probe ${url} returned HTTP ${response.status}.`);
    }
    console.log(`Documenso auth probe: ${url} HTTP ${response.status}`);
  }
}
