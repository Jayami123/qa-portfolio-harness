/** Builders and parsers for the Nextcloud seed. No I/O here, so every function is unit tested. */
/** OCS request that mints an app password for the owner, authenticated with the owner's login password. */
export declare function appPasswordRequest(baseUrl: string, username: string, loginPassword: string): {
    url: string;
    init: RequestInit;
};
/** Basic Authorization header value. Used for the owner's login at seed time and for the MCP pass-through later. */
export declare function basicAuthorization(username: string, secret: string): string;
/** Reads ocs.data.apppassword. Throws a fixed message and never echoes the body. */
export declare function parseAppPassword(body: unknown): string;
/** Reads ocs.data.id from GET /ocs/v2.php/cloud/user. Throws a fixed message and never echoes the body. */
export declare function parseOcsUserId(body: unknown): string;
/** The OCS request that returns the authenticated user, used by the MCP readiness check and proveAuth. */
export declare function cloudUserRequest(baseUrl: string, authorization: string): {
    url: string;
    init: RequestInit;
};
/**
 * POST /ocs/v2.php/cloud/users, made as the admin (owner). Creates a user with a password. Nextcloud answers 102 when the
 * user already exists; the caller then resets the password (see ocsSetPasswordRequest).
 */
export declare function ocsCreateUserRequest(baseUrl: string, adminUsername: string, adminPassword: string, userid: string, password: string, email: string): {
    url: string;
    init: RequestInit;
};
/** PUT /ocs/v2.php/cloud/users/{userid}, made as the admin. Sets the user's password. */
export declare function ocsSetPasswordRequest(baseUrl: string, adminUsername: string, adminPassword: string, userid: string, password: string): {
    url: string;
    init: RequestInit;
};
/**
 * Reads ocs.meta.statuscode from a provisioning reply. 100 and 200 are success; 102 means the user already exists.
 * Anything else throws a fixed message and never echoes the body.
 */
export declare function parseOcsProvisionStatus(body: unknown): "created" | "exists" | "ok";
//# sourceMappingURL=nextcloud-seed.d.ts.map