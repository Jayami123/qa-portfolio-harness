import crypto from "node:crypto";
import { harnessComposeFile } from "../internal/compose.js";
/** Pins from docs/pins/p4.md. Changing one is a deliberate PR that edits the table and this file together. */
export const NEXTCLOUD_IMAGE = "nextcloud:35.0.3-apache@sha256:8a7a65b8bae82a79568fec2ed9cf3e374a1944eda2a22ebe130d79463336fee3";
export const NEXTCLOUD_MCP_IMAGE = "ghcr.io/cbcoutinho/nextcloud-mcp-server:0.213.2@sha256:655c2864b48fd3f0696480ebe19a165ff114a582b30b9cec1d6ab4923586d325";
export const NEXTCLOUD_COMPOSE_PROJECT = "qa-harness-nextcloud";
export const NEXTCLOUD_OWNER_USERNAME = "qa-owner";
export const NEXTCLOUD_OWNER_EMAIL = "qa-owner@p4.test";
/** H2 second identity (P4_SECOND_IDENTITY=1). A plain user, not an admin. */
export const NEXTCLOUD_SECOND_USERNAME = "qa-user-b";
export const NEXTCLOUD_SECOND_EMAIL = "qa-user-b@p4.test";
/**
 * A url-safe random secret, 24 bytes (32 characters). Never logged. It never starts with "-": the image's entrypoint passes
 * the passwords to `occ maintenance:install` as separate arguments, and a leading dash makes Symfony Console read the value
 * as an option (for example `The "-c" option does not exist.`). base64url includes "-", so about 1 secret in 64 did.
 */
export function generateNextcloudSecret(randomBytes = crypto.randomBytes) {
    const secret = randomBytes(24).toString("base64url");
    return secret.startsWith("-") ? `A${secret.slice(1)}` : secret;
}
/**
 * Reads the secrets persisted by an earlier run, or makes new ones. Postgres and the Nextcloud installer read their
 * passwords only on first init, so a restart on the same volume must reuse them. Invalid or missing text makes new ones.
 */
export function nextcloudSecretsFromText(text, make = () => ({
    dbPassword: generateNextcloudSecret(),
    ownerPassword: generateNextcloudSecret(),
})) {
    if (text === undefined) {
        return make();
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed.dbPassword === "string" && parsed.dbPassword !== "" && typeof parsed.ownerPassword === "string" && parsed.ownerPassword !== "") {
            return { dbPassword: parsed.dbPassword, ownerPassword: parsed.ownerPassword };
        }
    }
    catch {
        // fall through: a damaged file is replaced
    }
    return make();
}
/**
 * Compose files for the stack. The MCP file is added only after the app is installed (plan section 6, Task 3). The mail
 * file (H1, P4_MAIL=1) puts the app container on the network GreenMail is on, so the Mail app can reach it.
 */
export function nextcloudComposeFiles(withMcp, withMail = false) {
    const files = [harnessComposeFile("nextcloud.compose.yml")];
    if (withMail) {
        files.push(harnessComposeFile("nextcloud.mail.compose.yml"));
    }
    if (withMcp) {
        files.push(harnessComposeFile("nextcloud.mcp.compose.yml"));
    }
    return files;
}
/** Environment for `docker compose`: the caller's env plus the two secrets the compose files substitute. */
export function nextcloudComposeEnv(base, secrets) {
    return {
        ...base,
        NEXTCLOUD_DB_PASSWORD: secrets.dbPassword,
        NEXTCLOUD_OWNER_PASSWORD: secrets.ownerPassword,
    };
}
/** Parses the body of GET /status.php. Ready only when installed, not in maintenance and no DB upgrade is pending. */
export function parseNextcloudStatus(body) {
    const s = body;
    if (!s || typeof s !== "object") {
        return { ready: false, reason: "status.php body is not an object" };
    }
    if (s.installed !== true) {
        return { ready: false, reason: "not installed yet" };
    }
    if (s.maintenance === true) {
        return { ready: false, reason: "maintenance mode" };
    }
    if (s.needsDbUpgrade === true) {
        return { ready: false, reason: "database upgrade pending" };
    }
    return { ready: true };
}
//# sourceMappingURL=nextcloud-env.js.map