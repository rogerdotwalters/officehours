/**
 * Per-connection token-bucket rate limiter.
 * Each message type has its own bucket; '*' is a global bucket for everything.
 */
import { C2S } from '../../shared/protocol.js';

// capacity = burst size, refill = tokens per second
export const DEFAULT_LIMITS = {
  '*':                   { capacity: 60, refill: 40 },
  [C2S.JOIN]:            { capacity: 2,  refill: 0.2 },
  [C2S.INPUT]:           { capacity: 30, refill: 25 },
  [C2S.INTERACT]:        { capacity: 4,  refill: 2 },
  [C2S.CANCEL]:          { capacity: 4,  refill: 2 },
  [C2S.REPORT]:          { capacity: 2,  refill: 0.2 },
  [C2S.VOTE]:            { capacity: 3,  refill: 0.5 },
  [C2S.CHAT]:            { capacity: 5,  refill: 0.7 },
  [C2S.SETTINGS]:        { capacity: 10, refill: 4 },
  [C2S.DESK_CHECK]:      { capacity: 2,  refill: 0.2 },
  [C2S.READY]:           { capacity: 4,  refill: 1 },
  [C2S.START]:           { capacity: 3,  refill: 0.5 },
  [C2S.RETURN_TO_LOBBY]: { capacity: 3,  refill: 0.5 },
  [C2S.PING]:            { capacity: 3,  refill: 1 },
};

export class RateLimiter {
  constructor(limits = DEFAULT_LIMITS) {
    this.limits = limits;
    this.buckets = new Map();
  }

  #take(key, now) {
    const rule = this.limits[key];
    if (!rule) return true;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: rule.capacity, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(rule.capacity, b.tokens + ((now - b.at) / 1000) * rule.refill);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Returns 'ok', 'drop' (this type is too fast) or 'flood' (everything is too fast). */
  check(type, now) {
    if (!this.#take('*', now)) return 'flood';
    return this.#take(type, now) ? 'ok' : 'drop';
  }
}
