import { resolveQueueSettings } from "empire-ts-aqueduct-core";
import { describe, expect, it } from "vitest";
import { publishBodyLimit } from "../../src/publishBodyLimit";

describe("publishBodyLimit", () => {
    it("allows the largest batch any queue allows, plus room for each item's envelope", () => {
        const small = resolveQueueSettings("small", { maxPublishBytes: 1000, maxPublishBatch: 2 });
        const large = resolveQueueSettings("large", { maxPublishBytes: 5000, maxPublishBatch: 10 });

        expect(publishBodyLimit([small, large])).toBe(5000 + 10 * 1500);
    });
});
