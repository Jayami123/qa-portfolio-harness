import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { platform } from "node:os";
/** Replaces every non-empty secret in `text` with `***`. */
export function redactSecrets(text, secrets = []) {
    let out = text;
    for (const secret of secrets) {
        if (secret !== "") {
            out = out.split(secret).join("***");
        }
    }
    return out;
}
/**
 * Run a command, inherit stdio, reject on non-zero exit.
 * Uses a shell on Windows so `.cmd` shims (yarn, npm, docker) resolve.
 */
export function run(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: "inherit",
            shell: platform() === "win32",
        });
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                child.kill();
                reject(new Error(`${command} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
            }, options.timeoutMs)
            : undefined;
        child.on("error", (error) => {
            if (timeout)
                clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code) => {
            if (timeout)
                clearTimeout(timeout);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
        });
    });
}
/** Same as `run`, but capture stdout/stderr (for parsing seed keys). */
export function runCapture(command, args, options) {
    const redact = options.redact ?? [];
    const redactLine = options.redactLine;
    const commandLine = redactSecrets(`${command} ${args.join(" ")}`, redact);
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["ignore", "pipe", "pipe"],
            shell: platform() === "win32",
        });
        let stdout = "";
        let stderr = "";
        const outCarry = { value: "" };
        const errCarry = { value: "" };
        const printable = (text, carry) => {
            if (redactLine === undefined) {
                return redactSecrets(text, redact);
            }
            const next = redactLine(text, carry.value);
            carry.value = next.carry;
            return redactSecrets(next.text, redact);
        };
        child.stdout?.on("data", (chunk) => {
            const text = chunk.toString();
            stdout += text;
            process.stdout.write(printable(text, outCarry));
        });
        child.stderr?.on("data", (chunk) => {
            const text = chunk.toString();
            stderr += text;
            process.stderr.write(printable(text, errCarry));
        });
        // Print a last line that never got its newline. Appending one and dropping it again
        // makes redactLine release the held-back text.
        const flush = (carry, write) => {
            if (redactLine === undefined || carry.value === "") {
                return;
            }
            write(redactSecrets(redactLine("\n", carry.value).text.slice(0, -1), redact));
            carry.value = "";
        };
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                child.kill();
                reject(new Error(`${commandLine} timed out after ${options.timeoutMs}ms`));
            }, options.timeoutMs)
            : undefined;
        child.on("error", (error) => {
            if (timeout)
                clearTimeout(timeout);
            reject(error);
        });
        child.on("exit", (code) => {
            if (timeout)
                clearTimeout(timeout);
            // Flush before settling, so the held-back text is printed before the caller continues.
            flush(outCarry, (text) => process.stdout.write(text));
            flush(errCarry, (text) => process.stderr.write(text));
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            const error = new Error(`${commandLine} exited with code ${code ?? "unknown"}`);
            error.stdout = redactSecrets(stdout, redact);
            error.stderr = redactSecrets(stderr, redact);
            reject(error);
        });
    });
}
export function detectPackageManager(productRoot) {
    if (fs.existsSync(path.join(productRoot, "pnpm-lock.yaml")))
        return "pnpm";
    if (fs.existsSync(path.join(productRoot, "yarn.lock")))
        return "yarn";
    return "npm";
}
//# sourceMappingURL=run.js.map