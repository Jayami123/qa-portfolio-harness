import type { ProductId } from "../types.js";
import { CalAdapter } from "./cal.adapter.js";
import { DocumensoAdapter } from "./documenso.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { TwentyAdapter } from "./twenty.adapter.js";
import type { ProductAdapter } from "./types.js";

const factories: Record<ProductId, () => ProductAdapter> = {
  cal: () => new CalAdapter(),
  documenso: () => new DocumensoAdapter(),
  medusa: () => new MedusaAdapter(),
  twenty: () => new TwentyAdapter(),
};

export function getAdapter(id: ProductId): ProductAdapter {
  const factory = factories[id];
  if (!factory) {
    throw new Error(`Unknown product id: ${String(id)}`);
  }
  return factory();
}
