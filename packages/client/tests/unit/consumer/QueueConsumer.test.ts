import { afterEach, describe, expect, it } from "vitest";
import { QueueClientError } from "../../../src/client/QueueClientError";
import { QueueConsumer } from "../../../src/consumer/QueueConsumer";
import { QueueConsumerOptions } from "../../../src/consumer/QueueConsumerOptions";
import { ConsumedQueueItem } from "../../../src/types/ConsumedQueueItem";
import { deliveredItem, emptyAnswer, FakeBroker, jsonResponse, takeAnswer } from "../../fixtures/broker/FakeBroker";
import { waitFor } from "../../fixtures/waiting/waitFor";

const running: QueueConsumer[] = [];

afterEach(async () => {
    await Promise.all(running.splice(0).map((consumer) => consumer.stop()));
});

interface Harness {
    consumer: QueueConsumer;
    broker: FakeBroker;
    handled: ConsumedQueueItem[];
    errors: unknown[];
    sleeps: number[];
    events: string[];
}

/** A consumer wired to a fake broker, with a handler that records what it gets and a sleep that does not wait. */
function makeHarness(overrides: Partial<QueueConsumerOptions> = {}, broker: FakeBroker = new FakeBroker()): Harness {
    const handled: ConsumedQueueItem[] = [];
    const errors: unknown[] = [];
    const sleeps: number[] = [];
    const events: string[] = [];
    const originalAck = broker.ack;

    broker.ack = (batchId) => {
        events.push(`ack ${batchId}`);
        return originalAck(batchId);
    };

    const consumer = new QueueConsumer({
        url: "http://broker",
        queue: "telemetry",
        token: "t",
        fetch: broker.fetch as typeof fetch,
        handler: (item) => {
            events.push(`handle ${item.sequence}`);
            handled.push(item);
        },
        onError: (error) => { errors.push(error); },
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
        ...overrides,
    });

    running.push(consumer);

    return { consumer, broker, handled, errors, sleeps, events };
}

