import { loadProductConfig } from "../config.js";
import type { ProductId } from "../types.js";
import { CalAdapter } from "./cal.adapter.js";
import { DocumensoAdapter } from "./documenso.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { TwentyAdapter } from "./twenty.adapter.js";
import type { ProductAdapter } from "./types.js";

export function getAdapter(id: ProductId): ProductAdapter {
  switch (id) {
    case "cal":
      return new CalAdapter(loadProductConfig("cal"));
    case "documenso":
      return new DocumensoAdapter(loadProductConfig("documenso"));
    case "medusa":
      return new MedusaAdapter(loadProductConfig("medusa"));
    case "twenty":
      return new TwentyAdapter(loadProductConfig("twenty"));
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown product id: ${String(exhaustive)}`);
    }
  }
}
