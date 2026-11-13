import { randomBytes as nodeRandomBytes } from "node:crypto";

/**
 * Opt-in mock OIDC provider for the Documenso sign-in tests. Off unless DOCUMENSO_OIDC is exactly "1".
 * The provider is navikt/mock-oauth2-server, pinned by tag and digest (docker/documenso.oidc.compose.yml). It runs
 * interactive login: the login form takes a username and a JSON claims object, so a test sets email_verified per login.
 * It does not check the client secret or the redirect URI; Documenso does its own checks, which is what the tests exercise.
 */
export const DOCUMENSO_OIDC_FLAG = "DOCUMENSO_OIDC";
export const DOCUMENSO_OIDC_INVALID = "DOCUMENSO_OIDC_INVALID";
export const DOCUMENSO_OIDC_IDP_NOT_READY = "DOCUMENSO_OIDC_IDP_NOT_READY";

export const DOCUMENSO_OIDC_OVERLAY = "documenso.oidc.compose.yml";
/** Host port of the provider, loopback only (docker/documenso.oidc.compose.yml). Not one of the reserved ports. */
export const DOCUMENSO_OIDC_IDP_PORT = 8081;
export const DOCUMENSO_OIDC_IMAGE =
  "ghcr.io/navikt/mock-oauth2-server:2.1.11@sha256:d1ab58574b6fd50e27575bb1626db4d1bc5cb91d797d6efc61951d79789e969d";
export const DOCUMENSO_OIDC_ISSUER_ID = "default";
/** A public identifier, not a secret. The client secret is generated per run and never stored in a tracked file. */
export const DOCUMENSO_OIDC_CLIENT_ID = "qa-documenso";
export const DOCUMENSO_OIDC_WELL_KNOWN_URL = `http://127.0.0.1:${String(DOCUMENSO_OIDC_IDP_PORT)}/${DOCUMENSO_OIDC_ISSUER_ID}/.well-known/openid-configuration`;

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

/**
 * The provider's JSON config, passed inline as JSON_CONFIG (no bind mount). Interactive login is on, so the login form
 * sets the claims for each login. The default mapping gives a verified user when a login sends no claims.
 * Holds no secret: the provider does not check the client secret.
 */
export const DOCUMENSO_OIDC_IDP_CONFIG = {
  interactiveLogin: true,
  tokenCallbacks: [
    {
      issuerId: DOCUMENSO_OIDC_ISSUER_ID,
      tokenExpiry: 3600,
      requestMappings: [
        {
          requestParam: "code",
          match: "*",
          claims: { sub: "qa-verified", email: "verified@qa.test", email_verified: true, name: "QA Verified" },
        },
      ],
    },
  ],
} as const;

export interface DocumensoOidcAppEnv {
  wellKnownUrl: string;
  clientId: string;
  clientSecret: string;
}

/** A fresh client secret: 32 random bytes, hex. Set only in the Documenso app env. Never logged, never written to disk. */
export function documensoOidcClientSecret(randomBytes: (size: number) => Buffer = nodeRandomBytes): string {
  return randomBytes(32).toString("hex");
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
  const timeoutMs = opts.timeoutMs ?? 60_000;
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
