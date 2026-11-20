/**
 * Container entry for the MCP recorder (H9). Reads MCP_RECORDER_ROUTES and MCP_RECORDER_PORT (default 9100), writes one
 * redacted JSON line per record to stdout, and writes its own status to stderr. Stops on SIGTERM or SIGINT.
 */
import { createRecorder } from "./proxy.js";
import { parseRecorderRoutes } from "./routes.js";

const routes = parseRecorderRoutes(process.env.MCP_RECORDER_ROUTES ?? "");
const port = Number(process.env.MCP_RECORDER_PORT ?? "9100");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("MCP_RECORDER_CONFIG: MCP_RECORDER_PORT must be a port number");
}

const server = createRecorder({
  routes,
  emit: (line) => {
    process.stdout.write(`${line}\n`);
  },
});

server.listen(port, "0.0.0.0", () => {
  process.stderr.write(`mcp-recorder: listening on ${port} for ${routes.map((r) => r.name).join(", ")}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
