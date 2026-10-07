import fs from "node:fs";
import path from "node:path";
import type { MedusaConfig } from "../config.js";
import { composeDown, composeUp, harnessComposeFile } from "../internal/compose.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import { pollHealth } from "../wait/health.js";
import { BaseAdapter } from "./base.js";

const COMPOSE_PROJECT = "qa-harness-medusa";

export class MedusaAdapter extends BaseAdapter<MedusaConfig> {
  readonly id = "medusa" as const;

  constructor(cfg: MedusaConfig) {
    super(cfg);
  }

  private productComposeFile(): string {
    return path.join(this.productRoot, "scripts", "portfolio-validation", "docker-compose.yml");
  }

  private composeOpts() {
    return {
      projectName: COMPOSE_PROJECT,
      files: [this.productComposeFile(), harnessComposeFile("medusa.compose.yml")],
      cwd: this.productRoot,
    };
  }

  async up(): Promise<void> {
    if (!fs.existsSync(this.productComposeFile())) {
      throw new Error(
        `Medusa validation compose not found at ${this.productComposeFile()}.`,
      );
    }

    await composeUp(this.composeOpts());

    console.log(`
Medusa dependencies are up:
  Postgres  localhost:5433  (medusa / medusa / medusa_validation)
  Redis     localhost:6380
  MinIO     localhost:9011 (console 9012)  — remapped to avoid Documenso 9001/9002

The Medusa HTTP process is NOT started by this adapter (this repo is the engine monorepo, not a store app).

TODO(verify): confirm how Jayami starts the live app for portfolio work.
Typical path from the fork's validation README:
  yarn.cmd install
  # point the app at DATABASE_URL / Redis 6380
  medusa develop     # GET ${this.cfg.baseUrl}/health

Then set MEDUSA_ADMIN_EMAIL, MEDUSA_ADMIN_PASSWORD, MEDUSA_PUBLISHABLE_API_KEY in the harness .env.
`);
  }

  async down(): Promise<void> {
    await composeDown(this.composeOpts());
  }

  async health(): Promise<HealthStatus> {
    return pollHealth(`${this.cfg.baseUrl}/health`, { timeoutMs: 0 });
  }

  async seed(): Promise<SeedResult> {
    // TODO(verify): the Medusa fork is the engine monorepo; there is no
    // storefront `db:seed` script at repo root. A running create-medusa-app
    // (or equivalent) owns seed data.
    throw new Error(
      "Medusa seed() is not wired in this monorepo. Start your store app, run its seed command, " +
        "then set MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD / MEDUSA_PUBLISHABLE_API_KEY. " +
        "TODO(verify): which starter Jayami uses for P1/P2 against this fork.",
    );
  }

  async authenticate(): Promise<AuthSession> {
    const email = this.cfg.adminEmail;
    const password = this.cfg.adminPassword;
    if (!email || !password) {
      throw new Error(
        "Medusa authenticate() needs MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD in the harness .env.",
      );
    }

    const url = `${this.cfg.baseUrl}/auth/user/emailpass`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const body = (await response.json().catch(() => undefined)) as
      | { token?: string }
      | undefined;

    if (!response.ok || !body?.token) {
      throw new Error(
        `Medusa POST ${url} failed (HTTP ${response.status}). Confirm the admin user exists and the app is running.`,
      );
    }

    return {
      product: this.id,
      baseUrl: this.cfg.baseUrl,
      authorizationHeader: `Bearer ${body.token}`,
      raw: {
        token: body.token,
        publishableApiKey: this.cfg.publishableApiKey,
        storeHeader: this.cfg.publishableApiKey
          ? { "x-publishable-api-key": this.cfg.publishableApiKey }
          : undefined,
        note: "Admin JWT via POST /auth/user/emailpass. Store APIs also need x-publishable-api-key.",
      },
    };
  }
}
