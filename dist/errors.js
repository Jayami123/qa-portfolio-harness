export class NotImplementedError extends Error {
    product;
    method;
    constructor(product, method, detail) {
        super(`NotImplemented: ${product}.${method}() is not wired yet.${detail ? ` ${detail}` : ""}`);
        this.name = "NotImplementedError";
        this.product = product;
        this.method = method;
    }
}
export function notImplemented(product, method, detail) {
    throw new NotImplementedError(product, method, detail);
}
//# sourceMappingURL=errors.js.map