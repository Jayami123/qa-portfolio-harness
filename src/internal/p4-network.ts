import { HARNESS_ROOT } from "../paths.js";
import { run } from "./run.js";

/** The one external network the P4 agent hosts and MCP-facing services share (review answer 0.1). */
export const P4_NETWORK = "qa-harness-p4";

export function p4NetworkInspectArgs(): string[] {
  return ["network", "inspect", P4_NETWORK];
}

export function p4NetworkCreateArgs(): string[] {
  return ["network", "create", "--driver", "bridge", P4_NETWORK];
}

/** Creates the network if it is missing. Idempotent: an existing network is left as it is. */
export async function ensureP4Network(): Promise<void> {
  try {
    await run("docker", p4NetworkInspectArgs(), { cwd: HARNESS_ROOT });
  } catch {
    await run("docker", p4NetworkCreateArgs(), { cwd: HARNESS_ROOT });
  }
}
