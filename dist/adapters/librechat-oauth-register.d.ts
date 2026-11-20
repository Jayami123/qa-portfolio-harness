/**
 * H4: registers the public OAuth clients that LibreChat signs in with. Run by the harness on the host before LibreChat starts.
 *
 * The request goes to the product's browser-reachable address, so the product's own /oauth/register endpoint answers it
 * (RFC 7591). The response is read for one value, `client_id`. The request body, the response body and every header are never
 * printed or written. No client secret is requested, so none is returned.
 */
import { type LibreChatMcpOauth } from "./librechat-oauth.js";
export declare const LIBRECHAT_OAUTH_REGISTER_FAILED = "LIBRECHAT_OAUTH_REGISTER_FAILED";
/** Parses a registration response and returns its client_id. Throws with the status only, never with the body. */
export declare function clientIdFromRegistration(status: number, bodyText: string): string;
/**
 * Registers one public client per OAuth product and returns the options with the client ids set. Twenty is the only product
 * today; its registration endpoint is /oauth/register on the browser address.
 */
export declare function registerOauthClients(oauth: LibreChatMcpOauth, fetchImpl?: typeof fetch): Promise<Record<string, string>>;
//# sourceMappingURL=librechat-oauth-register.d.ts.map