import { defineWorker } from '../../src/index.js';

defineWorker((val1, val2) => {
  if (val2 !== undefined) {
    return val1 + val2; // Logic for runTask
  }
  return val1 * 2; // Logic for ThreadPool
});