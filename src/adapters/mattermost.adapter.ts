import { derivedSecondPassword, type SecondIdentityProbe, secondIdentityProduct } from "./p4-second-identity.js";
import {
  channelByNameRequest,
  channelPostsRequest,
  type ChannelPost,
  createPostRequest,
  missingPostMessages,
  parseChannelId,
  parseChannelPosts,
  SEED_CHANNEL_NAME,
  seededPosts,
  seedPostMessages,
  type SeededPostsProbe,
} from "./mattermost-posts.js";
import fs from "node:fs";
import path from "node:path";
import type { MattermostConfig } from "../config.js";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { ensureP4Network } from "../internal/p4-network.js";
import { run, runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR } from "../paths.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";
import { mcpReadinessFor } from "./mcp-ready.js";
import {
  extraCaPem,
  MATTERMOST_AGENT_EMAIL,
  MATTERMOST_AGENT_B_EMAIL,
  MATTERMOST_AGENT_B_USERNAME,
  MATTERMOST_AGENT_USERNAME,
  MATTERMOST_COMPOSE_PROJECT,
  MATTERMOST_OWNER_EMAIL,
  MATTERMOST_OWNER_USERNAME,
  MATTERMOST_PAT_ROLES,
  MATTERMOST_TEAM_NAME,
  type MattermostSecrets,
  mattermostComposeEnv,
  mattermostComposeFiles,
  mattermostSecretsFromText,
} from "./mattermost-env.js";
import {
  createPatRequest,
  grantPatRoleRequest,
  isSystemAdmin,
  loginRequest,
  mmctlTeamAddArgs,
  mmctlTeamCreateArgs,
  mmctlUserCreateArgs,
  parsePatToken,
  parsePing,
  usersMeRequest,
} from "./mattermost-seed.js";
import { p4RunStateFile, readP4McpCredentials, removeP4RunState, requireMcpAuthorization, writeP4RunState } from "./p4-run-state.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import type { McpReadiness } from "./types.js";

const POLL_MS = 2000;
const REQUEST_MS = 10_000;
const MMCTL_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_TOOLS = 1;

interface Session {
  token: string;
  userId: string;
}

/**
 * Mattermost with the standalone MCP server (ADR 0006, decision Q2). The MCP binary is development-only upstream and is
 * built from a pinned commit. Seeds one team, one owner (system admin, used only to set up), and one member account
 * whose PAT is the MCP credential. The member has no admin role; the PAT role is granted by the owner.
 */
export class MattermostAdapter extends BaseAdapter<MattermostConfig> {
  readonly id = "mattermost" as const;
  private secrets: MattermostSecrets | undefined;

  constructor(cfg: MattermostConfig) {
    super(cfg);
  }

  mcpRunStateFile(): string {
    return p4RunStateFile("mattermost");
  }

  /** The second identity's run state (H2). Only written when P4_SECOND_IDENTITY=1. */
  secondRunStateFile(): string {
    return p4RunStateFile(secondIdentityProduct("mattermost"));
  }

  private secretsFile(): string {
    return path.join(this.cfg.productRoot, "secrets.json");
  }

  private secretsFromDisk(): MattermostSecrets {
    const file = this.secretsFile();
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
    return mattermostSecretsFromText(text);
  }

