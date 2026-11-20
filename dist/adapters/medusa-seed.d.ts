import type { MedusaConfig } from "../config.js";
import type { SeedResult } from "../types.js";
import { type MedusaHarnessSwitches } from "./medusa-env.js";
export declare function readPublishableKeyFromDatabase(dbUrl: string): Promise<string | undefined>;
export declare function ensureMedusaAdminUser(backendDir: string, email: string, password: string, env: Record<string, string>): Promise<void>;
export interface MedusaSeedContext {
    readonly cfg: MedusaConfig;
    readonly switches: MedusaHarnessSwitches;
    readonly authorizationHeader: string;
    readonly backendDir: string;
    readonly processEnv: Record<string, string>;
}
export declare function runMedusaSeed(ctx: MedusaSeedContext): Promise<SeedResult>;
export declare function ensureGermanWarehouse(ctx: MedusaSeedContext, notes: string[]): Promise<void>;
export declare function ensureFeaturedCollection(ctx: MedusaSeedContext, notes: string[]): Promise<void>;
/** `actor_id` from the JWT payload. Empty when the identity has no customer profile yet. */
export declare function customerActorId(token: string): string | undefined;
export declare function ensureCustomer(ctx: MedusaSeedContext, notes: string[], publishableKey: string): Promise<void>;
//# sourceMappingURL=medusa-seed.d.ts.map