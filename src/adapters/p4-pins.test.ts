import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LIBRECHAT_IMAGE, LIBRECHAT_MONGO_IMAGE } from "./librechat-env.js";
import { LITELLM_IMAGE } from "./litellm-env.js";
import { OPENCLAW_IMAGE } from "./openclaw-env.js";
import { MATTERMOST_IMAGE, MATTERMOST_MM_AGENTS_COMMIT } from "./mattermost-env.js";
import { NEXTCLOUD_IMAGE, NEXTCLOUD_MCP_IMAGE } from "./nextcloud-env.js";
import { OUTLINE_API_KEY_PREFIX } from "./outline-env.js";
import { PENPOT_BACKEND_IMAGE, PENPOT_EXPORTER_IMAGE, PENPOT_FRONTEND_IMAGE, PENPOT_MCP_IMAGE } from "./penpot-env.js";

// Runs from the repo root (npm test), so paths are relative to the working directory.
const PINS = path.resolve("docs", "pins", "p4.md");
const COMPOSE_FILES = [
  "docker/nextcloud.compose.yml",
  "docker/nextcloud.mcp.compose.yml",
  "docker/outline.compose.yml",
  "docker/penpot.compose.yml",
  "docker/mattermost.compose.yml",
  "docker/litellm.compose.yml",
  "docker/librechat.compose.yml",
  "docker/openclaw.compose.yml",
];
const DOCKERFILE = "docker/mattermost-mcp.Dockerfile";

function read(file: string): string {
  return fs.readFileSync(path.resolve(file), "utf8");
}

/**
 * Every registry image reference in a compose file or a Dockerfile. `p4-harness/*` is a local build tag: its content is
 * fixed by the Dockerfile's pinned base digests and pinned MM_AGENTS_COMMIT, so it has no registry digest and is skipped.
 */
function imageRefs(text: string): string[] {
  const refs: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const compose = /^\s*image:\s*(\S+)/.exec(line);
    if (compose?.[1] && !compose[1].startsWith("p4-harness/")) refs.push(compose[1]);
    const from = /^FROM\s+(\S+)/.exec(line);
    if (from?.[1] && !from[1].startsWith("$")) refs.push(from[1]);
    const arg = /^ARG\s+\w+_IMAGE=(\S+)/.exec(line);
    if (arg?.[1]) refs.push(arg[1]);
  }
  return refs;
}

describe("P4 pins (docs/pins/p4.md is the source of truth)", () => {
  it("every P4 compose and Dockerfile image is pinned by a 64-hex digest", () => {
    const files = [...COMPOSE_FILES, DOCKERFILE];
    let count = 0;
    for (const file of files) {
      for (const ref of imageRefs(read(file))) {
        count += 1;
        assert.match(ref, /@sha256:[0-9a-f]{64}$/, `${file}: ${ref} is not pinned by digest`);
      }
    }
    assert.ok(count >= 10, `expected at least 10 image references, found ${count}`);
  });

  it("every digest in those files appears in docs/pins/p4.md", () => {
    const pins = fs.readFileSync(PINS, "utf8");
    for (const file of [...COMPOSE_FILES, DOCKERFILE]) {
      for (const ref of imageRefs(read(file))) {
        const digest = /sha256:[0-9a-f]{64}/.exec(ref)?.[0];
        assert.ok(digest, `${file}: ${ref} has no digest`);
        assert.ok(pins.includes(digest), `${file}: digest of ${ref} is not recorded in docs/pins/p4.md`);
      }
    }
  });

  it("the TypeScript pin constants match the compose files", () => {
    const compose = [
      ...COMPOSE_FILES.map((f) => read(f)),
      read(DOCKERFILE),
    ].join("\n");
    for (const pin of [
      NEXTCLOUD_IMAGE,
      NEXTCLOUD_MCP_IMAGE,
      PENPOT_FRONTEND_IMAGE,
      PENPOT_BACKEND_IMAGE,
      PENPOT_EXPORTER_IMAGE,
      PENPOT_MCP_IMAGE,
      MATTERMOST_IMAGE,
      LITELLM_IMAGE,
      LIBRECHAT_IMAGE,
      LIBRECHAT_MONGO_IMAGE,
      OPENCLAW_IMAGE,
    ]) {
      assert.ok(compose.includes(pin), `pin constant ${pin} is not in the compose files`);
    }
  });

  it("the Mattermost MCP commit is the same in the Dockerfile, the compose file and the constant", () => {
    assert.match(MATTERMOST_MM_AGENTS_COMMIT, /^[0-9a-f]{40}$/);
    assert.ok(read(DOCKERFILE).includes(`ARG MM_AGENTS_COMMIT=${MATTERMOST_MM_AGENTS_COMMIT}`));
    assert.ok(read("docker/mattermost.compose.yml").includes(`MM_AGENTS_COMMIT: ${MATTERMOST_MM_AGENTS_COMMIT}`));
  });

  it("the Outline key prefix is the one the 1.13.0 build uses", () => {
    assert.equal(OUTLINE_API_KEY_PREFIX, "ol_api_");
  });

  it("the Twenty compose file still uses the tag-only pin (not changed by P4)", () => {
    assert.ok(read("docker/twenty.compose.yml").includes("twentycrm/twenty:${TAG:-v2.44.0}"));
  });
});

describe("agent-host pins (ADR 0007, D18)", () => {
  it("no agent-host compose file uses a moving tag", () => {
    for (const file of ["docker/litellm.compose.yml", "docker/librechat.compose.yml", "docker/openclaw.compose.yml"]) {
      for (const ref of imageRefs(read(file))) {
        assert.doesNotMatch(ref, /:(latest|main|main-slim)[@:]/, `${file}: ${ref} uses a moving tag`);
      }
    }
  });
});
