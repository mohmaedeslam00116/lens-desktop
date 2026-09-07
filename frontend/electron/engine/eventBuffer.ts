import { LiveEvent } from './types';

/**
 * Monotonic Event Ring Buffer
 *
 * Maintains a bounded in-memory circular ring buffer of the most recent sequential
 * research events (default capacity: 300) keyed by strictly monotonic event IDs (1, 2, 3...).
 *
 * Implements pure O(1) constant-time circular append with head/tail modulo indexing
 * and zero array reallocation upon reaching capacity.
 *
 * Supports delta replay via `getEventsSince(lastEventId)` to guarantee seamless
 * WebSocket reconnection recovery without missing telemetry, state transitions, or report chunks.
 */
export class EventRingBuffer {
  private readonly capacityLimit: number;
  private nextEventId: number;
  private readonly ring: (LiveEvent | null)[];
  private head: number = 0; // Index of the oldest element
  private tail: number = 0; // Index of the next insertion slot
  private count: number = 0; // Current count of elements in the ring

  constructor(capacity: number = 300, startEventId: number = 1) {
    if (capacity < 1) {
      throw new Error(`EventRingBuffer capacity must be >= 1, received ${capacity}`);
    }
    this.capacityLimit = Math.floor(capacity);
    this.nextEventId = Math.max(1, Math.floor(startEventId));
    this.ring = new Array(this.capacityLimit).fill(null);
  }

  /**
   * Appends an event to the circular buffer in O(1) time, stamping it with a strictly monotonic eventId.
   * Overwrites the oldest event if capacity is exceeded.
   */
  public push(event: LiveEvent): LiveEvent {
    const stampedEvent: LiveEvent = {
      ...event,
      eventId: this.nextEventId++
    };

    if (this.count === this.capacityLimit) {
      // Ring is full: overwrite oldest item at head and advance both head and tail
      this.ring[this.head] = stampedEvent;
      this.head = (this.head + 1) % this.capacityLimit;
      this.tail = this.head;
    } else {
      // Ring has available space: insert at tail and advance tail
      this.ring[this.tail] = stampedEvent;
      this.tail = (this.tail + 1) % this.capacityLimit;
      this.count++;
    }

    return stampedEvent;
  }

  /**
   * Alias for `push`.
   */
  public append(event: LiveEvent): LiveEvent {
    return this.push(event);
  }

  /**
   * Returns all events that occurred strictly after `lastEventId`.
   * If `lastEventId <= 0` or if the client missed events older than the buffer's retention,
   * returns all available events currently retained in the buffer.
   */
  public getEventsSince(lastEventId: number): LiveEvent[] {
    if (this.count === 0) {
      return [];
    }

    if (lastEventId <= 0) {
      return this.getAll();
    }

    const latestId = this.getLatestEventId();
    if (lastEventId >= latestId) {
      return [];
    }

    const oldestId = this.getOldestEventId();
    if (lastEventId < oldestId) {
      // Client's last seen event has already been evicted from the buffer.
      // Return all remaining retained events so the client receives maximum possible context.
      return this.getAll();
    }

    const result: LiveEvent[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacityLimit;
      const ev = this.ring[idx];
      if (ev && (ev.eventId ?? 0) > lastEventId) {
        result.push(ev);
      }
    }
    return result;
  }

  /**
   * Checks whether any events were evicted/dropped between the given lastEventId and
   * the oldest event currently retained in the buffer.
   */
  public hasDroppedEventsSince(lastEventId: number): boolean {
    if (this.count === 0 || lastEventId <= 0) {
      return false;
    }
    const oldestId = this.getOldestEventId();
    return lastEventId < oldestId;
  }

  /**
   * Returns a copy of all currently buffered events in chronological order.
   */
  public getAll(): LiveEvent[] {
    const result: LiveEvent[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacityLimit;
      const ev = this.ring[idx];
      if (ev) {
        result.push(ev);
      }
    }
    return result;
  }

  /**
   * Number of events currently in the buffer.
   */
  public size(): number {
    return this.count;
  }

  /**
   * Maximum capacity of the ring buffer.
   */
  public capacity(): number {
    return this.capacityLimit;
  }

  /**
   * Whether the buffer has reached maximum capacity.
   */
  public isFull(): boolean {
    return this.count >= this.capacityLimit;
  }

  /**
   * Highest eventId recorded so far, or 0 if buffer is empty.
   */
  public getLatestEventId(): number {
    if (this.count === 0) return 0;
    const lastIdx = (this.tail - 1 + this.capacityLimit) % this.capacityLimit;
    const ev = this.ring[lastIdx];
    return ev?.eventId ?? 0;
  }

  /**
   * Lowest eventId currently retained in the buffer, or 0 if buffer is empty.
   */
  public getOldestEventId(): number {
    if (this.count === 0) return 0;
    const ev = this.ring[this.head];
    return ev?.eventId ?? 0;
  }

  /**
   * Clears all stored events while preserving monotonic ID sequence progression.
   */
  public clear(): void {
    this.ring.fill(null);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
