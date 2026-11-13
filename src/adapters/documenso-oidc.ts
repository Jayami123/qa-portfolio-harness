import { randomBytes as nodeRandomBytes } from "node:crypto";

/**
 * Opt-in test OIDC provider for the Documenso sign-in tests. Off unless DOCUMENSO_OIDC is exactly "1".
 * The provider is Keycloak 26.5.0 (official image, pinned by tag and digest, docker/documenso.oidc.compose.yml). It is a
 * standards-complete provider: discovery publishes scopes_supported, the client is confidential with an exact redirect
 * URI, PKCE is S256, codes are single-use, and each seeded user has its own email_verified value (one true, one false).
 * The realm file holds no secret and no password. The adapter sets the client secret, the redirect URI and the two user
 * passwords through the admin REST API after the realm imports, from values generated per run and kept in memory.
 */
export const DOCUMENSO_OIDC_FLAG = "DOCUMENSO_OIDC";
export const DOCUMENSO_OIDC_INVALID = "DOCUMENSO_OIDC_INVALID";
export const DOCUMENSO_OIDC_IDP_NOT_READY = "DOCUMENSO_OIDC_IDP_NOT_READY";
export const DOCUMENSO_OIDC_SETUP_FAILED = "DOCUMENSO_OIDC_SETUP_FAILED";

export const DOCUMENSO_OIDC_OVERLAY = "documenso.oidc.compose.yml";
/** Host port of the provider, loopback only (docker/documenso.oidc.compose.yml). Not one of the reserved ports. */
export const DOCUMENSO_OIDC_IDP_PORT = 8081;
export const DOCUMENSO_OIDC_IDP_ORIGIN = `http://127.0.0.1:${String(DOCUMENSO_OIDC_IDP_PORT)}`;
export const DOCUMENSO_OIDC_IMAGE =
  "quay.io/keycloak/keycloak:26.5.0@sha256:5fdd7cda82e58775ed124294c7e16fabc33166d38dfc4aabebda7d64e7a964bf";
export const DOCUMENSO_OIDC_REALM = "qa";
/** A public identifier, not a secret. The client secret is generated per run and never stored in a tracked file. */
export const DOCUMENSO_OIDC_CLIENT_ID = "qa-documenso";
export const DOCUMENSO_OIDC_ADMIN_USER = "admin";
/** Env name read by compose interpolation (the value is generated per run and never printed). */
export const DOCUMENSO_OIDC_ADMIN_PASSWORD_ENV = "DOCUMENSO_OIDC_ADMIN_PASSWORD";
export const DOCUMENSO_OIDC_WELL_KNOWN_URL = `${DOCUMENSO_OIDC_IDP_ORIGIN}/realms/${DOCUMENSO_OIDC_REALM}/.well-known/openid-configuration`;
/** The redirect path Documenso uses for OIDC (`${NEXT_PUBLIC_WEBAPP_URL}/api/auth/callback/oidc`). */
export const DOCUMENSO_OIDC_CALLBACK_PATH = "/api/auth/callback/oidc";

/**
 * The two seeded users. The realm file (docker/documenso-oidc/qa-realm.json) carries the same usernames, emails and
 * email_verified values; a unit test checks that they match. Passwords are per run (see newDocumensoOidcRun).
 */
export const DOCUMENSO_OIDC_TEST_USERS = [
  { username: "verified", email: "verified@qa.test", emailVerified: true },
  { username: "unverified", email: "unverified@qa.test", emailVerified: false },
] as const;

export type DocumensoOidcTestUser = (typeof DOCUMENSO_OIDC_TEST_USERS)[number];

/** True only for the exact value "1". Unset or blank is off. Any other set value throws DOCUMENSO_OIDC_INVALID; the value is not printed. */
export function documensoOidcEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env[DOCUMENSO_OIDC_FLAG];
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  if (raw === "1") {
    return true;
  }
  throw new Error(`${DOCUMENSO_OIDC_INVALID}: ${DOCUMENSO_OIDC_FLAG} must be exactly 1 or unset (the value is not printed).`);
}

/** The overlay files the flag adds to the Documenso compose argv. Empty when the flag is off. */
export function documensoOidcOverlayFiles(enabled: boolean): string[] {
  return enabled ? [DOCUMENSO_OIDC_OVERLAY] : [];
}

/** A fresh client secret: 32 random bytes, hex. Set only in the Keycloak client and the Documenso app env. Never logged, never written. */
export function documensoOidcClientSecret(randomBytes: (size: number) => Buffer = nodeRandomBytes): string {
  return randomBytes(32).toString("hex");
}

export interface DocumensoOidcRun {
  adminPassword: string;
  clientSecret: string;
  /** Keyed by username. Per run, in memory only. */
  userPasswords: Record<DocumensoOidcTestUser["username"], string>;
}

