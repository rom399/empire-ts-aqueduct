import path from "node:path";
import {
    DEFAULT_MAX_PAYLOAD_BYTES,
    DEFAULT_MAX_PUBLISH_BATCH,
    DEFAULT_MAX_PUBLISH_BYTES,
    DEFAULT_MAX_SIZE,
    DEFAULT_MAX_TAKE_SIZE,
    DEFAULT_MAX_WAIT_MS,
    DEFAULT_RECEIPT_TIMEOUT_MS,
    DEFAULT_SPILL_BATCH_SIZE,
    DEFAULT_SPILL_BUFFER_SIZE,
} from "./queueDefaults";
import { isValidQueueName } from "./isValidQueueName";
import { OverflowPolicy } from "./OverflowPolicy";
import { QueueConfigurationError } from "./QueueConfigurationError";
import { QueueOptions } from "./QueueOptions";
import { QueueSettings } from "./QueueSettings";
import { SpillFullPolicy } from "./SpillFullPolicy";

/**
 * Applies the defaults to one queue's options and checks that the result can
 * work. Throws QueueConfigurationError naming the queue and the setting, so a
 * bad config fails at startup instead of at the first overflow.
 */
export function resolveQueueSettings(name: string, options: QueueOptions = {}, spillRoot?: string): QueueSettings {
    if (!isValidQueueName(name)) {
        throw new QueueConfigurationError(
            `"${name}" is not a valid queue name. Use 1 to 64 lowercase letters, digits, hyphens or underscores, and not a Windows reserved name such as "con" or "nul".`
        );
    }

    const overflow = parseOverflow(name, options.overflow);
    const spillFull = parseSpillFull(name, options.spillFull);
    const persist = options.persist ?? false;

    const maxSize = positiveInteger(name, "maxSize", options.maxSize ?? DEFAULT_MAX_SIZE);
    const spillBufferSize = positiveInteger(name, "spillBufferSize", options.spillBufferSize ?? DEFAULT_SPILL_BUFFER_SIZE);

    // The default batch is 2,000 but a small queue should still work with its defaults.
    const spillBatchSize = positiveInteger(
        name,
        "spillBatchSize",
        options.spillBatchSize ?? Math.min(DEFAULT_SPILL_BATCH_SIZE, maxSize, spillBufferSize)
    );

    const settings: QueueSettings = {
        name,
        maxSize,
        overflow,
        spillBufferSize,
        spillBatchSize,
        spillFull,
        receiptTimeoutMs: positiveInteger(name, "receiptTimeoutMs", options.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS),
        maxWaitMs: positiveInteger(name, "maxWaitMs", options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS),
        maxPayloadBytes: positiveInteger(name, "maxPayloadBytes", options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES),
        maxPublishBatch: positiveInteger(name, "maxPublishBatch", options.maxPublishBatch ?? DEFAULT_MAX_PUBLISH_BATCH),
        maxPublishBytes: positiveInteger(name, "maxPublishBytes", options.maxPublishBytes ?? DEFAULT_MAX_PUBLISH_BYTES),
        maxTakeSize: positiveInteger(name, "maxTakeSize", options.maxTakeSize ?? DEFAULT_MAX_TAKE_SIZE),
        persist,
    };

    if (options.messageTtlMs !== undefined) {
        settings.messageTtlMs = positiveInteger(name, "messageTtlMs", options.messageTtlMs);
    }

    if (options.maxSpillFiles !== undefined) {
        settings.maxSpillFiles = positiveInteger(name, "maxSpillFiles", options.maxSpillFiles);
    }

    if (options.maxSpillBytes !== undefined) {
        settings.maxSpillBytes = positiveInteger(name, "maxSpillBytes", options.maxSpillBytes);
    }

    const needsDisk = overflow === OverflowPolicy.Spill || persist;

    if (needsDisk) {
        if (!spillRoot) {
            throw new QueueConfigurationError(
                `Queue "${name}" uses ${overflow === OverflowPolicy.Spill ? "overflow: spill" : "persist"}, which needs a spillRoot folder.`
            );
        }

        settings.spillDirectory = path.join(spillRoot, name);
    }

    if (overflow === OverflowPolicy.Spill) {
        if (settings.maxSpillFiles === undefined && settings.maxSpillBytes === undefined) {
            throw new QueueConfigurationError(
                `Queue "${name}" uses overflow: spill, which needs a disk cap: set maxSpillFiles or maxSpillBytes.`
            );
        }

        if (spillBatchSize > spillBufferSize) {
            throw new QueueConfigurationError(
                `Queue "${name}": spillBatchSize (${spillBatchSize}) must not exceed spillBufferSize (${spillBufferSize}).`
            );
        }
    }

    if (spillBatchSize > maxSize) {
        throw new QueueConfigurationError(
            `Queue "${name}": spillBatchSize (${spillBatchSize}) must not exceed maxSize (${maxSize}).`
        );
    }

    return settings;
}

function positiveInteger(queue: string, setting: string, value: number): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new QueueConfigurationError(`Queue "${queue}": ${setting} must be a positive integer, got ${String(value)}.`);
    }

    return value;
}

function parseOverflow(queue: string, value: string | undefined): OverflowPolicy {
    if (value === undefined) {
        return OverflowPolicy.DropOldest;
    }

    if ((Object.values(OverflowPolicy) as string[]).includes(value)) {
        return value as OverflowPolicy;
    }

    throw new QueueConfigurationError(`Queue "${queue}": overflow must be "drop-oldest", "reject" or "spill", got "${value}".`);
}

function parseSpillFull(queue: string, value: string | undefined): SpillFullPolicy {
    if (value === undefined) {
        return SpillFullPolicy.Reject;
    }

    if ((Object.values(SpillFullPolicy) as string[]).includes(value)) {
        return value as SpillFullPolicy;
    }

    throw new QueueConfigurationError(`Queue "${queue}": spillFull must be "reject" or "drop-oldest", got "${value}".`);
}
