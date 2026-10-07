import type { TwentyConfig } from "../config.js";
import { UnimplementedAdapter } from "./base.js";

export class TwentyAdapter extends UnimplementedAdapter<TwentyConfig> {
  constructor(cfg: TwentyConfig) {
    super("twenty", cfg);
  }
}
