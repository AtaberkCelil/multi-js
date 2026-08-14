import { defineWorker } from '../../src/index.js';

defineWorker(({ sab, offset = 0, delayMs = 150 }) => {
  // [0] = currently active tasks, [1] = peak concurrency ever observed
  const counts = new Uint32Array(sab, offset, 2);
  const active = Atomics.add(counts, 0, 1) + 1;
  let cur = Atomics.load(counts, 1);
  while (active > cur && !Atomics.compareExchange(counts, 1, cur, active)) {
    cur = Atomics.load(counts, 1);
  }
  const end = Date.now() + delayMs;
  while (Date.now() < end) {
    // busy-wait
  }
  Atomics.sub(counts, 0, 1);
  return Atomics.load(counts, 1);
});