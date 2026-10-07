import fs from "node:fs";
import path from "node:path";
import type { TwentyConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { run } from "../internal/run.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-twenty";

export class TwentyAdapter extends BaseAdapter<TwentyConfig> {
  readonly id = "twenty" as const;

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
        path.join(this.dockerDir(), "docker-compose.yml"),
        path.join(this.dockerDir(), "docker-compose.validation.yml"),
        harnessComposeFile("twenty.compose.yml"),
      ],
      cwd: this.dockerDir(),
      env: {
        ...process.env,
        TAG: this.cfg.imageTag,
        TWENTY_BASE_URL: this.cfg.baseUrl,
      },
    };
  }

  private assertDockerEnv(): void {
    const envPath = path.join(this.dockerDir(), ".env");
    if (!fs.existsSync(envPath)) {
      throw new Error(
        `Twenty docker .env missing at ${envPath}. Copy .env.example → .env in packages/twenty-docker ` +
          `and set ENCRYPTION_KEY / APP_SECRET (openssl rand -base64 32). This harness will not invent secrets. ` +
          `Alternatively run the fork's scripts/validation/anchor-b-up.ps1`,
      );
    }
    const text = fs.readFileSync(envPath, "utf8");
    const encryption = text.match(/^\s*ENCRYPTION_KEY=(.*)$/m)?.[1]?.trim() ?? "";
    if (!encryption || encryption.startsWith("replace_me")) {
      throw new Error(
        `Twenty ${envPath} has no ENCRYPTION_KEY. Set it locally (do not commit). This harness will not invent secrets.`,
      );
    }
  }

  async up(): Promise<void> {
    this.assertDockerEnv();
    await composeUp(this.composeOpts());
    console.log(`
Twenty stack is starting (image twentycrm/twenty:${this.cfg.imageTag}).
  App:      ${this.cfg.baseUrl}/healthz
  Postgres: host port 5434 (container 5432)
  Mailpit:  http://localhost:8025

Seed is separate (can take 15–30 minutes): npm run smoke will call seed(), or:
  docker compose -p ${COMPOSE_PROJECT} -f docker-compose.yml exec -T server yarn command:prod workspace:seed:dev
`);
  }

  async down(): Promise<void> {
    await composeDown(this.composeOpts());
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/healthz`, { timeoutMs: 0 });
  }

  async seed(): Promise<SeedResult> {
    this.assertDockerEnv();
    await run(
      "docker",
      [
        "compose",
        "-p",
        COMPOSE_PROJECT,
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.validation.yml",
        "-f",
        harnessComposeFile("twenty.compose.yml"),
        "exec",
        "-T",
        "server",
        "yarn",
        "command:prod",
        "workspace:seed:dev",
      ],
      {
        cwd: this.dockerDir(),
        env: { TAG: this.cfg.imageTag, TWENTY_BASE_URL: this.cfg.baseUrl },
        timeoutMs: 40 * 60 * 1000,
      },
    );

    return {
      product: this.id,
      created: true,
      users: [
        {
          email: "tim@apple.dev",
          role: "demo",
          notes: "Fork validation README: password equals email for demo users. Set TWENTY_EMAIL / TWENTY_PASSWORD in harness .env.",
        },
      ],
      notes: "Invoked `yarn command:prod workspace:seed:dev` inside the twenty server container.",
    };
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
    if (!email || !password) {
      throw new Error(
        "Twenty authenticate() needs TWENTY_API_KEY, or TWENTY_EMAIL + TWENTY_PASSWORD in the harness .env. " +
          "Demo users are documented in the fork's scripts/validation/README.md — copy them into .env, do not commit.",
      );
    }

    const origin = this.cfg.baseUrl;
    const loginToken = await this.graphqlMetadata<{
      getLoginTokenFromCredentials?: { loginToken?: { token?: string } };
    }>(
      `mutation GetLoginTokenFromCredentials($email: String!, $password: String!, $origin: String!) {
        getLoginTokenFromCredentials(email: $email, password: $password, origin: $origin) {
          loginToken { token }
        }
      }`,
      { email, password, origin },
    );

    const token = loginToken.getLoginTokenFromCredentials?.loginToken?.token;
    if (!token) {
      throw new Error(
        "Twenty getLoginTokenFromCredentials returned no token. Check TWENTY_EMAIL / TWENTY_PASSWORD and that seed has run.",
      );
    }

    const auth = await this.graphqlMetadata<{
      getAuthTokensFromLoginToken?: {
        tokens?: { accessOrWorkspaceAgnosticToken?: { token?: string } };
      };
    }>(
      `mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
        getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
          tokens {
            accessOrWorkspaceAgnosticToken { token expiresAt }
            refreshToken { token expiresAt }
          }
        }
      }`,
      { loginToken: token, origin },
    );

    const access =
      auth.getAuthTokensFromLoginToken?.tokens?.accessOrWorkspaceAgnosticToken?.token;
    if (!access) {
      throw new Error("Twenty getAuthTokensFromLoginToken returned no access token.");
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${access}`,
      raw: {
        source: "graphql-metadata-signIn",
        // TODO(verify): origin may need a workspace subdomain (apple.localhost) in some Twenty configs.
        origin,
      },
    };
  }

  private async graphqlMetadata<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const url = `${this.cfg.baseUrl}/metadata`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (!response.ok || body.errors?.length) {
      throw new Error(
        `Twenty POST ${url} failed (HTTP ${response.status}): ${body.errors?.map((e) => e.message).join("; ") || "no token"}`,
      );
    }
    if (!body.data) {
      throw new Error(`Twenty POST ${url} returned no data.`);
    }
    return body.data;
  }
}
