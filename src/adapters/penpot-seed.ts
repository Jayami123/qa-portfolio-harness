/** RPC login body. Sent as JSON; the reply sets the auth-token cookie. */
export function loginRequest(baseUrl: string, email: string, password: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/rpc/command/login-with-password`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  };
}

/** Reads the auth-token value from the Set-Cookie headers of a login reply. Throws without echoing the headers. */
export function authTokenFromSetCookie(setCookies: string[]): string {
  for (const header of setCookies) {
    const token = /(?:^|[;\s,])auth-token=([^;]+)/.exec(header)?.[1];
    if (token !== undefined && token !== "") {
      return token;
    }
  }
  throw new Error("PENPOT_AUTH_COOKIE_MISSING: login returned no auth-token cookie (headers not printed)");
}

/**
 * Argv for the profile-creation CLI inside the backend container. The password is redacted by the caller.
 * Each value is attached to its long option with "=". argparse reads a separate value that starts with "-" as an option,
 * so a generated password such as "-abc" failed with "argument -p/--password: expected one argument". The attached form
 * is always one argv item. The long names are in the pinned Penpot 2.19.2 manage.py (parser.add_argument at lines 177-179).
 */
export function createProfileArgs(email: string, fullname: string, password: string): string[] {
  return [
    "python3",
    "manage.py",
    "create-profile",
    `--email=${email}`,
    `--fullname=${fullname}`,
    `--password=${password}`,
    "--skip-tutorial",
    "--skip-walkthrough",
  ];
}

/** Reads the email from a decoded profile (get-profile or login). Returns null when absent. */
export function profileEmail(decoded: unknown): string | null {
  const email = (decoded as { email?: unknown } | null)?.email;
  return typeof email === "string" && email !== "" ? email : null;
}
