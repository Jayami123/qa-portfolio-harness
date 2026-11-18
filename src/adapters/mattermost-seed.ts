/** Builders and parsers for the Mattermost seed. No I/O here, so every function is unit tested. */

const PAT_PATTERN = /^[a-z0-9]{26}$/;

/** Argv for `mmctl --local` (runs inside the app container, over the local socket, so no password is sent over HTTP). */
export function mmctlUserCreateArgs(email: string, username: string, password: string, systemAdmin: boolean): string[] {
  const args = ["mmctl", "--local", "user", "create", "--email", email, "--username", username, "--password", password];
  if (systemAdmin) {
    args.push("--system-admin");
  }
  return args;
}

export function mmctlTeamCreateArgs(teamName: string, displayName: string, ownerEmail: string): string[] {
  return ["mmctl", "--local", "team", "create", "--name", teamName, "--display-name", displayName, "--email", ownerEmail];
}

export function mmctlTeamAddArgs(teamName: string, usernames: string[]): string[] {
  return ["mmctl", "--local", "team", "users", "add", teamName, ...usernames];
}

/** POST /api/v4/users/login. The reply's Token header is the session token. */
export function loginRequest(baseUrl: string, loginId: string, password: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/v4/users/login`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login_id: loginId, password }),
    },
  };
}

/** PUT /api/v4/users/{id}/roles. Grants the PAT role; the admin token is needed. */
export function grantPatRoleRequest(
  baseUrl: string,
  userId: string,
  adminToken: string,
  roles: string,
): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/v4/users/${userId}/roles`,
    init: {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ roles }),
    },
  };
}

/** POST /api/v4/users/{id}/tokens. The member's own session token is used. */
export function createPatRequest(
  baseUrl: string,
  userId: string,
  sessionToken: string,
  description: string,
): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/v4/users/${userId}/tokens`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ description }),
    },
  };
}

/** Reads the token from a PAT reply. A Mattermost token is 26 lowercase alphanumeric characters. */
export function parsePatToken(body: unknown): string {
  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || !PAT_PATTERN.test(token)) {
    throw new Error("MATTERMOST_PAT_INVALID: the PAT reply had no usable token (body not printed)");
  }
  return token;
}

/** True when GET /api/v4/system/ping reports OK. */
export function parsePing(body: unknown): boolean {
  return (body as { status?: unknown } | null)?.status === "OK";
}

/** GET /api/v4/users/me, used to prove the PAT. */
export function usersMeRequest(baseUrl: string, bearerToken: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/api/v4/users/me`,
    init: { method: "GET", headers: { authorization: `Bearer ${bearerToken}` } },
  };
}

/** True when the user's roles include the system admin role. The MCP account must be false. */
export function isSystemAdmin(roles: unknown): boolean {
  return typeof roles === "string" && roles.split(" ").includes("system_admin");
}
