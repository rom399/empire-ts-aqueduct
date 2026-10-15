/**
 * What the queue needs from a logger. Empire's `ILogger` has the same shape,
 * so it can be passed in directly.
 */
export interface IQueueLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
    debug(message: string): void;
}
