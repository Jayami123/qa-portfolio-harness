/** A request built by a pure function and sent by the caller. The caller decides what is logged (nothing secret). */
export interface HttpRequest {
    url: string;
    init: RequestInit;
}
/** Pin from docs/pins/p4.md (greenmail/standalone 2.1.15, Docker Hub, pinned 2026-11-19). Changing it is a deliberate PR. */
export declare const GREENMAIL_IMAGE = "greenmail/standalone:2.1.15@sha256:309ba544ea482e5d4265d09921cdab07c8dad2cc4481d715c9b8ff5d3f0a149f";
export declare const GREENMAIL_COMPOSE_PROJECT = "qa-harness-greenmail";
/** The name the Nextcloud Mail app uses for GreenMail on the qa-harness-p4 network. */
export declare const GREENMAIL_HOST = "greenmail";
export declare const GREENMAIL_IMAP_PORT = 3143;
export declare const GREENMAIL_SMTP_PORT = 3025;
/** Loopback port of the GreenMail REST API. 8025, 8026, 8027 and 8028 are taken by the other catchers. */
export declare const GREENMAIL_API_PORT = 8029;
export declare const GREENMAIL_API_URL = "http://127.0.0.1:8029";
export declare const P4_MAIL_INVALID = "P4_MAIL_INVALID";
/**
 * H1: P4_MAIL=1 (exact value) starts GreenMail and configures the Nextcloud Mail app against it. Unset or empty, nothing
 * changes. Any other value throws without echoing it.
 */
export declare function parseMailFlag(raw: string): boolean;
/** The compose file for GreenMail. It needs no variable substitution, so `down` works without a password. */
export declare function greenmailComposeFiles(): string[];
/** POST /api/user. The password is sent in the body only; the request is never logged by this module. */
export declare function greenmailCreateUserRequest(login: string, email: string, password: string): HttpRequest;
/** GET /api/user. A 200 means the REST API is up. */
export declare function greenmailReadyRequest(): HttpRequest;
/** GET /api/user/{email}/messages: one entry per stored message for that address. */
export declare function greenmailMessagesRequest(email: string): HttpRequest;
/** The subjects in a GreenMail messages reply. Anything that is not an array of objects gives an empty list. */
export declare function parseGreenmailSubjects(body: unknown): string[];
//# sourceMappingURL=greenmail-env.d.ts.map