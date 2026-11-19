import { HARNESS_DOCKER_DIR } from "../paths.js";
import { run } from "./run.js";

export interface ComposeOptions {
  projectName: string;
  files: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

function composeArgs(options: ComposeOptions, extra: string[]): string[] {
  const args = ["compose", "-p", options.projectName];
  for (const file of options.files) {
    args.push("-f", file);
  }
  args.push(...extra);
  return args;
}

/** The argv for `docker compose up -d`. With `wait`, `--wait` is limited to `waitServices` when given: compose treats any
 *  exited container as a failure under --wait, so one-shot services (Cal's postgres_is_ready) must stay out of the wait. */
export function composeUpArgs(
  options: ComposeOptions,
  opts: { wait?: boolean; waitServices?: string[] } = {},
): string[] {
  const extra = opts.wait ? ["up", "-d", "--wait", ...(opts.waitServices ?? [])] : ["up", "-d"];
  return composeArgs(options, extra);
}

export async function composeUp(
  options: ComposeOptions,
  opts: { wait?: boolean; waitServices?: string[] } = {},
): Promise<void> {
  await run("docker", composeUpArgs(options, opts), {
    cwd: options.cwd,
    env: options.env,
  });
}

export async function composeDown(
  options: ComposeOptions,
  extra: string[] = [],
): Promise<void> {
  await run("docker", composeArgs(options, ["down", ...extra]), {
    cwd: options.cwd,
    env: options.env,
  });
}

/** The argv for `docker compose restart <service>`. It keeps volumes and the env file as they are. */
export function composeRestartArgs(options: ComposeOptions, service: string): string[] {
  return composeArgs(options, ["restart", service]);
}

export async function composeRestart(options: ComposeOptions, service: string): Promise<void> {
  await run("docker", composeRestartArgs(options, service), { cwd: options.cwd, env: options.env });
}

/**
 * The argv for `docker compose exec -T <service> <command...>`. The command is passed as separate argv entries, never as a
 * shell string, so no value is ever re-parsed by a shell. `-T` means no TTY, so stdin and stdout are plain pipes.
 */
export function composeExecArgs(options: ComposeOptions, service: string, command: string[]): string[] {
  return composeArgs(options, ["exec", "-T", service, ...command]);
}

export function harnessComposeFile(name: string): string {
  return `${HARNESS_DOCKER_DIR.replaceAll("\\", "/")}/${name}`;
}
