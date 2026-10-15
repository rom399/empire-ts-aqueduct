/**
 * Spreads a delay between half and one and a half times its length, so many
 * consumers that failed together do not all retry together.
 */
export function withJitter(delayMs: number, random: () => number = Math.random): number {
    return delayMs * (0.5 + random());
}
