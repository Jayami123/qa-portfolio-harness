import { notImplemented } from "../errors.js";
import { waitUntilHealthy } from "../wait/health.js";
export class BaseAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    get productRoot() {
        return this.cfg.productRoot;
    }
    get baseUrl() {
        return this.cfg.baseUrl;
    }
    get dbUrl() {
        return this.cfg.dbUrl;
    }
    async waitHealthy(timeoutMs) {
        const first = await this.health();
        if (first.ok) {
            return;
        }
        await waitUntilHealthy(first.url, { timeoutMs });
    }
    async proveAuth(_session) {
        // Optional per product. Cal overrides this.
    }
}
export class UnimplementedAdapter extends BaseAdapter {
    id;
    constructor(id, cfg) {
        super(cfg);
        this.id = id;
    }
    async up() {
        notImplemented(this.id, "up");
    }
    async down() {
        notImplemented(this.id, "down");
    }
    async health() {
        notImplemented(this.id, "health");
    }
    async seed() {
        notImplemented(this.id, "seed");
    }
    async authenticate() {
        notImplemented(this.id, "authenticate");
    }
}
//# sourceMappingURL=base.js.map