/** Twenty helpers. Parsers and guards are pure (no I/O). Secret bootstrap and volume checks accept injected deps for tests. */
export declare const TWENTY_DEFAULT_IMAGE_TAG = "v2.44.0";
export declare const TWENTY_IMAGE_REPO = "twentycrm/twenty";
/** Shared dev-seeder password (see fork `seed-users.util.ts` hash comment). Not a production secret. */
export declare const TWENTY_DEV_SEED_PASSWORD = "tim@apple.dev";
export declare const TWENTY_DEFAULT_ADMIN_EMAIL = "jane.austen@apple.dev";
/**
 * H2 second identity (P4_SECOND_IDENTITY=1): a Member the dev seeder creates in the same workspace, signed in with the
 * shared TWENTY_PASSWORD. Its MCP key is minted with its own workspace token.
 */
export declare const TWENTY_SECOND_MEMBER_EMAIL = "jony.ive@apple.dev";
/**
 * Seed workspace subdomains, from the fork's dev seeder at 7cbdfec6:
 * packages/twenty-server/src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant.ts:38 (Apple) and :47 (YCombinator).
 * With IS_MULTIWORKSPACE_ENABLED=true the workspace origin is `<subdomain>.<host of SERVER_URL>`
 * (workspace-domains.service.ts:240-245). Use a wildcard hostname (for example lvh.me), not 127.0.0.1.
 */
export declare const TWENTY_SEED_APPLE_WORKSPACE_SUBDOMAIN = "apple";
export declare const TWENTY_SEED_YC_WORKSPACE_SUBDOMAIN = "yc";
export declare const TWENTY_SEED_PRESENCE_EMAIL = "jane.austen@apple.dev";
export declare const TWENTY_DB_VOLUME_SUFFIX = "db-data";
export declare const TWENTY_SERVER_VOLUME_SUFFIX = "server-local-data";
/** Fork-only Anchor B overlay; harness must not depend on this file. */
export declare const TWENTY_FORBIDDEN_COMPOSE_FRAGMENT = "docker-compose.validation.yml";
/** Compose inputs: tracked fork `docker-compose.yml` + harness overlay only. */
export declare function twentyComposeFilePaths(dockerDir: string, harnessComposeFilePath: string): string[];
export declare function twentyImageRef(tag: string): string;
export declare function isTwentyHealthyStatus(statusCode: number): boolean;
export declare function assertTwentyImageTag(imageTag: string): void;
export interface TwentyWorkspaceUrls {
    subdomainUrl?: string | null;
    customUrl?: string | null;
}
export interface TwentyWorkspaceForSignIn {
    workspaceUrls?: TwentyWorkspaceUrls | null;
}
/** `subdomainUrl` wins, then `customUrl`, then base URL (fork anchor-b-probe-common.ps1). */
export declare function selectWorkspaceOrigin(workspace: TwentyWorkspaceForSignIn | null | undefined, baseUrl: string): string;
export interface GraphqlErrorShape {
    message: string;
}
export declare function parseTwentyMetadataBody<T>(statusCode: number, body: {
    data?: T;
    errors?: GraphqlErrorShape[];
}, context: string): T;
export interface SignInResultShape {
    signIn?: {
        tokens?: {
            accessOrWorkspaceAgnosticToken?: {
                token?: string | null;
            } | null;
        } | null;
        availableWorkspaces?: {
            availableWorkspacesForSignIn?: Array<{
                loginToken?: string | null;
                workspaceUrls?: TwentyWorkspaceUrls | null;
            } | null> | null;
        } | null;
    } | null;
}
export declare function extractBearerFromSignIn(data: SignInResultShape): string | undefined;
export interface LoginTokenExchangeShape {
    getAuthTokensFromLoginToken?: {
        tokens?: {
            accessOrWorkspaceAgnosticToken?: {
                token?: string | null;
            } | null;
        } | null;
    } | null;
}
export declare function extractBearerFromLoginTokenExchange(data: LoginTokenExchangeShape): string | undefined;
export type TwentySecretKeyState = "missing" | "placeholder" | "real";
export declare function classifyTwentySecretValue(value: string | undefined): TwentySecretKeyState;
export declare function twentyVolumeResetCommand(dockerDir: string, harnessComposeFile: string): string;
export interface TwentyVolumeCheck {
    listVolumes(): string[];
}
export declare function twentyHarnessVolumesExist(check: TwentyVolumeCheck, projectName?: string): boolean;
export declare const TWENTY_REQUIRE_FRESH_INVALID = "TWENTY_REQUIRE_FRESH_INVALID";
export declare const TWENTY_REQUIRE_FRESH_VOLUMES_EXIST = "TWENTY_REQUIRE_FRESH_VOLUMES_EXIST";
/** True only for the exact value "1". Undefined or blank is false. Any other non-blank value throws TWENTY_REQUIRE_FRESH_INVALID. */
export declare function readTwentyRequireFresh(env: NodeJS.ProcessEnv): boolean;
/** Throws, naming the existing harness volumes, when requireFresh is set and one exists. Called before composeUp. */
export declare function assertTwentyFreshOrRefuse(opts: {
    requireFresh: boolean;
    volumes: TwentyVolumeCheck;
    projectName?: string;
}): void;
export interface TwentyDockerEnvFs {
    existsSync(filePath: string): boolean;
    readFileSync(filePath: string, encoding: "utf8"): string;
    writeFileSync(filePath: string, data: string): void;
    copyFileSync(from: string, to: string): void;
}
export interface BootstrapTwentyDockerEnvOptions {
    dockerDir: string;
    harnessComposeFile: string;
    fs: TwentyDockerEnvFs;
    randomBytes(size: number): Buffer;
    volumes: TwentyVolumeCheck;
    projectName?: string;
}
export interface BootstrapTwentyDockerEnvResult {
    generatedNewSecrets: boolean;
}
/**
 * Ensure packages/twenty-docker/.env exists with ENCRYPTION_KEY and APP_SECRET.
 * Never overwrites real keys. Throws if new keys would be written while harness volumes already exist.
 */
