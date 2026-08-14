import { parentPort } from 'node:worker_threads';

// Simulates an externally-crashed/killed worker: it exits before ever replying.
parentPort.on('message', () => {
  process.exit(1);
});