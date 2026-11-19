import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";
import { generateNextcloudSecret } from "./nextcloud-env.js";

/** Pinned in docker/outline.compose.yml and docs/pins/p4.md. The Outline app image is 1.13.0 (BSL 1.1, ADR 0006). */
export const OUTLINE_COMPOSE_PROJECT = "qa-harness-outline";
export const OUTLINE_OWNER_EMAIL = "qa-owner@p4.test";
export const OUTLINE_OWNER_USERNAME = "qa-owner";
/** H2 second identity (P4_SECOND_IDENTITY=1): a member of the same team, with its own API key. */
export const OUTLINE_SECOND_EMAIL = "qa-user-b@p4.test";
export const OUTLINE_SECOND_NAME = "QA User B";
/** Outline prefixes every API key (models/ApiKey.js: ApiKey.prefix = "ol_api_", verified in the 1.13.0 build). */
export const OUTLINE_API_KEY_PREFIX = "ol_api_";

export interface OutlineSecrets {
  dbPassword: string;
  /** 32 random bytes as hex (64 characters). Outline encrypts data with it, so a restart must reuse it. */
  secretKey: string;
  utilsSecret: string;
}

function hex32(random: (n: number) => Buffer): string {
  return random(32).toString("hex");
}

/** Makes new secrets. The random source is injected in tests. */
export function generateOutlineSecrets(random: (n: number) => Buffer = crypto.randomBytes): OutlineSecrets {
  return {
    dbPassword: generateNextcloudSecret(random),
    secretKey: hex32(random),
    utilsSecret: hex32(random),
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Reuses secrets saved by an earlier run, or makes new ones. Invalid or missing text makes new ones. */
export function outlineSecretsFromText(
  text: string | undefined,
  make: () => OutlineSecrets = () => generateOutlineSecrets(),
): OutlineSecrets {
  if (text === undefined) {
    return make();
  }
  try {
    const parsed = JSON.parse(text) as Partial<OutlineSecrets>;
    if (
      typeof parsed.dbPassword === "string" &&
      parsed.dbPassword !== "" &&
      typeof parsed.secretKey === "string" &&
      HEX64.test(parsed.secretKey) &&
      typeof parsed.utilsSecret === "string" &&
      HEX64.test(parsed.utilsSecret)
    ) {
      return { dbPassword: parsed.dbPassword, secretKey: parsed.secretKey, utilsSecret: parsed.utilsSecret };
    }
  } catch {
    // fall through: a damaged file is replaced
  }
  return make();
}

export function outlineComposeFiles(): string[] {
  return [harnessComposeFile("outline.compose.yml")];
}

/** Environment for `docker compose`: the caller's env plus the secrets the compose file substitutes. */
export function outlineComposeEnv(base: NodeJS.ProcessEnv, secrets: OutlineSecrets): NodeJS.ProcessEnv {
  return {
    ...base,
    OUTLINE_DB_PASSWORD: secrets.dbPassword,
    OUTLINE_SECRET_KEY: secrets.secretKey,
    OUTLINE_UTILS_SECRET: secrets.utilsSecret,
  };
}
