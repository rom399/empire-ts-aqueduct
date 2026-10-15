/** Remembers the most recent ids, forgetting the oldest once it holds `size`. */
export class DedupeWindow {
    private readonly seen = new Set<string>();

    constructor(private readonly size: number) {}

    has(id: string): boolean {
        return this.seen.has(id);
    }

    add(id: string): void {
        this.seen.add(id);

        if (this.seen.size > this.size) {
            // A Set iterates in insertion order, so the first value is the oldest.
            const oldest = this.seen.values().next().value;

            if (oldest !== undefined) {
                this.seen.delete(oldest);
            }
        }
    }
}
