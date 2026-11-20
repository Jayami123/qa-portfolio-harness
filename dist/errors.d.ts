import type { ProductId } from "./types.js";
export declare class NotImplementedError extends Error {
    readonly product: ProductId;
    readonly method: string;
    constructor(product: ProductId, method: string, detail?: string);
}
export declare function notImplemented(product: ProductId, method: string, detail?: string): never;
//# sourceMappingURL=errors.d.ts.map