import { GREENMAIL_HOST, GREENMAIL_IMAP_PORT, GREENMAIL_SMTP_PORT, type HttpRequest } from "./greenmail-env.js";

/**
 * The Nextcloud Mail app (H1). The image has no mail app, and its container cannot reach the app store, so the host
 * downloads the release, checks its SHA-256 against the pin below, and copies it into the container. Version 5.13.3 is the
 * newest stable release that declares Nextcloud 35 (info.xml: nextcloud 32 to 35, php 8.1 to 8.5). The Mail app uses
 * Horde's pure-PHP IMAP client, so the image's PHP needs no `imap` extension (checked with `php -m`, 2026-11-19).
 */
export const MAIL_APP_VERSION = "5.13.3";
export const MAIL_APP_TARBALL_NAME = `mail-v${MAIL_APP_VERSION}.tar.gz`;
export const MAIL_APP_URL = `https://github.com/nextcloud-releases/mail/releases/download/v${MAIL_APP_VERSION}/${MAIL_APP_TARBALL_NAME}`;
/** SHA-256 of the release tarball, computed on the host on 2026-11-19 from the URL above. */
export const MAIL_APP_SHA256 = "c9660a13b6734b26e84b2a9f87058a96cd89905e3834beae5b6da8d1d4007d7c";
export const MAIL_APP_DIR = "/var/www/html/custom_apps/mail";

/** The `<version>` of an app's appinfo/info.xml, or undefined. Used to skip the copy when the same version is in place. */
export function parseAppInfoVersion(infoXml: string): string | undefined {
  return /<version>\s*([^<\s]+)\s*<\/version>/.exec(infoXml)?.[1];
}

/** The occ arguments that create one IMAP account with password login (no OAuth). Run as www-data in the app container. */
export function mailAccountCreateArgs(opts: {
  uid: string;
  name: string;
  email: string;
  login: string;
  password: string;
}): string[] {
  return [
    "mail:account:create-imap",
    opts.uid,
    opts.name,
    opts.email,
    GREENMAIL_HOST,
    String(GREENMAIL_IMAP_PORT),
    "none",
    opts.login,
    opts.password,
    GREENMAIL_HOST,
    String(GREENMAIL_SMTP_PORT),
    "none",
    opts.login,
    opts.password,
    "password",
  ];
}

/** GET /index.php/apps/mail/api/accounts with the user's own app password. */
export function mailAccountsRequest(baseUrl: string, authorization: string): HttpRequest {
  return {
    url: `${baseUrl}/index.php/apps/mail/api/accounts`,
    init: { method: "GET", headers: { authorization, "OCS-APIRequest": "true", accept: "application/json" } },
  };
}

/** The `{id, emailAddress}` pairs of an accounts reply. Anything else gives an empty list. */
export function parseMailAccounts(body: unknown): { id: number; emailAddress: string }[] {
  if (!Array.isArray(body)) return [];
  const out: { id: number; emailAddress: string }[] = [];
  for (const entry of body) {
    const a = entry as { id?: unknown; emailAddress?: unknown } | null;
    if (a && typeof a.id === "number" && typeof a.emailAddress === "string") {
      out.push({ id: a.id, emailAddress: a.emailAddress });
    }
  }
  return out;
}
