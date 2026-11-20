/**
 * Readiness check for Cal API v2 after `up()`. The API answers `/health` without touching the database, so a
 * DB-backed read is the real check: `GET /v2/me` with a key. A non-200 answer means the API cannot complete that read.
 * The message names the database host and port, never the password, and never the key.
 */
export declare function calDbHostPort(databaseUrl: string): string;
/** undefined when the read answered 200; otherwise a `harness:` message naming the status and the database host. */
export declare function calReadinessError(status: number, dbHostPort: string): string | undefined;
//# sourceMappingURL=cal-readiness.d.ts.map