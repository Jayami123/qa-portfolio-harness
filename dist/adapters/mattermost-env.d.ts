/** Pins from docs/pins/p4.md. The MCP source commit is the same one the Dockerfile builds. */
export declare const MATTERMOST_IMAGE = "mattermost/mattermost-team-edition:12.1.0@sha256:35927b9c535a9eb74f0e45385d3fe5d8308b16e0464031f157a834da8af3ee73";
export declare const MATTERMOST_MM_AGENTS_COMMIT = "96ecd17ce4d4b6cbcec1abcd2a9173759b4e85e1";
export declare const MATTERMOST_MCP_IMAGE_TAG = "p4-harness/mattermost-mcp:96ecd17";
export declare const MATTERMOST_COMPOSE_PROJECT = "qa-harness-mattermost";
export declare const MATTERMOST_TEAM_NAME = "qa";
export declare const MATTERMOST_OWNER_USERNAME = "qa-owner";
export declare const MATTERMOST_OWNER_EMAIL = "qa-owner@p4.test";
/** The MCP's PAT belongs to this member account, which is not a system admin (least privilege). */
export declare const MATTERMOST_AGENT_USERNAME = "qa-agent";
export declare const MATTERMOST_AGENT_EMAIL = "qa-agent@p4.test";
/** H2 second identity (P4_SECOND_IDENTITY=1): a second member of the same team, with its own PAT. */
export declare const MATTERMOST_AGENT_B_USERNAME = "qa-agent-b";
export declare const MATTERMOST_AGENT_B_EMAIL = "qa-agent-b@p4.test";
/** Roles a PAT needs. Granted to the agent by the admin, so the agent never holds admin rights. */
export declare const MATTERMOST_PAT_ROLES = "system_user system_user_access_token";
export interface MattermostSecrets {
    dbPassword: string;
    ownerPassword: string;
    agentPassword: string;
}
/** Makes new secrets. An undefined random source uses crypto.randomBytes (the default in generateNextcloudSecret). */
export declare function generateMattermostSecrets(random?: (n: number) => Buffer): MattermostSecrets;
/** Reuses saved secrets, or makes new ones when the text is missing or not usable. */
export declare function mattermostSecretsFromText(text: string | undefined, make?: () => MattermostSecrets): MattermostSecrets;
export declare function mattermostComposeFiles(): string[];
/**
 * Environment for `docker compose`. `buildContext` is the per-run folder that holds the Dockerfile and extra-ca.pem
 * (see mattermost.adapter.ts). Keeping the CA in a file avoids an environment variable, which the OS caps at 128 KB.
 */
export declare function mattermostComposeEnv(base: NodeJS.ProcessEnv, secrets: MattermostSecrets, buildContext: string): NodeJS.ProcessEnv;
/**
 * The PEM text to append to the build's trust store. Empty unless MATTERMOST_EXTRA_CA_FILE names a file. `read` is
 * injected in tests. A missing file is an error, not a silent skip.
 */
export declare function extraCaPem(file: string | undefined, read?: (p: string) => string): string;
//# sourceMappingURL=mattermost-env.d.ts.map