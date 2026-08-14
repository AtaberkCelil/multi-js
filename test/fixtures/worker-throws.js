import { defineWorker } from '../../src/index.js';

defineWorker(() => {
  throw new Error('boom-from-worker');
});