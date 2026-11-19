import net from "node:net";
import readline from "node:readline";

/**
 * The status of the tagged reply to `tag`, or undefined when `line` is not that reply. Pure, so it is unit tested.
 * `text` is the rest of the line; callers must not print it, because it can echo what the client sent.
 */
export function imapTaggedStatus(line: string, tag: string): { status: "OK" | "NO" | "BAD"; text: string } | undefined {
  const match = new RegExp(`^${tag} (OK|NO|BAD)(?: (.*))?$`).exec(line);
  if (!match) return undefined;
  return { status: match[1] as "OK" | "NO" | "BAD", text: match[2] ?? "" };
}

/**
 * An IMAP quoted string. The values the harness sends are base64url logins and passwords and fixed folder names, so a
 * quote, a backslash or a line break is a bug: it throws without echoing the value.
 */
export function imapQuoted(value: string): string {
  if (/["\\\r\n]/.test(value)) {
    throw new Error("IMAP value contains a character that must not be quoted (value not printed)");
  }
  return `"${value}"`;
}

export interface ImapCreateOptions {
  host: string;
  port: number;
  login: string;
  password: string;
  mailbox: string;
  timeoutMs: number;
}

/**
 * Creates one mailbox over IMAP, as the given user. The Mail app needs a Sent folder to exist before an account is
 * created, or it never sends (its sent-mailbox handler stops with "no sent mailbox"). GreenMail has no SPECIAL-USE
 * folders, so the folder is made by name. An existing folder is not an error. Errors name the step, never the values.
 */
export async function imapCreateMailbox(opts: ImapCreateOptions): Promise<void> {
  const socket = net.connect({ host: opts.host, port: opts.port });
  socket.setEncoding("utf8");
  socket.setTimeout(opts.timeoutMs, () => socket.destroy(new Error("IMAP connection timed out")));
  const lines = readline.createInterface({ input: socket, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  // A socket error (refused, reset, timed out) rejects the wait for the next line. Both paths are mapped here, once, to the
  // error code: the raw message of a socket error is not printed.
  const socketError = new Promise<never>((_, reject) => {
    socket.once("error", (error) => reject(error));
  });
  socketError.catch(() => undefined);
  const next = async (): Promise<string> => {
    let result: IteratorResult<string>;
    try {
      result = await Promise.race([iterator.next(), socketError]);
    } catch (error) {
      throw new Error(`IMAP connection failed (${(error as NodeJS.ErrnoException).code ?? "error"})`);
    }
    if (result.done) throw new Error("IMAP connection closed before the reply (no value printed)");
    return result.value;
  };
  const awaitTagged = async (tag: string) => {
    for (;;) {
      const status = imapTaggedStatus(await next(), tag);
      if (status) return status;
    }
  };
  try {
    const greeting = await next();
    if (!greeting.startsWith("* OK")) throw new Error("IMAP greeting was not OK");
    socket.write(`a1 LOGIN ${imapQuoted(opts.login)} ${imapQuoted(opts.password)}\r\n`);
    const login = await awaitTagged("a1");
    if (login.status !== "OK") throw new Error(`IMAP LOGIN returned ${login.status} (credentials not printed)`);
    socket.write(`a2 CREATE ${imapQuoted(opts.mailbox)}\r\n`);
    const create = await awaitTagged("a2");
    if (create.status !== "OK" && !create.text.includes("ALREADYEXISTS")) {
      throw new Error(`IMAP CREATE ${opts.mailbox} returned ${create.status}`);
    }
    socket.write("a3 LOGOUT\r\n");
    await awaitTagged("a3").catch(() => undefined);
  } finally {
    lines.close();
    socket.destroy();
  }
}
