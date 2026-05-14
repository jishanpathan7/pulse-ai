/**
 * Reconnect backoff strategies.
 *
 * ExponentialBackoff uses "full jitter" (AWS recommendation):
 *   delay = random(0, min(cap, base * 2^attempt))
 *
 * Full jitter distributes retries uniformly across the interval,
 * preventing thundering herd where many clients reconnect simultaneously
 * after a server restart.
 *
 * Reference: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

export interface BackoffStrategy {
  nextDelayMs(attempt: number): number;
  reset(): void;
}

export interface BackoffConfig {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly multiplier: number;
}

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseMs: 250,
  maxMs: 30_000,
  multiplier: 2,
};

export class ExponentialBackoff implements BackoffStrategy {
  private readonly config: BackoffConfig;

  constructor(config: BackoffConfig = DEFAULT_BACKOFF_CONFIG) {
    this.config = config;
  }

  /**
   * Full jitter exponential backoff.
   * attempt=0 → random(0, 250ms)
   * attempt=1 → random(0, 500ms)
   * attempt=2 → random(0, 1000ms)
   * ...capped at maxMs
   */
  nextDelayMs(attempt: number): number {
    const exponential = this.config.baseMs * Math.pow(this.config.multiplier, attempt);
    const cap = Math.min(this.config.maxMs, exponential);
    return Math.floor(Math.random() * cap);
  }

  reset(): void {
    // Stateless — nothing to reset. Method exists to satisfy interface.
  }
}

/** No-jitter linear backoff — for testing only. */
export class LinearBackoff implements BackoffStrategy {
  constructor(private readonly stepMs: number = 100) {}

  nextDelayMs(attempt: number): number {
    return this.stepMs * (attempt + 1);
  }

  reset(): void {}
}

/** Zero-delay backoff — for testing only. */
export class ImmediateBackoff implements BackoffStrategy {
  nextDelayMs(_attempt: number): number {
    return 0;
  }

  reset(): void {}
}
