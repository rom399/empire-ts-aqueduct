/** Whether the broker is accepting work. Shared by both apps so health reflects shutdown. */
export class ServerState {
    private accepting = false;

    get isAccepting(): boolean {
        return this.accepting;
    }

    open(): void {
        this.accepting = true;
    }

    close(): void {
        this.accepting = false;
    }
}
