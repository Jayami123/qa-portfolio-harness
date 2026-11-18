import path from "node:path";
import type { TwentyConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { TWENTY_REPLICAS_COMPOSE_FILE, twentyServerReplicas } from "./twenty-replicas.js";
import { run, runCapture } from "../internal/run.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth, waitUntilHealthy } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import {
  assertTwentyFreshOrRefuse,
  assertTwentyImageTag,
  bootstrapTwentyDockerEnv,
  defaultTwentyFs,
  defaultTwentyRandomBytes,
  extractBearerFromLoginTokenExchange,
  extractBearerFromSignIn,
  isTwentyHealthyStatus,
  parseTwentyMetadataBody,
  readTwentyRequireFresh,
  selectWorkspaceOrigin,
  listTwentyDockerVolumeNames,
  parseDockerVolumeList,
  seedExecFailedMessage,
  seedSkippedMessage,
  TWENTY_DEFAULT_ADMIN_EMAIL,
  TWENTY_SEED_PRESENCE_EMAIL,
  twentyComposeFilePaths,
  twentyImageRef,
  type LoginTokenExchangeShape,
  type SignInResultShape,
} from "./twenty-env.js";
import { enablePgStatsExtension, pgStatsComposeFilePaths, pgStatsEnabled } from "./pg-stats.js";
import { twentyRuntimeOverrideFiles, writeTwentyRuntimeOverride } from "./twenty-runtime-override.js";
import { mcpReadinessFor } from "./mcp-ready.js";
import { p4RunStateFile, readP4McpCredentials, removeP4RunState, requireMcpAuthorization, writeP4RunState } from "./p4-run-state.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import {
  apiKeyExpiry,
  type ApiKeyRole,
  CREATE_API_KEY,
  extractApiKeyToken,
  GENERATE_API_KEY_TOKEN,
  GET_API_KEY_ROLES,
  selectApiKeyRole,
  twentyMcpEnabled,
  twentyMcpUrl,
} from "./twenty-mcp.js";
import type { McpReadiness } from "./types.js";

const COMPOSE_PROJECT = "qa-harness-twenty";
const DEFAULT_WAIT_MS = 10 * 60 * 1000;
const MIN_WAIT_MS = 120_000;

const SIGN_IN_MUTATION = `mutation SignIn($email: String!, $password: String!) {
  signIn(email: $email, password: $password) {
    tokens { accessOrWorkspaceAgnosticToken { token } }
    availableWorkspaces {
      availableWorkspacesForSignIn {
        id
        displayName
        loginToken
        workspaceUrls { subdomainUrl customUrl }
      }
    }
  }
}`;

const EXCHANGE_LOGIN_TOKEN_MUTATION = `mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
  getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
    tokens { accessOrWorkspaceAgnosticToken { token } }
  }
}`;

const CURRENT_USER_QUERY = `query CurrentUser { currentUser { email } }`;

export class TwentyAdapter extends BaseAdapter<TwentyConfig> {
  readonly id = "twenty" as const;
  private seedResult?: SeedResult;

  constructor(cfg: TwentyConfig) {
    super(cfg);
  }

