import type { CalConfig, DocumensoConfig, MedusaConfig, ProductConfig, TwentyConfig } from "../config.js";
import { notImplemented } from "../errors.js";
import type { AuthSession, HealthStatus, ProductId, SeedResult } from "../types.js";
import { waitUntilHealthy } from "../wait/health.js";
import type { ProductAdapter } from "./types.js";

export abstract class BaseAdapter<C extends ProductConfig> implements ProductAdapter {
  abstract readonly id: ProductId;

  constructor(protected readonly cfg: C) {}

  get productRoot(): string {
    return this.cfg.productRoot;
  }

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  get dbUrl(): string {
    return this.cfg.dbUrl;
  }

  abstract up(): Promise<void>;
  abstract down(): Promise<void>;
  abstract health(): Promise<HealthStatus>;

  async waitHealthy(timeoutMs?: number): Promise<void> {
    const first = await this.health();
    if (first.ok) {
      return;
    }
    await waitUntilHealthy(first.url, { timeoutMs });
  }

  abstract seed(): Promise<SeedResult>;
  abstract authenticate(): Promise<AuthSession>;

  async proveAuth(_session: AuthSession): Promise<void> {
    // Optional per product. Cal overrides this.
  }
}

export class UnimplementedAdapter<C extends ProductConfig> extends BaseAdapter<C> {
  constructor(
    readonly id: ProductId,
    cfg: C,
  ) {
    super(cfg);
  }

  async up(): Promise<void> {
    notImplemented(this.id, "up");
  }

  async down(): Promise<void> {
    notImplemented(this.id, "down");
  }

  async health(): Promise<HealthStatus> {
    notImplemented(this.id, "health");
  }

  async seed(): Promise<SeedResult> {
    notImplemented(this.id, "seed");
  }

  async authenticate(): Promise<AuthSession> {
    notImplemented(this.id, "authenticate");
  }
}

export type { CalConfig, DocumensoConfig, MedusaConfig, TwentyConfig };
