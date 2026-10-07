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

export async function composeUp(options: ComposeOptions): Promise<void> {
  await run("docker", composeArgs(options, ["up", "-d"]), {
    cwd: options.cwd,
    env: options.env,
  });
}

export async function composeDown(options: ComposeOptions): Promise<void> {
  await run("docker", composeArgs(options, ["down"]), {
    cwd: options.cwd,
    env: options.env,
  });
}

export function harnessComposeFile(name: string): string {
  return `${HARNESS_DOCKER_DIR.replaceAll("\\", "/")}/${name}`;
}
