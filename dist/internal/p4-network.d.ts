/** The one external network the P4 agent hosts and MCP-facing services share (review answer 0.1). */
export declare const P4_NETWORK = "qa-harness-p4";
export declare function p4NetworkInspectArgs(): string[];
export declare function p4NetworkCreateArgs(): string[];
/** Runs one docker argv. Injected in tests. */
export type DockerExec = (args: string[]) => Promise<void>;
/**
 * Creates the network if it is missing. Idempotent: an existing network is left as it is. Every adapter whose compose
 * declares the external network calls this first, so `npm run up -- <product>` works without the other products (the
 * CI run that failed on "network qa-harness-p4 declared as external, but could not be found" is the reason).
 */
export declare function ensureP4Network(exec?: DockerExec): Promise<void>;
//# sourceMappingURL=p4-network.d.ts.map