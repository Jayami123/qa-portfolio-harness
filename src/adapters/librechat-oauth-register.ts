/**
 * H4: registers the public OAuth clients that LibreChat signs in with. Run by the harness on the host before LibreChat starts.
 *
 * The request goes to the product's browser-reachable address, so the product's own /oauth/register endpoint answers it
 * (RFC 7591). The response is read for one value, `client_id`. The request body, the response body and every header are never
 * printed or written. No client secret is requested, so none is returned.
 */
import { LIBRECHAT_MCP_OAUTH_INVALID, oauthRegistrationBody, type LibreChatMcpOauth } from "./librechat-oauth.js";

export const LIBRECHAT_OAUTH_REGISTER_FAILED = "LIBRECHAT_OAUTH_REGISTER_FAILED";

/** Parses a registration response and returns its client_id. Throws with the status only, never with the body. */
export function clientIdFromRegistration(status: number, bodyText: string): string {
  if (status !== 201 && status !== 200) {
    throw new Error(`${LIBRECHAT_OAUTH_REGISTER_FAILED}: the product answered HTTP ${status} to client registration`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error(`${LIBRECHAT_OAUTH_REGISTER_FAILED}: the registration answer was not JSON (body not printed)`);
  }
  const id = (parsed as { client_id?: unknown } | null)?.client_id;
  if (typeof id !== "string" || !/^[A-Za-z0-9._~-]{8,200}$/.test(id)) {
    throw new Error(`${LIBRECHAT_OAUTH_REGISTER_FAILED}: the registration answer had no usable client_id (value not printed)`);
  }
  return id;
}

/**
 * Registers one public client per OAuth product and returns the options with the client ids set. Twenty is the only product
 * today; its registration endpoint is /oauth/register on the browser address.
 */
export async function registerOauthClients(oauth: LibreChatMcpOauth, fetchImpl: typeof fetch = fetch): Promise<Record<string, string>> {
  const clients: Record<string, string> = {};
  for (const product of oauth.products) {
    if (product !== "twenty") {
      throw new Error(`${LIBRECHAT_MCP_OAUTH_INVALID}: no registration is defined for "${product}"`);
    }
    const url = `${oauth.twentyBrowserBaseUrl}/oauth/register`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(oauthRegistrationBody(product)),
      signal: AbortSignal.timeout(15000),
    });
    clients[product] = clientIdFromRegistration(res.status, await res.text());
  }
  return clients;
}
