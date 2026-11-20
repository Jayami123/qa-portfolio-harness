import { type ComposeOptions } from "../internal/compose.js";
import { type HttpRequest } from "./greenmail-env.js";
/** Where the host keeps the verified Mail app tarball (under .harness/, which is gitignored). */
export declare const MAIL_CACHE_DIR: string;
export declare function greenmailComposeOptions(): ComposeOptions;
/**
 * Polls an HTTP endpoint until it answers the expected status or the budget is spent. Never logs the URL's body.
 * Without `retryOn`, every answer and every connection failure is polled (GreenMail startup). With `retryOn`, only those
 * HTTP statuses are polled: any other answer, and any connection failure, throws at once.
 */
export declare function waitForStatus(req: HttpRequest, status: number, budgetMs: number, label: string, opts?: {
    retryOn?: readonly number[];
    pollMs?: number;
}): Promise<void>;
/** The Mail accounts route, as the path the error messages name. */
export declare const MAIL_ACCOUNTS_ROUTE = "/index.php/apps/mail/api/accounts";
/**
 * Waits until the Mail accounts route answers 200 for this identity. Right after `occ app:enable mail` the route can answer
 * 404 for a moment, so a 404 is polled and nothing else is. A 401 or 500 throws at once. Budget: `p4WaitBudgetMs()`.
 */
export declare function waitForMailAccountsRoute(baseUrl: string, identity: Pick<MailIdentity, "uid" | "authorization">, budgetMs?: number, pollMs?: number): Promise<void>;
/**
 * Starts GreenMail with an empty store. Its users live in memory, so the container is recreated on every `up`: a run never
 * inherits users, passwords or messages from an earlier run.
 */
export declare function startGreenmail(budgetMs: number): Promise<void>;
export declare function stopGreenmail(): Promise<void>;
/** occ as www-data in the app container. Output is printed; `redact` values never are. */
export declare function occ(container: string, args: string[], redact?: string[]): Promise<void>;
/**
 * The verified Mail app tarball. A kept file is reused only when its SHA-256 still matches the pin. A download that does
 * not match is discarded and the run stops: nothing from it is run on the host or in the container.
 */
export declare function ensureMailTarball(dir?: string): Promise<string>;
/**
 * Installs the pinned Mail app into the Nextcloud container and enables it. The copy is skipped when the same version is
 * already in the data volume. The image's own PHP and apps are not changed.
 */
export declare function installMailApp(container: string): Promise<void>;
export interface MailIdentity {
    /** The Nextcloud user id and the GreenMail login (the same name). */
    uid: string;
    name: string;
    email: string;
    /** That user's own Basic credential (app password), used to list and remove its stale Mail accounts. */
    authorization: string;
}
/**
 * One identity end to end: remove its stale Mail accounts (a kept volume has them from an earlier run), make its GreenMail
 * user with a new password, create its Sent folder (the Mail app stops sending without one), then create its account.
 * The password is made here, passed to GreenMail in a request body and to occ as an argument, and printed nowhere.
 */
export declare function configureMailIdentity(opts: {
    container: string;
    baseUrl: string;
    identity: MailIdentity;
    makePassword: () => string;
}): Promise<void>;
export interface MailFlowResult {
    accountId: number;
    inboxListed: boolean;
    inboxMessages: number;
    sendAccepted: boolean;
    greenmailDelivered: boolean;
    listedAfterSync: boolean;
}
/**
 * The live H1 flow for one message. The sender's MCP sends a marked message to `to`. GreenMail must store it for `to`.
 * After a Mail sync of the recipient's account (the container has no cron), the recipient's MCP inbox must list it. The
 * recipient's inbox is listed before the send too, so the result shows what the inbox held. Counts and flags only.
 */
export declare function runMailFlow(opts: {
    container: string;
    senderCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
    fromAccountId: number;
    to: string;
    recipientCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
    recipientAccountId: number;
    budgetMs: number;
}): Promise<MailFlowResult>;
/** Opens the MCP session for a credential. The URL and the Authorization header stay in memory. */
export declare function mcpCallFor(url: string, authorization: string): Promise<(tool: string, args: Record<string, unknown>) => Promise<unknown>>;
/** The account id of `email` in an MCP nc_mail_list_accounts reply. Throws when the account is missing. */
export declare function accountIdFor(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, email: string): Promise<number>;
//# sourceMappingURL=nextcloud-mail-seed.d.ts.map