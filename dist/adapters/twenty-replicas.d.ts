/**
 * Opt-in second Twenty server replica. `TWENTY_SERVER_REPLICAS=2` adds docker/twenty.replicas.compose.yml, which starts
 * `server-2` on 127.0.0.1:3003 with DISABLE_DB_MIGRATIONS=true so only the first replica runs migrations.
 * Unset, blank or `1` keeps one replica and the compose argv unchanged. Any other value stops `up()` by name.
 */
export declare const TWENTY_REPLICAS_COMPOSE_FILE = "twenty.replicas.compose.yml";
export declare function twentyServerReplicas(env: NodeJS.ProcessEnv): 1 | 2;
//# sourceMappingURL=twenty-replicas.d.ts.map