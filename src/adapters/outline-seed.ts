import { OUTLINE_API_KEY_PREFIX, OUTLINE_OWNER_EMAIL } from "./outline-env.js";

export interface OutlineSeedOutput {
  apiKey: string;
  teamId: string;
  userId: string;
}

/**
 * Reads the seed script's JSON line from stdout. The script prints one line; anything else on stdout (Outline's own
 * logs, for example) is skipped. Throws a fixed message and never echoes the stdout text or the key.
 */
export function parseOutlineSeedOutput(stdout: string): OutlineSeedOutput {
  const lines = stdout.split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes("apiKey")) {
      continue;
    }
    let parsed: Partial<OutlineSeedOutput>;
    try {
      parsed = JSON.parse(trimmed) as Partial<OutlineSeedOutput>;
    } catch {
      continue;
    }
    if (
      typeof parsed.apiKey === "string" &&
      parsed.apiKey.startsWith(OUTLINE_API_KEY_PREFIX) &&
      parsed.apiKey.length >= 40 &&
      typeof parsed.teamId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return { apiKey: parsed.apiKey, teamId: parsed.teamId, userId: parsed.userId };
    }
    throw new Error("OUTLINE_SEED_OUTPUT_INVALID: the seed output did not have the expected fields (not printed)");
  }
  throw new Error("OUTLINE_SEED_OUTPUT_MISSING: the seed script printed no result line (not printed)");
}

/** POST /api/auth.info with the key. The response names the authenticated user. */
export function authInfoRequest(baseUrl: string, authorization: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/auth.info`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: authorization },
      body: "{}",
    },
  };
}

/** Reads data.user.email from an auth.info reply. Throws a fixed message and never echoes the body. */
export function parseAuthInfoEmail(body: unknown): string {
  const email = (body as { data?: { user?: { email?: unknown } } } | null)?.data?.user?.email;
  if (typeof email !== "string" || email === "") {
    throw new Error("OUTLINE_AUTH_INFO_MISSING: auth.info returned no user email (body not printed)");
  }
  return email;
}

const KEY_PATTERN = /ol_api_[A-Za-z0-9]+/g;

/**
 * redactLine for runCapture: masks any Outline API key in text that runCapture echoes to the console. The seed prints
 * the key on stdout, so it must never reach a log. Only complete lines are masked now; the rest is held back.
 */
export function maskOutlineApiKeys(chunk: string, carry: string): { text: string; carry: string } {
  const combined = carry + chunk;
  const lastNewline = combined.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { text: "", carry: combined };
  }
  const complete = combined.slice(0, lastNewline + 1);
  return { text: complete.replace(KEY_PATTERN, "ol_api_***"), carry: combined.slice(lastNewline + 1) };
}

export function ownerEmailMatches(email: string): boolean {
  return email === OUTLINE_OWNER_EMAIL;
}
