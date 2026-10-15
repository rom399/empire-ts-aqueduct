/** What storing one batch did. */
export interface StoreResult {
    /** Items written. */
    stored: number;
    /** Items the database already had, from a redelivery. */
    duplicates: number;
    /** Items refused because they are not well formed (no id or type, or no usable time). */
    invalid: number;
    /** Items whose summary tables could not be updated; the raw event was still stored. */
    projectionErrors: number;
}
