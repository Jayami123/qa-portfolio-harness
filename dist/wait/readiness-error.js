/**
 * Keeps the network error code and cause of a failed readiness request. Node's fetch reports only "fetch failed" and
 * hides the code (ECONNREFUSED, ECONNRESET, UND_ERR_SOCKET, ...) in `cause`, so a bare message does not say why a
 * product is unreachable. Only error names, codes and messages are read. Request headers and bodies are never included.
 */
const MAX_CHARS = 200;
const MAX_DEPTH = 5;
function errorChain(error) {
    const out = [];
    const visit = (node, depth) => {
        if (node === undefined || node === null || depth > MAX_DEPTH)
            return;
        out.push(node);
        const next = node;
        visit(next.cause, depth + 1);
        if (Array.isArray(next.errors)) {
            for (const child of next.errors)
                visit(child, depth + 1);
        }
    };
    visit(error, 0);
    return out;
}
/** Returns "CODE: message" (or "message" when no code exists). An abort or a timeout is "fetch timed out". */
export function describeFetchFailure(error) {
    const chain = errorChain(error);
    const isTimeout = chain.some((e) => {
        const name = e.name;
        return name === "AbortError" || name === "TimeoutError";
    });
    if (isTimeout)
        return "fetch timed out";
    const code = chain
        .map((e) => e.code)
        .find((c) => typeof c === "string" && c !== "");
    const head = error instanceof Error ? error.message : String(error);
    const cause = error?.cause?.message;
    const detail = typeof cause === "string" && cause !== "" ? cause : head;
    const text = code === undefined ? detail : `${code}: ${detail}`;
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}...` : text;
}
//# sourceMappingURL=readiness-error.js.map