export interface OutlineSeedOutput {
    apiKey: string;
    teamId: string;
    userId: string;
    /** H2: present only when the seed ran with P4_SECOND_IDENTITY=1. */
    second?: {
        apiKey: string;
        userId: string;
    };
}
/** Argv after `docker compose exec -T`: the flag is passed as an env value (never a secret), only when H2 is on. */
export declare function outlineSeedExecEnv(secondIdentity: boolean): string[];
/**
 * Reads the seed script's JSON line from stdout. The script prints one line; anything else on stdout (Outline's own
 * logs, for example) is skipped. Throws a fixed message and never echoes the stdout text or the key.
 */
export declare function parseOutlineSeedOutput(stdout: string): OutlineSeedOutput;
/** POST /api/auth.info with the key. The response names the authenticated user. */
export declare function authInfoRequest(baseUrl: string, authorization: string): {
    url: string;
    init: RequestInit;
};
/** Reads data.user.email from an auth.info reply. Throws a fixed message and never echoes the body. */
export declare function parseAuthInfoEmail(body: unknown): string;
/**
 * redactLine for runCapture: masks any Outline API key in text that runCapture echoes to the console. The seed prints
 * the key on stdout, so it must never reach a log. Only complete lines are masked now; the rest is held back.
 */
export declare function maskOutlineApiKeys(chunk: string, carry: string): {
    text: string;
    carry: string;
};
export declare function ownerEmailMatches(email: string): boolean;
/** H2: auth.info email check for the second identity. */
export declare function secondEmailMatches(email: string): boolean;
//# sourceMappingURL=outline-seed.d.ts.map