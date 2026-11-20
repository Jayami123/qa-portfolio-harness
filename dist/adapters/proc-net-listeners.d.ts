/** /proc/net/tcp could not be read at all, so the caller falls back to lsof. */
export declare class ProcNetUnavailableError extends Error {
}
export interface ProcFs {
    readFile(path: string): string;
    readdir(path: string): string[];
    readlink(path: string): string;
}
export declare const realProcFs: ProcFs;
/**
 * Inodes of TCP sockets in LISTEN state on `port`, from the text of /proc/net/tcp or /proc/net/tcp6.
 * Columns: 1 local address (HEX:PORT), 3 state, 9 inode.
 */
export declare function parseProcNetListenInodes(text: string, port: number): string[];
/**
 * Pids that own a LISTEN socket on `port`, read from /proc. The socket inode comes from /proc/net/tcp{,6};
 * the owner is the process whose /proc/<pid>/fd holds a link to `socket:[<inode>]`. The process name is
 * never parsed, so a title such as `next-server (v16.2.3)` does not matter.
 */
export declare function readLinuxListenerPids(port: number, procFs?: ProcFs): number[];
//# sourceMappingURL=proc-net-listeners.d.ts.map