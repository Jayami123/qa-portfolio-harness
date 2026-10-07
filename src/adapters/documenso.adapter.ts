import { notImplemented } from "../errors.js";
import type { AuthSession, HealthStatus, SeedResult } from "../types.js";
import type { ProductAdapter } from "./types.js";

export class DocumensoAdapter implements ProductAdapter {
  readonly id = "documenso" as const;
  readonly productRoot = "";
  readonly baseUrl = "";
  readonly dbUrl = "";

  async up(): Promise<void> {
    notImplemented(this.id, "up");
  }

  async down(): Promise<void> {
    notImplemented(this.id, "down");
  }

  async health(): Promise<HealthStatus> {
    notImplemented(this.id, "health");
  }

  async waitHealthy(_timeoutMs?: number): Promise<void> {
    notImplemented(this.id, "waitHealthy");
  }

  async seed(): Promise<SeedResult> {
    notImplemented(this.id, "seed");
  }

  async authenticate(): Promise<AuthSession> {
    notImplemented(this.id, "authenticate");
  }
}
