import { createHmac } from "node:crypto";
/**
 * H2: a second identity per MCP server, behind one switch. `P4_SECOND_IDENTITY=1` (exact value) makes the adapter that
 * supports it create a second user and expose that user's MCP credential through its own run-state file. Unset, nothing
 * changes. Any other value throws without echoing it.
 */
export const P4_SECOND_IDENTITY_INVALID = "P4_SECOND_IDENTITY_INVALID";
export function parseSecondIdentityFlag(raw) {
    if (raw === "")
        return false;
    if (raw === "1")
        return true;
    throw new Error(`${P4_SECOND_IDENTITY_INVALID}: P4_SECOND_IDENTITY must be exactly "1" or unset (value not printed)`);
}
/** The run-state product name for a second identity, for example "nextcloud-b". */
export function secondIdentityProduct(product) {
    return `${product}-b`;
}
/**
 * The second identity's password, derived from a secret the adapter already keeps (for example Penpot's secret key or
 * Mattermost's agent password). Derived, not stored: a kept volume and a restart get the same value, and no new field
 * is added to a secrets file that older runs wrote. HMAC-SHA256 over a fixed label, base64url (43 characters).
 */
export function derivedSecondPassword(secret, label) {
    return createHmac("sha256", secret).update(`p4-second-identity:${label}`).digest("base64url");
}
//# sourceMappingURL=p4-second-identity.js.map