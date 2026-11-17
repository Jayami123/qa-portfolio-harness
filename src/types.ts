/** Products that have a fork under PRODUCTS_ROOT (see config.ts loadConfig). */
export type ForkProductId = "cal" | "documenso" | "medusa" | "twenty";

/** P4 products: image-only, no fork. Their productRoot is .harness/<product> (ADR 0006, decision D1). */
export type P4ProductId = "nextcloud" | "outline" | "penpot" | "mattermost";

export type ProductId = ForkProductId | P4ProductId;

export const P4_PRODUCT_IDS: readonly P4ProductId[] = ["nextcloud", "outline", "penpot", "mattermost"];

export function isForkProductId(id: ProductId): id is ForkProductId {
  return !(P4_PRODUCT_IDS as readonly string[]).includes(id);
}

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
