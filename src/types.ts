export type ProductId = "cal" | "documenso" | "medusa" | "twenty";

export interface AuthSession {
  product: ProductId;
  baseUrl: string;
  /** Bearer token / API key / cookies as needed by the product */
  authorizationHeader: string;
  /** Optional browser storageState path for Playwright P1 */
  storageStatePath?: string;
  raw?: unknown;
}

export interface SeedUser {
  email: string;
  role?: string;
  notes?: string;
}

export interface SeedResult {
  product: ProductId;
  created: boolean;
  users: SeedUser[];
  notes?: string;
}

export interface HealthStatus {
  ok: boolean;
  url: string;
  statusCode?: number;
  error?: string;
  checkedAt: string;
}
