import pg from "pg";
/**
 * Create a Postgres pool with **read-only intent**.
 *
 * This helper does not run migrations, seeds, or writes. The database role in
 * `dbUrl` should itself be a read-only role in any shared environment. The
 * pool also sets `default_transaction_read_only=on` as a session guard.
 */
export declare function createPgClient(dbUrl: string): pg.Pool;
//# sourceMappingURL=pg.d.ts.map