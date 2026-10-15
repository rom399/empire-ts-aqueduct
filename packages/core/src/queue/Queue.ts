import { randomUUID } from "node:crypto";
import { QueueItem } from "../items/QueueItem";
import { NewQueueItem } from "../items/NewQueueItem";
import { QueueItemValidator } from "../items/QueueItemValidator";
import { IClock } from "../clock/IClock";
import { IQueueLogger } from "../logging/IQueueLogger";
import { NEAR_FULL_RATIO, WARNING_INTERVAL_MS } from "../options/queueDefaults";
import { OverflowPolicy } from "../options/OverflowPolicy";
import { QueueSettings } from "../options/QueueSettings";
import { SpillFullPolicy } from "../options/SpillFullPolicy";
import { PublishRejected } from "../publishing/PublishRejected";
import { PublishRejectionReason } from "../publishing/PublishRejectionReason";
import { PublishResult } from "../publishing/PublishResult";
import { SpillStore } from "../spill/SpillStore";
import { QueueStats } from "../stats/QueueStats";
import { ItemDeque } from "../structures/ItemDeque";
import { LongPollQueue } from "../structures/LongPollQueue";
import { WarningThrottle } from "../structures/WarningThrottle";
import { TakeOptions } from "../taking/TakeOptions";
import { TakeResult } from "../taking/TakeResult";
import { InFlightBatch } from "./InFlightBatch";
import { QueueDependencies } from "./QueueDependencies";

/**
 * One named queue. It knows nothing about HTTP, so it works in-process as well
 * as behind the broker.
 *
 * Items live in up to three tiers, always in this order: the **main queue**
 * (the oldest items, the only place consumers take from), the **spill files**
 * on disk, and the **spill buffer** (the newest items, in memory). Reading
 * main, then files oldest first, then the buffer is strict FIFO with no
 * sorting. Only a queue with `overflow: spill` uses the files and the buffer.
 *
 * Everything here is synchronous apart from the long-poll wait, so each
 * publish, take and acknowledge is atomic. That is what guarantees two
 * consumers never receive the same item.
 */
export class Queue {
    private readonly settings: QueueSettings;
    private readonly clock: IClock;
    private readonly logger: IQueueLogger;
    private readonly store?: SpillStore;
    private readonly validator: QueueItemValidator;
    private readonly warnings: WarningThrottle;
    private readonly waiters: LongPollQueue<TakeResult>;

    private readonly main = new ItemDeque<QueueItem>();
    private readonly buffer = new ItemDeque<QueueItem>();
    private readonly inFlight = new Map<string, InFlightBatch>();
    private inFlightCount = 0;

    /** How many times each item has been returned after a receipt timeout. Absent means never. */
    private readonly redeliveries = new Map<string, number>();

    private nextSequence = 1;
    private closed = false;
    private highWaterMark = 0;

    private published = 0;
    private taken = 0;
    private acknowledged = 0;
    private redelivered = 0;
    private dropped = 0;
    private rejected = 0;
    private expired = 0;
    private purged = 0;

    constructor(settings: QueueSettings, dependencies: QueueDependencies) {
        this.settings = settings;
        this.clock = dependencies.clock;
        this.logger = dependencies.logger;
        this.store = dependencies.spillStore;
        this.validator = new QueueItemValidator(settings.maxPayloadBytes);
        this.warnings = new WarningThrottle(this.clock, WARNING_INTERVAL_MS);
        this.waiters = new LongPollQueue<TakeResult>(this.clock);
    }

    get name(): string {
        return this.settings.name;
    }

    get isClosed(): boolean {
        return this.closed;
    }

    /**
     * Loads whatever an earlier run left on disk: files written at a clean
     * shutdown with `persist`, or spill files a crash left behind. Call it once
     * before the queue is used.
     */
    restore(): void {
        if (!this.store) {
            return;
        }

        this.store.scan();

        const saved = this.store.readState();
        const highest = this.store.highestSequence();

        // Never go backwards: the files may hold higher numbers than the saved state if the last run crashed.
        this.nextSequence = Math.max(saved?.nextSequence ?? 1, highest !== undefined ? highest + 1 : 1);

        this.refill();

        const restored = this.main.length + this.buffer.length + this.store.itemCount;

        if (restored > 0) {
            this.logger.info(`Queue "${this.name}" restored ${restored} items from disk.`);
        }
    }

