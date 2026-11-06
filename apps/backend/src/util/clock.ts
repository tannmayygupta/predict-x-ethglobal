/** Unix seconds. Injected everywhere so tests can freeze and advance time without sleeping. */
export interface Clock {
  now(): number;
}

const MS_PER_SECOND = 1000;

export const systemClock: Clock = {
  now: () => Math.floor(Date.now() / MS_PER_SECOND),
};
