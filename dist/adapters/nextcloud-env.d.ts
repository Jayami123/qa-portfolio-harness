/** Pins from docs/pins/p4.md. Changing one is a deliberate PR that edits the table and this file together. */
export declare const NEXTCLOUD_IMAGE = "nextcloud:35.0.3-apache@sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3";
export declare const NEXTCLOUD_MCP_IMAGE = "ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325";
export declare const NEXTCLOUD_COMPOSE_PROJECT = "qa-harness-nextcloud";
export declare const NEXTCLOUD_OWNER_USERNAME = "qa-owner";
export declare const NEXTCLOUD_OWNER_EMAIL = "qa-owner@p4.test";
/** H2 second identity (P4_SECOND_IDENTITY=1). A plain user, not an admin. */
export declare const NEXTCLOUD_SECOND_USERNAME = "qa-user-b";
export declare const NEXTCLOUD_SECOND_EMAIL = "qa-user-b@p4.test";
export interface NextcloudSecrets {
    dbPassword: string;
    ownerPassword: string;
}
/**
 * A url-safe random secret, 24 bytes (32 characters). Never logged. It never starts with "-": the image's entrypoint passes
 * the passwords to `occ maintenance:install` as separate arguments, and a leading dash makes Symfony Console read the value
 * as an option (for example `The "-c" option does not exist.`). base64url includes "-", so about 1 secret in 64 did.
 */
export declare function generateNextcloudSecret(randomBytes?: (n: number) => Buffer): string;
/**
 * Reads the secrets persisted by an earlier run, or makes new ones. Postgres and the Nextcloud installer read their
 * passwords only on first init, so a restart on the same volume must reuse them. Invalid or missing text makes new ones.
 */
export declare function nextcloudSecretsFromText(text: string | undefined, make?: () => NextcloudSecrets): NextcloudSecrets;
/**
 * Compose files for the stack. The MCP file is added only after the app is installed (plan section 6, Task 3). The mail
 * file (H1, P4_MAIL=1) puts the app container on the network GreenMail is on, so the Mail app can reach it.
 */
export declare function nextcloudComposeFiles(withMcp: boolean, withMail?: boolean): string[];
/** Environment for `docker compose`: the caller's env plus the two secrets the compose files substitute. */
export declare function nextcloudComposeEnv(base: NodeJS.ProcessEnv, secrets: NextcloudSecrets): NodeJS.ProcessEnv;
/** Parses the body of GET /status.php. Ready only when installed, not in maintenance and no DB upgrade is pending. */
export declare function parseNextcloudStatus(body: unknown): {
    ready: boolean;
    reason?: string;
};
//# sourceMappingURL=nextcloud-env.d.ts.map