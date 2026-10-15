import { areaPath, linePath, niceMax, scaleLinear } from "../data/chartScale";

interface Props {
    values: number[];
    color: string;
    /** Fix the top of the scale (for example a queue's capacity). Default: fit the data. */
    max?: number;
    width?: number;
    height?: number;
    label: string;
}

/** A tiny trend line with no axes. */
export function Sparkline({ values, color, max, width = 160, height = 34, label }: Props) {
    const top = max ?? niceMax(Math.max(0, ...values));
    const x = scaleLinear(0, Math.max(1, values.length - 1), 2, width - 2);
    const y = scaleLinear(0, top, height - 2, 2);
    const points = values.map((value, i) => ({ x: x(i), y: y(value) }));

    return (
        <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
            <path d={areaPath(points, height - 2)} fill={color} opacity="0.18" />
            <path d={linePath(points)} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
    );
}
