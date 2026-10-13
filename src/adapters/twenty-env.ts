/** Twenty helpers. Parsers and guards are pure (no I/O). Secret bootstrap and volume checks accept injected deps for tests. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TWENTY_DEFAULT_IMAGE_TAG = "v2.44.0";
export const TWENTY_IMAGE_REPO = "twentycrm/twenty";

/** Shared dev-seeder password (see fork `seed-users.util.ts` hash comment). Not a production secret. */
export const TWENTY_DEV_SEED_PASSWORD = "tim@apple.dev";

export const TWENTY_DEFAULT_ADMIN_EMAIL = "jane.austen@apple.dev";
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

export function seedFailRerunMessage(output: string): string {
  return (
    `Twenty seed failed on an already-seeded database. Inspect the output below and reset volumes with down -v before retrying.\n${output}`
  );
}

export const defaultTwentyFs: TwentyDockerEnvFs = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  copyFileSync: fs.copyFileSync,
};

export const defaultTwentyRandomBytes = (size: number) => crypto.randomBytes(size);
