import type { ProcessorStatus, QueueSample, QueueSeriesResponse } from "../../../src/shared/apiTypes";
import { formatAgo, formatClock, formatCount, formatRate } from "../data/format";
import { queueFill, queueSeverity } from "../scene/layout";
import { PALETTE, css } from "../scene/palette";
import { LineChart } from "./LineChart";
import { Sparkline } from "./Sparkline";

interface Props {
    latest: QueueSample | null;
    samples: QueueSample[];
    series: QueueSeriesResponse | undefined;
    processor: ProcessorStatus | undefined;
    now: number;
}

export function QueuePanel({ latest, samples, series, processor, now }: Props) {
    if (latest === null) {
        return (
            <p className="muted">
                No queue reading yet. The processor samples the broker every couple of seconds; if it is not running,
                or has no admin token, nothing is recorded.
            </p>
        );
    }

    const fill = queueFill(latest.depth, latest.maxSize);
    const severity = queueSeverity(fill);
    const stale = processor !== undefined && !processor.alive;

    return (
        <div className="queue-panel">
            <div className="gauge" role="meter" aria-valuemin={0} aria-valuemax={latest.maxSize} aria-valuenow={latest.depth} aria-label="Queue depth">
                <div className={`gauge-fill ${severity}`} style={{ width: `${Math.max(fill * 100, latest.depth > 0 ? 1.5 : 0)}%` }} />
                <span className="gauge-text">{formatCount(latest.depth)} / {formatCount(latest.maxSize)} waiting</span>
            </div>
            {stale ? <p className="note warn">The processor is not reporting, so these numbers are from {formatAgo(latest.at, now)}.</p> : null}
            <dl className="facts">
                <div><dt>in flight</dt><dd>{formatCount(latest.inFlight)}</dd></div>
                <div><dt>spilled</dt><dd>{formatCount(latest.spilled)}</dd></div>
                <div><dt>consumers waiting</dt><dd>{latest.waitingConsumers}</dd></div>
                <div><dt>published/s</dt><dd>{formatRate(latest.publishRate)}</dd></div>
                <div><dt>acknowledged/s</dt><dd>{formatRate(latest.ackRate)}</dd></div>
                <div><dt>high-water mark</dt><dd>{formatCount(latest.highWaterMark)}</dd></div>
                <div><dt>published</dt><dd>{formatCount(latest.published)}</dd></div>
                <div><dt>acknowledged</dt><dd>{formatCount(latest.acknowledged)}</dd></div>
                <div><dt>redelivered</dt><dd className={latest.redelivered > 0 ? "warn" : ""}>{formatCount(latest.redelivered)}</dd></div>
                <div><dt>dropped</dt><dd className={latest.dropped > 0 ? "bad" : ""}>{formatCount(latest.dropped)}</dd></div>
                <div><dt>rejected</dt><dd className={latest.rejected > 0 ? "bad" : ""}>{formatCount(latest.rejected)}</dd></div>
                <div><dt>expired</dt><dd className={latest.expired > 0 ? "warn" : ""}>{formatCount(latest.expired)}</dd></div>
            </dl>
            <div className="sparks">
                <div><small>depth, last {samples.length} readings</small>
                    <Sparkline values={samples.map((s) => s.depth)} color={css(PALETTE.queue)} label="Queue depth" />
                </div>
                <div><small>published per second</small>
                    <Sparkline values={samples.map((s) => s.publishRate)} color={css(PALETTE.telemetry)} label="Publish rate" />
                </div>
            </div>
            {series !== undefined && series.points.length > 1 ? (
                <LineChart
                    times={series.points.map((p) => p.at)}
                    series={[
                        { name: "depth", color: css(PALETTE.queue), values: series.points.map((p) => p.depth), filled: true },
                        { name: "in flight", color: css(PALETTE.warn), values: series.points.map((p) => p.inFlight) },
                    ]}
                    height={100}
                    formatTime={(t) => formatClock(t).slice(0, 5)}
                    formatValue={formatCount}
                />
            ) : null}
        </div>
    );
}
