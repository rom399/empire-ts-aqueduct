import { DatabaseInfoQuery } from "./DatabaseInfoQuery";
import { EventsQuery } from "./EventsQuery";
import { QueueQuery } from "./QueueQuery";
import { RequestsQuery } from "./RequestsQuery";
import { SummaryQuery } from "./SummaryQuery";
import { TelemetryDatabase } from "./TelemetryDatabase";
import { TimeseriesQuery } from "./TimeseriesQuery";
import { TopologyQuery } from "./TopologyQuery";
import { WindowStatsQuery } from "./WindowStatsQuery";

/** Everything the web server reads from the database, one bounded query per question. */
export class TelemetryQueries {
    readonly topology: TopologyQuery;
    readonly summary: SummaryQuery;
    readonly timeseries: TimeseriesQuery;
    readonly events: EventsQuery;
    readonly requests: RequestsQuery;
    readonly queue: QueueQuery;
    readonly info: DatabaseInfoQuery;

    constructor(db: TelemetryDatabase, retentionMs: number) {
        const stats = new WindowStatsQuery(db);

        this.topology = new TopologyQuery(db, stats);
        this.summary = new SummaryQuery(db, stats);
        this.timeseries = new TimeseriesQuery(db);
        this.events = new EventsQuery(db);
        this.requests = new RequestsQuery(db);
        this.queue = new QueueQuery(db);
        this.info = new DatabaseInfoQuery(db, retentionMs);
    }
}
