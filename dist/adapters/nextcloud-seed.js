/** Builders and parsers for the Nextcloud seed. No I/O here, so every function is unit tested. */
/** OCS request that mints an app password for the owner, authenticated with the owner's login password. */
export function appPasswordRequest(baseUrl, username, loginPassword) {
    return {
        url: `${baseUrl}/ocs/v2.php/core/getapppassword?format=json`,
        init: {
            method: "GET",
            headers: { "OCS-APIRequest": "true", Authorization: basicAuthorization(username, loginPassword) },
        },
    };
}
/** Basic Authorization header value. Used for the owner's login at seed time and for the MCP pass-through later. */
export function basicAuthorization(username, secret) {
    return `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`;
}
/** Reads ocs.data.apppassword. Throws a fixed message and never echoes the body. */
export function parseAppPassword(body) {
    const value = body?.ocs?.data?.apppassword;
    if (typeof value !== "string" || value === "") {
        throw new Error("NEXTCLOUD_APP_PASSWORD_MISSING: getapppassword returned no app password (body not printed)");
    }
    return value;
}
/** Reads ocs.data.id from GET /ocs/v2.php/cloud/user. Throws a fixed message and never echoes the body. */
export function parseOcsUserId(body) {
    const id = body?.ocs?.data?.id;
    if (typeof id !== "string" || id === "") {
        throw new Error("NEXTCLOUD_USER_UNKNOWN: cloud/user returned no id (body not printed)");
    }
    return id;
}
/** The OCS request that returns the authenticated user, used by the MCP readiness check and proveAuth. */
export function cloudUserRequest(baseUrl, authorization) {
    return {
        url: `${baseUrl}/ocs/v2.php/cloud/user?format=json`,
        init: { method: "GET", headers: { "OCS-APIRequest": "true", Authorization: authorization } },
    };
}
/**
 * POST /ocs/v2.php/cloud/users, made as the admin (owner). Creates a user with a password. Nextcloud answers 102 when the
 * user already exists; the caller then resets the password (see ocsSetPasswordRequest).
 */
export function ocsCreateUserRequest(baseUrl, adminUsername, adminPassword, userid, password, email) {
    const body = new URLSearchParams({ userid, password, email }).toString();
    return {
        url: `${baseUrl}/ocs/v2.php/cloud/users?format=json`,
        init: {
            method: "POST",
            headers: {
                "OCS-APIRequest": "true",
                Authorization: basicAuthorization(adminUsername, adminPassword),
                "content-type": "application/x-www-form-urlencoded",
            },
            body,
        },
    };
}
/** PUT /ocs/v2.php/cloud/users/{userid}, made as the admin. Sets the user's password. */
export function ocsSetPasswordRequest(baseUrl, adminUsername, adminPassword, userid, password) {
    return {
        url: `${baseUrl}/ocs/v2.php/cloud/users/${encodeURIComponent(userid)}?format=json`,
        init: {
            method: "PUT",
            headers: {
                "OCS-APIRequest": "true",
                Authorization: basicAuthorization(adminUsername, adminPassword),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ key: "password", value: password }).toString(),
        },
    };
}
/**
 * Reads ocs.meta.statuscode from a provisioning reply. 100 and 200 are success; 102 means the user already exists.
 * Anything else throws a fixed message and never echoes the body.
 */
export function parseOcsProvisionStatus(body) {
    const code = body?.ocs?.meta?.statuscode;
    if (code === 100 || code === 200)
        return code === 100 ? "created" : "ok";
    if (code === 102)
        return "exists";
    throw new Error(`NEXTCLOUD_PROVISION_FAILED: provisioning returned statuscode ${String(code)} (body not printed)`);
}
//# sourceMappingURL=nextcloud-seed.js.map