/** Pins from docs/pins/p4.md. The MCP image is the official penpotapp/mcp (MIT). */
export declare const PENPOT_FRONTEND_IMAGE = "penpotapp/frontend:2.19.2@sha256:27af83e128712c6e621afcbc4dbae5a607204f7acc89a9ae1245b5601b4a66a8";
export declare const PENPOT_BACKEND_IMAGE = "penpotapp/backend:2.19.2@sha256:b6c602504ca48ec99a25f6a5463c9aa4f4728ac9ed69e7d5d183fb4f779f5e4e";
export declare const PENPOT_EXPORTER_IMAGE = "penpotapp/exporter:2.19.2@sha256:60fdaddd4de2492e5fc5d21419a268374af83b5501c09b167cd2513d2c3e29d7";
export declare const PENPOT_MCP_IMAGE = "penpotapp/mcp:2.19.2@sha256:94c6672072a1fbbdb5ff577375e96d3f67b3a67ecdcd8f81498c5ec27eba36f3";
export declare const PENPOT_COMPOSE_PROJECT = "qa-harness-penpot";
export declare const PENPOT_OWNER_EMAIL = "qa-owner@p4.test";
export declare const PENPOT_OWNER_NAME = "QA Owner";
/** H2 second identity (P4_SECOND_IDENTITY=1): a second profile on the same backend. */
export declare const PENPOT_SECOND_EMAIL = "qa-user-b@p4.test";
export declare const PENPOT_SECOND_NAME = "QA User B";
/**
 * Flags used by the harness stack (spike, 2026-11-17). `disable-admin-console` is needed because the admin console is on
 * by default and blocks RPC when it is not configured. `enable-prepl-server` lets manage.py create the profile.
 */
export declare const PENPOT_FLAGS = "enable-login-with-password disable-registration disable-email-verification disable-onboarding-questions disable-admin-console enable-prepl-server";
export interface PenpotSecrets {
    dbPassword: string;
    /** Penpot's shared secret. The backend and the exporter must share it. */
    secretKey: string;
    ownerPassword: string;
}
export declare function generatePenpotSecrets(random?: (n: number) => Buffer): PenpotSecrets;
/** Reuses saved secrets, or makes new ones when the text is missing or not usable. */
export declare function penpotSecretsFromText(text: string | undefined, make?: () => PenpotSecrets): PenpotSecrets;
/** H6: the multi-user override is added only when the per-user plugin option is on. Off, the files are unchanged. */
export declare function penpotComposeFiles(perUserPlugin?: boolean): string[];
export declare function penpotComposeEnv(base: NodeJS.ProcessEnv, secrets: PenpotSecrets): NodeJS.ProcessEnv;
//# sourceMappingURL=penpot-env.d.ts.map