    /** Publishes one item. Never throws for a bad item; the result says what happened. */
    publish(raw: unknown): PublishResult {
        const result = this.closed ? this.rejectClosed() : this.publishValidated(raw);

        this.serveWaiters();

        return result;
    }

    /**
     * Publishes a batch. It is not all-or-nothing: each item gets its own
     * result, and the overflow policy applies item by item. Accepted items get
     * consecutive sequence numbers in request order. A batch with too many items
     * or too many bytes is refused whole.
     */
    publishBatch(raws: unknown[]): PublishResult[] {
        if (this.closed) {
            return raws.map(() => this.rejectClosed());
        }

        if (raws.length > this.settings.maxPublishBatch) {
            return raws.map(() => this.rejectTooLarge(`A batch may hold at most ${this.settings.maxPublishBatch} items; this one has ${raws.length}.`));
        }

        const validations = raws.map((raw) => this.validator.validate(raw));
        const totalBytes = validations.reduce((total, validation) => total + (validation.ok ? validation.payloadBytes : 0), 0);

        if (totalBytes > this.settings.maxPublishBytes) {
            return validations.map((validation) => validation.ok
                ? this.rejectTooLarge(`A batch may carry at most ${this.settings.maxPublishBytes} payload bytes; this one carries ${totalBytes}.`)
                : this.rejectInvalid(validation.message));
        }

        const results = validations.map((validation) => validation.ok
            ? this.enqueue(validation.item)
            : this.rejectInvalid(validation.message));

        this.serveWaiters();

        return results;
    }

    /**
     * Takes up to `maxItems` items and marks them in flight. Returns what is
     * available at once and never waits to fill the batch. On an empty queue it
     * returns nothing at once, or waits for the first item if `waitMs` is set.
     */
    async take(maxItems: number, options: TakeOptions = {}): Promise<TakeResult> {
        if (!Number.isInteger(maxItems) || maxItems < 1) {
            throw new RangeError("maxItems must be a positive integer.");
        }

        if (this.closed) {
            return this.emptyResult();
        }

        const limit = Math.min(maxItems, this.settings.maxTakeSize);
        const immediate = this.takeBatch(limit);

        if (immediate) {
            return immediate;
        }

        const waitMs = Math.min(options.waitMs ?? 0, this.settings.maxWaitMs);

        if (!(waitMs > 0)) {
            return this.emptyResult();
        }

        const served = await this.waiters.wait(limit, waitMs, options.signal);

        return served ?? this.emptyResult();
    }

    /**
     * Confirms a consumer received a batch. The queue forgets the items for
     * good. Returns false if the batch is unknown, which means its receipt
     * window already closed and the items went back to the queue.
     */
    acknowledge(batchId: string): boolean {
        const batch = this.inFlight.get(batchId);

        if (!batch) {
            return false;
        }

        batch.timer.cancel();
        this.inFlight.delete(batchId);
        this.inFlightCount -= batch.items.length;
        this.acknowledged += batch.items.length;

        for (const item of batch.items) {
            this.redeliveries.delete(item.itemId);
        }

        this.refill();

        return true;
    }

    /** Copies up to `maxItems` live items from the front of the main queue without removing or leasing them. */
    peek(maxItems: number): QueueItem[] {
        const now = this.clock.now();

        return this.main.toArray()
            .filter((item) => !this.isExpired(item, now))
            .slice(0, maxItems);
    }

    /**
     * Removes every waiting item from every tier, including spill files, and
     * returns how many. The sequence counter is not reset and in-flight batches
     * are not touched; if they time out they come back as usual.
     */
    purge(): number {
        const removed = this.main.length + this.buffer.length + (this.store?.deleteAll() ?? 0);

        this.main.clear();
        this.buffer.clear();
        this.purged += removed;

        // Only items in flight can still be redelivered.
        const inFlightIds = new Set([...this.inFlight.values()].flatMap((batch) => batch.items.map((item) => item.itemId)));

        for (const itemId of this.redeliveries.keys()) {
            if (!inFlightIds.has(itemId)) {
                this.redeliveries.delete(itemId);
            }
        }

        return removed;
    }

    /** Removes expired items from every tier and returns how many. Called by the shared sweeper. */
    sweep(): number {
        const now = this.clock.now();
        let removed = this.trimExpired(this.main, now) + this.trimExpired(this.buffer, now);

        if (this.store) {
            const deleted = this.store.deleteExpired(now);

            this.expired += deleted;
            removed += deleted;
        }

        if (removed > 0) {
            this.logger.info(`Queue "${this.name}" expired ${removed} items.`);
            this.refill();
        }

        return removed;
    }

