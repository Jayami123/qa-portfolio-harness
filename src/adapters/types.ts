import type { AuthSession, HealthStatus, ProductId, SeedResult } from "../types.js";

export interface ProductAdapter {
  id: ProductId;
  /** Absolute path to the local fork */
  productRoot: string;
  baseUrl: string;
  dbUrl: string;
  up(): Promise<void>;
  down(): Promise<void>;
  health(): Promise<HealthStatus>;
  waitHealthy(timeoutMs?: number): Promise<void>;
  seed(): Promise<SeedResult>;
  authenticate(): Promise<AuthSession>;
  /**
   * Hit a product endpoint that requires this session (not a public /health).
   * No-op when the product has no probe yet.
   */
  proveAuth(session: AuthSession): Promise<void>;
}
