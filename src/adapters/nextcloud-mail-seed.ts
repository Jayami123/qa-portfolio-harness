import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { composeDown, composeUp, type ComposeOptions } from "../internal/compose.js";
import { run, runCapture } from "../internal/run.js";
import { HARNESS_DOCKER_DIR, HARNESS_ROOT } from "../paths.js";
import {
  GREENMAIL_COMPOSE_PROJECT,
  GREENMAIL_IMAP_PORT,
  greenmailComposeFiles,
  greenmailCreateUserRequest,
  greenmailMessagesRequest,
  greenmailReadyRequest,
  type HttpRequest,
  parseGreenmailSubjects,
} from "./greenmail-env.js";
import { imapCreateMailbox } from "./greenmail-imap.js";
import { openMcpSession } from "./mcp-call.js";
import { p4WaitBudgetMs } from "./p4-wait.js";
import {
  MAIL_APP_DIR,
  MAIL_APP_SHA256,
  MAIL_APP_TARBALL_NAME,
  MAIL_APP_URL,
  MAIL_APP_VERSION,
  mailAccountCreateArgs,
  mailAccountsRequest,
  parseAppInfoVersion,
  parseMailAccounts,
} from "./nextcloud-mail.js";

/** Where the host keeps the verified Mail app tarball (under .harness/, which is gitignored). */
export const MAIL_CACHE_DIR = path.join(HARNESS_ROOT, ".harness", "nextcloud-mail");

const POLL_MS = 2000;
const REQUEST_MS = 5000;

export function greenmailComposeOptions(): ComposeOptions {
  return { projectName: GREENMAIL_COMPOSE_PROJECT, files: greenmailComposeFiles(), cwd: HARNESS_DOCKER_DIR };
}

/**
 * Polls an HTTP endpoint until it answers the expected status or the budget is spent. Never logs the URL's body.
 * Without `retryOn`, every answer and every connection failure is polled (GreenMail startup). With `retryOn`, only those
 * HTTP statuses are polled: any other answer, and any connection failure, throws at once.
 */
export async function waitForStatus(
  req: HttpRequest,
  status: number,
  budgetMs: number,
  label: string,
  opts: { retryOn?: readonly number[]; pollMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const pollMs = opts.pollMs ?? POLL_MS;
  let last = "no response";
  while (Date.now() < deadline) {
    let code: number | undefined;
    try {
      const response = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(REQUEST_MS) });
      code = response.status;
    } catch {
      if (opts.retryOn) throw new Error(`${label} request failed (not retried)`);
      last = "connection failed";
    }
    if (code !== undefined) {
      if (code === status) return;
      last = `HTTP ${code}`;
      if (opts.retryOn && !opts.retryOn.includes(code)) throw new Error(`${label} returned HTTP ${code} (not retried)`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`${label} did not answer HTTP ${status} within the budget (last: ${last})`);
}

/** The Mail accounts route, as the path the error messages name. */
export const MAIL_ACCOUNTS_ROUTE = "/index.php/apps/mail/api/accounts";

/**
 * Waits until the Mail accounts route answers 200 for this identity. Right after `occ app:enable mail` the route can answer
 * 404 for a moment, so a 404 is polled and nothing else is. A 401 or 500 throws at once. Budget: `p4WaitBudgetMs()`.
 */
export async function waitForMailAccountsRoute(
  baseUrl: string,
  identity: Pick<MailIdentity, "uid" | "authorization">,
  budgetMs: number = p4WaitBudgetMs(),
  pollMs?: number,
): Promise<void> {
  const req = mailAccountsRequest(baseUrl, identity.authorization);
  await waitForStatus(req, 200, budgetMs, `Mail accounts route ${MAIL_ACCOUNTS_ROUTE} for ${identity.uid}`, {
    retryOn: [404],
    pollMs,
  });
}

/**
 * Starts GreenMail with an empty store. Its users live in memory, so the container is recreated on every `up`: a run never
 * inherits users, passwords or messages from an earlier run.
 */
export async function startGreenmail(budgetMs: number): Promise<void> {
  await composeDown(greenmailComposeOptions(), ["--remove-orphans"]);
  await composeUp(greenmailComposeOptions(), { wait: true });
  await waitForStatus(greenmailReadyRequest(), 200, budgetMs, "GreenMail REST API");
}

export async function stopGreenmail(): Promise<void> {
  await composeDown(greenmailComposeOptions(), ["--remove-orphans"]);
}

/** Quiet capture: returns stdout, prints nothing. For reads whose output is not needed on screen. */
function captureQuiet(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", args, { cwd: HARNESS_ROOT, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`docker ${args[0]} failed (output not printed)`));
      else resolve(stdout);
    });
  });
}

