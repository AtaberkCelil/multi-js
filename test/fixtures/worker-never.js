import { defineWorker } from '../../src/index.js';

// Never responds — used to test that terminate()/destroy() unblocks pending tasks.
defineWorker(() => {
  while (true) {
    // busy-loop forever
  }
});