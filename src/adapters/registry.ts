import { loadConfig } from "../config.js";
import type { ProductId } from "../types.js";
import { CalAdapter } from "./cal.adapter.js";
import { DocumensoAdapter } from "./documenso.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { TwentyAdapter } from "./twenty.adapter.js";
import type { ProductAdapter } from "./types.js";

export function getAdapter(id: ProductId): ProductAdapter {
  const config = loadConfig();
  switch (id) {
    case "cal":
      return new CalAdapter(config.cal);
    case "documenso":
      return new DocumensoAdapter(config.documenso);
    case "medusa":
      return new MedusaAdapter(config.medusa);
    case "twenty":
      return new TwentyAdapter(config.twenty);
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown product id: ${String(exhaustive)}`);
    }
  }
}
