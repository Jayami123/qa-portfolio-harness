import fs from "node:fs";
import { harnessComposeFile } from "../internal/compose.js";
import { generateNextcloudSecret } from "./nextcloud-env.js";

/** Pins from docs/pins/p4.md. The MCP source commit is the same one the Dockerfile builds. */
export const MATTERMOST_IMAGE =
  "mattermost/mattermost-team-edition:12.1.0@sha256:35927b9c535a9eb74f0e45385d3fe5d8308b16e0464031f157a834da8af3ee73";
export const MATTERMOST_MM_AGENTS_COMMIT = "96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1";
export const MATTERMOST_MCP_IMAGE_TAG = "p4-harness/mattermost-mcp:96ecd17";

export const MATTERMOST_COMPOSE_PROJECT = "qa-harness-mattermost";
export const MATTERMOST_TEAM_NAME = "qa";
export const MATTERMOST_OWNER_USERNAME = "qa-owner";
export const MATTERMOST_OWNER_EMAIL = "qa-owner@p4.test";
/** The MCP's PAT belongs to this member account, which is not a system admin (least privilege). */
export const MATTERMOST_AGENT_USERNAME = "qa-agent";
export const MATTERMOST_AGENT_EMAIL = "qa-agent@p4.test";
/** H2 second identity (P4_SECOND_IDENTITY=1): a second member of the same team, with its own PAT. */
export const MATTERMOST_AGENT_B_USERNAME = "qa-agent-b";
export const MATTERMOST_AGENT_B_EMAIL = "qa-agent-b@p4.test";
/** Roles a PAT needs. Granted to the agent by the admin, so the agent never holds admin rights. */
export const MATTERMOST_PAT_ROLES = "system_user system_user_access_token";

export interface MattermostSecrets {
  dbPassword: string;
  ownerPassword: string;
  agentPassword: string;
}

/** Makes new secrets. An undefined random source uses crypto.randomBytes (the default in generateNextcloudSecret). */
export function generateMattermostSecrets(random?: (n: number) => Buffer): MattermostSecrets {
  return {
    dbPassword: generateNextcloudSecret(random),
    ownerPassword: generateNextcloudSecret(random),
    agentPassword: generateNextcloudSecret(random),
  };
}

/** Reuses saved secrets, or makes new ones when the text is missing or not usable. */
export function mattermostSecretsFromText(
  text: string | undefined,
  make: () => MattermostSecrets = () => generateMattermostSecrets(),
): MattermostSecrets {
  if (text === undefined) {
    return make();
  }
  try {
    const parsed = JSON.parse(text) as Partial<MattermostSecrets>;
    if (
      typeof parsed.dbPassword === "string" &&
      parsed.dbPassword !== "" &&
      typeof parsed.ownerPassword === "string" &&
      parsed.ownerPassword !== "" &&
      typeof parsed.agentPassword === "string" &&
      parsed.agentPassword !== ""
    ) {
      return {
        dbPassword: parsed.dbPassword,
        ownerPassword: parsed.ownerPassword,
        agentPassword: parsed.agentPassword,
      };
    }
  } catch {
    // fall through: a damaged file is replaced
  }
  return make();
}

export function mattermostComposeFiles(): string[] {
  return [harnessComposeFile("mattermost.compose.yml")];
}

/**
 * Environment for `docker compose`. `buildContext` is the per-run folder that holds the Dockerfile and extra-ca.pem
 * (see mattermost.adapter.ts). Keeping the CA in a file avoids an environment variable, which the OS caps at 128 KB.
 */
export function mattermostComposeEnv(
  base: NodeJS.ProcessEnv,
  secrets: MattermostSecrets,
  buildContext: string,
): NodeJS.ProcessEnv {
  return {
    ...base,
    MATTERMOST_DB_PASSWORD: secrets.dbPassword,
    MATTERMOST_BUILD_CONTEXT: buildContext,
  };
}

/**
 * The PEM text to append to the build's trust store. Empty unless MATTERMOST_EXTRA_CA_FILE names a file. `read` is
 * injected in tests. A missing file is an error, not a silent skip.
 */
export function extraCaPem(file: string | undefined, read: (p: string) => string = (p) => fs.readFileSync(p, "utf8")): string {
  if (file === undefined || file.trim() === "") {
    return "";
  }
  return read(file.trim());
}
