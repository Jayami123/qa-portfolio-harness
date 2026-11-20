/**
 * The per-run credential channel for the Documenso OIDC test users (D-HAR-F9). `up` with DOCUMENSO_OIDC=1 writes
 * `<harnessRoot>/.harness/documenso-oidc-run.json` (gitignored, mode 0600). `down` removes it. A test in another process
 * reads it through documensoOidcTestUsers(). Consumers must never upload, print or log this file or its values.
 */
export declare const DOCUMENSO_OIDC_RUN_STATE_BASENAME = "documenso-oidc-run.json";
export declare const DOCUMENSO_OIDC_RUN_STATE_MISSING = "DOCUMENSO_OIDC_RUN_STATE_MISSING";
export declare const DOCUMENSO_OIDC_RUN_STATE_INVALID = "DOCUMENSO_OIDC_RUN_STATE_INVALID";
export declare const DOCUMENSO_OIDC_NOT_ENABLED = "DOCUMENSO_OIDC_NOT_ENABLED";
export interface DocumensoOidcRunStateUser {
    username: string;
    email: string;
    emailVerified: boolean;
    password: string;
}
export interface DocumensoOidcRunState {
    version: 1;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    users: {
        verified: DocumensoOidcRunStateUser;
        unverified: DocumensoOidcRunStateUser;
    };
}
/** The two seeded users a test logs in as. Usernames and passwords only: nothing else is exposed by the reader. */
export interface DocumensoOidcTestUsers {
    verified: {
        username: string;
        password: string;
    };
    unverified: {
        username: string;
        password: string;
    };
}
export declare function documensoOidcRunStateFile(harnessRoot?: string): string;
/** Writes the run state with mode 0600 (also when the file already existed), creating `.harness/` if needed. Never logs. */
export declare function writeDocumensoOidcRunState(file: string, state: DocumensoOidcRunState): void;
/** Removes the run state. Missing is not an error. Never logs. */
export declare function removeDocumensoOidcRunState(file: string): void;
/**
 * Typed reader for the two seeded users. Throws DOCUMENSO_OIDC_NOT_ENABLED when the flag is not set, and
 * DOCUMENSO_OIDC_RUN_STATE_MISSING when the file is not there (both name the cause and never a value). A file that is not
 * the expected shape throws DOCUMENSO_OIDC_RUN_STATE_INVALID, without its content.
 */
export declare function documensoOidcTestUsers(env?: NodeJS.ProcessEnv, file?: string): DocumensoOidcTestUsers;
//# sourceMappingURL=documenso-oidc-run-state.d.ts.map