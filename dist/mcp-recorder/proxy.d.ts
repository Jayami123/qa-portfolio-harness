/**
 * The MCP recorder (H9): a reverse proxy in front of each MCP server. Bytes go through unchanged, in both directions, and
 * streamed responses (SSE) are piped as they arrive. Only the copy written to the log is redacted (redact.ts). Each exchange
 * writes a `request` line when the request body is read, a `response` line (status and headers) when the response head
 * arrives, and a `response_body` line when the body ends. A long-lived event stream therefore shows its head at once, and
 * its body only when it closes.
 *
 * It imports only Node built-ins and its own files, so the same compiled code runs in the recorder container.
 */
import http from "node:http";
import { type RecorderRoute } from "./routes.js";
export interface RecorderOptions {
    routes: readonly RecorderRoute[];
    /** Receives one JSON line per record, already redacted. The container writes it to stdout. */
    emit: (line: string) => void;
    now?: () => Date;
    /** Bytes of each body kept for the log. The forwarded bytes are never cut. */
    maxRecordBytes?: number;
    /** Largest request body accepted. Larger requests get 413 and are not forwarded. */
    maxRequestBytes?: number;
}
/** A clipped body loses its last RECORD_CLIP_RESERVE bytes, so a credential cut at the limit cannot show a fragment. */
export declare const RECORD_CLIP_RESERVE = 512;
/**
 * The part of a body kept for the log. When the whole body is longer than maxRecord, the last RECORD_CLIP_RESERVE bytes of
 * the kept part are dropped too, so a credential cut at the limit cannot show a fragment.
 */
export declare function clipForRecord(kept: Buffer, maxRecord: number, totalBytes: number): {
    text: Buffer;
    truncated: boolean;
};
export declare function createRecorder(opts: RecorderOptions): http.Server;
//# sourceMappingURL=proxy.d.ts.map