    stats(): QueueStats {
        return {
            name: this.name,
            depth: this.main.length,
            inFlight: this.inFlightCount,
            buffered: this.buffer.length,
            spilledFiles: this.store?.fileCount ?? 0,
            spilledItems: this.store?.itemCount ?? 0,
            totalWaiting: this.waitingCount(),
            waitingConsumers: this.waiters.length,
            published: this.published,
            taken: this.taken,
            acknowledged: this.acknowledged,
            redelivered: this.redelivered,
            dropped: this.dropped,
            rejected: this.rejected,
            expired: this.expired,
            purged: this.purged,
            highWaterMark: this.highWaterMark,
            maxSize: this.settings.maxSize,
            closed: this.closed,
        };
    }

    /**
     * Stops the queue: refuses new publishes and takes, releases waiting
     * consumers with an empty answer, and puts in-flight items back. With
     * `persist` on it then writes everything to disk, oldest first.
     */
    shutdown(): void {
        if (this.closed) {
            return;
        }

        this.closed = true;
        this.waiters.releaseAll();
        this.returnAllInFlight();

        if (this.settings.persist && this.store) {
            this.persistToDisk(this.store);
        }
    }

    private publishValidated(raw: unknown): PublishResult {
        const validation = this.validator.validate(raw);

        return validation.ok ? this.enqueue(validation.item) : this.rejectInvalid(validation.message);
    }

    private enqueue(newItem: NewQueueItem): PublishResult {
        const placed = this.settings.overflow === OverflowPolicy.Spill
            ? this.placeWithSpill(newItem)
            : this.placeInMemory(newItem);

        if (placed.accepted) {
            this.published++;
            this.recordHighWaterMark();
            this.warnIfNearlyFull();
        }

        return placed;
    }

    /** `drop-oldest` and `reject`: one tier, in memory. */
    private placeInMemory(newItem: NewQueueItem): PublishResult {
        if (this.occupancy() >= this.settings.maxSize) {
            if (this.settings.overflow === OverflowPolicy.Reject) {
                return this.reject(PublishRejectionReason.QueueFull, `Queue "${this.name}" is full (${this.settings.maxSize} items).`);
            }

            const oldest = this.main.shift();

            if (!oldest) {
                // Every slot is held by an in-flight item, which is never evicted.
                return this.reject(PublishRejectionReason.QueueFull, `Queue "${this.name}" is full of items awaiting acknowledgement.`);
            }

            this.countDropped(oldest);
        }

        return this.accept(newItem, this.main);
    }

    /**
     * `spill`: straight to main when nothing is spilled and there is room,
     * otherwise to the buffer. Sending new items to the buffer while older ones
     * are spilled is what keeps the order strict.
     */
    private placeWithSpill(newItem: NewQueueItem): PublishResult {
        if (!this.hasSpilledItems() && this.occupancy() < this.settings.maxSize) {
            return this.accept(newItem, this.main);
        }

        if (this.buffer.length >= this.settings.spillBufferSize) {
            const refusal = this.flushBufferToDisk();

            if (refusal) {
                return refusal;
            }
        }

        return this.accept(newItem, this.buffer);
    }

    private accept(newItem: NewQueueItem, tier: ItemDeque<QueueItem>): PublishResult {
        const now = this.clock.now();

        const item: QueueItem = {
            ...newItem,
            itemId: randomUUID(),
            sequence: this.nextSequence++,
            enqueuedAt: now,
        };

        if (this.settings.messageTtlMs !== undefined) {
            item.expiresAt = now + this.settings.messageTtlMs;
        }

        tier.pushBack(item);

        return { accepted: true, itemId: item.itemId, sequence: item.sequence };
    }

