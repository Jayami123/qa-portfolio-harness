import { loadProductConfig } from "../config.js";
import type { ProductId } from "../types.js";
import { CalAdapter } from "./cal.adapter.js";
import { DocumensoAdapter } from "./documenso.adapter.js";
import { MedusaAdapter } from "./medusa.adapter.js";
import { NextcloudAdapter } from "./nextcloud.adapter.js";
import { MattermostAdapter } from "./mattermost.adapter.js";
import { OutlineAdapter } from "./outline.adapter.js";
import { PenpotAdapter } from "./penpot.adapter.js";
import { TwentyAdapter } from "./twenty.adapter.js";
import { notImplemented } from "../errors.js";
import { LiteLlmAdapter } from "./litellm.adapter.js";
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
    case "outline":
      return new OutlineAdapter(loadProductConfig("outline"));
    case "penpot":
      return new PenpotAdapter(loadProductConfig("penpot"));
    case "mattermost":
      return new MattermostAdapter(loadProductConfig("mattermost"));
    // Adapters land in tasks 3 to 5. Until then these ids fail with a named message, not a silent fallback.
    case "litellm":
      return new LiteLlmAdapter(loadProductConfig("litellm"));
    case "librechat":
      return notImplemented(id, "getAdapter", "the LibreChat adapter lands in task 4");
    case "openclaw":
      return notImplemented(id, "getAdapter", "the OpenClaw adapter lands in task 5");
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown product id: ${String(exhaustive)}`);
    }
  }
}
