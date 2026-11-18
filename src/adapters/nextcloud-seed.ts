/** Builders and parsers for the Nextcloud seed. No I/O here, so every function is unit tested. */

/** OCS request that mints an app password for the owner, authenticated with the owner's login password. */
export function appPasswordRequest(
  baseUrl: string,
  username: string,
  loginPassword: string,
): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/ocs/v2.php/core/getapppassword?format=json`,
    init: {
      method: "GET",
      headers: { "OCS-APIRequest": "true", Authorization: basicAuthorization(username, loginPassword) },
    },
  };
}

/** Basic Authorization header value. Used for the owner's login at seed time and for the MCP pass-through later. */
export function basicAuthorization(username: string, secret: string): string {
  return `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`;
}

/** Reads ocs.data.apppassword. Throws a fixed message and never echoes the body. */
export function parseAppPassword(body: unknown): string {
  const value = (body as { ocs?: { data?: { apppassword?: unknown } } } | null)?.ocs?.data?.apppassword;
  if (typeof value !== "string" || value === "") {
    throw new Error("NEXTCLOUD_APP_PASSWORD_MISSING: getapppassword returned no app password (body not printed)");
  }
  return value;
}

/** Reads ocs.data.id from GET /ocs/v2.php/cloud/user. Throws a fixed message and never echoes the body. */
export function parseOcsUserId(body: unknown): string {
  const id = (body as { ocs?: { data?: { id?: unknown } } } | null)?.ocs?.data?.id;
  if (typeof id !== "string" || id === "") {
    throw new Error("NEXTCLOUD_USER_UNKNOWN: cloud/user returned no id (body not printed)");
  }
  return id;
}

/** The OCS request that returns the authenticated user, used by the MCP readiness check and proveAuth. */
export function cloudUserRequest(baseUrl: string, authorization: string): { url: string; init: RequestInit } {
  return {
    url: `${baseUrl}/ocs/v2.php/cloud/user?format=json`,
    init: { method: "GET", headers: { "OCS-APIRequest": "true", Authorization: authorization } },
  };
}
