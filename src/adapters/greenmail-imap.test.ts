import assert from "node:assert/strict";
import net from "node:net";
import { after, describe, it } from "node:test";
import { imapCreateMailbox, imapQuoted, imapTaggedStatus } from "./greenmail-imap.js";

describe("imapTaggedStatus", () => {
  it("reads the status of the reply with the same tag", () => {
    assert.deepEqual(imapTaggedStatus("a1 OK LOGIN completed", "a1"), { status: "OK", text: "LOGIN completed" });
    assert.deepEqual(imapTaggedStatus("a2 NO [ALREADYEXISTS] Mailbox exists", "a2"), { status: "NO", text: "[ALREADYEXISTS] Mailbox exists" });
    assert.deepEqual(imapTaggedStatus("a3 BAD", "a3"), { status: "BAD", text: "" });
  });

  it("ignores untagged lines and other tags", () => {
    assert.equal(imapTaggedStatus("* OK [CAPABILITY IMAP4rev1] ready", "a1"), undefined);
    assert.equal(imapTaggedStatus("a10 OK done", "a1"), undefined);
    assert.equal(imapTaggedStatus("a1 MAYBE", "a1"), undefined);
  });
});

describe("imapQuoted", () => {
  it("wraps a plain value in double quotes", () => {
    assert.equal(imapQuoted("qa-owner"), '"qa-owner"');
  });

  it("refuses a quote, a backslash or a line break, and does not echo the value", () => {
    for (const value of ['pa"ss', "pa\\ss", "pa\r\nss"]) {
      assert.throws(
        () => imapQuoted(value),
        (error: Error) => {
          assert.match(error.message, /value not printed/);
          assert.equal(error.message.includes(value), false);
          return true;
        },
      );
    }
  });
});

/**
 * A tiny IMAP stand-in for the three commands the harness sends (LOGIN, CREATE, LOGOUT). It answers from a script, so the
 * socket code and its replies are tested without Docker. Each test gets its own server on an ephemeral port.
 */
function fakeImap(replies: { login: string; create: string }): Promise<{ port: number; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("* OK fake IMAP ready\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        seen.push(line.replace(/("[^"]*")/g, '"***"').replace(/LOGIN (\S+) \S+/, "LOGIN $1 ***"));
        if (line.startsWith("a1 LOGIN")) socket.write(`${replies.login}\r\n`);
        if (line.startsWith("a2 CREATE")) socket.write(`${replies.create}\r\n`);
        if (line.startsWith("a3 LOGOUT")) {
          socket.write("* BYE\r\na3 OK logout\r\n");
          socket.end();
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, seen, close: () => server.close() });
    });
  });
}

const servers: { close: () => void }[] = [];
after(() => servers.forEach((s) => s.close()));

describe("imapCreateMailbox over a socket", () => {
  it("logs in, creates the folder and logs out", async () => {
    const fake = await fakeImap({ login: "a1 OK LOGIN completed", create: "a2 OK CREATE completed" });
    servers.push(fake);
    await imapCreateMailbox({ host: "127.0.0.1", port: fake.port, login: "qa-owner", password: "pw-value", mailbox: "Sent", timeoutMs: 5000 });
    assert.ok(fake.seen.some((l) => l.startsWith("a2 CREATE")));
    assert.ok(fake.seen.some((l) => l.startsWith("a3 LOGOUT")));
  });

  it("treats an existing folder as success", async () => {
    const fake = await fakeImap({ login: "a1 OK LOGIN completed", create: "a2 NO [ALREADYEXISTS] Mailbox exists" });
    servers.push(fake);
    await imapCreateMailbox({ host: "127.0.0.1", port: fake.port, login: "qa-owner", password: "pw-value", mailbox: "Sent", timeoutMs: 5000 });
  });

  it("fails on a refused login without printing the password", async () => {
    const fake = await fakeImap({ login: "a1 NO authentication failed", create: "a2 OK" });
    servers.push(fake);
    await assert.rejects(
      imapCreateMailbox({ host: "127.0.0.1", port: fake.port, login: "qa-owner", password: "very-secret-pw", mailbox: "Sent", timeoutMs: 5000 }),
      (error: Error) => {
        assert.match(error.message, /LOGIN returned NO/);
        assert.equal(error.message.includes("very-secret-pw"), false);
        return true;
      },
    );
  });

  it("rejects with the error code when nothing listens, instead of crashing", async () => {
    const closed = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const port = typeof address === "object" && address ? address.port : 0;
        probe.close(() => resolve(port));
      });
    });
    await assert.rejects(
      imapCreateMailbox({ host: "127.0.0.1", port: closed, login: "qa-owner", password: "pw", mailbox: "Sent", timeoutMs: 5000 }),
      /IMAP connection failed \(ECONNREFUSED\)/,
    );
  });

  it("never sends a quote-containing value on the wire", async () => {
    const fake = await fakeImap({ login: "a1 OK", create: "a2 OK" });
    servers.push(fake);
    await assert.rejects(
      imapCreateMailbox({ host: "127.0.0.1", port: fake.port, login: 'qa"owner', password: "pw", mailbox: "Sent", timeoutMs: 5000 }),
      /value not printed/,
    );
  });
});