    /**
     * Writes the oldest `spillBatchSize` buffered items to one file. Returns a
     * refusal when the disk cap is reached and `spillFull` is `reject`.
     */
    private flushBufferToDisk(): PublishRejected | undefined {
        const store = this.store;

        if (!store) {
            return undefined;
        }

        while (store.isFull(this.settings.maxSpillFiles, this.settings.maxSpillBytes)) {
            if (this.settings.spillFull === SpillFullPolicy.Reject) {
                return this.reject(PublishRejectionReason.SpillFull, `Queue "${this.name}" has reached its spill disk cap.`);
            }

            const deleted = store.deleteOldest();

            if (deleted === 0) {
                break;
            }

            this.dropped += deleted;
            this.warnOnce("spill-dropped", `Queue "${this.name}" reached its spill disk cap and deleted its oldest spill file (${deleted} items dropped).`);
        }

        const batch = this.buffer.toArray(this.settings.spillBatchSize);

        try {
            store.write(batch, this.clock.now());
            store.writeState({ nextSequence: this.nextSequence });
        } catch (error) {
            // A disk problem must not take the broker down. Keep going in memory by dropping the oldest buffered items.
            this.dropped += batch.length;
            this.warnOnce("spill-failed", `Queue "${this.name}" could not write a spill file; dropped ${batch.length} buffered items.`, error);
        }

        this.buffer.removeFront(batch.length);

        return undefined;
    }

    /** Hands the waiting consumers whatever is available, longest-waiting first. */
    private serveWaiters(): void {
        this.waiters.serve((maxItems) => this.takeBatch(maxItems));
    }

    /** Builds a batch from the front of the main queue, or returns null if no live item is there. */
    private takeBatch(maxItems: number): TakeResult | null {
        const now = this.clock.now();
        let items = this.takeLiveItems(maxItems, now);

        if (items.length === 0) {
            // Discarding expired items frees slots, which lets the lower tiers move up. Look once more.
            this.refill();
            items = this.takeLiveItems(maxItems, now);
        }

        if (items.length === 0) {
            return null;
        }

        const batchId = `b_${randomUUID()}`;

        this.inFlight.set(batchId, {
            items,
            timer: this.clock.setTimeout(() => this.returnTimedOutBatch(batchId), this.settings.receiptTimeoutMs),
        });
        this.inFlightCount += items.length;
        this.taken += items.length;

        this.refill();

        return {
            batchId,
            count: items.length,
            drained: this.waitingCount() === 0,
            items: items.map((item) => ({ ...item, deliveryCount: (this.redeliveries.get(item.itemId) ?? 0) + 1 })),
        };
    }

    /** Removes up to `maxItems` items from the front of main, discarding any that have expired. */
    private takeLiveItems(maxItems: number, now: number): QueueItem[] {
        const items: QueueItem[] = [];

        while (items.length < maxItems) {
            const item = this.main.shift();

            if (!item) {
                break;
            }

            if (this.isExpired(item, now)) {
                this.countExpired(item);
                continue;
            }

            items.push(item);
        }

        return items;
    }

    /** The receipt window closed with no ack: the items go back to the front and will be delivered again. */
    private returnTimedOutBatch(batchId: string): void {
        const batch = this.inFlight.get(batchId);

        if (!batch) {
            return;
        }

        this.inFlight.delete(batchId);
        this.inFlightCount -= batch.items.length;

        const now = this.clock.now();
        const survivors: QueueItem[] = [];

        for (const item of batch.items) {
            if (this.isExpired(item, now)) {
                this.countExpired(item);
                continue;
            }

            this.redeliveries.set(item.itemId, (this.redeliveries.get(item.itemId) ?? 0) + 1);
            survivors.push(item);
        }

        this.redelivered += survivors.length;
        this.main.pushFront(survivors);
        this.serveWaiters();
    }

    /** Puts every in-flight batch back at the front of the main queue, in sequence order. */
    private returnAllInFlight(): void {
        const returned: QueueItem[] = [];

        for (const batch of this.inFlight.values()) {
            batch.timer.cancel();
            returned.push(...batch.items);
        }

        this.inFlight.clear();
        this.inFlightCount = 0;
        this.main.pushFront(returned.sort((a, b) => a.sequence - b.sequence));
    }

    /**
     * Moves items from the lower tiers into main as room opens up. The oldest
     * file loads only when main has room for all of it, so a reload can never
     * overflow the queue straight away and the queue never thrashes between
     * disk and memory. With no files left, buffered items move over one by one.
     */
    private refill(): void {
        const now = this.clock.now();

        while (this.store && this.store.fileCount > 0) {
            const file = this.store.oldest();

            if (!file) {
                break;
            }

            // A file bigger than maxSize can only come from a config change. Let it into an empty queue rather than strand it.
            const needed = Math.min(file.count, this.settings.maxSize);

            if (this.freeSlots() < needed) {
                return;
            }

            const loaded = this.store.loadOldest(now);

            this.expired += loaded.expired;

            for (const item of loaded.items) {
                this.main.pushBack(item);
            }
        }

        while (this.buffer.length > 0 && this.freeSlots() > 0) {
            const item = this.buffer.shift();

            if (item) {
                this.main.pushBack(item);
            }
        }
    }

