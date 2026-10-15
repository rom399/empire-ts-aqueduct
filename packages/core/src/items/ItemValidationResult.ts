import { NewQueueItem } from "./NewQueueItem";

/** The outcome of validating one item a producer sent. */
export type ItemValidationResult =
    | {
        ok: true;
        item: NewQueueItem;
        /** The size of the serialised payload, so callers need not measure it again. */
        payloadBytes: number;
    }
    | {
        ok: false;
        message: string;
    };
