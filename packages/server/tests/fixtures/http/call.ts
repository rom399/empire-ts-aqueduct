export interface CallResult {
    status: number;
    headers: Headers;
    body: any;
}

/** Calls the broker and parses a JSON answer, so a test can read status, headers and body together. */
export async function call(
    baseUrl: string,
    path: string,
    options: { method?: string; token?: string; body?: unknown; rawBody?: string } = {}
): Promise<CallResult> {
    const response = await fetch(baseUrl + path, {
        method: options.method ?? "GET",
        headers: {
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.body !== undefined || options.rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });

    const text = await response.text();

    return { status: response.status, headers: response.headers, body: parseBody(text) };
}

/** A valid item a producer might send. */
export function item(n: number): { type: string; payload: { n: number }; createdAt: number } {
    return { type: "test.event", payload: { n }, createdAt: 1_700_000_000_000 };
}

/** Empire answers an unknown route or method with plain text, so a body that is not JSON is returned as it is. */
function parseBody(text: string): any {
    if (!text) {
        return undefined;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
