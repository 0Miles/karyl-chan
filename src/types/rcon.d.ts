declare module 'rcon' {
    export default class Rcon {
        constructor(host: string, port: number, password: string);
        connect(): Promise<void>;
        disconnect(): void;
        send(command: string): void;
        on(event: 'auth', callback: () => void): this;
        on(event: 'response', callback: (str: string) => void): this;
        on(event: 'server', callback: (str: string) => void): this;
        on(event: 'error', callback: (err: Error) => void): this;
        on(event: 'end', callback: () => void): this;
        removeAllListeners(): void;
    }
}
