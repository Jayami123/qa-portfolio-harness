/** Twenty helpers. Parsers and guards are pure (no I/O). Secret bootstrap and volume checks accept injected deps for tests. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TWENTY_DEFAULT_IMAGE_TAG = "v2.44.0";
export const TWENTY_IMAGE_REPO = "twentycrm/twenty";

/** Shared dev-seeder password (see fork `seed-users.util.ts` hash comment). Not a production secret. */
export const TWENTY_DEV_SEED_PASSWORD = "tim@apple.dev";

export const TWENTY_DEFAULT_ADMIN_EMAIL = "jane.austen@apple.dev";

/**
 * Seed workspace subdomains, from the fork's dev seeder at 7cbdfec6:
 * packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts:38 (Apple) and :47 (YCombinator).
 * With IS_MULTIWORKSPACE_ENABLED=true the workspace origin is `<subdomain>.<host of SERVER_URL>`
 * (workspace-domains.service.ts:240-245). Use a wildcard hostname (for example lvh.me), not 127.0.0.1.
 */
export const TWENTY_SEED_APPLE_WORKSPACE_SUBDOMAIN = "apple";
export const TWENTY_SEED_YC_WORKSPACE_SUBDOMAIN = "yc";
export const TWENTY_SEED_PRESENCE_EMAIL = TWENTY_DEFAULT_ADMIN_EMAIL;

export const TWENTY_DB_VOLUME_SUFFIX = "db-data";
export const TWENTY_SERVER_VOLUME_SUFFIX = "server-local-data";

/** Fork-only Anchor B overlay; harness must not depend on this file. */
export const TWENTY_FORBIDDEN_COMPOSE_FRAGMENT = "docker-compose.validation.yml";

/** Compose inputs: tracked fork `docker-compose.yml` + harness overlay only. */
export function twentyComposeFilePaths(dockerDir: string, harnessComposeFilePath: string): string[] {
  return [path.join(dockerDir, "docker-compose.yml"), harnessComposeFilePath];
}

const PLACEHOLDER_KEY = /^replace_me/i;

export function twentyImageRef(tag: string): string {
  return `${TWENTY_IMAGE_REPO}:${tag}`;
}

export function isTwentyHealthyStatus(statusCode: number): boolean {
  return statusCode === 200;
}

export function assertTwentyImageTag(imageTag: string): void {
  const tag = imageTag.trim();
  if (!tag) {
    throw new Error("Twenty image tag is empty. Set TWENTY_IMAGE_TAG (for example v2.44.0). This harness does not run :latest.");
  }
  if (tag === "latest") {
    throw new Error(
      `Twenty image tag "latest" is not allowed. Pin TWENTY_IMAGE_TAG (default ${TWENTY_DEFAULT_IMAGE_TAG}).`,
    );
  }
}

export interface TwentyWorkspaceUrls {
  subdomainUrl?: string | null;
  customUrl?: string | null;
}

export interface TwentyWorkspaceForSignIn {
  workspaceUrls?: TwentyWorkspaceUrls | null;
}

/** `subdomainUrl` wins, then `customUrl`, then base URL (fork anchor-b-probe-common.ps1). */
export function selectWorkspaceOrigin(
  workspace: TwentyWorkspaceForSignIn | null | undefined,
  baseUrl: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  if (!workspace?.workspaceUrls) {
    return base;
  }
  const subdomain = workspace.workspaceUrls.subdomainUrl?.trim();
  if (subdomain) {
    return subdomain.replace(/\/$/, "");
  }
  const custom = workspace.workspaceUrls.customUrl?.trim();
  if (custom) {
    return custom.replace(/\/$/, "");
  }
  return base;
}

export interface GraphqlErrorShape {
  message: string;
}

