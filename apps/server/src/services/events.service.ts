import type { SseEvent } from "@test-evals/shared";

type Listener = (event: SseEvent) => void;

class RunEventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  publish(event: SseEvent): void {
    this.listeners.get(event.runId)?.forEach((listener) => listener(event));
  }
}

export const runEvents = new RunEventBus();
