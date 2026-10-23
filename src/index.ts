export type {
  AuthSession,
  HealthStatus,
  ProductId,
  SeedResult,
  SeedUser,
} from "./types.js";
export type { ProductAdapter } from "./adapters/types.js";
export { getAdapter } from "./adapters/registry.js";
export { NotImplementedError } from "./errors.js";
export { createPgClient } from "./db/pg.js";
export * from "./data/factories.js";

/**
 * Twenty dev-seeder login (public fixture values for the fork's dev seed, not production secrets).
 * Re-exported so consumers can sign in to a local Twenty seeded by this harness.
 */
export {
  TWENTY_DEFAULT_ADMIN_EMAIL,
  TWENTY_DEV_SEED_PASSWORD,
} from "./adapters/twenty-env.js";
