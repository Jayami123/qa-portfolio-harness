import type { MedusaConfig } from "../config.js";
import { UnimplementedAdapter } from "./base.js";

export class MedusaAdapter extends UnimplementedAdapter<MedusaConfig> {
  constructor(cfg: MedusaConfig) {
    super("medusa", cfg);
  }
}
