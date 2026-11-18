import { spawnSync } from "node:child_process";

/** One diagnostic command. argv is run without a shell, except the explicit `sh -c` for the ss pipe. */
export interface DiagnosticCommand {
  label: string;
  argv: string[];
}

/**
 * The commands printed when a readiness wait times out in the agent-hosts job: docker ps for the run, the app container's
 * port map, the listener on the product's port, and an HTTP status from the runner. The URL and the container name are the
 * only inputs. No header or secret is part of any command.
 */
export function readinessDiagnosticCommands(opts: { url: string; container: string }): DiagnosticCommand[] {
  const port = new URL(opts.url).port;
  return [
    { label: "docker ps (this run)", argv: ["docker", "ps", "-a", "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}"] },
    { label: `docker port ${opts.container}`, argv: ["docker", "port", opts.container] },
    { label: `ss -ltnp | grep ${port}`, argv: ["sh", "-c", `ss -ltnp | grep ${port} || true`] },
    {
      label: `curl ${opts.url} (HTTP status from the runner)`,
      argv: ["curl", "-sS", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}", opts.url],
    },
  ];
}

/** Runs each diagnostic and prints its output. Never throws: a failed diagnostic is printed and the wait keeps its error. */
export function printReadinessDiagnostics(opts: { url: string; container: string }): void {
  console.log(`Readiness diagnostics for ${opts.url} (container ${opts.container}):`);
  for (const cmd of readinessDiagnosticCommands(opts)) {
    const [file, ...args] = cmd.argv;
    const result = spawnSync(file ?? "true", args, { encoding: "utf8", timeout: 20000 });
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    console.log(`--- ${cmd.label} (exit ${result.status ?? "none"})`);
    console.log(out === "" ? "(no output)" : out);
  }
}
