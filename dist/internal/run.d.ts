export interface RunOptions {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
}
export interface RunCaptureOptions extends RunOptions {
    /** Secret values replaced with `***` in thrown error messages and captured output. */
    redact?: string[];
    /**
     * Line-aware redaction for what is printed while the child runs. Gets each chunk and the
     * incomplete last line held back from the previous chunk (`carry`); returns the text to print
     * and the new carry. Captured stdout and stderr stay unredacted.
     */
    redactLine?: (chunk: string, carry: string) => {
        text: string;
        carry: string;
    };
}
export interface RunCaptureResult {
    stdout: string;
    stderr: string;
}
/** Replaces every non-empty secret in `text` with `***`. */
export declare function redactSecrets(text: string, secrets?: readonly string[]): string;
/**
 * Run a command, inherit stdio, reject on non-zero exit.
 * Uses a shell on Windows so `.cmd` shims (yarn, npm, docker) resolve.
 */
export declare function run(command: string, args: string[], options: RunOptions): Promise<void>;
/** Same as `run`, but capture stdout/stderr (for parsing seed keys). */
export declare function runCapture(command: string, args: string[], options: RunCaptureOptions): Promise<RunCaptureResult>;
export declare function detectPackageManager(productRoot: string): "yarn" | "pnpm" | "npm";
//# sourceMappingURL=run.d.ts.map