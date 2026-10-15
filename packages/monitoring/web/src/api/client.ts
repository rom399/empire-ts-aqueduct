import type {
    DatabaseResponse, EventsResponse, QueueResponse, QueueSeriesResponse, RequestsResponse,
    SummaryResponse, TimeseriesResponse, TopologyResponse,
} from "../../../src/shared/apiTypes";

/**
 * Every URL is relative to the page ("api/..."), so the dashboard works at "/"
 * (the hub), at "/admin/" (behind the load balancer) and under the Vite dev
 * server alike.
 */
function url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const target = new URL(`api/${path}`, document.baseURI);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
            target.searchParams.set(key, String(value));
        }
    }

    return target.toString();
}

export class ApiError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = "ApiError";
    }
}

async function get<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
    let response: Response;

    try {
        response = await fetch(url(path, params), { signal, cache: "no-store" });
    } catch (err) {
        if (signal?.aborted) {
            throw err;
        }

        throw new ApiError("The dashboard server cannot be reached.");
    }

    if (!response.ok) {
        throw new ApiError(`The server answered ${response.status} for ${path}.`, response.status);
    }

    return (await response.json()) as T;
}

/** The bounded reads the dashboard makes. Nothing here asks for "everything". */
export const api = {
    topology: (signal?: AbortSignal) => get<TopologyResponse>("topology", {}, signal),
    summary: (windowMs: number, signal?: AbortSignal) => get<SummaryResponse>("summary", { windowMs }, signal),
    queue: (signal?: AbortSignal) => get<QueueResponse>("queue", {}, signal),
    queueSeries: (from: number, to: number, signal?: AbortSignal) => get<QueueSeriesResponse>("queue/series", { from, to }, signal),
    database: (signal?: AbortSignal) => get<DatabaseResponse>("db", {}, signal),
    events: (limit: number, signal?: AbortSignal) => get<EventsResponse>("events", { limit }, signal),
    requests: (limit: number, backendId?: string, signal?: AbortSignal) => get<RequestsResponse>("requests", { limit, backendId }, signal),
    timeseries: (from: number, to: number, backendId: string | undefined, route: string | undefined, signal?: AbortSignal) =>
        get<TimeseriesResponse>("timeseries", { from, to, backendId, route }, signal),
    streamUrl: (afterSeq?: number) => url("stream", { afterSeq }),
};
