/**
 * Readiness check for Cal API v2 after `up()`. The API answers `/health` without touching the database, so a
 * DB-backed read is the real check: `GET /v2/me` with a key. A non-200 answer means the API cannot complete that read.
 * The message names the database host and port, never the password, and never the key.
 */
export function calDbHostPort(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || "5432"}`;
}

/** undefined when the read answered 200; otherwise a `harness:` message naming the status and the database host. */
export function calReadinessError(status: number, dbHostPort: string): string | undefined {
  if (status === 200) {
    return undefined;
  }
  return (
    `harness: Cal API v2 readiness read GET /v2/me answered ${status}; the API could not complete a database read ` +
    `(database ${dbHostPort}). Check CAL_DB_URL, that the Cal Postgres is up, and the API log for the cause.`
  );
}
