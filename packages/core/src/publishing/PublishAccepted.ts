/** The queue accepted the item. */
export interface PublishAccepted {
    accepted: true;
    itemId: string;
    sequence: number;
}