export function parseTwentyMetadataBody<T>(
  statusCode: number,
  body: { data?: T; errors?: GraphqlErrorShape[] },
  context: string,
): T {
  if (body.errors?.length) {
    throw new Error(
      `Twenty ${context} returned GraphQL errors (HTTP ${statusCode}): ${body.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!body.data) {
    throw new Error(`Twenty ${context} returned no data (HTTP ${statusCode}).`);
  }
  return body.data;
}

export interface SignInResultShape {
  signIn?: {
    tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string | null } | null } | null;
    availableWorkspaces?: {
      availableWorkspacesForSignIn?: Array<{
        loginToken?: string | null;
        workspaceUrls?: TwentyWorkspaceUrls | null;
      } | null> | null;
    } | null;
  } | null;
}

export function extractBearerFromSignIn(data: SignInResultShape): string | undefined {
  return data.signIn?.tokens?.accessOrWorkspaceAgnosticToken?.token?.trim() || undefined;
}

export interface LoginTokenExchangeShape {
  getAuthTokensFromLoginToken?: {
    tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string | null } | null } | null;
  } | null;
}

export function extractBearerFromLoginTokenExchange(data: LoginTokenExchangeShape): string | undefined {
  return data.getAuthTokensFromLoginToken?.tokens?.accessOrWorkspaceAgnosticToken?.token?.trim() || undefined;
}

export type TwentySecretKeyState = "missing" | "placeholder" | "real";

export function classifyTwentySecretValue(value: string | undefined): TwentySecretKeyState {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "missing";
  }
  if (PLACEHOLDER_KEY.test(trimmed)) {
    return "placeholder";
  }
  return "real";
}

export function twentyVolumeResetCommand(dockerDir: string, harnessComposeFile: string): string {
  const files = twentyComposeFilePaths(dockerDir, harnessComposeFile);
  const fileArgs = files.map((f) => `-f ${f}`).join(" ");
  return `docker compose -p qa-harness-twenty ${fileArgs} down -v (from ${dockerDir})`;
}

export interface TwentyVolumeCheck {
  listVolumes(): string[];
}

export function twentyHarnessVolumesExist(check: TwentyVolumeCheck, projectName = "qa-harness-twenty"): boolean {
  const prefix = `${projectName}_`;
  const names = check.listVolumes();
  return names.some((name) => name === `${prefix}${TWENTY_DB_VOLUME_SUFFIX}` || name === `${prefix}${TWENTY_SERVER_VOLUME_SUFFIX}`);
}

export const TWENTY_REQUIRE_FRESH_INVALID = "TWENTY_REQUIRE_FRESH_INVALID";
export const TWENTY_REQUIRE_FRESH_VOLUMES_EXIST = "TWENTY_REQUIRE_FRESH_VOLUMES_EXIST";

/** True only for the exact value "1". Undefined or blank is false. Any other non-blank value throws TWENTY_REQUIRE_FRESH_INVALID. */
export function readTwentyRequireFresh(env: NodeJS.ProcessEnv): boolean {
  const raw = env.TWENTY_REQUIRE_FRESH;
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  if (raw === "1") {
    return true;
  }
  throw new Error(`${TWENTY_REQUIRE_FRESH_INVALID}: TWENTY_REQUIRE_FRESH must be 1 or unset (got "${raw}")`);
}

/** Throws, naming the existing harness volumes, when requireFresh is set and one exists. Called before composeUp. */
export function assertTwentyFreshOrRefuse(opts: {
  requireFresh: boolean;
  volumes: TwentyVolumeCheck;
  projectName?: string;
}): void {
  if (!opts.requireFresh) {
    return;
  }
  const projectName = opts.projectName ?? "qa-harness-twenty";
  if (!twentyHarnessVolumesExist(opts.volumes, projectName)) {
    return;
  }
  const prefix = `${projectName}_`;
  const names = opts.volumes.listVolumes();
  const present = [`${prefix}${TWENTY_DB_VOLUME_SUFFIX}`, `${prefix}${TWENTY_SERVER_VOLUME_SUFFIX}`].filter((n) => names.includes(n));
  throw new Error(
    `${TWENTY_REQUIRE_FRESH_VOLUMES_EXIST}: ${present.join(" and ")} exist. Reset with TWENTY_DOWN_VOLUMES=1 npm run down -- twenty.`,
  );
}

export interface TwentyDockerEnvFs {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: "utf8"): string;
  writeFileSync(filePath: string, data: string): void;
  copyFileSync(from: string, to: string): void;
}

export interface BootstrapTwentyDockerEnvOptions {
  dockerDir: string;
  harnessComposeFile: string;
  fs: TwentyDockerEnvFs;
  randomBytes(size: number): Buffer;
  volumes: TwentyVolumeCheck;
  projectName?: string;
}

export interface BootstrapTwentyDockerEnvResult {
  generatedNewSecrets: boolean;
}

function readEnvKey(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^\\s*${key}=(.*)$`, "m"));
  return match?.[1]?.trim();
}

