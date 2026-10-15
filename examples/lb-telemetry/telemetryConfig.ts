import process from "process";

/**
 * Where the telemetry queue lives, shared by the balancer, the backends and
 * the consumer. These match telemetry-broker.json; the tokens are for local
 * demos only. Override the address or tokens with the environment variables
 * and change the config file to match.
 */
export const BROKER_PUBLISH_URL = process.env.EMPIRE_LB_QUEUE_PUBLISH_URL ?? "http://127.0.0.1:7121";
export const BROKER_PULL_URL = process.env.EMPIRE_LB_QUEUE_PULL_URL ?? "http://127.0.0.1:7122";
export const TELEMETRY_QUEUE = "lb-telemetry";
export const TELEMETRY_PUBLISH_TOKEN = process.env.EMPIRE_LB_QUEUE_PUBLISH_TOKEN ?? "lb-publish-token";
export const TELEMETRY_PULL_TOKEN = process.env.EMPIRE_LB_QUEUE_PULL_TOKEN ?? "lb-pull-token";

/** The telemetry hub's web server, which the balancer shows under /admin. */
export const HUB_URL = process.env.EMPIRE_LB_HUB_URL ?? "http://127.0.0.1:7130";
