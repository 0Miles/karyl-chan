export interface SystemEvent {
    id: number;
    type: 'bot-ready' | 'bot-disconnect' | 'guild-join' | 'guild-leave' | 'error' | 'server-start';
    message: string;
    timestamp: string;
}

class SystemEventLog {
    private events: SystemEvent[] = [];
    private counter = 0;
    private readonly MAX_EVENTS = 100;

    record(type: SystemEvent['type'], message: string): void {
        this.events.push({
            id: ++this.counter,
            type,
            message,
            timestamp: new Date().toISOString()
        });
        if (this.events.length > this.MAX_EVENTS) this.events.shift();
    }

    list(): SystemEvent[] {
        return [...this.events].reverse();
    }
}

export const systemEventLog = new SystemEventLog();
