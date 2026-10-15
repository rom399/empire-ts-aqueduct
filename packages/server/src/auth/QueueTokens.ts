import { BearerToken } from "./BearerToken";

/** The two tokens of one queue. */
export interface QueueTokens {
    publish: BearerToken;
    pull: BearerToken;
}
