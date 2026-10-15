
export interface RequestTrace {
  requestId: string;
  timestamp: string;
  clientIp: string;
  method: string;
  url: string;
  selectedUrl: string | null; // Clean, universal destination naming
  targetGroup: string;
  durationMs?: number;
  statusCode?: number;
  error?: string;
}

export interface ITraceStore {
  initialize(): Promise<void>;
  logRequest(trace: Omit<RequestTrace, "durationMs" | "statusCode" | "error">): Promise<void>;
  completeRequest(requestId: string, metrics: { durationMs: number; statusCode: number; error?: string }): Promise<void>;
  flushBatch(logs: Omit<RequestTrace, "durationMs" | "statusCode" | "error">[], completions: { requestId: string; metrics: { durationMs: number; statusCode: number; error?: string } }[]): void;
}