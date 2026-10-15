import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyHarnessLauncher,
  collectDescendants,
  parseCommandLine,
  parseLsofPids,
  parseNetstatListeningPids,
} from "./medusa-listeners.js";

const NETSTAT = [
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       25860",
  "  TCP    [::]:8000              [::]:0                 LISTENING       25860",
  "  TCP    127.0.0.1:9000         0.0.0.0:0              LISTENING       4411",
  "  TCP    127.0.0.1:60378        127.0.0.1:8000         TIME_WAIT       0",
  "  TCP    127.0.0.1:8000         127.0.0.1:50001        ESTABLISHED     25860",
  "  TCP    0.0.0.0:18000          0.0.0.0:0              LISTENING       9999",
].join("\r\n");

describe("parseNetstatListeningPids", () => {
  it("returns the LISTENING pid on the port, deduplicated across IPv4 and IPv6", () => {
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 8000), [25860]);
  });

  it("finds a different port without matching ports that only end in the same digits", () => {
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 9000), [4411]);
    assert.deepEqual(parseNetstatListeningPids(NETSTAT, 3000), []);
  });

  it("ignores ESTABLISHED and TIME_WAIT rows", () => {
    assert.deepEqual(
      parseNetstatListeningPids(
        "  TCP    127.0.0.1:8000  127.0.0.1:1  ESTABLISHED  77",
        8000,
      ),
      [],
    );
  });
});

describe("parseLsofPids", () => {
  it("parses one pid per line and drops blanks and junk", () => {
    assert.deepEqual(parseLsofPids("123\n456\n\n456\nnot-a-pid\n"), [123, 456]);
  });

  it("returns an empty list when nothing listens", () => {
    assert.deepEqual(parseLsofPids(""), []);
  });
});

describe("parseCommandLine", () => {
  it("splits on spaces, keeps quoted paths together, and leaves backslashes alone", () => {
    assert.deepEqual(
      parseCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" D:\\p\\next start -p 8000',
      ),
      [
        "C:\\Program Files\\nodejs\\node.exe",
        "D:\\p\\next",
        "start",
        "-p",
        "8000",
      ],
    );
  });

  it("returns no arguments for an empty line", () => {
    assert.deepEqual(parseCommandLine(""), []);
    assert.deepEqual(parseCommandLine("   "), []);
  });
});

