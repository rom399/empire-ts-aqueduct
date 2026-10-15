/** What a spilling queue does when its disk cap is reached. */
export enum SpillFullPolicy {
    /** Refuse new items. */
    Reject = "reject",

    /** Delete the oldest spill file and count its items as dropped. */
    DropOldest = "drop-oldest",
}
