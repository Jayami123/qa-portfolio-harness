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

/** Argv for the owner-creation CLI inside the backend container. The password is redacted by the caller. */
export function createProfileArgs(email: string, fullname: string, password: string): string[] {
  return [
    "python3",
    "manage.py",
    "create-profile",
    "-e",
    email,
    "-n",
    fullname,
    "-p",
    password,
    "--skip-tutorial",
    "--skip-walkthrough",
  ];
}

/** Reads the email from a decoded profile (get-profile or login). Returns null when absent. */
export function profileEmail(decoded: unknown): string | null {
  const email = (decoded as { email?: unknown } | null)?.email;
  return typeof email === "string" && email !== "" ? email : null;
}
