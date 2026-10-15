/**
 * 12 - Load balancer (the balancer itself; backend.ts, traffic.ts, telemetry-broker.json
 * and consumer.ts are its companions)
 *
 * Empire acting as a small layer-7 reverse proxy - see
 * doc/features/05_Loadbalancer_Core_L7.md for the full design. A learning and
 * local-development tool, not a production edge: no TLS, no HTTP/2, no
 * WebSocket upgrades, no retries.
 *
 * Three pieces, all plain middleware registered with app.use(), in this
 * order - the load balancer is terminal (it never calls next()), so
 * everything the balancer app answers itself must come before it:
 *
 *   1. createAdminProxyMiddleware        - the telemetry dashboard, at /admin (loopback only)
 *   2. createBackendRegistrationEndpoint - where backends announce themselves, at /_lb/registry
 *   3. createLoadBalancerMiddleware      - the proxy itself, round robin unless told otherwise
 *
 * Backends register themselves and keep a lease alive with heartbeats; nothing
 * here lists them. The lease is 5 seconds so a killed backend leaves the
 * ring quickly enough to watch (the library default is 15).
 *
 * Telemetry: nothing is drawn by the balancer itself. Every event the
 * LoadBalancerMonitor reports (backend added or removed, lease renewed, request
 * dispatched, completed, failed or aborted) is published to the "lb-telemetry"
 * queue on a queue broker (the empire-ts-aqueduct package), as type
 * "loadbalancer.<event>". Each backend publishes a "backend.request" item for
 * every request it serves to the same queue. Publishing is buffered and retried,
 * so the balancer works with the broker down; events are then held (up to 5000)
 * and sent when it returns.
 *
 * A separate telemetry hub (src/telemetry-hub) drains that queue into SQLite and
 * serves a React dashboard. This balancer shows it under /admin by forwarding
 * those requests to the hub, so http://localhost:8012/admin/ is the dashboard.
 * The balancer does not need the hub to proxy traffic.
 *
 * Quickest: from src/telemetry-hub, run `npm run setup` once, then `npm run demo`.
 * That starts the broker, the hub, this balancer, three backends and the traffic
 * generator together, and Ctrl-C stops them all. Open http://localhost:8012/admin/.
 *
 * Or run the parts yourself (each in its own terminal):
 *   empire-ts-aqueduct --config examples/12-load-balancer/telemetry-broker.json   # the broker (see below)
 *   empire-ts-monitoring all --config <hub config>                    # processor + dashboard server, port 7130
 *   npx tsx examples/12-load-balancer/server.ts                       # this balancer, port 8012, round robin
 *   npx tsx examples/12-load-balancer/server.ts least-connections     # the same, choosing by requests in flight
 *   npx tsx examples/12-load-balancer/backend.ts alpha 8021           # a backend
 *   npx tsx examples/12-load-balancer/backend.ts beta 8022 40         # a slower one (40 ms base latency)
 *   npx tsx examples/12-load-balancer/traffic.ts                      # steady traffic through the balancer
 *   npx tsx examples/12-load-balancer/consumer.ts                     # optional: print the telemetry as text
 *
 * Open: http://localhost:8012/admin/
 *
 * The broker and the hub are not part of Empire. Neither is on npm yet; run them
 * from the repository, from src/queue-server and src/telemetry-hub:
 *   npx tsx src/cli.ts --config <path to>/examples/12-load-balancer/telemetry-broker.json
 *   npx tsx src/cli.ts all --config config/hub.example.json
 * The broker listens on 7121 (publish) and 7122 (pull). telemetry-broker.json
 * holds demo tokens; see telemetryConfig.ts for the matching environment
 * overrides. The hub's example config matches them.
 *
 * Scripted walkthrough:
 *   1. Start only this balancer, with no broker. The ring is empty and any
 *      request answers 503; after a few seconds the log warns, once, that the
 *      telemetry broker is unreachable and events are waiting:
 *        curl -i http://localhost:8012/health
 *   2. Start the broker and the hub, then open /admin/. The waiting events arrive
 *      within a second or so, oldest first, and the queue panel shows the broker
 *      queue being read. Click the queue or the database in the scene to open
 *      their panels. (consumer.ts prints the same events as text.)
 *   3. Start alpha, then beta, then gamma (a third terminal, backend.ts gamma 8023 120).
 *      Each appears in the ring (loadbalancer.backendAdded) the moment it
 *      registers, its lease arc drains between heartbeats (loadbalancer.leaseRenewed),
 *      and round robin starts sweeping the widened ring - no balancer restart, no config edit.
 *   4. Start traffic.ts. Each request produces loadbalancer.dispatched, then
 *      loadbalancer.completed (status, durationMs, route) from the balancer,
 *      and a backend.request item from the backend that served it: in the scene,
 *      a dot flies from the balancer to a backend and back coloured by status,
 *      and small telemetry packets travel along the lane to the queue, the
 *      processor and the database. Click a backend: the camera flies to it and
 *      it unfolds into one satellite per route.
 *   5. Watch GET /slow: its durations are the longest. Hammer it:
 *        for i in $(seq 1 40); do curl -s http://localhost:8012/slow > /dev/null; done
 *   6. Ctrl-C one backend: it deregisters first, so you see
 *      loadbalancer.backendRemoved with reason "deregistered" while any request
 *      it was serving finishes.
 *   7. Kill one hard (kill -9 its process id): nothing tells the balancer. After
 *      5 seconds the lease runs out and the item says reason "expired" -
 *      "crashed" looks different from "shut down cleanly".
 *   8. Stop the broker while traffic.ts runs, wait, start it again. Telemetry is
 *      held in the balancer and the backends meanwhile, and requests are never
 *      slowed. Past 5000 waiting events the oldest are dropped.
 *   9. Restart this balancer as `server.ts least-connections`, with traffic.ts
 *      still running. Gamma (the slow one) now gets a smaller share, because a
 *      backend still busy with earlier requests is passed over - the Backends
 *      table's req/s column shows it.
 *
 * Set EMPIRE_LB_TOKEN on the balancer and every backend to change the shared
 * secret; the default below is for local demos only. Registration is open to
 * loopback clients only - see the design doc's security section before
 * changing that.
 */