describe("QueueConsumer", () => {
    describe("the take, acknowledge, process flow", () => {
        it("acknowledges the batch before it processes any item", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]));
            const { consumer, handled, events } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 2);

            expect(events).toEqual(["ack b_1", "handle 1", "handle 2"]);
        });

        it("acknowledges once per batch, not once per item", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2), deliveredItem(3)]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(broker.of("ack").length).toBe(1);
        });

        it("passes each handler the item with its deliveryCount", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1, { deliveryCount: 3 })]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(handled[0]).toMatchObject({ sequence: 1, deliveryCount: 3, payload: { n: 1 } });
        });

        it("asks for batchSize items and the configured wait", async () => {
            const broker = new FakeBroker();
            const { consumer } = makeHarness({ batchSize: 20, waitMs: 5000 }, broker);

            consumer.start();
            await waitFor(() => broker.of("take").length === 1);

            expect(broker.of("take")[0].body).toEqual({ maxItems: 20, waitMs: 5000 });
        });

        it("keeps taking after a batch", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1)]))
                .willTake(takeAnswer("b_2", [deliveredItem(2)]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 2);

            expect(handled.map((item) => item.sequence)).toEqual([1, 2]);
        });

        it("counts what it did", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 2);

            expect(consumer.stats()).toMatchObject({ batchesTaken: 1, itemsReceived: 2, itemsProcessed: 2, handlerErrors: 0 });
        });
    });

    describe("concurrency", () => {
        it("runs at most `concurrency` handlers at the same time, and all of them when it can", async () => {
            const items = Array.from({ length: 8 }, (_, index) => deliveredItem(index + 1));
            const broker = new FakeBroker().willTake(takeAnswer("b_1", items));
            let active = 0;
            let peak = 0;
            let finished = 0;

            const { consumer } = makeHarness({
                concurrency: 3,
                handler: async () => {
                    active++;
                    peak = Math.max(peak, active);
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    active--;
                    finished++;
                },
            }, broker);

            consumer.start();
            await waitFor(() => finished === 8);

            expect(peak).toBe(3);
        });

        it("handles items strictly in order with the default concurrency of 1", async () => {
            const items = [deliveredItem(1), deliveredItem(2), deliveredItem(3)];
            const broker = new FakeBroker().willTake(takeAnswer("b_1", items));
            const order: number[] = [];

            const { consumer } = makeHarness({
                handler: async (item) => {
                    await new Promise((resolve) => setTimeout(resolve, 5 - item.sequence));
                    order.push(item.sequence);
                },
            }, broker);

            consumer.start();
            await waitFor(() => order.length === 3);

            expect(order).toEqual([1, 2, 3]);
        });

        it("finishes a whole batch before it takes the next", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]))
                .willTake(takeAnswer("b_2", [deliveredItem(3)]));
            const { consumer, handled } = makeHarness({ concurrency: 2 }, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(handled.slice(0, 2).map((item) => item.sequence).sort((a, b) => a - b)).toEqual([1, 2]);
            expect(handled[2].sequence).toBe(3);
        });
    });

    describe("optional helpers", () => {
        it("processes a batch in the order the broker sent it by default", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(3), deliveredItem(1), deliveredItem(2)]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(handled.map((item) => item.sequence)).toEqual([3, 1, 2]);
        });

        it("sorts a batch by sequence when asked", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(3), deliveredItem(1), deliveredItem(2)]));
            const { consumer, handled } = makeHarness({ sortBySequence: true }, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(handled.map((item) => item.sequence)).toEqual([1, 2, 3]);
        });

        it("processes a redelivered item again by default", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1)]))
                .willTake(takeAnswer("b_2", [deliveredItem(1, { deliveryCount: 2 })]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 2);

            expect(handled.map((item) => item.deliveryCount)).toEqual([1, 2]);
        });

        it("skips an itemId it has already seen when dedupe is on", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]))
                .willTake(takeAnswer("b_2", [deliveredItem(1, { deliveryCount: 2 }), deliveredItem(3)]));
            const { consumer, handled } = makeHarness({ dedupe: true }, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(handled.map((item) => item.sequence)).toEqual([1, 2, 3]);
            expect(consumer.stats().duplicatesSkipped).toBe(1);
        });

        it("forgets the oldest ids once the dedupe window is full", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]))
                .willTake(takeAnswer("b_2", [deliveredItem(1)]));
            const { consumer, handled } = makeHarness({ dedupe: { windowSize: 1 } }, broker);

            consumer.start();
            await waitFor(() => handled.length === 3);

            expect(handled.map((item) => item.sequence)).toEqual([1, 2, 1]);
        });
    });

    describe("acknowledgement problems", () => {
        it("skips the batch when the broker says the acknowledgement came too late", async () => {
            const broker = new FakeBroker()
                .willTake(takeAnswer("b_1", [deliveredItem(1)]))
                .willTake(takeAnswer("b_2", [deliveredItem(2)]));

            broker.ack = (batchId) => batchId === "b_1" ? jsonResponse({ error: "Unknown batch" }, 404) : jsonResponse({ acknowledged: true });

            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(handled.map((item) => item.sequence)).toEqual([2]);
            expect(consumer.stats().batchesSkipped).toBe(1);
        });

        it("processes the batch anyway when the acknowledgement fails with an unknown outcome", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1)]));

            broker.ack = () => jsonResponse({ error: "boom" }, 500);

            const { consumer, handled, errors } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(errors[0]).toBeInstanceOf(QueueClientError);
            expect(consumer.stats().ackErrors).toBe(1);
        });
    });

    describe("failures", () => {
        it("reports a failed take, backs off with a growing delay, and carries on", async () => {
            const broker = new FakeBroker()
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(takeAnswer("b_1", [deliveredItem(1)]));
            const { consumer, handled, errors, sleeps } = makeHarness({ initialBackoffMs: 1000, maxBackoffMs: 3000 }, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(errors.length).toBe(3);
            expect(consumer.stats().takeErrors).toBe(3);
            // Jitter spreads each delay between half and one and a half times its base: 1000, 2000, then capped at 3000.
            expect(sleeps[0]).toBeGreaterThanOrEqual(500);
            expect(sleeps[0]).toBeLessThanOrEqual(1500);
            expect(sleeps[1]).toBeGreaterThanOrEqual(1000);
            expect(sleeps[1]).toBeLessThanOrEqual(3000);
            expect(sleeps[2]).toBeGreaterThanOrEqual(1500);
            expect(sleeps[2]).toBeLessThanOrEqual(4500);
        });

        it("starts the backoff over after a success", async () => {
            const broker = new FakeBroker()
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(takeAnswer("b_1", [deliveredItem(1)]))
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(takeAnswer("b_2", [deliveredItem(2)]));
            const { consumer, handled, sleeps } = makeHarness({ initialBackoffMs: 1000 }, broker);

            consumer.start();
            await waitFor(() => handled.length === 2);

            expect(sleeps.length).toBe(2);
            expect(sleeps.every((ms) => ms >= 500 && ms <= 1500)).toBe(true);
        });

        it("reports a handler error with the item and carries on with the rest", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2), deliveredItem(3)]));
            const processed: number[] = [];

            const { consumer, errors } = makeHarness({
                handler: (item) => {
                    if (item.sequence === 2) {
                        throw new Error("cannot do 2");
                    }

                    processed.push(item.sequence);
                },
                onError: (error, item) => { errors.push([error, item?.sequence]); },
            }, broker);

            consumer.start();
            await waitFor(() => processed.length === 2);

            expect(processed).toEqual([1, 3]);
            expect(errors).toEqual([[new Error("cannot do 2"), 2]]);
            expect(consumer.stats()).toMatchObject({ itemsProcessed: 2, handlerErrors: 1 });
        });

        it("keeps running when the error handler itself throws", async () => {
            const broker = new FakeBroker()
                .willTake(jsonResponse({ error: "down" }, 503))
                .willTake(takeAnswer("b_1", [deliveredItem(1)]));
            const { consumer, handled } = makeHarness({
                onError: () => { throw new Error("logging failed"); },
            }, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);
        });
    });

    describe("polling", () => {
        it("pauses for the poll interval after an empty answer that came back at once", async () => {
            const broker = new FakeBroker().willTake(emptyAnswer()).willTake(takeAnswer("b_1", [deliveredItem(1)]));
            const { consumer, handled, sleeps } = makeHarness({ waitMs: 0, pollIntervalMs: 750 }, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(sleeps.length).toBe(1);
            expect(sleeps[0]).toBeGreaterThan(0);
            expect(sleeps[0]).toBeLessThanOrEqual(750);
        });

        it("does not pause after a long-poll that waited the full interval", async () => {
            const broker = new FakeBroker()
                .willTake(async () => {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    return emptyAnswer();
                })
                .willTake(takeAnswer("b_1", [deliveredItem(1)]));
            const { consumer, handled, sleeps } = makeHarness({ pollIntervalMs: 10 }, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);

            expect(sleeps).toEqual([]);
        });
    });

    describe("stopping", () => {
        it("cancels a waiting take and resolves", async () => {
            const broker = new FakeBroker();
            const { consumer } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => broker.of("take").length === 1);
            await consumer.stop();

            expect(consumer.isRunning).toBe(false);
            expect(consumer.stats().takeErrors).toBe(0);
        });

        it("finishes the items already in hand before it resolves", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1), deliveredItem(2)]));
            const finished: number[] = [];
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });

            const { consumer } = makeHarness({
                handler: async (item) => {
                    await gate;
                    finished.push(item.sequence);
                },
            }, broker);

            consumer.start();
            await waitFor(() => broker.of("ack").length === 1);

            const stopping = consumer.stop();

            release();
            await stopping;

            expect(finished).toEqual([1, 2]);
        });

        it("takes nothing more once stopped", async () => {
            const broker = new FakeBroker().willTake(takeAnswer("b_1", [deliveredItem(1)]));
            const { consumer, handled } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => handled.length === 1);
            await consumer.stop();

            const takesAtStop = broker.of("take").length;

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(broker.of("take").length).toBe(takesAtStop);
        });

        it("can be stopped when it was never started, and more than once", async () => {
            const { consumer } = makeHarness();

            await consumer.stop();
            await consumer.stop();
        });

        it("can be started again after it was stopped", async () => {
            const broker = new FakeBroker();
            const { consumer } = makeHarness({}, broker);

            consumer.start();
            await waitFor(() => broker.of("take").length === 1);
            await consumer.stop();
            consumer.start();
            await waitFor(() => broker.of("take").length === 2);
        });

        it("refuses to start twice", () => {
            const { consumer } = makeHarness();

            consumer.start();

            expect(() => consumer.start()).toThrow(/already running/);
        });
    });

    describe("options", () => {
        it("refuses a batch size, concurrency or wait that is not a whole number in range", () => {
            expect(() => makeHarness({ batchSize: 0 })).toThrow(RangeError);
            expect(() => makeHarness({ concurrency: 1.5 })).toThrow(RangeError);
            expect(() => makeHarness({ waitMs: -1 })).toThrow(RangeError);
            expect(() => makeHarness({ dedupe: { windowSize: 0 } })).toThrow(RangeError);
        });
    });
});
