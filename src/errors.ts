import type { ProductId } from "./types.js";

export class NotImplementedError extends Error {
  readonly product: ProductId;
  readonly method: string;

  constructor(product: ProductId, method: string, detail?: string) {
    super(
      `NotImplemented: ${product}.${method}() is not wired yet.${detail ? ` ${detail}` : ""}`,
    );
    this.name = "NotImplementedError";
    this.product = product;
    this.method = method;
  }
}

export function notImplemented(product: ProductId, method: string, detail?: string): never {
  throw new NotImplementedError(product, method, detail);
}
