/** Documenso helpers. Parsers are pure (no I/O). DNS lookup and cert existence are injected so tests stay offline. */
/** Documenso's old-space default. 7168 MB passed the build in P2 probe 1.3; 2044 MB died with exit 134. */
export declare const DOCUMENSO_HEAP_MB = 7168;
/** The base env with the heap default merged into NODE_OPTIONS. The caller's own heap limit wins. */
export declare function withDocumensoHeap(base: Record<string, string>, nodeOptions: string | undefined): Record<string, string>;
export declare const DOCUMENSO_NODE_MAJOR = 24;
export declare const DOCUMENSO_DEFAULT_PORT = "3001";
/** IPv4-only lookup. Injected in tests; production uses dns.promises.lookup (hosts file). */
export type DocumensoLoopbackLookup = (hostname: string, options: {
    family: 4;
}) => Promise<{
    address: string;
}>;
export interface DocumensoListen {
    host: string;
    port: string;
}
/**
 * Parse the configured base URL. Only 127.0.0.1 is accepted: localhost can resolve to ::1 on Windows
 * and hide an app that only listens on IPv4 (or the reverse), so the harness never passes on it.
 */
export declare function documensoListen(baseUrl: string): DocumensoListen;
/** The localhost twin of a 127.0.0.1 base URL, used only to diagnose an IPv6-only bind. */
export declare function localhostTwin(baseUrl: string): string;
export declare function documensoHealthUrls(baseUrl: string): {
    signin: string;
    csrf: string;
};
export declare function isDocumensoHealthyStatus(statusCode: number): boolean;
export declare function stripTrailingSlash(url: string): string;
/**
 * Validate optional DOCUMENSO_PUBLIC_URL. Origin only (scheme, host, port): no path beyond `/`,
 * query, hash, or credentials. Hostname must not be localhost or an IP. Port must match listen.
 */
export declare function parseDocumensoPublicUrl(raw: string, listenPort: string): string;
/**
 * Fail unless hostname resolves to 127.0.0.1 (IPv4). Uses getaddrinfo so /etc/hosts is honoured.
 * No localhost fallback.
 */
export declare function assertDocumensoPublicHostResolvesToLoopback(hostname: string, lookup?: DocumensoLoopbackLookup): Promise<void>;
/**
 * Read NEXT_PUBLIC_WEBAPP_URL from Documenso's `window.__ENV__ = {...}; window.__webpack_nonce__` script.
 * Returns undefined when the assignment is missing or not JSON.
 */
export declare function parseDocumensoRunningWebappUrl(html: string): string | undefined;
export declare function runningWebappUrlMatches(html: string, expectedPublicUrl: string): boolean;
/**
 * Absolute path to the fork's bundled dev certificate. Remix `npm run start` sets
 * NODE_ENV=production, so Documenso will not fall back to `./example/cert.p12`.
 * An absolute path does not depend on the Remix process cwd (the harness spawns at productRoot).
 */
export declare function documensoLocalSigningCertPath(productRoot: string): string;
/**
 * Fail before Docker when the fork example cert is not on disk. The harness does not generate one.
 */
export declare function assertDocumensoSigningCert(productRoot: string, exists?: (filePath: string) => boolean): void;
/**
 * Local-only values for the app process and migrate/seed commands. These are the stock
 * `.env.example` placeholders from the fork, not secrets. The harness values win over the
 * product `.env` because dotenv does not override variables already set in the environment.
 *
 * NEXT_PRIVATE_INTERNAL_WEBAPP_URL always stays on the listen/base URL so the server can
 * talk to itself without depending on a public hostname. NEXT_PUBLIC_WEBAPP_URL follows
 * publicUrl when set (passkey RP ID / cookie domain).
 *
 * Local signing uses the fork example cert with an empty passphrase (same as `.env.example`).
 * Seal calls signPdf under production start, which requires this path.
 */
/** Gotenberg service started by the opt-in overlay (docker/documenso.gotenberg.compose.yml). */
export declare const DOCUMENSO_GOTENBERG_URL = "http://127.0.0.1:3010";
/** True only for the exact value DOCUMENSO_GOTENBERG=1. Unset, blank or any other value keeps Gotenberg off. */
export declare function documensoGotenbergEnabled(env: NodeJS.ProcessEnv): boolean;
export declare function buildDocumensoAppEnv(cfg: {
    baseUrl: string;
    dbUrl: string;
    productRoot: string;
    publicUrl?: string;
    /** Set only when Gotenberg is on. Unset leaves NEXT_PRIVATE_DOCUMENT_CONVERSION_URL out of the env. */
    documentConversionUrl?: string;
    /** Set only when DOCUMENSO_OIDC=1 (src/adapters/documenso-oidc.ts). Unset leaves every NEXT_PRIVATE_OIDC_* name out of the env. */
    oidc?: {
        wellKnownUrl: string;
        clientId: string;
        clientSecret: string;
    };
}): Record<string, string>;
/** Throws unless the given Node major version is at least Documenso's required 24. */
export declare function assertDocumensoNodeVersion(version: string): void;
/** The Node binary Documenso runs under: $NODE24 when it is set and not blank, else the Node running the harness. */
export declare function documensoNodeBinary(env: NodeJS.ProcessEnv, execPath: string): string;
/** The version of a Node binary, read by running it (not the version of the harness's own process). */
export declare function documensoNodeVersion(binary: string): string;
/**
 * The name of the PATH variable in an env object. Windows matches it case-insensitively ("Path"), so an existing
 * key in any spelling is reused. Without one, "PATH" is used.
 */
export declare function documensoPathKey(env: NodeJS.ProcessEnv): string;
/**
 * The PATH value for Documenso child steps when $NODE24 is set: the Node 24 folder comes first, so `npm` and
 * the processes it starts run under Node 24. Returns the current PATH unchanged when no binary is given.
 */
export declare function documensoChildPath(nodeBinary: string | undefined, currentPath: string | undefined): string | undefined;
export type DocumensoProbeVerdict = "healthy" | "unhealthy" | "environment";
/**
 * healthy: 127.0.0.1 answers 200 on both routes.
 * environment: 127.0.0.1 fails but localhost answers. Blocking, never a pass.
 * unhealthy: neither answers.
 */
export declare function classifyDocumensoProbe(strictOk: boolean, localhostOk: boolean): DocumensoProbeVerdict;
/** PIDs of LISTENING sockets on `port`, from `netstat -ano` output. Diagnostic only. */
export declare function parseNetstatListeningPids(netstatOutput: string, port: string): number[];
/** Executable name from `tasklist /FI "PID eq n" /NH` output. Diagnostic only. */
export declare function parseTasklistImageName(tasklistOutput: string): string | undefined;
//# sourceMappingURL=documenso-env.d.ts.map