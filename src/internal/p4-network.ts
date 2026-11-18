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

/** Runs one docker argv. Injected in tests. */
export type DockerExec = (args: string[]) => Promise<void>;

const dockerRun: DockerExec = (args) => run("docker", args, { cwd: HARNESS_ROOT });

/**
 * Creates the network if it is missing. Idempotent: an existing network is left as it is. Every adapter whose compose
 * declares the external network calls this first, so `npm run up -- <product>` works without the other products (the
 * CI run that failed on "network qa-harness-p4 declared as external, but could not be found" is the reason).
 */
export async function ensureP4Network(exec: DockerExec = dockerRun): Promise<void> {
  try {
    await exec(p4NetworkInspectArgs());
  } catch {
    await exec(p4NetworkCreateArgs());
  }
}