describe("classifyHarnessLauncher", () => {
  const root = "D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter";
  const backendSpawn = parseCommandLine(
    "C:\\nvm4w\\nodejs\\node.exe D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\apps\\backend\\node_modules\\@medusajs\\cli\\cli.js start",
  );
  const storefrontSpawn = parseCommandLine(
    "C:\\nvm4w\\nodejs\\node.exe D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\apps\\storefront\\node_modules\\next\\dist\\bin\\next start -p 8000",
  );

  it("matches the backend spawn line", () => {
    assert.equal(classifyHarnessLauncher(backendSpawn, root), "backend");
  });

  it("matches the storefront spawn line", () => {
    assert.equal(classifyHarnessLauncher(storefrontSpawn, root), "storefront");
  });

  it("matches the pnpm store layout of the medusa CLI", () => {
    const argv = parseCommandLine(
      "node D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\node_modules\\.pnpm\\@medusajs+cli@2.21.2\\node_modules\\@medusajs\\cli\\cli.js start",
    );
    assert.equal(classifyHarnessLauncher(argv, root), "backend");
  });

  it("matches a script under apps/backend/.medusa/server", () => {
    const argv = [
      "node",
      "D:/Jayami/Portfolio/products/medusa-dtc-starter/apps/backend/.medusa/server/index.js",
    ];
    assert.equal(classifyHarnessLauncher(argv, root), "backend");
  });

  it("matches across slash styles and case", () => {
    const argv = [
      "/usr/bin/node",
      "D:/JAYAMI/portfolio/PRODUCTS/Medusa-DTC-Starter/apps/storefront/node_modules/next/dist/bin/next",
      "start",
    ];
    assert.equal(
      classifyHarnessLauncher(
        argv,
        "d:\\jayami\\portfolio\\products\\medusa-dtc-starter",
      ),
      "storefront",
    );
  });

  it("does not match when the product path is only in a later argument", () => {
    const argv = parseCommandLine(
      "node D:\\other\\server.js --config D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\x",
    );
    assert.equal(classifyHarnessLauncher(argv, root), undefined);
  });

  it("does not match when the product CLI path is only a later argument", () => {
    const argv = [
      "node",
      "D:/other/wrapper.js",
      "D:/Jayami/Portfolio/products/medusa-dtc-starter/apps/storefront/node_modules/next/dist/bin/next",
      "start",
    ];
    assert.equal(classifyHarnessLauncher(argv, root), undefined);
  });

  it("does not take a node flag value for the launch script", () => {
    const argv = [
      "node",
      "--require",
      "D:/Jayami/Portfolio/products/medusa-dtc-starter/apps/storefront/node_modules/next/dist/bin/next",
      "unrelated.js",
      "start",
    ];
    assert.equal(classifyHarnessLauncher(argv, root), undefined);
  });

  it("does not match the same CLI without start (build, dev)", () => {
    const argv = parseCommandLine(
      "node D:\\Jayami\\Portfolio\\products\\medusa-dtc-starter\\apps\\storefront\\node_modules\\next\\dist\\bin\\next build",
    );
    assert.equal(classifyHarnessLauncher(argv, root), undefined);
  });

  it("does not match a sibling folder that only shares the prefix", () => {
    const argv = [
      "node",
      "D:/Jayami/Portfolio/products/medusa-dtc-starter-old/apps/storefront/node_modules/next/dist/bin/next",
      "start",
    ];
    assert.equal(classifyHarnessLauncher(argv, root), undefined);
  });

  it("does not match non-node executables or eval", () => {
    assert.equal(
      classifyHarnessLauncher(
        [
          "pnpm",
          "D:/Jayami/Portfolio/products/medusa-dtc-starter/apps/storefront/node_modules/next/dist/bin/next",
          "start",
        ],
        root,
      ),
      undefined,
    );
    assert.equal(
      classifyHarnessLauncher(["node", "-e", "require('x')", "start"], root),
      undefined,
    );
  });

  it("does not match an empty command line or an empty root", () => {
    assert.equal(
      classifyHarnessLauncher(parseCommandLine(""), root),
      undefined,
    );
    assert.equal(classifyHarnessLauncher(backendSpawn, ""), undefined);
  });

  describe("relative launch script with a Linux cwd", () => {
    const productRoot = "/home/dev/products/medusa-dtc-starter";
    const argv = [
      "node",
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "8000",
    ];

    it("matches when the cwd is inside apps/storefront", () => {
      assert.equal(
        classifyHarnessLauncher(
          argv,
          productRoot,
          `${productRoot}/apps/storefront`,
        ),
        "storefront",
      );
    });

    it("does not match when the cwd is outside the product apps", () => {
      assert.equal(
        classifyHarnessLauncher(argv, productRoot, "/tmp"),
        undefined,
      );
      assert.equal(
        classifyHarnessLauncher(argv, productRoot, `${productRoot}/apps/other`),
        undefined,
      );
    });

    it("does not match a relative script without a cwd", () => {
      assert.equal(classifyHarnessLauncher(argv, productRoot), undefined);
    });

    it("does not let a relative script escape the product through ..", () => {
      const escaping = [
        "node",
        "../../../outside/node_modules/next/dist/bin/next",
        "start",
      ];
      assert.equal(
        classifyHarnessLauncher(
          escaping,
          productRoot,
          `${productRoot}/apps/storefront`,
        ),
        undefined,
      );
    });
  });
});

describe("collectDescendants", () => {
  const tree: Record<number, number[]> = {
    1: [2, 3],
    2: [4],
    3: [],
    4: [5],
  };
  const childrenOf = (pid: number) => tree[pid] ?? [];

  it("returns all descendants, deepest first, without the root pid", () => {
    assert.deepEqual(collectDescendants(1, childrenOf), [5, 4, 2, 3]);
  });

  it("returns an empty list for a pid with no children", () => {
    assert.deepEqual(collectDescendants(3, childrenOf), []);
    assert.deepEqual(collectDescendants(99, childrenOf), []);
  });

  it("survives a cycle in the process table", () => {
    const cyclic: Record<number, number[]> = { 1: [2], 2: [3], 3: [1, 2] };
    assert.deepEqual(
      collectDescendants(1, (pid) => cyclic[pid] ?? []),
      [3, 2],
    );
  });
});