  private writeSecrets(secrets: MattermostSecrets): void {
    fs.mkdirSync(this.cfg.productRoot, { recursive: true });
    fs.writeFileSync(this.secretsFile(), JSON.stringify(secrets), { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(this.secretsFile(), 0o600);
  }

  /** The per-run build folder: the Dockerfile plus extra-ca.pem (empty unless MATTERMOST_EXTRA_CA_FILE is set). */
  private buildContext(): string {
    return path.join(this.cfg.productRoot, "build");
  }

  /** Copies the Dockerfile and writes the optional CA into the build folder. Never logs the CA. */
  private prepareBuildContext(): void {
    const dir = this.buildContext();
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(HARNESS_DOCKER_DIR, "mattermost-mcp.Dockerfile"), path.join(dir, "mattermost-mcp.Dockerfile"));
    fs.writeFileSync(path.join(dir, "extra-ca.pem"), extraCaPem(process.env.MATTERMOST_EXTRA_CA_FILE), { mode: 0o600 });
  }

  private composeOpts(): ComposeOptions {
    const secrets = this.secrets ?? this.secretsFromDisk();
    return {
      projectName: MATTERMOST_COMPOSE_PROJECT,
      files: mattermostComposeFiles(),
      cwd: HARNESS_DOCKER_DIR,
      env: mattermostComposeEnv(process.env, secrets, this.buildContext()),
    };
  }

  private composeArgs(extra: string[]): string[] {
    const opts = this.composeOpts();
    return ["compose", "-p", opts.projectName, ...opts.files.flatMap((f) => ["-f", f]), ...extra];
  }

  async up(): Promise<void> {
    // The compose file declares qa-harness-p4 as external, so it must exist before any compose call.
    await ensureP4Network();
    this.secrets = this.secretsFromDisk();
    this.writeSecrets(this.secrets);
    this.prepareBuildContext();
    const opts = this.composeOpts();
    await composeUp(opts, { wait: true, waitServices: ["db", "app"] });
    await this.waitHealthy();
    await this.seed();
    // Build the MCP image (pinned commit) and start it only after the app is seeded.
    await run("docker", this.composeArgs(["build", "mcp"]), { cwd: opts.cwd, env: opts.env, timeoutMs: MMCTL_TIMEOUT_MS });
    await composeUp(opts, { wait: true, waitServices: ["mcp"] });
    await this.waitMcp();
    if (this.cfg.secondIdentity) {
      await this.waitSecondMcp();
    }
    console.log(
      `Mattermost is up: ${this.cfg.baseUrl} (MCP ${this.cfg.mcpUrl}, development-only binary). The MCP credential is in ${this.mcpRunStateFile()} and is not printed.`,
    );
  }

  async down(): Promise<void> {
    removeP4RunState(this.mcpRunStateFile());
    removeP4RunState(this.secondRunStateFile());
    const opts = this.composeOpts();
    if (process.env.MATTERMOST_DOWN_VOLUMES === "1") {
      await run("docker", this.composeArgs(["down", "-v"]), { cwd: opts.cwd, env: opts.env });
      fs.rmSync(this.secretsFile(), { force: true });
      return;
    }
    await composeDown(opts, ["--remove-orphans"]);
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/api/v4/system/ping`, { timeoutMs: 0, isOk: (status) => status === 200 });
  }

  async waitHealthy(timeoutMs?: number): Promise<void> {
    const url = `${this.cfg.baseUrl}/api/v4/system/ping`;
    const deadline = Date.now() + (timeoutMs ?? p4WaitBudgetMs());
    let last = "no response";
    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_MS) });
        if (response.status === 200 && parsePing(await response.json())) {
          return;
        }
        last = `HTTP ${response.status}`;
      } catch {
        last = "connection failed";
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`Timed out waiting for ${url} to report OK (last: ${last})`);
  }

  private async login(loginId: string, password: string): Promise<Session | null> {
    const req = loginRequest(this.cfg.baseUrl, loginId, password);
    const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (response.status !== 200) {
      return null;
    }
    const token = response.headers.get("token");
    const body = (await response.json()) as { id?: unknown };
    if (!token || typeof body.id !== "string") {
      return null;
    }
    return { token, userId: body.id };
  }

  private async mmctl(args: string[], redact: string[]): Promise<void> {
    const opts = this.composeOpts();
    await runCapture("docker", this.composeArgs(["exec", "-T", "app", ...args]), {
      cwd: opts.cwd,
      env: opts.env,
      timeoutMs: MMCTL_TIMEOUT_MS,
      redact,
    });
  }

  /** Owner (system admin, setup only), team, member, PAT role grant, then the member's PAT. Idempotent on a kept volume. */
  async seed(): Promise<SeedResult> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const redact = [secrets.dbPassword, secrets.ownerPassword, secrets.agentPassword];

    let owner = await this.login(MATTERMOST_OWNER_USERNAME, secrets.ownerPassword);
    if (owner === null) {
      await this.mmctl(mmctlUserCreateArgs(MATTERMOST_OWNER_EMAIL, MATTERMOST_OWNER_USERNAME, secrets.ownerPassword, true), redact);
      owner = await this.login(MATTERMOST_OWNER_USERNAME, secrets.ownerPassword);
      if (owner === null) {
        throw new Error("MATTERMOST_OWNER_LOGIN_FAILED: the owner account does not log in after creation");
      }
    }

    const teamResponse = await fetch(`${this.cfg.baseUrl}/api/v4/teams/name/${MATTERMOST_TEAM_NAME}`, {
      headers: { authorization: `Bearer ${owner.token}` },
      signal: AbortSignal.timeout(REQUEST_MS),
    });
    if (teamResponse.status === 404) {
      await this.mmctl(mmctlTeamCreateArgs(MATTERMOST_TEAM_NAME, "QA", MATTERMOST_OWNER_EMAIL), redact);
    }

    let agent = await this.login(MATTERMOST_AGENT_USERNAME, secrets.agentPassword);
    if (agent === null) {
      await this.mmctl(mmctlUserCreateArgs(MATTERMOST_AGENT_EMAIL, MATTERMOST_AGENT_USERNAME, secrets.agentPassword, false), redact);
      await this.mmctl(mmctlTeamAddArgs(MATTERMOST_TEAM_NAME, [MATTERMOST_OWNER_USERNAME, MATTERMOST_AGENT_USERNAME]), redact);
      agent = await this.login(MATTERMOST_AGENT_USERNAME, secrets.agentPassword);
      if (agent === null) {
        throw new Error("MATTERMOST_AGENT_LOGIN_FAILED: the member account does not log in after creation");
      }
    }

    // The owner grants the PAT role. The member never receives admin rights.
    const grant = grantPatRoleRequest(this.cfg.baseUrl, agent.userId, owner.token, MATTERMOST_PAT_ROLES);
    const granted = await fetch(grant.url, { ...grant.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (granted.status !== 200) {
      throw new Error(`Mattermost role grant returned HTTP ${granted.status}`);
    }

    // A fresh member session, after the grant, mints the PAT.
    const memberSession = await this.login(MATTERMOST_AGENT_USERNAME, secrets.agentPassword);
    if (memberSession === null) {
      throw new Error("MATTERMOST_AGENT_LOGIN_FAILED: the member account does not log in after the role grant");
    }
    const pat = createPatRequest(this.cfg.baseUrl, memberSession.userId, memberSession.token, "p4-mcp");
    const patResponse = await fetch(pat.url, { ...pat.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (patResponse.status !== 200) {
      throw new Error(`Mattermost PAT creation returned HTTP ${patResponse.status}`);
    }
    const token = parsePatToken(await patResponse.json());

    writeP4RunState(this.mcpRunStateFile(), {
      version: 1,
      product: "mattermost",
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: `Bearer ${token}`,
      owner: { username: MATTERMOST_AGENT_USERNAME, email: MATTERMOST_AGENT_EMAIL },
    });
    const users: SeedResult["users"] = [
      { email: MATTERMOST_OWNER_EMAIL, role: "system_admin", notes: "setup only; not used by the MCP" },
      { email: MATTERMOST_AGENT_EMAIL, role: "member", notes: "the MCP's PAT belongs to this account" },
    ];
    if (this.cfg.secondIdentity) {
      await this.seedSecond(owner.token, [...redact, this.secondPassword(secrets)]);
      users.push({ email: MATTERMOST_AGENT_B_EMAIL, role: "member", notes: "second identity (H2); PAT in its own run state" });
      if (this.cfg.secondPosts) {
        await this.seedSecondPosts();
      }
    }
    return {
      product: this.id,
      created: true,
      users,
      notes: "Created one team, an owner for setup, and a member account. The member's PAT is in the run state (not printed).",
    };
  }

  /** H2: the second password, derived from the agent password the secrets file already keeps. Never stored. */
  private secondPassword(secrets: MattermostSecrets): string {
    return derivedSecondPassword(secrets.agentPassword, "mattermost");
  }

  /**
   * H2. A second member of the same team, with the PAT role granted by the owner, and its own PAT. Idempotent: an existing
   * account with the derived password is reused, and a kept volume's PAT is minted again (the run state is rewritten).
   */
  private async seedSecond(ownerToken: string, redact: string[]): Promise<void> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const password = this.secondPassword(secrets);
    let member = await this.login(MATTERMOST_AGENT_B_USERNAME, password);
    if (member === null) {
      await this.mmctl(mmctlUserCreateArgs(MATTERMOST_AGENT_B_EMAIL, MATTERMOST_AGENT_B_USERNAME, password, false), redact);
      await this.mmctl(mmctlTeamAddArgs(MATTERMOST_TEAM_NAME, [MATTERMOST_AGENT_B_USERNAME]), redact);
      member = await this.login(MATTERMOST_AGENT_B_USERNAME, password);
      if (member === null) {
        throw new Error("MATTERMOST_SECOND_LOGIN_FAILED: the second member account does not log in after creation");
      }
    }
    const grant = grantPatRoleRequest(this.cfg.baseUrl, member.userId, ownerToken, MATTERMOST_PAT_ROLES);
    const granted = await fetch(grant.url, { ...grant.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (granted.status !== 200) {
      throw new Error(`Mattermost role grant (second identity) returned HTTP ${granted.status}`);
    }
    const session = await this.login(MATTERMOST_AGENT_B_USERNAME, password);
    if (session === null) {
      throw new Error("MATTERMOST_SECOND_LOGIN_FAILED: the second member account does not log in after the role grant");
    }
    const pat = createPatRequest(this.cfg.baseUrl, session.userId, session.token, "p4-mcp-b");
    const patResponse = await fetch(pat.url, { ...pat.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (patResponse.status !== 200) {
      throw new Error(`Mattermost PAT creation (second identity) returned HTTP ${patResponse.status}`);
    }
    writeP4RunState(this.secondRunStateFile(), {
      version: 1,
      product: secondIdentityProduct("mattermost"),
      mcpUrl: this.cfg.mcpUrl,
      mcpAuthorization: `Bearer ${parsePatToken(await patResponse.json())}`,
      owner: { username: MATTERMOST_AGENT_B_USERNAME, email: MATTERMOST_AGENT_B_EMAIL },
    });
  }

  async authenticate(): Promise<AuthSession> {
    const creds = readP4McpCredentials("mattermost", this.mcpRunStateFile());
    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: requireMcpAuthorization(creds, "mattermost"),
      raw: { source: "run-state" },
    };
  }

  /** Uses the PAT on /users/me and checks the account is the member, not an admin. */
  async proveAuth(session: AuthSession): Promise<void> {
    const me = await this.me(session);
    if (me.username !== MATTERMOST_AGENT_USERNAME) {
      throw new Error("Mattermost proveAuth: the PAT does not belong to the member account");
    }
    if (isSystemAdmin(me.roles)) {
      throw new Error("Mattermost proveAuth: the MCP account has the system admin role, which it must not");
    }
    console.log("Mattermost auth probe: PAT belongs to the member account, no admin role (HTTP 200)");
  }

  /**
   * H7. The second member posts the missing messages from SEED_POST_PREFIX in town-square. It logs in with its derived
   * password (the same account H2 created) and reads the channel first, so a kept volume posts only what is missing.
   */
  private async seedSecondPosts(): Promise<void> {
    const secrets = this.secrets ?? this.secretsFromDisk();
    const session = await this.login(MATTERMOST_AGENT_B_USERNAME, this.secondPassword(secrets));
    if (session === null) {
      throw new Error("MATTERMOST_SECOND_LOGIN_FAILED: the second member account does not log in for the H7 posts");
    }
    const channelId = await this.channelIdFor(session.token);
    const existing = (await this.channelPosts(session.token, channelId)).map((post) => post.message);
    for (const message of missingPostMessages(existing)) {
      const req = createPostRequest(this.cfg.baseUrl, session.token, channelId, message);
      const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
      if (response.status !== 201 && response.status !== 200) {
        throw new Error(`Mattermost post (second identity, H7) returned HTTP ${response.status}`);
      }
    }
  }

  /** The channel id of SEED_CHANNEL_NAME in the harness team, read with the given token. */
  private async channelIdFor(token: string): Promise<string> {
    const req = channelByNameRequest(this.cfg.baseUrl, token, MATTERMOST_TEAM_NAME, SEED_CHANNEL_NAME);
    const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (response.status !== 200) {
      throw new Error(`Mattermost channel lookup returned HTTP ${response.status}`);
    }
    return parseChannelId(await response.json());
  }

  private async channelPosts(token: string, channelId: string): Promise<ChannelPost[]> {
    const req = channelPostsRequest(this.cfg.baseUrl, token, channelId);
    const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (response.status !== 200) {
      throw new Error(`Mattermost channel posts returned HTTP ${response.status}`);
    }
    return parseChannelPosts(await response.json());
  }

  /**
   * H7 live probe. Reads the channel as the owner (the MCP's own PAT, a team member) and checks that every seeded message
   * exists exactly once and that its author is the second identity's user id. Returns counts and the second username only.
   */
  async probeSeededPosts(): Promise<SeededPostsProbe> {
    const ownerAuth = requireMcpAuthorization(readP4McpCredentials("mattermost", this.mcpRunStateFile()), "mattermost");
    const secondAuth = requireMcpAuthorization(readP4McpCredentials(secondIdentityProduct("mattermost"), this.secondRunStateFile()), "mattermost");
    const second = await this.me({ product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: secondAuth, raw: { source: "run-state" } });
    const ownerBearer = ownerAuth.replace(/^Bearer /, "");
    const channelId = await this.channelIdFor(ownerBearer);
    const posts = seededPosts(await this.channelPosts(ownerBearer, channelId));
    const expected = seedPostMessages();
    const missing = missingPostMessages(posts.map((post) => post.message)).length;
    const duplicates = posts.length - new Set(posts.map((post) => post.message)).size;
    const authoredBySecond = posts.filter((post) => post.userId === second.id).length;
    return {
      product: this.id,
      channel: SEED_CHANNEL_NAME,
      expected: expected.length,
      found: posts.length,
      missing,
      duplicates,
      authoredBySecond,
      secondAuthor: second.username,
    };
  }

  /** users/me for one PAT: the id, username and roles. The PAT is never printed. */
  private async me(session: AuthSession): Promise<{ id: string; username: string; roles: unknown }> {
    const bearer = session.authorizationHeader.replace(/^Bearer /, "");
    const req = usersMeRequest(this.cfg.baseUrl, bearer);
    const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
    if (response.status !== 200) {
      throw new Error(`Mattermost proveAuth users/me returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as { id?: unknown; username?: unknown; roles?: unknown };
    return {
      id: typeof body.id === "string" ? body.id : "",
      username: typeof body.username === "string" ? body.username : "",
      roles: body.roles,
    };
  }

  /** H2: MCP readiness and the users/me identity for the second PAT (its own run state). */
  async waitSecondMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials(secondIdentityProduct("mattermost"), this.secondRunStateFile());
    const readiness = await mcpReadinessFor("mattermost", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "mattermost"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: MIN_TOOLS,
    });
    const me = await this.me({ product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: requireMcpAuthorization(creds, "mattermost"), raw: { source: "run-state" } });
    if (me.username !== MATTERMOST_AGENT_B_USERNAME) {
      throw new Error("Mattermost second identity: users/me did not name the second member");
    }
    return readiness;
  }

  /**
   * H2 live probe. Both PATs authenticate as their own accounts (different usernames, neither an admin), and the MCP
   * handshake and tools list pass for both. Returns usernames and counts only.
   */
  async probeSecondIdentity(): Promise<SecondIdentityProbe> {
    const ownerCreds = readP4McpCredentials("mattermost", this.mcpRunStateFile());
    const secondCreds = readP4McpCredentials(secondIdentityProduct("mattermost"), this.secondRunStateFile());
    const ownerAuth = requireMcpAuthorization(ownerCreds, "mattermost");
    const secondAuth = requireMcpAuthorization(secondCreds, "mattermost");
    const ownerMe = await this.me({ product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: ownerAuth, raw: { source: "run-state" } });
    const secondMe = await this.me({ product: this.id, baseUrl: this.cfg.baseUrl, authorizationHeader: secondAuth, raw: { source: "run-state" } });
    if (isSystemAdmin(secondMe.roles)) {
      throw new Error("Mattermost second identity has the system admin role, which it must not");
    }
    const ownerMcp = await mcpReadinessFor("mattermost", { url: ownerCreds.mcpUrl, authorization: ownerAuth, timeoutMs: p4WaitBudgetMs(), minTools: MIN_TOOLS });
    const secondMcp = await mcpReadinessFor("mattermost", { url: secondCreds.mcpUrl, authorization: secondAuth, timeoutMs: p4WaitBudgetMs(), minTools: MIN_TOOLS });
    return {
      product: this.id,
      owner: ownerMe.username,
      second: secondMe.username,
      distinct: ownerMe.username !== secondMe.username,
      ownerTools: ownerMcp.toolNames.length,
      secondTools: secondMcp.toolNames.length,
    };
  }

  async waitMcp(timeoutMs?: number): Promise<McpReadiness> {
    const creds = readP4McpCredentials("mattermost", this.mcpRunStateFile());
    const readiness = await mcpReadinessFor("mattermost", {
      url: creds.mcpUrl,
      authorization: requireMcpAuthorization(creds, "mattermost"),
      timeoutMs: timeoutMs ?? p4WaitBudgetMs(),
      minTools: MIN_TOOLS,
    });
    await this.proveAuth(await this.authenticate());
    return readiness;
  }
}
