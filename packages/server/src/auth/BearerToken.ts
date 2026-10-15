import { createHash, timingSafeEqual } from "node:crypto";

/** The word that must start the Authorization header. */
const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/**
 * One secret a caller must present as `Authorization: Bearer <token>`.
 *
 * Both sides are hashed with SHA-256 before they are compared, so the
 * comparison takes the same time whatever the token's length and however much
 * of it matches. Same approach as the load balancer's registration endpoint.
 */
export class BearerToken {
    private readonly digest: Buffer;

    /** Throws if the secret is empty, so a missing token fails at startup and never leaves a port open. */
    constructor(secret: string, readonly purpose: string) {
        if (typeof secret !== "string" || secret.length === 0) {
            throw new Error(`The ${purpose} token is missing or empty.`);
        }

        this.digest = hash(secret);
    }

    /** True if `authorizationHeader` carries this token. */
    matches(authorizationHeader: string | undefined): boolean {
        const presented = BEARER_PREFIX.exec(authorizationHeader ?? "")?.[1];

        if (presented === undefined) {
            return false;
        }

        return timingSafeEqual(this.digest, hash(presented.trim()));
    }

    /** True if both tokens hold the same secret. */
    sameSecretAs(other: BearerToken): boolean {
        return timingSafeEqual(this.digest, other.digest);
    }
}

function hash(value: string): Buffer {
    return createHash("sha256").update(value).digest();
}
