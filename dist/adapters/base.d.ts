import type { CalConfig, DocumensoConfig, MedusaConfig, ProductConfig, TwentyConfig } from "../config.js";
import type { AuthSession, HealthStatus, ProductId, SeedResult } from "../types.js";
import type { ProductAdapter } from "./types.js";
export declare abstract class BaseAdapter<C extends ProductConfig> implements ProductAdapter {
    protected readonly cfg: C;
    abstract readonly id: ProductId;
    constructor(cfg: C);
    get productRoot(): string;
    get baseUrl(): string;
    get dbUrl(): string;
    abstract up(): Promise<void>;
    abstract down(): Promise<void>;
    abstract health(): Promise<HealthStatus>;
    waitHealthy(timeoutMs?: number): Promise<void>;
    abstract seed(): Promise<SeedResult>;
    abstract authenticate(): Promise<AuthSession>;
    proveAuth(_session: AuthSession): Promise<void>;
}
export declare class UnimplementedAdapter<C extends ProductConfig> extends BaseAdapter<C> {
    readonly id: ProductId;
    constructor(id: ProductId, cfg: C);
    up(): Promise<void>;
    down(): Promise<void>;
    health(): Promise<HealthStatus>;
    seed(): Promise<SeedResult>;
    authenticate(): Promise<AuthSession>;
}
export type { CalConfig, DocumensoConfig, MedusaConfig, TwentyConfig };
//# sourceMappingURL=base.d.ts.map