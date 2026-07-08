/**
 * Minimal typed publish/subscribe bus. Systems communicate through events
 * (currently just log messages) instead of holding references to UI objects.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface GameEvents {
  log: { level: LogLevel; message: string };
  [key: string]: unknown;
}

type Handler<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown> = GameEvents> {
  private handlers = new Map<keyof M, Set<Handler<never>>>();

  /** Subscribe. Returns an unsubscribe function. */
  on<K extends keyof M>(event: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as Handler<M[K]>)(payload);
    }
  }
}