import process from "process";
import { Empire } from "empire-ts";
import { BackendRegistry } from "empire-ts";
import { createBackendRegistrationEndpoint } from "empire-ts";
import { createLoadBalancerMiddleware } from "empire-ts";
import { LoadBalancerMonitor } from "empire-ts";
import { ILoadBalancingStrategy } from "empire-ts";
import { LeastConnectionsStrategy } from "empire-ts";
import { RoundRobinStrategy } from "empire-ts";
import { createAdminProxyMiddleware } from "./createAdminProxyMiddleware";
import { QueueTelemetryPublisher } from "./QueueTelemetryPublisher";
import { BROKER_PUBLISH_URL, HUB_URL, TELEMETRY_PUBLISH_TOKEN, TELEMETRY_QUEUE } from "./telemetryConfig";

const PORT = 8012;
const LEASE_TTL_MS = 5000;
const PROXY_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2000;
const TOKEN = process.env.EMPIRE_LB_TOKEN ?? "dev-token";

const ROUND_ROBIN = "round-robin";
const LEAST_CONNECTIONS = "least-connections";
const strategyName = process.argv[2] ?? ROUND_ROBIN;

/**
 * Least connections reads the monitor's in-flight counts, so it is built
 * from the same monitor the balancer reports to - the load balancer refuses
 * to start otherwise.
 */
function createStrategy(name: string, monitor: LoadBalancerMonitor): ILoadBalancingStrategy {
    switch (name) {
        case ROUND_ROBIN:
            return new RoundRobinStrategy();
        case LEAST_CONNECTIONS:
            return new LeastConnectionsStrategy(monitor);
        default:
            console.error(`Unknown strategy "${name}" - use ${ROUND_ROBIN} or ${LEAST_CONNECTIONS}`);
            process.exit(1);
    }
}

const app = new Empire({
    host: "127.0.0.1",
    port: PORT,
    // Bounds how long stop() waits for requests still being proxied.
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
});

const monitor = new LoadBalancerMonitor({ logger: app.logger });
const registry = new BackendRegistry({ leaseTtlMs: LEASE_TTL_MS, monitor });


// Every monitor event goes to the telemetry queue and nowhere else: the balancer
// draws nothing itself, the hub's dashboard does that. The publisher buffers and retries, so a broker
// that is down never slows or breaks proxying.
const telemetry = new QueueTelemetryPublisher({
    brokerUrl: BROKER_PUBLISH_URL,
    queueName: TELEMETRY_QUEUE,
    token: TELEMETRY_PUBLISH_TOKEN,
    source: "lb-balancer",
    logger: app.logger,
});
const stopForwarding = monitor.subscribe((event) => {
    telemetry.publish(`loadbalancer.${event.type}`, event, {
        at: event.at,
        correlationId: "requestId" in event ? event.requestId : undefined,
    });
});

const admin = createAdminProxyMiddleware(HUB_URL, app.logger);
const loadBalancer = createLoadBalancerMiddleware({
    registry,
    monitor,
    strategy: createStrategy(strategyName, monitor),
    timeoutMs: PROXY_TIMEOUT_MS,
    logger: app.logger,
});

app.use(admin);
app.use(createBackendRegistrationEndpoint(registry, { path: "/_lb/registry", token: TOKEN }));
app.use(loadBalancer);

async function start(): Promise<void> {
    try {
        await app.start();
        app.logger.info(`Registry: http://127.0.0.1:${PORT}/_lb/registry   Strategy: ${strategyName}   Telemetry queue: ${BROKER_PUBLISH_URL} (${TELEMETRY_QUEUE})   Dashboard: http://localhost:${PORT}/admin/`);
    } catch (err) {
        app.logger.error("Failed to start server", err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    app.logger.info("Shutting down...");

    try {
        admin.dispose();
        loadBalancer.dispose();
        registry.dispose();
        await app.stop();
        // Last, so the events from the final requests and the shutdown are sent too.
        stopForwarding();
        await telemetry.dispose();
        app.logger.info("Server stopped.");
        process.exit(0);
    } catch (err) {
        app.logger.error("Error during shutdown", err);
        process.exit(1);
    }
});

void start();
