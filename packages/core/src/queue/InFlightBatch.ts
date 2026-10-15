import { IClockTimer } from "../clock/IClockTimer";
import { QueueItem } from "../items/QueueItem";

/** A batch handed to a consumer and waiting for its receipt ack. */
export interface InFlightBatch {
    items: QueueItem[];

    /** Fires when the receipt window closes. */
    timer: IClockTimer;
}
