/** Thrown when something asks for a queue that was not declared. */
export class UnknownQueueError extends Error {
    constructor(readonly queueName: string) {
        super(`There is no queue named "${queueName}".`);
        this.name = "UnknownQueueError";
    }
}
