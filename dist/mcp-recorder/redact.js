/**
 * Redaction for the MCP recorder (H9). Pure functions with no imports, so the recorder container can run this compiled
 * file on its own. Every header value, body and path that the recorder writes passes through here first.
 *
 * Rules, in order of strength:
 *  1. A header whose name looks like a credential (authorization, cookie, set-cookie, api keys, tokens) is replaced by
 *     "[REDACTED]". The MCP session id is kept as a short digest so requests can still be matched, without the id itself.
 *  2. In bodies and paths, a value under a credential-like key (JSON key, query parameter or key=value pair) is replaced.
 *  3. Bearer, Basic and token prefixes and JWT-shaped strings are replaced wherever they appear.
 * Nothing here is reversible: a replaced value cannot be recovered from the recording.
 */
import { createHash } from "node:crypto";
export const REDACTED = "[REDACTED]";
/** Values shorter than this are not treated as secrets when checking for leaks (matches the env-file redaction). */
export const MIN_LEAK_VALUE_LENGTH = 6;
/** Header and key names that carry credentials. Matched case-insensitively against the name only, never the value. */
const SENSITIVE_NAME = /authorization|cookie|token|secret|passw|api[-_]?key|credential|private[-_]?key|session/i;
const SESSION_HEADER = "mcp-session-id";
export function sessionDigest(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}
export function redactHeaders(headers) {
    const out = {};
    for (const [name, raw] of Object.entries(headers)) {
        if (raw === undefined)
            continue;
        const lower = name.toLowerCase();
        const value = Array.isArray(raw) ? raw.join(", ") : String(raw);
        if (lower === SESSION_HEADER) {
            out[lower] = sessionDigest(value);
        }
        else if (SENSITIVE_NAME.test(lower)) {
            out[lower] = REDACTED;
        }
        else {
            out[lower] = redactText(value);
        }
    }
    return out;
}
const TEXT_PATTERNS = [
    // Bearer / Basic / Token credentials, wherever they appear.
    [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
    // JWT-shaped strings (three base64url parts, the first starting eyJ).
    [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, REDACTED],
    // Header-line form: "Cookie: a=b; c=d", "Authorization: ...".
    [/((?:set-)?cookie|authorization)(\s*[:=]\s*)[^\r\n]+/gi, `$1$2${REDACTED}`],
];
/**
 * A key followed by a value: JSON "password": "x", query token=abc, or password: x. The key is one word, and the test for a
 * credential name is done in code (SENSITIVE_NAME). No regex here has two unbounded runs around a keyword, so matching
 * stays linear in the input length (no polynomial backtracking).
 */
const KEY_VALUE = /(?<![\w-])(["']?)([\w-]+)(["']?\s*[:=]\s*)("(?:[^"\\]|\\.)*(?:"|$)|[^\s,&}\]"']+)/g;
function redactKeyValue(match, open, key, sep, value) {
    if (!SENSITIVE_NAME.test(key) || value.startsWith("[REDACTED"))
        return match;
    return `${open}${key}${sep}"${REDACTED}"`;
}
/** Replaces credential-shaped text in any string (a path, a query, a log line, a body). */
export function redactText(text) {
    let out = text;
    for (const [pattern, replacement] of TEXT_PATTERNS) {
        out = out.replace(pattern, replacement);
    }
    return out.replace(KEY_VALUE, redactKeyValue);
}
/** Replaces the value of every credential-like key in a parsed JSON value. Keys stay, so the shape stays readable. */
export function redactJson(value) {
    if (Array.isArray(value))
        return value.map((item) => redactJson(item));
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [key, inner] of Object.entries(value)) {
            out[key] = SENSITIVE_NAME.test(key) ? REDACTED : redactJson(inner);
        }
        return out;
    }
    return value;
}
function redactSseLine(line) {
    const match = /^data:\s?(.*)$/.exec(line);
    if (!match)
        return redactText(line);
    try {
        return `data: ${JSON.stringify(redactJson(JSON.parse(match[1] ?? "")))}`;
    }
    catch {
        return redactText(line);
    }
}
/** Redacts a message body by content type: SSE per data line, JSON by key, anything else as text. */
export function redactBody(text, contentType) {
    const type = (contentType ?? "").toLowerCase();
    if (type.includes("text/event-stream")) {
        return text.split("\n").map(redactSseLine).join("\n");
    }
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            return redactText(JSON.stringify(redactJson(JSON.parse(trimmed))));
        }
        catch {
            // not JSON after all: fall through to text redaction
        }
    }
    return redactText(text);
}
/** How many of the given secret values appear in the text. Used by the leak checks; the values are never returned. */
export function countLeakedValues(text, values) {
    let leaked = 0;
    for (const value of new Set(values)) {
        if (value.length >= MIN_LEAK_VALUE_LENGTH && text.includes(value))
            leaked += 1;
    }
    return leaked;
}
//# sourceMappingURL=redact.js.map