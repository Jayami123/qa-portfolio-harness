import fs from "node:fs";
import path from "node:path";
import type { DocumensoConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { detectPackageManager, run } from "../internal/run.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-documenso";

export class DocumensoAdapter extends BaseAdapter<DocumensoConfig> {
  readonly id = "documenso" as const;

  constructor(cfg: DocumensoConfig) {
    super(cfg);
  }

  private composeDir(): string {
    return path.join(this.productRoot, "docker", "development");
  }

  private productComposeFile(): string {
    return path.join(this.composeDir(), "compose.yml");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [this.productComposeFile(), harnessComposeFile("documenso.compose.yml")],
      cwd: this.composeDir(),
    };
  }

  async up(): Promise<void> {
    if (!fs.existsSync(this.productComposeFile())) {
      throw new Error(
        `Documenso compose not found at ${this.productComposeFile()}. Expected docker/development/compose.yml in the fork.`,
      );
    }

    await composeUp(this.composeOpts());

    const port = new URL(this.cfg.baseUrl).port || "3001";
    console.log(`
Documenso dependencies are up (Postgres 54320, Inbucket 9000, Gotenberg 3005).
The Remix web app is NOT started by this adapter.

In a separate terminal, from ${this.productRoot}:
  npm ci                         # first time (or npm install)
  # copy .env.example → .env (product secrets stay in the fork, not this repo)
  npx prisma migrate dev         # or: npm run prisma:migrate-dev
  npm run prisma:seed
  set PORT=${port}               # PowerShell: $env:PORT="${port}"
  npm run dev                    # web on ${this.cfg.baseUrl} (not 3000 — Cal uses 3000)

Then create an API token in Settings → API tokens and set DOCUMENSO_API_TOKEN in the harness .env.
`);
  }

  async down(): Promise<void> {
    await composeDown(this.composeOpts());
  }

  async health(): Promise<HealthStatus> {
    // No dedicated /health route found in the fork; GET / accepting < 500.
    return pollHealth(`${this.cfg.baseUrl}/`, { timeoutMs: 0 });
  }

  async seed(): Promise<SeedResult> {
    const pm = detectPackageManager(this.productRoot);
    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(
        `Documenso node_modules missing at ${this.productRoot}. Run \`${pm} ci\` there first.`,
      );
    }

    await run(pm, ["run", "prisma:seed"], {
      cwd: this.productRoot,
      timeoutMs: 10 * 60 * 1000,
    });

    return {
      product: this.id,
      created: true,
      users: [
        { email: "example@documenso.com", role: "user", notes: "from packages/prisma/seed/initial-seed.ts" },
        { email: "admin@documenso.com", role: "admin" },
      ],
      notes: "Invoked the fork's `npm run prisma:seed`.",
    };
  }

  async authenticate(): Promise<AuthSession> {
    const token = this.cfg.apiToken;
    if (!token) {
      // TODO(verify): minting via tRPC api-token-router requires an authenticated
      // session. There is no unauthenticated HTTP helper in the fork for the first token.
      throw new Error(
        "Documenso authenticate() needs DOCUMENSO_API_TOKEN in the harness .env. " +
          "Start the app, sign in as a seeded user, open Settings → API tokens " +
          "(tRPC api-token-router), create a token, and paste it. " +
          "Do not commit the token.",
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${token}`,
      raw: { source: "DOCUMENSO_API_TOKEN" },
    };
  }
}
