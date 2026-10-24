import fs from "node:fs";

/** /proc/net/tcp could not be read at all, so the caller falls back to lsof. */
export class ProcNetUnavailableError extends Error {}

export interface ProcFs {
  readFile(path: string): string;
  readdir(path: string): string[];
  readlink(path: string): string;
}

export const realProcFs: ProcFs = {
  readFile: (path) => fs.readFileSync(path, "utf8"),
  readdir: (path) => fs.readdirSync(path),
  readlink: (path) => fs.readlinkSync(path),
};

/** TCP_LISTEN in /proc/net/tcp. */
const TCP_LISTEN = "0A";

/**
 * Inodes of TCP sockets in LISTEN state on `port`, from the text of /proc/net/tcp or /proc/net/tcp6.
 * Columns: 1 local address (HEX:PORT), 3 state, 9 inode.
 */
export function parseProcNetListenInodes(text: string, port: number): string[] {
  const inodes = new Set<string>();
  for (const line of text.trim().split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10) {
      continue;
    }
    const local = cols[1] ?? "";
    const state = cols[3] ?? "";
    const inode = cols[9] ?? "";
    const localPort = parseInt(local.slice(local.lastIndexOf(":") + 1), 16);
    if (localPort !== port || state.toUpperCase() !== TCP_LISTEN) {
      continue;
    }
    if (!/^\d+$/.test(inode) || inode === "0") {
      continue;
    }
    inodes.add(inode);
  }
  return [...inodes];
}

/**
 * Pids that own a LISTEN socket on `port`, read from /proc. The socket inode comes from /proc/net/tcp{,6};
 * the owner is the process whose /proc/<pid>/fd holds a link to `socket:[<inode>]`. The process name is
 * never parsed, so a title such as `next-server (v16.2.3)` does not matter.
 */
export function readLinuxListenerPids(port: number, procFs: ProcFs = realProcFs): number[] {
  let v4: string;
  try {
    v4 = procFs.readFile("/proc/net/tcp");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProcNetUnavailableError(`/proc/net/tcp is unreadable: ${detail}`);
  }
  let v6 = "";
  try {
    v6 = procFs.readFile("/proc/net/tcp6");
  } catch {
    v6 = "";
  }
  const inodes = new Set([...parseProcNetListenInodes(v4, port), ...parseProcNetListenInodes(v6, port)]);
  if (inodes.size === 0) {
    return [];
  }
  const socketLinks = new Set([...inodes].map((inode) => `socket:[${inode}]`));

  let entries: string[];
  try {
    entries = procFs.readdir("/proc");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ProcNetUnavailableError(`/proc is unreadable: ${detail}`);
  }
  const pids = new Set<number>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    let fds: string[];
    try {
      fds = procFs.readdir(`/proc/${entry}/fd`);
    } catch {
      // Another user's process (EACCES) or one that exited (ENOENT): skip this pid only.
      continue;
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = procFs.readlink(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      if (socketLinks.has(target)) {
        pids.add(Number(entry));
        break;
      }
    }
  }
  return [...pids].sort((a, b) => a - b);
}
