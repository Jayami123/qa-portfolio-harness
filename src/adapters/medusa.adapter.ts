import { execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { platform } from "node:os";
import path from "node:path";
import type { MedusaConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { run } from "../internal/run.js";
import { resolvePnpm, spawnLogged } from "../internal/spawn-detached.js";
import { HARNESS_DOCKER_DIR, HARNESS_ROOT } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { stopMedusaBackendFromPidFile, writeMedusaBackendPid } from "./medusa-backend-pid.js";
import {
  MEDUSA_HTTP_MODE,
  MEDUSA_MIN_NODE,
  MEDUSA_MIN_PNPM,
  MEDUSA_REBUILD_PACKAGES,
  assertMedusaBackendPresent,
  assertMedusaNodeVersion,
  assertMedusaPnpmVersion,
  buildMedusaBackendEnvFile,
  classifyMedusaProbe,
  decideMedusaBuildSkip,
  isMedusaHealthyStatus,
  medusaBackendStartArgs,
  medusaBuiltServerPackagePath,
  medusaHarnessBuildMarkerPath,
  medusaHealthUrl,
  medusaListen,
  parseMedusaEnvFile,
  redactMedusaText,
  serializeMedusaHarnessBuildRecord,
  type MedusaProbeVerdict,
} from "./medusa-env.js";

const COMPOSE_PROJECT = "qa-harness-medusa";
const DEFAULT_BUILD_MS = 10 * 60_000;
const MIN_BUILD_MS = 120_000;
const DEFAULT_WAIT_MS = 2 * 60_000;
const MIN_WAIT_MS = 120_000;
const MIGRATE_TIMEOUT_MS = 10 * 60_000;
const PROBE_REQUEST_MS = 10_000;
const STOP_POLL_MS = 15_000;
const STOP_POLL_INTERVAL_MS = 200;

interface MedusaProbe {
  verdict: MedusaProbeVerdict;
  status: HealthStatus;
  localhost?: HealthStatus;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MedusaAdapter extends BaseAdapter<MedusaConfig> {
  readonly id = "medusa" as const;
  private backendProcess?: ChildProcess;

  constructor(cfg: MedusaConfig) {
    super(cfg);
  }

  private backendDir(): string {
    return path.join(this.productRoot, "apps", "backend");
  }

  private builtServerPackage(): string {
    return medusaBuiltServerPackagePath(this.backendDir());
  }

  private buildMarkerPath(): string {
    return medusaHarnessBuildMarkerPath(this.backendDir());
  }

  private logFile(): string {
    return path.join(HARNESS_ROOT, ".harness", "medusa-backend.log");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [harnessComposeFile("medusa.compose.yml")],
      cwd: HARNESS_DOCKER_DIR,
    };
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
    return this.timeoutFromEnv("MEDUSA_BUILD_MS", DEFAULT_BUILD_MS, MIN_BUILD_MS);
  }

  private webWaitMs(): number {
    return this.timeoutFromEnv("MEDUSA_WEB_WAIT_MS", DEFAULT_WAIT_MS, MIN_WAIT_MS);
  }

  private readLogTail(max = 4000): string {
    const logFile = this.logFile();
    const raw = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").slice(-max) : "(no log)";
    return redactMedusaText(raw);
  }

  private pnpmVersion(): string {
    try {
      return execFileSync(resolvePnpm(), ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: platform() === "win32",
      }).trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Medusa needs pnpm ${MEDUSA_MIN_PNPM} or newer (DTC starter packageManager). \`pnpm --version\` failed: ${detail}`,
      );
    }
  }

  private assertToolchain(): void {
    assertMedusaNodeVersion(process.versions.node);
    assertMedusaPnpmVersion(this.pnpmVersion());
    assertMedusaBackendPresent(this.productRoot);
    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(
        `Medusa node_modules missing at ${this.productRoot}. Run \`pnpm install --frozen-lockfile\` there first (Node ${MEDUSA_MIN_NODE} or newer).`,
      );
    }
  }

  private writeBackendEnv(): void {
    const templatePath = path.join(this.backendDir(), ".env.template");
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Medusa backend .env.template missing at ${templatePath}.`);
    }
    const file = buildMedusaBackendEnvFile(fs.readFileSync(templatePath, "utf8"), {
      databaseUrl: this.cfg.dbUrl,
    });
    const envPath = path.join(this.backendDir(), ".env");
    fs.writeFileSync(envPath, file, "utf8");
    console.log(`Wrote Medusa backend env at ${envPath} (gitignored).`);
  }

  private backendProcessEnv(): Record<string, string> {
    const envPath = path.join(this.backendDir(), ".env");
    if (!fs.existsSync(envPath)) {
      throw new Error(`Medusa backend .env missing at ${envPath}.`);
    }
    return parseMedusaEnvFile(fs.readFileSync(envPath, "utf8"));
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

  private readBuildMarkerText(): string | undefined {
    const file = this.buildMarkerPath();
    if (!fs.existsSync(file)) {
      return undefined;
    }
    return fs.readFileSync(file, "utf8");
  }

  private logBuildSkipDecision(reason: ReturnType<typeof decideMedusaBuildSkip>["reason"]): void {
    switch (reason) {
      case "skip_matches_head": {
        const head = this.productGitSha();
        console.log(
          `Medusa harness-build.json matches HEAD ${head ?? "(unknown)"}; skipping medusa build (set MEDUSA_WEB_REBUILD=1 to rebuild).`,
        );
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

  private shouldSkipBuild(): boolean {
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

  private writeBuildMarker(): void {
    const sha = this.productGitSha();
    if (sha === undefined) {
      return;
    }
    const marker = this.buildMarkerPath();
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, serializeMedusaHarnessBuildRecord(sha), "utf8");
  }

  private async runPnpm(args: string[], cwd: string, timeoutMs: number): Promise<void> {
    const started = Date.now();
    await run(resolvePnpm(), args, {
      cwd,
      env: this.backendProcessEnv(),
      timeoutMs,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`pnpm ${args.join(" ")} finished in ${seconds} s.`);
  }

  private async rebuildProvenPackages(): Promise<void> {
    if (MEDUSA_REBUILD_PACKAGES.length === 0) {
      return;
    }
    console.log(`Rebuilding ${MEDUSA_REBUILD_PACKAGES.join(", ")} (install scripts were skipped).`);
    await this.runPnpm(["rebuild", ...MEDUSA_REBUILD_PACKAGES], this.productRoot, this.buildTimeoutMs());
  }

  private async migrate(): Promise<void> {
    console.log("Running medusa db:migrate…");
    await this.runPnpm(["medusa", "db:migrate"], this.backendDir(), MIGRATE_TIMEOUT_MS);
  }

  private async ensureBuild(): Promise<void> {
    if (this.shouldSkipBuild()) {
      return;
    }
    console.log(`Building Medusa backend (up to ${String(this.buildTimeoutMs())} ms)…`);
    await this.runPnpm(["medusa", "build"], this.backendDir(), this.buildTimeoutMs());
    if (!fs.existsSync(this.builtServerPackage())) {
      throw new Error(
        `medusa build exited 0 but ${this.builtServerPackage()} is missing.`,
      );
    }
    this.writeBuildMarker();
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

  private async waitForPortClosed(host: string, port: string, deadlineMs: number): Promise<boolean> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      if (!(await this.isPortOpen(host, port))) {
        return true;
      }
      await sleep(STOP_POLL_INTERVAL_MS);
    }
    return !(await this.isPortOpen(host, port));
  }

  private async probeStrict(): Promise<HealthStatus> {
    return pollHealth(medusaHealthUrl(this.cfg.baseUrl), {
      timeoutMs: 0,
      requestTimeoutMs: PROBE_REQUEST_MS,
      isOk: isMedusaHealthyStatus,
      alternateLoopback: false,
    });
  }

  private async probe(): Promise<MedusaProbe> {
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

  private describeStatus(status: HealthStatus): string {
    return status.statusCode !== undefined ? `HTTP ${status.statusCode}` : (status.error ?? "no response");
  }

  private environmentError(probe: MedusaProbe): Error {
    return new Error(
      "ENVIRONMENT finding: Medusa answers on localhost but not 127.0.0.1; it may be bound only to IPv6 (::1). " +
        "Fix the bind before continuing. Not treated as healthy.\n" +
        `  checked ${probe.status.url}: ${this.describeStatus(probe.status)}\n` +
        `  checked ${probe.localhost?.url ?? "(none)"}: ${this.describeStatus(probe.localhost ?? probe.status)}`,
    );
  }

  private async waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const started = Date.now();
    let last: MedusaProbe;
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
        throw new Error(
          `Medusa backend process exited (code ${this.backendProcess.exitCode}). Last log:\n${this.readLogTail()}`,
        );
      }
      if (Date.now() >= deadline) {
        break;
      }
      await sleep(2000);
    }
    throw new Error(
      `Timed out waiting for ${medusaHealthUrl(this.cfg.baseUrl)} to return HTTP 200 (last ${this.describeStatus(last.status)}).\n` +
        `Last log:\n${this.readLogTail()}`,
    );
  }

  /**
   * Production `medusa start` resolves the admin build as `{cwd}/public/admin`.
   * `medusa build` writes that folder under `.medusa/server`, so start must run there.
   * Develop stays in `apps/backend`, where `medusa develop` compiles the admin itself.
   */
  private backendStartCwd(): string {
    return MEDUSA_HTTP_MODE === "production"
      ? path.join(this.backendDir(), ".medusa", "server")
      : this.backendDir();
  }

  private startBackend(): void {
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
    const command =
      MEDUSA_HTTP_MODE === "production"
        ? process.execPath
        : resolvePnpm();
    const args =
      MEDUSA_HTTP_MODE === "production"
        ? [path.join(this.backendDir(), "node_modules", "@medusajs", "cli", "cli.js"), "start"]
        : [...medusaBackendStartArgs(MEDUSA_HTTP_MODE)];
    if (MEDUSA_HTTP_MODE === "production" && !fs.existsSync(args[0] ?? "")) {
      throw new Error(`Medusa CLI missing at ${args[0] ?? "(unknown)"}. Run pnpm install in the DTC starter.`);
    }
    console.log(`Starting Medusa backend in ${cwd} (logs: ${logFile})`);
    this.backendProcess = spawnLogged(command, args, {
      cwd,
      logFile,
      env: this.backendProcessEnv(),
      // Detach so the server stays up after this CLI exits. shell:false so the recorded pid is node.exe, which down() can taskkill.
      detached: true,
      shell: false,
    });
    if (this.backendProcess.pid !== undefined) {
      writeMedusaBackendPid(this.backendProcess.pid);
    }
    this.backendProcess.unref();
  }

  private async stopBackend(host: string, port: string): Promise<void> {
    if (this.backendProcess?.exitCode === null) {
      this.backendProcess.kill("SIGTERM");
      await sleep(1000);
    }
    let stopError: Error | undefined;
    try {
      stopMedusaBackendFromPidFile(HARNESS_ROOT);
    } catch (error) {
      stopError = error instanceof Error ? error : new Error(String(error));
    }
    const closed = await this.waitForPortClosed(host, port, STOP_POLL_MS);
    this.backendProcess = undefined;
    if (closed) {
      return;
    }
    if (stopError !== undefined) {
      throw stopError;
    }
    throw new Error(
      `Medusa backend still listening on ${host}:${port} after stopping the harness pid. The harness did not kill any other process.`,
    );
  }

  async up(): Promise<void> {
    this.assertToolchain();
    const { host, port } = medusaListen(this.cfg.baseUrl);

    await composeUp(this.composeOpts(), { wait: true });
    console.log("Medusa Postgres (127.0.0.1:5433, database medusa) is up. Redis is not started.");

    const already = await this.probe();
    if (already.verdict === "healthy") {
      console.log(`Medusa already healthy at ${already.status.url} (HTTP 200).`);
      return;
    }
    if (already.verdict === "environment") {
      throw this.environmentError(already);
    }

    this.writeBackendEnv();

    if (process.env.MEDUSA_SKIP_WEB_START === "1") {
      throw new Error(
        `Medusa backend is not reachable at ${medusaHealthUrl(this.cfg.baseUrl)} and MEDUSA_SKIP_WEB_START=1. ` +
          `Start it yourself from ${this.backendDir()} with pnpm ${medusaBackendStartArgs(MEDUSA_HTTP_MODE).join(" ")}.`,
      );
    }

    if (await this.isPortOpen(host, port)) {
      throw new Error(
        `Port ${port} on 127.0.0.1 is in use, but /health is not HTTP 200. The harness did not stop anything. ` +
          `Stop that process yourself, or change MEDUSA_BASE_URL, then retry.`,
      );
    }

    await this.rebuildProvenPackages();
    await this.migrate();
    await this.ensureBuild();
    const bootStarted = Date.now();
    this.startBackend();
    await this.waitReady(this.webWaitMs());
    const bootSeconds = ((Date.now() - bootStarted) / 1000).toFixed(1);
    console.log(`Medusa backend is up at ${this.cfg.baseUrl} (${MEDUSA_HTTP_MODE}, ${bootSeconds} s from spawn to HTTP 200).`);
  }

  async down(): Promise<void> {
    const { host, port } = medusaListen(this.cfg.baseUrl);
    await this.stopBackend(host, port);
    await composeDown(this.composeOpts());
    console.log("Medusa backend stopped and compose stack torn down (volumes kept).");
  }

  async health(): Promise<HealthStatus> {
    return this.probeStrict();
  }

  async waitHealthy(timeoutMs?: number): Promise<void> {
    await this.waitReady(timeoutMs ?? this.webWaitMs());
  }

  async seed(): Promise<SeedResult> {
    throw new Error(
      "Medusa seed() is not wired yet. up() runs medusa db:migrate only. " +
        "Admin user, collection, and the second stock location are a later task.",
    );
  }

  async authenticate(): Promise<AuthSession> {
    const email = this.cfg.adminEmail;
    const password = this.cfg.adminPassword;
    if (!email || !password) {
      throw new Error(
        "Medusa authenticate() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.",
      );
    }

    const url = `${this.cfg.baseUrl}/auth/user/emailpass`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const body = (await response.json().catch(() => undefined)) as { token?: string } | undefined;

    if (!response.ok || !body?.token) {
      throw new Error(
        `Medusa POST ${url} failed (HTTP ${response.status}). Confirm the admin user exists and the app is running.`,
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${body.token}`,
      raw: {
        token: body.token,
        publishableApiKey: this.cfg.publishableApiKey,
        storeHeader: this.cfg.publishableApiKey
          ? { "x-publishable-api-key": this.cfg.publishableApiKey }
          : undefined,
        note: "Admin JWT via POST /auth/user/emailpass. Store APIs also need x-publishable-api-key.",
      },
    };
  }
}
