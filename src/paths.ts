import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root of qa-portfolio-harness (works from src/ and dist/). */
export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const HARNESS_DOCKER_DIR = path.join(HARNESS_ROOT, "docker");
