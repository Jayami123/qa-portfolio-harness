import fs from "node:fs";
import path from "node:path";
import type { CalConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { detectPackageManager, run } from "../internal/run.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-cal";

/**
 * Key material created by the fork's `packages/prisma` seed (`scripts/seed.ts`
 * `ensureAcmeOwnerHasApiKeySeeded`). Not invented here — only replayed after
 * `yarn db-seed`. Override with CAL_API_KEY if you mint a different key.
 */
const CAL_SEEDED_API_KEY_BODY = "0123456789abcdef0123456789abcdef";
const CAL_SEEDED_API_KEY_PREFIX = "cal_";

export class CalAdapter extends BaseAdapter<CalConfig> {
  readonly id = "cal" as const;

  constructor(cfg: CalConfig) {
    super(cfg);
  }

  private prismaDir(): string {
    return path.join(this.productRoot, "packages", "prisma");
  }

  private productComposeFile(): string {
    return path.join(this.prismaDir(), "docker-compose.yml");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [this.productComposeFile(), harnessComposeFile("cal.compose.yml")],
      cwd: this.prismaDir(),
    };
  }

  async up(): Promise<void> {
    if (!fs.existsSync(this.productComposeFile())) {
      throw new Error(
        `Cal prisma compose not found at ${this.productComposeFile()}. Expected the cal.diy fork under ${this.productRoot}.`,
      );
    }

    await composeUp(this.composeOpts());

    console.log(`
Cal Postgres is up (host port 5450, db calendso).
The web app and API v2 are NOT started by this adapter (too heavy for Week 1).

In a separate terminal, from ${this.productRoot}:
  yarn
  # copy .env.example → .env and set NEXTAUTH_SECRET + CALENDSO_ENCRYPTION_KEY
  yarn dx          # migrate + seed (or: yarn db-seed if Postgres is already up)
  yarn dev         # web on ${this.cfg.baseUrl}

API v2 (optional, port 5555):
  cd apps/api/v2
  yarn dev         # GET ${this.cfg.apiBaseUrl}/health → OK

Then run: npm run smoke -- cal
`);
  }

  async down(): Promise<void> {
    await composeDown(this.composeOpts());
  }

  async health(): Promise<HealthStatus> {
    const apiHealth = `${this.cfg.apiBaseUrl}/health`;
    const webHealth = `${this.cfg.baseUrl}/api/health`;
    const webRoot = `${this.cfg.baseUrl}/`;

    const api = await pollHealth(apiHealth, { timeoutMs: 0 });
    if (api.ok) {
      return api;
    }

    const named = await pollHealth(webHealth, { timeoutMs: 0 });
    if (named.ok && named.statusCode !== 404) {
      return named;
    }

    // Fork has no web /api/health route; GET / accepting 200/302 (any < 500).
    return pollHealth(webRoot, { timeoutMs: 0 });
  }

  async seed(): Promise<SeedResult> {
    const pm = detectPackageManager(this.productRoot);
    if (pm !== "yarn") {
      console.warn(`Cal lockfile is yarn.lock; using ${pm} anyway.`);
    }
    if (!fs.existsSync(path.join(this.productRoot, "node_modules"))) {
      throw new Error(
        `Cal node_modules missing at ${this.productRoot}. Run \`yarn\` there first, then \`yarn dx\` or \`yarn db-seed\`.`,
      );
    }

    await run("yarn", ["db-seed"], {
      cwd: this.productRoot,
      timeoutMs: 10 * 60 * 1000,
    });

    return {
      product: this.id,
      created: true,
      users: [
        { email: "free@example.com", role: "free", notes: "password is documented in the cal.diy README" },
        { email: "pro@example.com", role: "pro" },
        { email: "trial@example.com", role: "trial" },
        { email: "admin@example.com", role: "admin" },
        { email: "onboarding@example.com", role: "onboarding" },
      ],
      notes: "Invoked the fork's `yarn db-seed` (packages/prisma seed-basic → scripts/seed.ts).",
    };
  }

  async authenticate(): Promise<AuthSession> {
    const prefix = process.env.API_KEY_PREFIX ?? CAL_SEEDED_API_KEY_PREFIX;
    const key = this.cfg.apiKey ?? `${prefix}${CAL_SEEDED_API_KEY_BODY}`;

    if (!this.cfg.apiKey) {
      console.log(
        "Cal authenticate(): using the API key created by the fork seed (scripts/seed.ts). Set CAL_API_KEY to override.",
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.apiBaseUrl,
      authorizationHeader: `Bearer ${key}`,
      raw: {
        webBaseUrl: this.cfg.baseUrl,
        apiBaseUrl: this.cfg.apiBaseUrl,
        source: this.cfg.apiKey ? "CAL_API_KEY" : "fork-seed-scripts/seed.ts",
      },
    };
  }
}
