/** The fields of an event the projector reads. */
export interface StoredEventView {
    type: string;
    source: string | null;
    at: number;
    payload: Record<string, unknown>;
}
