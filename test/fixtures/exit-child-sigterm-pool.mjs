import { ThreadPool } from '../../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A pool with a worker that never responds, and a fire-and-forget task.
// The child must still exit cleanly when SIGTERM arrives — nothing is
// terminated explicitly.
const pool = new ThreadPool(path.join(__dirname, 'worker-never.js'), 1);
pool.execute([1]);

setTimeout(() => process.emit('SIGTERM'), 200);