  private dockerDir(): string {
    return path.join(this.productRoot, "packages", "twenty-docker");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [
        ...twentyComposeFilePaths(this.dockerDir(), harnessComposeFile("twenty.compose.yml")),
        ...twentyRuntimeOverrideFiles(),
        ...(twentyServerReplicas(process.env) === 2 ? [harnessComposeFile(TWENTY_REPLICAS_COMPOSE_FILE)] : []),
        ...pgStatsComposeFilePaths({ env: process.env, product: "twenty" }),
      ],
      cwd: this.dockerDir(),
      env: {
        ...process.env,
        TAG: this.cfg.imageTag,
        TWENTY_BASE_URL: this.cfg.baseUrl,
      },
    };
  }

  private healthUrl(): string {
    return `${this.cfg.baseUrl}/healthz`;
  }

  private waitBudgetMs(): number {
    const raw = process.env.TWENTY_WAIT_MS;
    if (raw === undefined || raw.trim() === "") {
      return DEFAULT_WAIT_MS;
    }
    const requested = Number(raw);
    return Number.isFinite(requested) && requested >= MIN_WAIT_MS ? requested : DEFAULT_WAIT_MS;
  }

  private async listDockerVolumes(): Promise<string[]> {
    return listTwentyDockerVolumeNames(async () => {
      const { stdout } = await runCapture("docker", ["volume", "ls", "--format", "{{.Name}}"], {
        cwd: this.dockerDir(),
        timeoutMs: 60_000,
      });
      return parseDockerVolumeList(stdout);
    });
  }

  private async prepareDockerEnvAsync(): Promise<void> {
    const names = await this.listDockerVolumes();
    bootstrapTwentyDockerEnv({
      dockerDir: this.dockerDir(),
      harnessComposeFile: harnessComposeFile("twenty.compose.yml"),
      fs: defaultTwentyFs,
      randomBytes: defaultTwentyRandomBytes,
      volumes: { listVolumes: () => names },
      projectName: COMPOSE_PROJECT,
    });
  }

  private dockerComposeArgs(subcommand: string[]): string[] {
    const opts = this.composeOpts();
    return ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), ...subcommand];
  }

  private async assertRunningServerImage(): Promise<void> {
    const expected = twentyImageRef(this.cfg.imageTag);
    const opts = this.composeOpts();
    const { stdout: containerId } = await runCapture(
      "docker",
      this.dockerComposeArgs(["ps", "-q", "server"]),
      { cwd: opts.cwd, env: opts.env, timeoutMs: 60_000 },
    );
    const id = containerId.trim();
    if (!id) {
      throw new Error("Twenty server container not found after compose up.");
    }
    const { stdout: imageLine } = await runCapture(
      "docker",
      ["inspect", "--format", "{{.Config.Image}}", id],
      { cwd: this.dockerDir(), timeoutMs: 60_000 },
    );
    const running = imageLine.trim();
    if (running !== expected) {
      throw new Error(`Twenty server image is ${running}, expected ${expected}. Check TWENTY_IMAGE_TAG and docker/twenty.compose.yml.`);
    }
  }

  async up(): Promise<void> {
    // The compose file declares qa-harness-p4 as external, so it must exist before any compose call.
    await ensureP4Network();
    assertTwentyImageTag(this.cfg.imageTag);
    const requireFresh = readTwentyRequireFresh(process.env);
    if (requireFresh) {
      const names = await this.listDockerVolumes();
      assertTwentyFreshOrRefuse({ requireFresh, volumes: { listVolumes: () => names }, projectName: COMPOSE_PROJECT });
    }
    writeTwentyRuntimeOverride({ env: process.env });
    await this.prepareDockerEnvAsync();
    await composeUp(this.composeOpts(), { wait: true });
    if (pgStatsEnabled(process.env)) {
      // Same defaults the fork's compose substitutes when PG_DATABASE_USER and PG_DATABASE_NAME are unset.
      await enablePgStatsExtension({
        project: COMPOSE_PROJECT,
        files: this.composeOpts().files,
        service: "db",
        user: process.env.PG_DATABASE_USER ?? "postgres",
        db: process.env.PG_DATABASE_NAME ?? "default",
        cwd: this.dockerDir(),
      });
    }
    await this.assertRunningServerImage();
    // Opt-in (TWENTY_MCP=1 exactly). Off by default, so the defaults above are unchanged.
    if (twentyMcpEnabled(process.env)) {
      // seed() is idempotent (seedAlreadyPresent): a kept-volume restart skips it. A fresh volume needs it first,
      // because signIn fails with "User not found" until workspace:seed:dev has created the admin.
      await this.seed();
      await this.prepareMcp();
      await this.waitMcp();
    }
    console.log(`
Twenty stack is up (image ${twentyImageRef(this.cfg.imageTag)}).
  App:      ${this.healthUrl()} (HTTP 200)
  Postgres: host port 5434 (container 5432)
  Mailpit:  http://127.0.0.1:8025 (SMTP 1025; Documenso Inbucket uses 2525 / 9003)

Seed is separate and can take a long time on first boot. Smoke calls seed(), or:
  docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml exec -T server yarn command:prod workspace:seed:dev
`);
  }

  async down(): Promise<void> {
    // The MCP run state is removed whether or not TWENTY_MCP was set (a missing file is not an error).
    removeP4RunState(this.mcpRunStateFile());
    const opts = this.composeOpts();
    if (process.env.TWENTY_DOWN_VOLUMES === "1") {
      await run("docker", ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), "down", "-v"], {
        cwd: opts.cwd,
        env: opts.env,
      });
      return;
    }
    // --remove-orphans: server-2 must go even when TWENTY_SERVER_REPLICAS is unset at down time.
    await composeDown(opts, ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(this.healthUrl(), { timeoutMs: 0, isOk: isTwentyHealthyStatus });
  }

  async waitHealthy(timeoutMs?: number): Promise<void> {
    await waitUntilHealthy(this.healthUrl(), {
      timeoutMs: timeoutMs ?? this.waitBudgetMs(),
      isOk: isTwentyHealthyStatus,
    });
  }

  mcpRunStateFile(): string {
    return p4RunStateFile("twenty");
  }

  /**
   * The workspace token from the loginToken exchange. The plain signIn token is workspace-agnostic: /mcp rejects it and
   * createApiKey refuses it (probe, 2026-11-17). So the MCP path always takes the exchange route.
   */
  private async workspaceToken(): Promise<string> {
    const signIn = await this.metadataGraphql<SignInResultShape>(
      SIGN_IN_MUTATION,
      { email: this.cfg.email, password: this.cfg.password },
      "mcp signIn",
    );
    const workspace = (signIn.signIn?.availableWorkspaces?.availableWorkspacesForSignIn ?? [])[0];
    if (!workspace?.loginToken) {
      throw new Error("TWENTY_MCP_NO_WORKSPACE: signIn returned no workspace loginToken. Check that seed has run.");
    }
    const origin = selectWorkspaceOrigin(workspace, this.cfg.baseUrl);
    const exchanged = await this.metadataGraphql<LoginTokenExchangeShape>(
      EXCHANGE_LOGIN_TOKEN_MUTATION,
      { loginToken: workspace.loginToken, origin },
      "mcp getAuthTokensFromLoginToken",
    );
    const token = extractBearerFromLoginTokenExchange(exchanged);
    if (!token) {
      throw new Error("TWENTY_MCP_NO_WORKSPACE_TOKEN: the loginToken exchange returned no access token");
    }
    return token;
  }

  /** Authenticated GraphQL on /metadata. metadataGraphql above sends no Authorization, so this one does. */
  private async authedGraphql<T>(token: string, query: string, variables: Record<string, unknown>, context: string): Promise<T> {
    const response = await fetch(`${this.cfg.baseUrl}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    return parseTwentyMetadataBody(response.status, body, context);
  }

  /** Mints a least-privilege API key, exchanges it for the MCP bearer, and writes the run state (mode 0600). */
  private async prepareMcp(): Promise<void> {
    const token = await this.workspaceToken();
    const roles = await this.authedGraphql<{ getApiKeyRoles: ApiKeyRole[] }>(token, GET_API_KEY_ROLES, {}, "mcp getApiKeyRoles");
    const role = selectApiKeyRole(roles.getApiKeyRoles);
    const expiresAt = apiKeyExpiry(new Date());
    const created = await this.authedGraphql<{ createApiKey: { id: string } }>(
      token,
      CREATE_API_KEY,
      { input: { name: "qa-harness-mcp", expiresAt, roleId: role.id } },
      "mcp createApiKey",
    );
    const generated = await this.authedGraphql<{ generateApiKeyToken: { token: string } }>(
      token,
      GENERATE_API_KEY_TOKEN,
      { apiKeyId: created.createApiKey.id, expiresAt },
      "mcp generateApiKeyToken",
    );
    const apiKeyToken = extractApiKeyToken({ data: generated });
    writeP4RunState(this.mcpRunStateFile(), {
      version: 1,
      product: "twenty",
      mcpUrl: twentyMcpUrl(this.cfg.baseUrl),
      mcpAuthorization: `Bearer ${apiKeyToken}`,
      owner: { username: this.cfg.email, email: this.cfg.email },
    });
    console.log("Twenty MCP credential written to the run state. It is not printed.");
  }

  /** MCP readiness: a real handshake and tools/list with the scoped key. The key is not printed. */
  async waitMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials("twenty", this.mcpRunStateFile());
    return mcpReadinessFor("twenty", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "twenty"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: 1,
    });
  }

  private seedUsers(): SeedResult["users"] {
    return [
      { email: TWENTY_DEFAULT_ADMIN_EMAIL, role: "Admin", notes: "shared TWENTY_PASSWORD (dev seeder)" },
      { email: "jony.ive@apple.dev", role: "Member", notes: "shared TWENTY_PASSWORD (dev seeder)" },
      { email: "phil.schiler@apple.dev", role: "Guest", notes: "shared TWENTY_PASSWORD (dev seeder)" },
      { email: "tim@apple.dev", role: "Limited", notes: "shared TWENTY_PASSWORD (dev seeder)" },
    ];
  }

  private async seedAlreadyPresent(): Promise<boolean> {
    try {
      const data = await this.metadataGraphql<SignInResultShape>(
        SIGN_IN_MUTATION,
        { email: this.cfg.email, password: this.cfg.password },
        "seed presence signIn",
      );
      const workspaces = data.signIn?.availableWorkspaces?.availableWorkspacesForSignIn ?? [];
      return workspaces.length > 0 || Boolean(extractBearerFromSignIn(data));
    } catch {
      return false;
    }
  }

  async seed(): Promise<SeedResult> {
    if (this.seedResult) {
      return this.seedResult;
    }
    await this.prepareDockerEnvAsync();

    if (await this.seedAlreadyPresent()) {
      const notes = seedSkippedMessage(TWENTY_SEED_PRESENCE_EMAIL);
      this.seedResult = {
        product: this.id,
        created: false,
        users: this.seedUsers(),
        notes,
      };
      console.log(notes);
      return this.seedResult;
    }

    try {
      await run(
        "docker",
        this.dockerComposeArgs([
          "exec",
          "-T",
          "server",
          "yarn",
          "command:prod",
          "workspace:seed:dev",
        ]),
        {
          cwd: this.composeOpts().cwd,
          env: this.composeOpts().env,
          timeoutMs: 40 * 60 * 1000,
        },
      );
    } catch (error) {
      if (await this.seedAlreadyPresent()) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new Error(seedExecFailedMessage(TWENTY_SEED_PRESENCE_EMAIL, cause), { cause: error });
      }
      throw error;
    }

    this.seedResult = {
      product: this.id,
      created: true,
      users: this.seedUsers(),
      notes: "Invoked `yarn command:prod workspace:seed:dev` inside the twenty server container.",
    };
    return this.seedResult;
  }

  async authenticate(): Promise<AuthSession> {
    if (this.cfg.apiKey) {
      return {
        product: this.id,
        baseUrl: this.cfg.baseUrl,
        authorizationHeader: `Bearer ${this.cfg.apiKey}`,
        raw: { source: "TWENTY_API_KEY" },
      };
    }

    const email = this.cfg.email;
    const password = this.cfg.password;

    const signIn = await this.metadataGraphql<SignInResultShape>(
      SIGN_IN_MUTATION,
      { email, password },
      "signIn",
    );

    const direct = extractBearerFromSignIn(signIn);
    if (direct) {
      return {
        product: this.id,
        baseUrl: this.cfg.baseUrl,
        authorizationHeader: `Bearer ${direct}`,
        raw: { source: "graphql-metadata-signIn", origin: this.cfg.baseUrl },
      };
    }

    const workspaces = signIn.signIn?.availableWorkspaces?.availableWorkspacesForSignIn ?? [];
    const workspace = workspaces[0];
    if (!workspace?.loginToken) {
      throw new Error(
        "Twenty signIn returned no bearer token and no workspace loginToken. Check TWENTY_EMAIL / TWENTY_PASSWORD and that seed has run.",
      );
    }

    const origin = selectWorkspaceOrigin(workspace, this.cfg.baseUrl);
    const exchanged = await this.metadataGraphql<LoginTokenExchangeShape>(
      EXCHANGE_LOGIN_TOKEN_MUTATION,
      { loginToken: workspace.loginToken, origin },
      "getAuthTokensFromLoginToken",
    );
    const access = extractBearerFromLoginTokenExchange(exchanged);
    if (!access) {
      throw new Error("Twenty getAuthTokensFromLoginToken returned no access token.");
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${access}`,
      raw: { source: "graphql-metadata-getAuthTokensFromLoginToken", origin },
    };
  }

  async proveAuth(session: AuthSession): Promise<void> {
    const url = `${this.cfg.baseUrl}/metadata`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: session.authorizationHeader,
      },
      body: JSON.stringify({ query: CURRENT_USER_QUERY }),
    });
    const body = (await response.json()) as {
      data?: { currentUser?: { email?: string } };
      errors?: { message: string }[];
    };
    parseTwentyMetadataBody(response.status, body, "proveAuth currentUser");
    const email = body.data?.currentUser?.email;
    if (!email) {
      throw new Error("Twenty proveAuth: currentUser returned no email.");
    }
    if (email !== this.cfg.email) {
      throw new Error(`Twenty proveAuth: expected currentUser.email ${this.cfg.email}, got ${email}.`);
    }
    console.log(`Twenty auth probe: POST ${url} currentUser.email=${email} (HTTP ${response.status})`);
  }

  private async metadataGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    context: string,
  ): Promise<T> {
    const url = `${this.cfg.baseUrl}/metadata`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    return parseTwentyMetadataBody(response.status, body, context);
  }
}