export declare function bootstrapTwentyDockerEnv(options: BootstrapTwentyDockerEnvOptions): BootstrapTwentyDockerEnvResult;
export declare function seedSkippedMessage(email: string): string;
export declare function seedExecFailedMessage(email: string, cause: string): string;
/** The seed is run once and retried at most twice, so three attempts in all. */
export declare const TWENTY_SEED_MAX_ATTEMPTS = 3;
export declare function seedMembershipFailedMessage(email: string, attempts: number, lastCause: string): string;
export declare function seedResetFailedMessage(attempt: number, cause: string): string;
export interface TwentySeedAttemptIo {
    /** Runs `workspace:seed:dev`. Throws when the command fails. Note the command exits 0 even when the seeder fails inside it. */
    runSeed: () => Promise<void>;
    /** True when the seed user can sign in, get a workspace loginToken and exchange it. Never throws. */
    membershipOk: () => Promise<boolean>;
    /**
     * Wipes the harness-owned Twenty database and starts the stack again, so the next seed starts from nothing. Needed because
     * `workspace:seed:dev` is not re-runnable on a partly or fully seeded database (Twenty v2.44.0: a second run fails in
     * synchronizeTwentyStandardApplication with WorkspaceMigrationBuilderException, and still exits 0).
     */
    reset: () => Promise<void>;
    /** Progress lines. Never gets a secret. */
    log: (line: string) => void;
}
/**
 * Seeds, then checks workspace membership. When an attempt fails, the database is reset and the seed runs again, up to
 * `maxAttempts` in all (never on top of a partial seed). A seed command that exits 0 but leaves no usable membership counts
 * as a failed attempt: that is what a timed-out upstream seeder looks like. The reset runs only between attempts, never
 * before the first and never after the last. Returns the number of attempts used. Throws seedMembershipFailedMessage after
 * the last failed attempt, or seedResetFailedMessage when a reset fails.
 */
export declare function seedTwentyWithMembershipCheck(io: TwentySeedAttemptIo, email: string, maxAttempts?: number): Promise<number>;
export declare function parseDockerVolumeList(stdout: string): string[];
export type TwentyDockerVolumeLister = () => Promise<string[]>;
/** Lists Docker volume names; propagates errors from `docker volume ls` (never treats failure as empty). */
export declare function listTwentyDockerVolumeNames(listVolumes: TwentyDockerVolumeLister): Promise<string[]>;
export declare const defaultTwentyFs: TwentyDockerEnvFs;
export declare const defaultTwentyRandomBytes: (size: number) => NonSharedBuffer;
//# sourceMappingURL=twenty-env.d.ts.map