// When things happen, in seconds of the film. The scenes overlap a little: one leaves while the next comes in.

export const DURATION = 64;

export const SCENES = {
  hook: [0, 8.3],
  title: [7.9, 13.5],
  reap: [13.2, 24.4],
  wake: [24.1, 35.5],
  awake: [35.2, 44.4],
  savings: [44.1, 52.9],
  features: [52.6, 58.4],
  end: [58.1, DURATION],
};

// the week the hook replays
export const LAPSE = [1.3, 6.9];

// the first app put to sleep, then the scythe through the idle ones
export const REAP = { going: 17.5, down: 18.6, slash: [19.35, 20.05] };

// the request that wakes the first app up
export const WAKE = { hit: 26.2, boot: [26.5, 30.6], up: 30.6 };

// the fleet wakes back up for the hook, as the loop starts again
export const LOOP = [62.3, 63.15];
