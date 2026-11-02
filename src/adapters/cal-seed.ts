/** The fork maps `model User` to the table "users" (packages/prisma/schema.prisma, `@@map(name: "users")`). */
export const CAL_SEED_USER_SQL = `SELECT 1 AS ok FROM users WHERE email = 'free@example.com' LIMIT 1`;

/** The fork's seed prints `Created seeded API Key: cal_<hex>`. Hide the value, keep the line. */
const SEEDED_KEY = /(Created seeded API Key:\s*)\S+/g;

/** Redacts per complete line so a key split across two chunks is still caught. Returns the text to print and the carry-over. */
export function redactSeedOutput(chunk: string, carry = ""): { text: string; carry: string } {
  const joined = carry + chunk;
  const cut = joined.lastIndexOf("\n") + 1;
  const complete = joined.slice(0, cut);
  return { text: complete.replace(SEEDED_KEY, "$1***"), carry: joined.slice(cut) };
}

/**
 * True when the seed output names the core seed user as an exact address. A look-alike such as `teamfree@example.com`,
 * `xfree@example.com` or `free@example.com.evil` does not match. The `users` row is still checked before a failure is accepted.
 */
const CORE_SEED_EMAIL = /(?<![\w.+-])free@example\.com(?![\w-]|\.[\w-])/i;
export function outputNamesCoreSeedUser(output: string): boolean {
  return CORE_SEED_EMAIL.test(output);
}
