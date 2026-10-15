import type { TimeseriesResponse } from "../../../src/shared/apiTypes";
import { RANGES, RangeName } from "../data/useDashboard";
import { formatClock, formatCount, formatMs } from "../data/format";
import { PALETTE, css } from "../scene/palette";
import { LineChart } from "./LineChart";

interface Props {
    series: TimeseriesResponse | undefined;
    range: RangeName;
    onRange: (range: RangeName) => void;
    scope: string;
}

export function ChartsPanel({ series, range, onRange, scope }: Props) {
    const times = series?.points.map((p) => p.t) ?? [];
    const perSecond = (count: number): number => (series ? count / (series.bucketMs / 1000) : 0);
    const clock = (t: number): string => (RANGES[range] > 6 * 3_600_000 ? new Date(t).toTimeString().slice(0, 5) : formatClock(t).slice(0, 8));

    return (
        <div>
            <div className="range" role="group" aria-label="Time range">
                {(Object.keys(RANGES) as RangeName[]).map((name) => (
                    <button key={name} type="button" className={name === range ? "on" : ""} aria-pressed={name === range} onClick={() => onRange(name)}>{name}</button>
                ))}
                <span className="scope">{scope}</span>
            </div>
            {series === undefined ? <p className="muted">Loading…</p> : (
                <>
                    <LineChart
                        times={times}
                        series={[
                            { name: "requests/s", color: css(PALETTE.info), values: series.points.map((p) => perSecond(p.count)), filled: true },
                            { name: "errors/s", color: css(PALETTE.bad), values: series.points.map((p) => perSecond(p.errors)) },
                        ]}
                        formatTime={clock}
                        formatValue={(v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))}
                    />
                    <LineChart
                        times={times}
                        series={[
                            { name: "avg latency", color: css(PALETTE.ok), values: series.points.map((p) => (p.count > 0 ? p.avgMs : null)) },
                            { name: "max latency", color: css(PALETTE.warn), values: series.points.map((p) => (p.count > 0 ? p.maxMs : null)) },
                        ]}
                        formatTime={clock}
                        formatValue={(v) => formatMs(v).replace(" ms", "")}
                        unit="ms"
                    />
                    <small className="muted">{formatCount(series.points.reduce((sum, p) => sum + p.count, 0))} requests · {series.bucketMs / 1000} s per point</small>
                </>
            )}
        </div>
    );
}
