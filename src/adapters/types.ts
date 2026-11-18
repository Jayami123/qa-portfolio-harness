import type { AuthSession, HealthStatus, ProductId, SeedResult } from "../types.js";

/** Result of a real MCP handshake: initialize, notifications/initialized, tools/list. Names only, never schemas or tokens. */
export interface McpReadiness {
  url: string;
  toolCount: number;
  toolNames: string[];
  elapsedMs: number;
}

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
  /** P4 (ADR 0006, D4): waits for the MCP endpoint. Optional, so Cal, Documenso and Medusa are unchanged. */
  waitMcp?(timeoutMs?: number): Promise<McpReadiness>;
  /** P4 (D4): absolute path of the run-state file that holds the MCP credential. */
  mcpRunStateFile?(): string;
}
