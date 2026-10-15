import { PublishAccepted } from "./PublishAccepted";
import { PublishRejected } from "./PublishRejected";

/** What happened to one published item. */
export type PublishResult = PublishAccepted | PublishRejected;
