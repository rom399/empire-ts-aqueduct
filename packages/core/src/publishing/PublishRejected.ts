import { PublishRejectionReason } from "./PublishRejectionReason";

/** The queue refused the item. */
export interface PublishRejected {
    accepted: false;
    reason: PublishRejectionReason;
    message: string;
}