/** The values for one `up`. 32 random bytes each, hex for the secrets and base64url for the user passwords. */
export function newDocumensoOidcRun(randomBytes: (size: number) => Buffer = nodeRandomBytes): DocumensoOidcRun {
  const pw = (): string => randomBytes(24).toString("base64url");
  return {
    adminPassword: randomBytes(32).toString("hex"),
    clientSecret: documensoOidcClientSecret(randomBytes),
    userPasswords: { verified: pw(), unverified: pw() },
  };
}

export type OidcFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface ConfigureOidcOptions {
  run: DocumensoOidcRun;
  /** Documenso's webapp origin (publicUrl when set, else baseUrl). The redirect URI is this plus DOCUMENSO_OIDC_CALLBACK_PATH. */
  webappUrl: string;
  fetch?: OidcFetch;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

/**
 * Sets the client secret, the exact redirect URI and the two user passwords through Keycloak's admin REST API, after the
 * realm has imported. Throws DOCUMENSO_OIDC_SETUP_FAILED naming the step and the HTTP status. It never includes a value.
 */
export async function configureOidcProvider(opts: ConfigureOidcOptions): Promise<void> {
  const fetchImpl: OidcFetch = opts.fetch ?? (async (url, init) => {
    const r = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body });
    return { status: r.status, json: () => r.json() };
  });
  const fail = (step: string, status: number): never => {
    throw new Error(`${DOCUMENSO_OIDC_SETUP_FAILED}: ${step} answered HTTP ${String(status)}.`);
  };
  const realmAdmin = `${DOCUMENSO_OIDC_IDP_ORIGIN}/admin/realms/${DOCUMENSO_OIDC_REALM}`;

  const tokenRes = await fetchImpl(`${DOCUMENSO_OIDC_IDP_ORIGIN}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: DOCUMENSO_OIDC_ADMIN_USER,
      password: opts.run.adminPassword,
    }).toString(),
  });
  if (tokenRes.status !== 200) {
    fail("admin token", tokenRes.status);
  }
  const { access_token: accessToken } = (await tokenRes.json()) as { access_token?: string };
  if (typeof accessToken !== "string") {
    throw new Error(`${DOCUMENSO_OIDC_SETUP_FAILED}: admin token response had no access_token.`);
  }
  const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };

  const clientsRes = await fetchImpl(`${realmAdmin}/clients?clientId=${DOCUMENSO_OIDC_CLIENT_ID}`, { headers });
  if (clientsRes.status !== 200) {
    fail("list clients", clientsRes.status);
  }
  const clients = (await clientsRes.json()) as KeycloakClient[];
  const client = clients.find((c) => c.clientId === DOCUMENSO_OIDC_CLIENT_ID);
  if (client === undefined) {
    throw new Error(`${DOCUMENSO_OIDC_SETUP_FAILED}: client ${DOCUMENSO_OIDC_CLIENT_ID} is not in the realm.`);
  }
  const putClient = await fetchImpl(`${realmAdmin}/clients/${client.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      ...client,
      secret: opts.run.clientSecret,
      redirectUris: [`${opts.webappUrl}${DOCUMENSO_OIDC_CALLBACK_PATH}`],
      publicClient: false,
      standardFlowEnabled: true,
      attributes: { "pkce.code.challenge.method": "S256" },
    }),
  });
  if (putClient.status !== 204 && putClient.status !== 200) {
    fail("set client", putClient.status);
  }

  for (const user of DOCUMENSO_OIDC_TEST_USERS) {
    const usersRes = await fetchImpl(`${realmAdmin}/users?username=${user.username}&exact=true`, { headers });
    if (usersRes.status !== 200) {
      fail(`list user ${user.username}`, usersRes.status);
    }
    const found = (await usersRes.json()) as Array<{ id: string; username: string }>;
    const match = found.find((u) => u.username === user.username);
    if (match === undefined) {
      throw new Error(`${DOCUMENSO_OIDC_SETUP_FAILED}: user ${user.username} is not in the realm.`);
    }
    const reset = await fetchImpl(`${realmAdmin}/users/${match.id}/reset-password`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ type: "password", value: opts.run.userPasswords[user.username], temporary: false }),
    });
    if (reset.status !== 204 && reset.status !== 200) {
      fail(`set password for ${user.username}`, reset.status);
    }
  }
}

export interface WaitForOidcOptions {
  fetch?: (url: string) => Promise<{ status: number }>;
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls the well-known URL until it answers 200 or the timeout passes. Throws DOCUMENSO_OIDC_IDP_NOT_READY with the URL
 * (never a secret). A timeout fails up(); the harness does not start Documenso against a provider that is not answering.
 */
export async function waitForOidcWellKnown(url: string, opts: WaitForOidcOptions = {}): Promise<void> {
  const fetchImpl = opts.fetch ?? (async (u: string) => ({ status: (await fetch(u)).status }));
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetchImpl(url)).status === 200) {
        return;
      }
    } catch {
      // Not listening yet: keep polling until the deadline.
    }
    if (Date.now() >= deadline) {
      throw new Error(`${DOCUMENSO_OIDC_IDP_NOT_READY}: ${url} did not answer 200 within ${String(timeoutMs)} ms.`);
    }
    await sleep(intervalMs);
  }
}
