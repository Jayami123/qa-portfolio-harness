/**
 * Minimal Transit (JSON) decoder for Penpot's RPC replies: maps ("^ " arrays), keywords ("~:x") and UUIDs ("~u...").
 * It handles the shapes the harness reads (login, profile, access-token) and nothing more.
 */
export function decodeTransit(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value[0] === "^ ") {
      const out: Record<string, unknown> = {};
      for (let i = 1; i + 1 < value.length; i += 2) {
        out[transitKey(value[i])] = decodeTransit(value[i + 1]);
      }
      return out;
    }
    if (value[0] === "~#set" || value[0] === "~#list") {
      return decodeTransit(value[1]);
    }
    return value.map((item) => decodeTransit(item));
  }
  if (typeof value === "string") {
    if (value.startsWith("~u") || value.startsWith("~:")) {
      return value.slice(2);
    }
    if (value.startsWith("~~")) {
      return value.slice(1);
    }
    return value;
  }
  return value;
}

function transitKey(key: unknown): string {
  return typeof key === "string" && key.startsWith("~:") ? key.slice(2) : String(key);
}
