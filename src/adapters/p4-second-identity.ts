/**
 * H2: a second identity per MCP server, behind one switch. `P4_SECOND_IDENTITY=1` (exact value) makes the adapter that
 * supports it create a second user and expose that user's MCP credential through its own run-state file. Unset, nothing
 * changes. Any other value throws without echoing it.
 */
export const P4_SECOND_IDENTITY_INVALID = "P4_SECOND_IDENTITY_INVALID";

export function parseSecondIdentityFlag(raw: string): boolean {
  if (raw === "") return false;
  if (raw === "1") return true;
  throw new Error(`${P4_SECOND_IDENTITY_INVALID}: P4_SECOND_IDENTITY must be exactly "1" or unset (value not printed)`);
}

/** The run-state product name for a second identity, for example "nextcloud-b". */
export function secondIdentityProduct(product: string): string {
  return `${product}-b`;
}
