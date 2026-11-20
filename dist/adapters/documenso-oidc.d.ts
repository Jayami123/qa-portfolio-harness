/**
 * Opt-in test OIDC provider for the Documenso sign-in tests. Off unless DOCUMENSO_OIDC is exactly "1".
 * The provider is Keycloak 26.5.0 (official image, pinned by tag and digest, docker/documenso.oidc.compose.yml). It is a
 * standards-complete provider: discovery publishes scopes_supported, the client is confidential with an exact redirect
 * URI, PKCE is S256, codes are single-use, and each seeded user has its own email_verified value (one true, one false).
 * The realm file holds no secret and no password. The adapter sets the client secret, the redirect URI and the two user
 * passwords through the admin REST API after the realm imports, from values generated per run and kept in memory.
 */
export declare const DOCUMENSO_OIDC_FLAG = "DOCUMENSO_OIDC";
export declare const DOCUMENSO_OIDC_INVALID = "DOCUMENSO_OIDC_INVALID";
export declare const DOCUMENSO_OIDC_IDP_NOT_READY = "DOCUMENSO_OIDC_IDP_NOT_READY";
export declare const DOCUMENSO_OIDC_SETUP_FAILED = "DOCUMENSO_OIDC_SETUP_FAILED";
export declare const DOCUMENSO_OIDC_OVERLAY = "documenso.oidc.compose.yml";
/** Host port of the provider, loopback only (docker/documenso.oidc.compose.yml). Not one of the reserved ports. */
export declare const DOCUMENSO_OIDC_IDP_PORT = 8081;
export declare const DOCUMENSO_OIDC_IDP_ORIGIN: string;
export declare const DOCUMENSO_OIDC_IMAGE = "quay.io/keycloak/keycloak:26.5.0@sha256:5fdd7cda82e58775ed124294c7e16fabc33166d38dfc4aabebda7d64e7a964bf";
export declare const DOCUMENSO_OIDC_REALM = "qa";
/** A public identifier, not a secret. The client secret is generated per run and never stored in a tracked file. */
export declare const DOCUMENSO_OIDC_CLIENT_ID = "qa-documenso";
export declare const DOCUMENSO_OIDC_ADMIN_USER = "admin";
/** Env name read by compose interpolation (the value is generated per run and never printed). */
export declare const DOCUMENSO_OIDC_ADMIN_PASSWORD_ENV = "DOCUMENSO_OIDC_ADMIN_PASSWORD";
export declare const DOCUMENSO_OIDC_WELL_KNOWN_URL: string;
/** The redirect path Documenso uses for OIDC (`${NEXT_PUBLIC_WEBAPP_URL}/api/auth/callback/oidc`). */
export declare const DOCUMENSO_OIDC_CALLBACK_PATH = "/api/auth/callback/oidc";
/**
 * The two seeded users. The realm file (docker/documenso-oidc/qa-realm.json) carries the same usernames, emails and
 * email_verified values; a unit test checks that they match. Passwords are per run (see newDocumensoOidcRun).
 */
export declare const DOCUMENSO_OIDC_TEST_USERS: readonly [{
    readonly username: "verified";
    readonly email: "verified@qa.test";
    readonly emailVerified: true;
}, {
    readonly username: "unverified";
    readonly email: "unverified@qa.test";
    readonly emailVerified: false;
}];
export type DocumensoOidcTestUser = (typeof DOCUMENSO_OIDC_TEST_USERS)[number];
/** True only for the exact value "1". Unset or blank is off. Any other set value throws DOCUMENSO_OIDC_INVALID; the value is not printed. */
export declare function documensoOidcEnabled(env: NodeJS.ProcessEnv): boolean;
/** The overlay files the flag adds to the Documenso compose argv. Empty when the flag is off. */
export declare function documensoOidcOverlayFiles(enabled: boolean): string[];
/** A fresh client secret: 32 random bytes, hex. Set only in the Keycloak client and the Documenso app env. Never logged, never written. */
export declare function documensoOidcClientSecret(randomBytes?: (size: number) => Buffer): string;
export interface DocumensoOidcRun {
    adminPassword: string;
    clientSecret: string;
    /** Keyed by username. Per run, in memory only. */
    userPasswords: Record<DocumensoOidcTestUser["username"], string>;
}
/** The values for one `up`. 32 random bytes each, hex for the secrets and base64url for the user passwords. */
export declare function newDocumensoOidcRun(randomBytes?: (size: number) => Buffer): DocumensoOidcRun;
export type OidcFetch = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    status: number;
    json: () => Promise<unknown>;
}>;
export interface ConfigureOidcOptions {
    run: DocumensoOidcRun;
    /** Documenso's webapp origin (publicUrl when set, else baseUrl). The redirect URI is this plus DOCUMENSO_OIDC_CALLBACK_PATH. */
    webappUrl: string;
    fetch?: OidcFetch;
}
/**
 * Sets the client secret, the exact redirect URI and the two user passwords through Keycloak's admin REST API, after the
 * realm has imported. Throws DOCUMENSO_OIDC_SETUP_FAILED naming the step and the HTTP status. It never includes a value.
 */
export declare function configureOidcProvider(opts: ConfigureOidcOptions): Promise<void>;
export interface WaitForOidcOptions {
    fetch?: (url: string) => Promise<{
        status: number;
    }>;
    timeoutMs?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Polls the well-known URL until it answers 200 or the timeout passes. Throws DOCUMENSO_OIDC_IDP_NOT_READY with the URL
 * (never a secret). A timeout fails up(); the harness does not start Documenso against a provider that is not answering.
 */
export declare function waitForOidcWellKnown(url: string, opts?: WaitForOidcOptions): Promise<void>;
//# sourceMappingURL=documenso-oidc.d.ts.map