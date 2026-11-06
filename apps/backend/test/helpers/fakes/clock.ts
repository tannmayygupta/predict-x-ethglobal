import type { Clock } from "../../../src/util/clock";

/** Matches the fixtures' timestamps so expiry maths in tests reads naturally. */
export const FAKE_CLOCK_START = 1_761_600_000;

export class FakeClock implements Clock {
  private current = FAKE_CLOCK_START;

  now(): number {
    return this.current;
  }

  set(seconds: number): void {
    this.current = seconds;
  }

  advance(seconds: number): void {
    this.current += seconds;
  }
}
