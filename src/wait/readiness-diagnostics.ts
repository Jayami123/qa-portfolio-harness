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
  printContainerFailureDiagnostics(opts.container);
}

const LOG_TAIL_LINES = 200;
const MAX_LOG_CHARS = 20_000;

/** Result of one docker call. The default runner uses spawnSync; tests pass a stub. */
export interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
export type DockerRunner = (args: string[]) => DockerResult;

export const spawnDocker: DockerRunner = (args) => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 20000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** State of the app container from `docker inspect`. `exited` is true only for status "exited" or "dead". */
export interface ContainerState {
  container: string;
  status: string;
  exited: boolean;
  exitCode?: number;
  oomKilled?: boolean;
}

const SECRET_NAME =
  "[\\w.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|AUTH|CREDENTIAL|SALT|DSN|COOKIE|SESSION)[\\w.-]*";
const SECRET_PAIR = new RegExp(`(["']?${SECRET_NAME}["']?\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&}]+)`, "gi");

/**
 * Hides values that look like secrets in container output: KEY=value and "key": "value" pairs whose name looks secret,
 * Authorization and Bearer values, credentials inside URLs, and JWTs. The name stays so the line is still readable.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***:***@")
    .replace(/\b(Authorization\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?[^\s,;"']+/gi, "$1***")
    .replace(/\b(Bearer\s+)[\w.~+/=-]{8,}/gi, "$1***")
    .replace(SECRET_PAIR, "$1***")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, "***");
}

/** `docker logs --tail 200`, redacted and capped. stdout and stderr are both kept because apps log to either. */
export function captureContainerLogs(container: string, docker: DockerRunner = spawnDocker): string {
  const result = docker(["logs", "--tail", String(LOG_TAIL_LINES), container]);
  const raw = `${result.stdout}${result.stderr}`.trim();
  if (raw === "") return `(no log output, docker logs exit ${result.status ?? "none"})`;
  const text = redactSecrets(raw);
  return text.length > MAX_LOG_CHARS ? `...${text.slice(-MAX_LOG_CHARS)}` : text;
}

/** Reads status, ExitCode and OOMKilled with one `docker inspect`. Returns undefined when the container cannot be inspected. */
export function inspectContainerState(container: string, docker: DockerRunner = spawnDocker): ContainerState | undefined {
  const result = docker(["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}}", container]);
  if (result.status !== 0) return undefined;
  const [status, code, oom] = result.stdout.trim().split(/\s+/);
  if (status === undefined || status === "") return undefined;
  const exitCode = Number(code);
  return {
    container,
    status,
    exited: status === "exited" || status === "dead",
    exitCode: Number.isInteger(exitCode) ? exitCode : undefined,
    oomKilled: oom === "true" ? true : oom === "false" ? false : undefined,
  };
}

/** One-line message for an exited container: name, exit code and OOMKilled. */
export function describeContainerExit(state: ContainerState): string {
  return (
    `Container ${state.container} exited before it became ready ` +
    `(status ${state.status}, exit code ${state.exitCode ?? "unknown"}, OOMKilled ${state.oomKilled ?? "unknown"})`
  );
}

/** Thrown by a readiness wait as soon as the app container is seen exited. */
export class ContainerExitedError extends Error {
  constructor(readonly state: ContainerState) {
    super(describeContainerExit(state));
    this.name = "ContainerExitedError";
  }
}

/**
 * Call on each poll. When the container has exited, prints its exit state and redacted log tail, then throws
 * ContainerExitedError. A container that is missing, starting or restarting is not an exit: the wait keeps polling and
 * the timeout stays the backstop.
 */
export function failIfContainerExited(container: string, url: string, docker: DockerRunner = spawnDocker): void {
  const state = inspectContainerState(container, docker);
  if (state?.exited !== true) return;
  console.log(`Readiness for ${url}: ${describeContainerExit(state)}`);
  printContainerFailureDiagnostics(container, docker);
  throw new ContainerExitedError(state);
}

/** Prints the exit state and the redacted log tail of the app container. Never throws. */
export function printContainerFailureDiagnostics(container: string, docker: DockerRunner = spawnDocker): void {
  const state = inspectContainerState(container, docker);
  console.log(`--- docker inspect ${container}`);
  console.log(
    state === undefined
      ? "(container not found or not inspectable)"
      : `status=${state.status} ExitCode=${state.exitCode ?? "unknown"} OOMKilled=${state.oomKilled ?? "unknown"}`,
  );
  console.log(`--- docker logs --tail ${LOG_TAIL_LINES} ${container} (secret-looking values redacted)`);
  console.log(captureContainerLogs(container, docker));
}
