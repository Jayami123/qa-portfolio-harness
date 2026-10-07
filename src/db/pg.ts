import pg from "pg";

const { Pool } = pg;

/**
 * Create a Postgres pool with **read-only intent**.
 *
 * This helper does not run migrations, seeds, or writes. The database role in
 * `dbUrl` should itself be a read-only role in any shared environment. The
 * pool also sets `default_transaction_read_only=on` as a session guard.
 */
export function createPgClient(dbUrl: string): pg.Pool {
  if (!dbUrl) {
    throw new Error("createPgClient: dbUrl is required");
  }

  return new Pool({
    connectionString: dbUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    options: "-c default_transaction_read_only=on",
  });
}