    /** Writes everything still waiting to disk, oldest first, then saves the sequence counter. */
    private persistToDisk(store: SpillStore): void {
        const now = this.clock.now();
        const live = (tier: ItemDeque<QueueItem>): QueueItem[] => tier.toArray().filter((item) => !this.isExpired(item, now));
        const main = live(this.main);
        const buffered = live(this.buffer);

        try {
            // No disk cap here: a clean shutdown must save everything or fail loudly.
            // Main and the buffer are chunked separately. Any spill files already on disk sit between
            // them in sequence order, and a file mixing both would overlap those files' ranges.
            for (const tier of [main, buffered]) {
                for (let start = 0; start < tier.length; start += this.settings.spillBatchSize) {
                    store.write(tier.slice(start, start + this.settings.spillBatchSize), now);
                }
            }

            store.writeState({ nextSequence: this.nextSequence });
            this.main.clear();
            this.buffer.clear();
            this.logger.info(`Queue "${this.name}" saved ${main.length + buffered.length} items to disk.`);
        } catch (error) {
            this.logger.error(`Queue "${this.name}" could not save its items to disk; they are lost.`, error);
        }
    }

    private trimExpired(tier: ItemDeque<QueueItem>, now: number): number {
        let removed = 0;

        // Expiry is uniform per queue, so expired items are always at the front.
        for (let item = tier.first(); item && this.isExpired(item, now); item = tier.first()) {
            tier.shift();
            this.countExpired(item);
            removed++;
        }

        return removed;
    }

    private isExpired(item: QueueItem, now: number): boolean {
        return item.expiresAt !== undefined && item.expiresAt <= now;
    }

    private countExpired(item: QueueItem): void {
        this.expired++;
        this.redeliveries.delete(item.itemId);
    }

    private countDropped(item: QueueItem): void {
        this.dropped++;
        this.redeliveries.delete(item.itemId);
        this.warnOnce("full", `Queue "${this.name}" is full; dropped its oldest item (${this.dropped} dropped so far).`);
    }

    /** Items counted against `maxSize`: waiting in main plus handed out and not yet acknowledged. */
    private occupancy(): number {
        return this.main.length + this.inFlightCount;
    }

    private freeSlots(): number {
        return Math.max(0, this.settings.maxSize - this.occupancy());
    }

    private hasSpilledItems(): boolean {
        return this.buffer.length > 0 || (this.store?.fileCount ?? 0) > 0;
    }

    private waitingCount(): number {
        return this.main.length + this.buffer.length + (this.store?.itemCount ?? 0);
    }

    private recordHighWaterMark(): void {
        this.highWaterMark = Math.max(this.highWaterMark, this.waitingCount() + this.inFlightCount);
    }

    private warnIfNearlyFull(): void {
        if (this.occupancy() >= this.settings.maxSize * NEAR_FULL_RATIO) {
            this.warnOnce("near-full", `Queue "${this.name}" is ${Math.round(NEAR_FULL_RATIO * 100)}% full (${this.occupancy()} of ${this.settings.maxSize}).`);
        }
    }

    private warnOnce(kind: string, message: string, error?: unknown): void {
        if (!this.warnings.allow(kind)) {
            return;
        }

        if (error) {
            this.logger.error(message, error);
        } else {
            this.logger.warn(message);
        }
    }

    private emptyResult(): TakeResult {
        return { batchId: null, count: 0, drained: this.waitingCount() === 0, items: [] };
    }

    private reject(reason: PublishRejectionReason, message: string): PublishRejected {
        this.rejected++;
        this.warnOnce(`rejected-${reason}`, `${message} Rejected ${this.rejected} items so far.`);

        return { accepted: false, reason, message };
    }

    private rejectInvalid(message: string): PublishRejected {
        this.rejected++;

        return { accepted: false, reason: PublishRejectionReason.InvalidItem, message };
    }

    private rejectTooLarge(message: string): PublishRejected {
        this.rejected++;

        return { accepted: false, reason: PublishRejectionReason.BatchTooLarge, message };
    }

    private rejectClosed(): PublishRejected {
        this.rejected++;

        return { accepted: false, reason: PublishRejectionReason.QueueClosed, message: `Queue "${this.name}" is shutting down.` };
    }
}
