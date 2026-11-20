/** Pinned in docker/outline.compose.yml and docs/pins/p4.md. The Outline app image is 1.13.0 (BSL 1.1, ADR 0006). */
export declare const OUTLINE_COMPOSE_PROJECT = "qa-harness-outline";
export declare const OUTLINE_OWNER_EMAIL = "qa-owner@p4.test";
export declare const OUTLINE_OWNER_USERNAME = "qa-owner";
/** H2 second identity (P4_SECOND_IDENTITY=1): a member of the same team, with its own API key. */
export declare const OUTLINE_SECOND_EMAIL = "qa-user-b@p4.test";
export declare const OUTLINE_SECOND_NAME = "QA User B";
/** Outline prefixes every API key (models/ApiKey.js: ApiKey.prefix = "ol_api_", verified in the 1.13.0 build). */
export declare const OUTLINE_API_KEY_PREFIX = "ol_api_";
export interface OutlineSecrets {
    dbPassword: string;
    /** 32 random bytes as hex (64 characters). Outline encrypts data with it, so a restart must reuse it. */
    secretKey: string;
    utilsSecret: string;
}
/** Makes new secrets. The random source is injected in tests. */
export declare function generateOutlineSecrets(random?: (n: number) => Buffer): OutlineSecrets;
/** Reuses secrets saved by an earlier run, or makes new ones. Invalid or missing text makes new ones. */
export declare function outlineSecretsFromText(text: string | undefined, make?: () => OutlineSecrets): OutlineSecrets;
export declare function outlineComposeFiles(): string[];
/** Environment for `docker compose`: the caller's env plus the secrets the compose file substitutes. */
export declare function outlineComposeEnv(base: NodeJS.ProcessEnv, secrets: OutlineSecrets): NodeJS.ProcessEnv;
//# sourceMappingURL=outline-env.d.ts.map