/** occ as www-data in the app container. Output is printed; `redact` values never are. */
export async function occ(container: string, args: string[], redact: string[] = []): Promise<void> {
  await runCapture("docker", ["exec", "-u", "www-data", container, "php", "occ", ...args], { cwd: HARNESS_ROOT, redact });
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * The verified Mail app tarball. A kept file is reused only when its SHA-256 still matches the pin. A download that does
 * not match is discarded and the run stops: nothing from it is run on the host or in the container.
 */
export async function ensureMailTarball(dir: string = MAIL_CACHE_DIR): Promise<string> {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, MAIL_APP_TARBALL_NAME);
  if (fs.existsSync(file) && sha256File(file) === MAIL_APP_SHA256) return file;
  const response = await fetch(MAIL_APP_URL, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`Mail app download returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== MAIL_APP_SHA256) {
    throw new Error("Mail app download does not match the pinned SHA-256 (file not kept)");
  }
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return file;
}

/**
 * Installs the pinned Mail app into the Nextcloud container and enables it. The copy is skipped when the same version is
 * already in the data volume. The image's own PHP and apps are not changed.
 */
export async function installMailApp(container: string): Promise<void> {
  const current = await captureQuiet(["exec", "-u", "www-data", container, "cat", `${MAIL_APP_DIR}/appinfo/info.xml`])
    .then((xml) => parseAppInfoVersion(xml))
    .catch(() => undefined);
  if (current !== MAIL_APP_VERSION) {
    const tarball = await ensureMailTarball();
    const inContainer = `/tmp/${MAIL_APP_TARBALL_NAME}`;
    await run("docker", ["cp", tarball, `${container}:${inContainer}`], { cwd: HARNESS_ROOT });
    await run("docker", ["exec", "-u", "root", container, "tar", "-xzf", inContainer, "-C", "/var/www/html/custom_apps"], {
      cwd: HARNESS_ROOT,
    });
    await run("docker", ["exec", "-u", "root", container, "chown", "-R", "www-data:www-data", MAIL_APP_DIR], { cwd: HARNESS_ROOT });
  }
  await occ(container, ["app:enable", "mail"]);
}

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
export async function configureMailIdentity(opts: {
  container: string;
  baseUrl: string;
  identity: MailIdentity;
  makePassword: () => string;
}): Promise<void> {
  const { container, baseUrl, identity } = opts;
  await waitForMailAccountsRoute(baseUrl, identity);
  const accountsReq = mailAccountsRequest(baseUrl, identity.authorization);
  const listed = await fetch(accountsReq.url, accountsReq.init);
  if (listed.status !== 200) throw new Error(`Mail accounts list for ${identity.uid} returned HTTP ${listed.status}`);
  for (const account of parseMailAccounts(await listed.json())) {
    if (account.emailAddress === identity.email) {
      await occ(container, ["mail:account:delete", String(account.id)]);
    }
  }
  const password = opts.makePassword();
  const created = greenmailCreateUserRequest(identity.uid, identity.email, password);
  const createdResponse = await fetch(created.url, created.init);
  if (createdResponse.status !== 200) throw new Error(`GreenMail user create for ${identity.uid} returned HTTP ${createdResponse.status}`);
  await imapCreateMailbox({ host: "127.0.0.1", port: GREENMAIL_IMAP_PORT, login: identity.uid, password, mailbox: "Sent", timeoutMs: 30_000 });
  await occ(container, mailAccountCreateArgs({ uid: identity.uid, name: identity.name, email: identity.email, login: identity.uid, password }), [password]);
}

export interface MailFlowResult {
  accountId: number;
  inboxListed: boolean;
  inboxMessages: number;
  sendAccepted: boolean;
  greenmailDelivered: boolean;
  listedAfterSync: boolean;
}

async function greenmailSubjects(email: string): Promise<string[]> {
  const req = greenmailMessagesRequest(email);
  const response = await fetch(req.url, req.init);
  if (response.status !== 200) throw new Error(`GreenMail messages for an identity returned HTTP ${response.status}`);
  return parseGreenmailSubjects(await response.json());
}

/** The INBOX mailbox id for an account, from nc_mail_list_mailboxes. */
async function inboxId(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, accountId: number): Promise<number> {
  const boxes = (await call("nc_mail_list_mailboxes", { account_id: accountId })) as { results?: { name?: unknown; databaseId?: unknown }[] };
  const inbox = boxes.results?.find((box) => box.name === "INBOX");
  if (typeof inbox?.databaseId !== "number") throw new Error("the account has no INBOX in nc_mail_list_mailboxes");
  return inbox.databaseId;
}

async function inboxSubjects(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, mailboxId: number): Promise<string[]> {
  const page = (await call("nc_mail_list_messages", { mailbox_id: mailboxId, limit: 100 })) as { results?: { subject?: unknown }[] };
  return (page.results ?? []).map((m) => m.subject).filter((s): s is string => typeof s === "string");
}

/**
 * The live H1 flow for one message. The sender's MCP sends a marked message to `to`. GreenMail must store it for `to`.
 * After a Mail sync of the recipient's account (the container has no cron), the recipient's MCP inbox must list it. The
 * recipient's inbox is listed before the send too, so the result shows what the inbox held. Counts and flags only.
 */
export async function runMailFlow(opts: {
  container: string;
  senderCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  fromAccountId: number;
  to: string;
  recipientCall: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
  recipientAccountId: number;
  budgetMs: number;
}): Promise<MailFlowResult> {
  const mailboxId = await inboxId(opts.recipientCall, opts.recipientAccountId);
  const before = await inboxSubjects(opts.recipientCall, mailboxId);
  const marker = `p4-h1-${randomBytes(6).toString("hex")}`;
  const sent = await opts.senderCall("nc_mail_send_message", {
    account_id: opts.fromAccountId,
    to: [{ email: opts.to }],
    subject: marker,
    body: "H1 live check (harness). No secret in this message.",
  });
  const sendAccepted = (sent as { success?: unknown }).success === true;
  const deadline = Date.now() + opts.budgetMs;
  let delivered = false;
  while (!delivered && Date.now() < deadline) {
    delivered = (await greenmailSubjects(opts.to)).includes(marker);
    if (!delivered) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  let listedAfterSync = false;
  for (let attempt = 0; attempt < 5 && !listedAfterSync; attempt += 1) {
    await occ(opts.container, ["mail:account:sync", String(opts.recipientAccountId)]);
    listedAfterSync = (await inboxSubjects(opts.recipientCall, mailboxId)).includes(marker);
  }
  return {
    accountId: opts.recipientAccountId,
    inboxListed: true,
    inboxMessages: before.length,
    sendAccepted,
    greenmailDelivered: delivered,
    listedAfterSync,
  };
}

/** Opens the MCP session for a credential. The URL and the Authorization header stay in memory. */
export function mcpCallFor(url: string, authorization: string): Promise<(tool: string, args: Record<string, unknown>) => Promise<unknown>> {
  return openMcpSession({ url, authorization });
}

/** The account id of `email` in an MCP nc_mail_list_accounts reply. Throws when the account is missing. */
export async function accountIdFor(call: (tool: string, args: Record<string, unknown>) => Promise<unknown>, email: string): Promise<number> {
  const accounts = (await call("nc_mail_list_accounts", {})) as { results?: { id?: unknown; emailAddress?: unknown }[] };
  const found = accounts.results?.find((a) => a.emailAddress === email);
  if (typeof found?.id !== "number") throw new Error(`no Mail account for ${email} in nc_mail_list_accounts`);
  return found.id;
}
