import type { DocumensoConfig } from "../config.js";
import { UnimplementedAdapter } from "./base.js";

export class DocumensoAdapter extends UnimplementedAdapter<DocumensoConfig> {
  constructor(cfg: DocumensoConfig) {
    super("documenso", cfg);
  }
}
