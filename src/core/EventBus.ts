type EventHandler = (...args: any[]) => void | Promise<void>;

export interface EventMap {
  [event: string]: EventHandler;
}

export class EventBus {
  private listeners: Map<string, Set<EventHandler>> = new Map();

  on<T extends keyof EventMap>(event: T, handler: EventMap[T]): void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    this.listeners.get(event as string)!.add(handler);
  }

  off<T extends keyof EventMap>(event: T, handler: EventMap[T]): void {
    const set = this.listeners.get(event as string);
    if (set) set.delete(handler);
  }

  async emit<T extends keyof EventMap>(event: T, ...args: Parameters<EventMap[T]>): Promise<void> {
    const set = this.listeners.get(event as string);
    if (!set) return;
    const promises: Promise<void>[] = [];
    for (const handler of set) {
      const result = handler(...args);
      if (result instanceof Promise) promises.push(result);
    }
    await Promise.all(promises);
  }

  clear(): void {
    this.listeners.clear();
  }
}
