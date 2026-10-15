/** Thrown at startup when a queue's settings cannot work. */
export class QueueConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QueueConfigurationError";
    }
}
