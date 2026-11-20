/** Default readiness budget for P4 products: 10 minutes covers a first boot (image unpack, DB init, app install). */
export declare const P4_DEFAULT_WAIT_MS: number;
/** Floor, same rule as TWENTY_WAIT_MS: a smaller value is ignored and the default is used. */
export declare const P4_MIN_WAIT_MS = 120000;
/** Reads P4_WAIT_MS. Blank, non-numeric or below the floor falls back to the default. */
export declare function p4WaitBudgetMs(env?: NodeJS.ProcessEnv): number;
//# sourceMappingURL=p4-wait.d.ts.map