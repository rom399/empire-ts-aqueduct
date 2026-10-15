/** What a queue's folder remembers between runs besides its items. */
export interface SpillState {
    /** The sequence number the queue should hand out next, so numbering continues after a restart. */
    nextSequence: number;
}
