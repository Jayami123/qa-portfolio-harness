/** The fork maps `model User` to the table "users" (packages/prisma/schema.prisma, `@@map(name: "users")`). */
export declare const CAL_SEED_USER_SQL = "SELECT 1 AS ok FROM users WHERE email = 'free@example.com' LIMIT 1";
/** Redacts per complete line so a key split across two chunks is still caught. Returns the text to print and the carry-over. */
export declare function redactSeedOutput(chunk: string, carry?: string): {
    text: string;
    carry: string;
};
export declare function outputNamesCoreSeedUser(output: string): boolean;
//# sourceMappingURL=cal-seed.d.ts.map