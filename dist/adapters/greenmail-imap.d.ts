/**
 * The status of the tagged reply to `tag`, or undefined when `line` is not that reply. Pure, so it is unit tested.
 * `text` is the rest of the line; callers must not print it, because it can echo what the client sent.
 */
export declare function imapTaggedStatus(line: string, tag: string): {
    status: "OK" | "NO" | "BAD";
    text: string;
} | undefined;
/**
 * An IMAP quoted string. The values the harness sends are base64url logins and passwords and fixed folder names, so a
 * quote, a backslash or a line break is a bug: it throws without echoing the value.
 */
export declare function imapQuoted(value: string): string;
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
export declare function imapCreateMailbox(opts: ImapCreateOptions): Promise<void>;
//# sourceMappingURL=greenmail-imap.d.ts.map