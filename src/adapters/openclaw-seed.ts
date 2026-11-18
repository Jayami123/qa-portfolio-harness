/** Builders and parsers for the OpenClaw seed. No I/O here, so every function is unit tested. */

/**
 * The argv that writes openclaw.json into the state volume (review answer 0.5). It runs as the image's `node` user
 * (uid 1000), with no network, and the config arrives on stdin. No root, no chown.
 */
export function openClawWriteConfigArgs(image: string, volume: string): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--network",
    "none",
    "--user",
    "1000:1000",
    "-v",
    `${volume}:/home/node/.openclaw`,
    "--entrypoint",
    "sh",
    image,
    "-c",
    "cat > /home/node/.openclaw/openclaw.json",
  ];
}

/** /readyz is ready only when the body says ready: true. */
export function readyzIsReady(body: unknown): boolean {
  return (body as { ready?: unknown } | null)?.ready === true;
}
