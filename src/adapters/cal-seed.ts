/** The fork maps `model User` to the table "users" (packages/prisma/schema.prisma, `@@map(name: "users")`). */
export const CAL_SEED_USER_SQL = `SELECT 1 AS ok FROM users WHERE email = 'free@example.com' LIMIT 1`;
