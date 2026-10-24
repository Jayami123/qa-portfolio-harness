import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { describe, it } from "node:test";
import { listenerPids } from "./cal-web-process.js";

// Real sockets, no fakes. Linux only: the unit tests cover the other platforms.
const skip = process.platform !== "linux"
  ? "Linux only: reads /proc/net/tcp. Windows uses netstat and macOS uses lsof; covered by the unit tests."
  : false;

function listenOn(server: http.Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function readPort(stream: NodeJS.ReadableStream): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (buffer.includes("\n")) {
        resolve(Number(buffer.split("\n")[0]));
      }
    });
    stream.on("error", reject);
  });
}

describe("linux listener lookup on real sockets", () => {
  it("reports this process as the listener of its own socket", { skip }, async () => {
    const server = http.createServer();
    await listenOn(server, "127.0.0.1", 0);
    try {
      const port = (server.address() as AddressInfo).port;
      assert.deepEqual(listenerPids(port, "linux"), [process.pid]);
    } finally {
      server.close();
    }
  });

  it("resolves a child titled like next-server, the shape lsof skips", { skip, timeout: 15_000 }, async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.title = "next-server (v16.2.3)"; const s = require("node:http").createServer(); ' +
          's.listen(0, "127.0.0.1", () => process.stdout.write(s.address().port + "\\n"));',
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      const port = await readPort(child.stdout);
      const comm = fs.readFileSync(`/proc/${String(child.pid)}/comm`, "utf8").trim();
      assert.equal(comm, "next-server (v1", "the kernel truncates the title; this is the shape lsof skips");
      assert.deepEqual(listenerPids(port, "linux"), [child.pid]);
    } finally {
      child.kill();
      await once(child, "exit");
    }
  });

  it("resolves an IPv6 loopback listener", { skip, timeout: 15_000 }, async (t) => {
    const server = http.createServer();
    try {
      await listenOn(server, "::1", 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
        t.skip("IPv6 loopback not available on this host");
        return;
      }
      throw error;
    }
    try {
      const port = (server.address() as AddressInfo).port;
      assert.deepEqual(listenerPids(port, "linux"), [process.pid]);
    } finally {
      server.close();
    }
  });
});
