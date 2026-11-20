/** Builders and parsers for the Mattermost seed. No I/O here, so every function is unit tested. */
/** Argv for `mmctl --local` (runs inside the app container, over the local socket, so no password is sent over HTTP). */
export declare function mmctlUserCreateArgs(email: string, username: string, password: string, systemAdmin: boolean): string[];
export declare function mmctlTeamCreateArgs(teamName: string, displayName: string, ownerEmail: string): string[];
export declare function mmctlTeamAddArgs(teamName: string, usernames: string[]): string[];
/** POST /api/v4/users/login. The reply's Token header is the session token. */
export declare function loginRequest(baseUrl: string, loginId: string, password: string): {
    url: string;
    init: RequestInit;
};
/** PUT /api/v4/users/{id}/roles. Grants the PAT role; the admin token is needed. */
export declare function grantPatRoleRequest(baseUrl: string, userId: string, adminToken: string, roles: string): {
    url: string;
    init: RequestInit;
};
/** POST /api/v4/users/{id}/tokens. The member's own session token is used. */
export declare function createPatRequest(baseUrl: string, userId: string, sessionToken: string, description: string): {
    url: string;
    init: RequestInit;
};
/** Reads the token from a PAT reply. A Mattermost token is 26 lowercase alphanumeric characters. */
export declare function parsePatToken(body: unknown): string;
/** True when GET /api/v4/system/ping reports OK. */
export declare function parsePing(body: unknown): boolean;
/** GET /api/v4/users/me, used to prove the PAT. */
export declare function usersMeRequest(baseUrl: string, bearerToken: string): {
    url: string;
    init: RequestInit;
};
/** True when the user's roles include the system admin role. The MCP account must be false. */
export declare function isSystemAdmin(roles: unknown): boolean;
//# sourceMappingURL=mattermost-seed.d.ts.map