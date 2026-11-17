import { loadProductConfig } from "../config.js";
import type { ProductId } from "../types.js";
import { CalAdapter } from "./cal.adapter.js";
import { DocumensoAdapter } from "./documenso.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { UnimplementedAdapter } from "./base.js";
import { NextcloudAdapter } from "./nextcloud.adapter.js";
import { MattermostAdapter } from "./mattermost.adapter.js";
import { OutlineAdapter } from "./outline.adapter.js";
import { PenpotAdapter } from "./penpot.adapter.js";
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
    case "nextcloud":
      return new NextcloudAdapter(loadProductConfig("nextcloud"));
    // Outline, Penpot and Mattermost arrive in Tasks 4 to 6. Until then they fail loudly with NotImplementedError.
    case "outline":
      return new OutlineAdapter(loadProductConfig("outline"));
    case "penpot":
      return new PenpotAdapter(loadProductConfig("penpot"));
    case "mattermost":
      return new MattermostAdapter(loadProductConfig("mattermost"));
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown product id: ${String(exhaustive)}`);
    }
  }
}
