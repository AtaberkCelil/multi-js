import { defineWorker } from '../../src/index.js';

defineWorker((val, delayMs = 250, shouldThrow = false) => {
  if (shouldThrow) {
    throw new Error('slow-boom');
  }
  const end = Date.now() + delayMs;
  while (Date.now() < end) {
    // busy-wait so the thread is genuinely occupied
  }
  return val;
});