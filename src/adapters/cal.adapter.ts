import fs from "node:fs";
import path from "node:path";
import type { CalConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import { detectPackageManager, run } from "../internal/run.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-cal";

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
      notes:
        "Invoked the fork's `yarn db-seed`. Copy the printed `Created seeded API Key: cal_…` line into harness CAL_API_KEY. Re-seed will skip if the key already exists, so the env value is the source of truth.",
    };
  }

  async authenticate(): Promise<AuthSession> {
    const key = this.cfg.apiKey;
    if (!key) {
      throw new Error(
        "Cal authenticate() requires CAL_API_KEY in the harness .env. " +
          "Run `yarn db-seed` in the Cal fork, copy the printed `cal_…` key, and paste it here. " +
          "This adapter does not hardcode the seed key (it changes if seed.ts changes).",
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.apiBaseUrl,
      authorizationHeader: key.startsWith("Bearer ") ? key : `Bearer ${key}`,
      raw: {
        webBaseUrl: this.cfg.baseUrl,
        apiBaseUrl: this.cfg.apiBaseUrl,
        source: "CAL_API_KEY",
      },
    };
  }

  /**
   * Prove the Bearer token against an authenticated API v2 route.
   * Public GET /health is not used — it does not require a key.
   */
  async proveAuth(session: AuthSession): Promise<void> {
    const probes = [
      process.env.CAL_AUTH_PROBE_URL,
      `${this.cfg.apiBaseUrl}/api/v2/me`,
      `${this.cfg.apiBaseUrl}/me`,
    ].filter((url): url is string => Boolean(url));

    let lastError = "no probe attempted";
    for (const url of probes) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: session.authorizationHeader,
          },
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Cal auth probe ${url} returned HTTP ${response.status}. CAL_API_KEY is missing, expired, or not a valid API v2 key.`,
          );
        }
        if (response.status === 404) {
          lastError = `HTTP 404 at ${url}`;
          continue;
        }
        if (response.status >= 500) {
          lastError = `HTTP ${response.status} at ${url}`;
          continue;
        }
        console.log(`Cal auth probe ok: ${url} HTTP ${response.status}`);
        return;
      } catch (error) {
        if (error instanceof Error && error.message.includes("CAL_API_KEY")) {
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(
      `Cal auth probe failed (${lastError}). Start API v2 (\`cd apps/api/v2 && yarn dev\`) and set CAL_AUTH_PROBE_URL if /api/v2/me is not the route. TODO(verify): confirm /me path on this fork.`,
    );
  }
}
