/** Why a queue refused an item. */
export enum PublishRejectionReason {
    /** The item failed validation. */
    InvalidItem = "invalid-item",

    /** The queue is full and its policy is `reject`. */
    QueueFull = "queue-full",

    /** The spill disk cap was reached and `spillFull` is `reject`. */
    SpillFull = "spill-full",

    /** The queue is shutting down. */
    QueueClosed = "queue-closed",

    /** The batch had too many items or too many bytes. The whole batch is refused. */
    BatchTooLarge = "batch-too-large",
}