function setOrAppendEnvKey(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}=.*$`, "m");
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  const suffix = text.endsWith("\n") || text.length === 0 ? "" : "\n";
  return `${text}${suffix}${line}\n`;
}

function wouldGenerateSecret(state: TwentySecretKeyState): boolean {
  return state === "missing" || state === "placeholder";
}

/**
 * Ensure packages/twenty-docker/.env exists with ENCRYPTION_KEY and APP_SECRET.
 * Never overwrites real keys. Throws if new keys would be written while harness volumes already exist.
 */
export function bootstrapTwentyDockerEnv(options: BootstrapTwentyDockerEnvOptions): BootstrapTwentyDockerEnvResult {
  const envPath = path.join(options.dockerDir, ".env");
  const examplePath = path.join(options.dockerDir, ".env.example");
  let text: string;
  if (!options.fs.existsSync(envPath)) {
    if (!options.fs.existsSync(examplePath)) {
      throw new Error(`Twenty docker .env.example missing at ${examplePath}.`);
    }
    options.fs.copyFileSync(examplePath, envPath);
    text = options.fs.readFileSync(envPath, "utf8");
  } else {
    text = options.fs.readFileSync(envPath, "utf8");
  }

  const encryptionState = classifyTwentySecretValue(readEnvKey(text, "ENCRYPTION_KEY"));
  const appSecretState = classifyTwentySecretValue(readEnvKey(text, "APP_SECRET"));
  const willGenerate =
    wouldGenerateSecret(encryptionState) || wouldGenerateSecret(appSecretState);

  if (willGenerate && twentyHarnessVolumesExist(options.volumes, options.projectName)) {
    throw new Error(
      `Twenty docker volumes already exist but ${envPath} is missing real ENCRYPTION_KEY / APP_SECRET. ` +
        `Reset volumes before generating new keys:\n  ${twentyVolumeResetCommand(options.dockerDir, options.harnessComposeFile)}`,
    );
  }

  let generatedNewSecrets = false;
  const writeKey = (key: string, state: TwentySecretKeyState) => {
    if (!wouldGenerateSecret(state)) {
      return;
    }
    const value = options.randomBytes(32).toString("base64");
    text = setOrAppendEnvKey(text, key, value);
    generatedNewSecrets = true;
  };

  writeKey("ENCRYPTION_KEY", encryptionState);
  writeKey("APP_SECRET", appSecretState);

  if (generatedNewSecrets) {
    options.fs.writeFileSync(envPath, text);
  }

  return { generatedNewSecrets };
}

export function seedSkippedMessage(email: string): string {
  return `Twenty seed skipped: seed user ${email} already present.`;
}

export function seedExecFailedMessage(email: string, cause: string): string {
  return (
    "Twenty seed command exited with an error. " +
    `Seed user ${email} is present afterwards, so the seed may have completed before the error or the database was already seeded. ` +
    `Original error: ${cause}. ` +
    "To get a clean state, reset volumes with TWENTY_DOWN_VOLUMES=1 npm run down -- twenty and rerun."
  );
}

/** The seed is run once and retried at most twice, so three attempts in all. */
export const TWENTY_SEED_MAX_ATTEMPTS = 3;

export function seedMembershipFailedMessage(email: string, attempts: number, lastCause: string): string {
  return (
    `Twenty seed did not produce a usable workspace for ${email} after ${attempts} attempt(s), each on a freshly reset database: ` +
    "the workspace loginToken exchange still fails (for example \"User is not a member of the workspace\"), " +
    "which means the seed was cut short (in CI an upstream seeder query timed out). " +
    `Last problem: ${lastCause}. ` +
    "To get a clean state by hand, reset volumes with TWENTY_DOWN_VOLUMES=1 npm run down -- twenty and rerun."
  );
}

export function seedResetFailedMessage(attempt: number, cause: string): string {
  return (
    `Twenty seed attempt ${attempt} failed and the reset before the next attempt also failed: ${cause}. ` +
    "Reset volumes by hand with TWENTY_DOWN_VOLUMES=1 npm run down -- twenty and rerun."
  );
}

export interface TwentySeedAttemptIo {
  /** Runs `workspace:seed:dev`. Throws when the command fails. Note the command exits 0 even when the seeder fails inside it. */
  runSeed: () => Promise<void>;
  /** True when the seed user can sign in, get a workspace loginToken and exchange it. Never throws. */
  membershipOk: () => Promise<boolean>;
  /**
   * Wipes the harness-owned Twenty database and starts the stack again, so the next seed starts from nothing. Needed because
   * `workspace:seed:dev` is not re-runnable on a partly or fully seeded database (Twenty v2.44.0: a second run fails in
   * synchronizeTwentyStandardApplication with WorkspaceMigrationBuilderException, and still exits 0).
   */
  reset: () => Promise<void>;
  /** Progress lines. Never gets a secret. */
  log: (line: string) => void;
}

/**
 * Seeds, then checks workspace membership. When an attempt fails, the database is reset and the seed runs again, up to
 * `maxAttempts` in all (never on top of a partial seed). A seed command that exits 0 but leaves no usable membership counts
 * as a failed attempt: that is what a timed-out upstream seeder looks like. The reset runs only between attempts, never
 * before the first and never after the last. Returns the number of attempts used. Throws seedMembershipFailedMessage after
 * the last failed attempt, or seedResetFailedMessage when a reset fails.
 */
export async function seedTwentyWithMembershipCheck(
  io: TwentySeedAttemptIo,
  email: string,
  maxAttempts: number = TWENTY_SEED_MAX_ATTEMPTS,
): Promise<number> {
  let lastCause = "the membership check failed";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let execError: string | undefined;
    try {
      await io.runSeed();
    } catch (error) {
      execError = error instanceof Error ? error.message : String(error);
    }
    if (execError === undefined && (await io.membershipOk())) {
      return attempt;
    }
    lastCause = execError !== undefined ? `seed command failed: ${execError}` : "the seed command exited 0 but the workspace membership check failed";
    if (attempt < maxAttempts) {
      io.log(`Twenty seed attempt ${attempt} of ${maxAttempts} did not leave a usable workspace (${lastCause}); resetting the database and retrying.`);
      try {
        await io.reset();
      } catch (error) {
        throw new Error(seedResetFailedMessage(attempt, error instanceof Error ? error.message : String(error)), { cause: error });
      }
    }
  }
  throw new Error(seedMembershipFailedMessage(email, maxAttempts, lastCause));
}

export function parseDockerVolumeList(stdout: string): string[] {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export type TwentyDockerVolumeLister = () => Promise<string[]>;

/** Lists Docker volume names; propagates errors from `docker volume ls` (never treats failure as empty). */
export async function listTwentyDockerVolumeNames(listVolumes: TwentyDockerVolumeLister): Promise<string[]> {
  return listVolumes();
}

export const defaultTwentyFs: TwentyDockerEnvFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  copyFileSync: fs.copyFileSync,
};

export const defaultTwentyRandomBytes = (size: number) => crypto.randomBytes(size);
