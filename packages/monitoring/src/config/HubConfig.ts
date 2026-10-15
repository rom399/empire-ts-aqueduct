/** The hub's settings after the config file is read and checked. Paths are absolute. */
export interface HubConfig {
    dbPath: string;
    retentionMs: number;
    broker: {
        pullUrl: string;
        queue: string;
        pullToken: string;
        adminToken?: string;
    };
    server: {
        host: string;
        port: number;
        webRoot: string;
    };
}
