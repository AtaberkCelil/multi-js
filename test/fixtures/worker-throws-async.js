import { defineWorker } from '../../src/index.js';

defineWorker(async () => {
  throw new Error('async-boom-from-worker');
});