/** RPC login body. Sent as JSON; the reply sets the auth-token cookie. */
export declare function loginRequest(baseUrl: string, email: string, password: string): {
    url: string;
    init: RequestInit;
};
/** Reads the auth-token value from the Set-Cookie headers of a login reply. Throws without echoing the headers. */
export declare function authTokenFromSetCookie(setCookies: string[]): string;
/** Argv for the owner-creation CLI inside the backend container. The password is redacted by the caller. */
export declare function createProfileArgs(email: string, fullname: string, password: string): string[];
/** Reads the email from a decoded profile (get-profile or login). Returns null when absent. */
export declare function profileEmail(decoded: unknown): string | null;
//# sourceMappingURL=penpot-seed.d.ts.map