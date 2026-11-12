/**
 * The loopback Mailpit catcher that `up cal` starts for Cal's SMTP (docker/cal.mail.compose.yml).
 * Host ports are chosen to avoid the other products: 1025 and 8025 (Twenty Mailpit), 2525 and 9003 (Documenso Inbucket).
 * The catcher binds 127.0.0.1 only.
 */
export const CAL_MAIL_SMTP_HOST = "127.0.0.1";
export const CAL_MAIL_SMTP_PORT = 1026;
export const CAL_MAIL_UI_PORT = 8026;

/**
 * The fork's shipped SMTP defaults (EMAIL_SERVER_HOST='localhost', EMAIL_SERVER_PORT=1025, the fork's .env.example:227-228).
 * The root .env writer rewrites only this pair, and only when both keys are missing or still hold these values.
 */
export const CAL_MAIL_EXAMPLE_HOST = "localhost";
export const CAL_MAIL_EXAMPLE_PORT = "1025";
