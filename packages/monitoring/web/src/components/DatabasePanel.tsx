import type { DatabaseResponse, ProcessorStatus } from "../../../src/shared/apiTypes";
import { formatAgo, formatBytes, formatCount, formatRetention } from "../data/format";

interface Props {
    info: DatabaseResponse | undefined;
    processor: ProcessorStatus | undefined;
    now: number;
}

export function DatabasePanel({ info, processor, now }: Props) {
    if (info === undefined) {
        return <p className="muted">Waiting for the database overview…</p>;
    }

    return (
        <div className="db-panel">
            <dl className="facts">
                <div><dt>file</dt><dd className="path" title={info.path}>{info.path.split(/[\\/]/).pop()}</dd></div>
                <div><dt>size</dt><dd>{formatBytes(info.sizeBytes)}</dd></div>
                <div><dt>kept for</dt><dd>{formatRetention(info.retentionMs)}</dd></div>
                <div><dt>stored since start</dt><dd>{formatCount(processor?.storedTotal)}</dd></div>
                <div><dt>duplicates skipped</dt><dd>{formatCount(processor?.duplicatesSkipped)}</dd></div>
                <div><dt>last stored</dt><dd>{formatAgo(processor?.lastStoredAt, now)}</dd></div>
            </dl>
            {processor?.lastError ? <p className="note warn">Last processor error: {processor.lastError}</p> : null}
            <table className="grid">
                <thead><tr><th>table</th><th>rows</th><th>oldest</th><th>newest</th></tr></thead>
                <tbody>
                    {info.tables.map((table) => (
                        <tr key={table.name}>
                            <td>{table.name}</td>
                            <td>{formatCount(table.rows)}</td>
                            <td>{table.oldestAt === null ? "–" : formatAgo(table.oldestAt, now)}</td>
                            <td>{table.newestAt === null ? "–" : formatAgo(table.newestAt, now)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
