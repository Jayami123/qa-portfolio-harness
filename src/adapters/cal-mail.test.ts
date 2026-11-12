import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CAL_MAIL_EXAMPLE_HOST, CAL_MAIL_EXAMPLE_PORT, CAL_MAIL_SMTP_HOST, CAL_MAIL_SMTP_PORT, CAL_MAIL_UI_PORT } from "./cal-mail.js";
import { HARNESS_ROOT } from "../paths.js";

const overlay = fs.readFileSync(path.join(HARNESS_ROOT, "docker", "cal.mail.compose.yml"), "utf8");

/** Host ports already used by the other products and by Redis. The Cal catcher must not take any of them. */
const RESERVED_HOST_PORTS = [3000, 5555, 5450, 3001, 5451, 2525, 9003, 3002, 5434, 1025, 8025, 9000, 8000, 5433, 6380, 6381];

describe("Cal mail catcher ports", () => {
  it("SMTP and UI ports match the mapping in docker/cal.mail.compose.yml", () => {
    assert.ok(overlay.includes(`"127.0.0.1:${String(CAL_MAIL_SMTP_PORT)}:1025"`));
    assert.ok(overlay.includes(`"127.0.0.1:${String(CAL_MAIL_UI_PORT)}:8025"`));
  });

  it("neither host port collides with another product or Redis", () => {
    assert.equal(RESERVED_HOST_PORTS.includes(CAL_MAIL_SMTP_PORT), false);
    assert.equal(RESERVED_HOST_PORTS.includes(CAL_MAIL_UI_PORT), false);
  });

  it("every published port binds 127.0.0.1", () => {
    const published = overlay.split("\n").filter((l) => /^\s*-\s*"/.test(l));
    assert.equal(published.length, 2);
    for (const line of published) {
      assert.match(line, /"127\.0\.0\.1:\d+:\d+"/);
    }
  });

  it("pins the Mailpit image by tag and digest", () => {
    assert.match(overlay, /image: axllent\/mailpit:v1\.22\.3@sha256:[0-9a-f]{64}/);
  });

  it("uses the loopback host for the SMTP host and the fork's shipped example values", () => {
    assert.equal(CAL_MAIL_SMTP_HOST, "127.0.0.1");
    assert.equal(CAL_MAIL_EXAMPLE_HOST, "localhost");
    assert.equal(CAL_MAIL_EXAMPLE_PORT, "1025");
  });
});
