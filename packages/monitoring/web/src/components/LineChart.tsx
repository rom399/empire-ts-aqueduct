import { useId, useMemo } from "react";
import { areaPath, linePath, niceMax, scaleLinear, timeTicks } from "../data/chartScale";

export interface ChartSeries {
    name: string;
    color: string;
    /** One value per time point; null leaves a gap. */
    values: Array<number | null>;
    filled?: boolean;
}

interface Props {
    times: number[];
    series: ChartSeries[];
    height?: number;
    unit?: string;
    formatTime: (t: number) => string;
    formatValue: (v: number) => string;
}

const WIDTH = 480;
const PAD = { left: 40, right: 8, top: 8, bottom: 20 };

/** A small line chart in plain SVG. With no data it says so instead of drawing an empty frame. */
export function LineChart({ times, series, height = 120, unit, formatTime, formatValue }: Props) {
    const id = useId();
    const plot = useMemo(() => {
        const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
        const hasData = all.some((v) => v > 0);
        const max = niceMax(Math.max(0, ...all));
        const x = scaleLinear(times[0] ?? 0, times[times.length - 1] ?? 1, PAD.left, WIDTH - PAD.right);
        const y = scaleLinear(0, max, height - PAD.bottom, PAD.top);

        return {
            hasData,
            max,
            baseline: height - PAD.bottom,
            lines: series.map((s) => {
                const points = s.values.map((value, i) => ({ x: x(times[i]), y: value === null ? null : y(value) }));
                return { ...s, line: linePath(points), area: s.filled ? areaPath(points, height - PAD.bottom) : "" };
            }),
            ticks: timeTicks(times[0] ?? 0, times[times.length - 1] ?? 0, 4).map((t) => ({ t, x: x(t) })),
        };
    }, [times, series, height]);

    return (
        <div className="chart">
            <div className="chart-legend">
                {series.map((s) => (
                    <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>
                ))}
                {unit ? <span className="chart-unit">{unit}</span> : null}
            </div>
            <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={series.map((s) => s.name).join(", ")} preserveAspectRatio="none">
                <defs>
                    {plot.lines.map((s, i) => (
                        <linearGradient key={s.name} id={`${id}-g${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
                        </linearGradient>
                    ))}
                </defs>
                <line className="axis" x1={PAD.left} x2={WIDTH - PAD.right} y1={plot.baseline} y2={plot.baseline} />
                <line className="grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top} y2={PAD.top} />
                <text className="tick" x={PAD.left - 4} y={PAD.top + 4} textAnchor="end">{formatValue(plot.max)}</text>
                <text className="tick" x={PAD.left - 4} y={plot.baseline} textAnchor="end">0</text>
                {plot.ticks.map((tick, i) => (
                    <text key={tick.t} className="tick" x={tick.x} y={height - 5} textAnchor={i === 0 ? "start" : i === plot.ticks.length - 1 ? "end" : "middle"}>{formatTime(tick.t)}</text>
                ))}
                {plot.lines.map((s, i) => (
                    <g key={s.name}>
                        {s.area ? <path d={s.area} fill={`url(#${id}-g${i})`} /> : null}
                        <path d={s.line} fill="none" stroke={s.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                    </g>
                ))}
            </svg>
            {!plot.hasData ? <div className="chart-empty">No traffic in this range</div> : null}
        </div>
    );
}
