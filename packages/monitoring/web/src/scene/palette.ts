/** Colours shared by the scene and the panels, as hex numbers (three.js) with a CSS twin. */
export const PALETTE = {
    ok: 0x2ecc71,
    info: 0x3b82f6,
    warn: 0xf5a524,
    bad: 0xef4444,
    dispatch: 0xcfd8e8,
    hub: 0x3b5bdb,
    node: 0x3b82f6,
    gone: 0x6b7280,
    lease: 0x9be36b,
    telemetry: 0x7dd3fc,
    queue: 0x38bdf8,
    processor: 0xa78bfa,
    database: 0xfbbf24,
    background: 0x0b1020,
} as const;

export function css(color: number): string {
    return `#${color.toString(16).padStart(6, "0")}`;
}
