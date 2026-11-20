/**
 * H2: a second identity per MCP server, behind one switch. `P4_SECOND_IDENTITY=1` (exact value) makes the adapter that
 * supports it create a second user and expose that user's MCP credential through its own run-state file. Unset, nothing
 * changes. Any other value throws without echoing it.
 */
export declare const P4_SECOND_IDENTITY_INVALID = "P4_SECOND_IDENTITY_INVALID";
export declare function parseSecondIdentityFlag(raw: string): boolean;
/** The run-state product name for a second identity, for example "nextcloud-b". */
export declare function secondIdentityProduct(product: string): string;
/**
 * The second identity's password, derived from a secret the adapter already keeps (for example Penpot's secret key or
 * Mattermost's agent password). Derived, not stored: a kept volume and a restart get the same value, and no new field
 * is added to a secrets file that older runs wrote. HMAC-SHA256 over a fixed label, base64url (43 characters).
 */
export declare function derivedSecondPassword(secret: string, label: string): string;
/**
 * What a live probe reports for one product: the two authenticated identities (emails or usernames, never a key), whether
 * they differ, and how many tools the MCP listed for each credential.
 */
export interface SecondIdentityProbe {
    product: string;
    owner: string;
    second: string;
    distinct: boolean;
    ownerTools: number;
    secondTools: number;
}
//# sourceMappingURL=p4-second-identity.d.ts.map