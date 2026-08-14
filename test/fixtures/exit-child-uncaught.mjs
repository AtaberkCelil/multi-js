import { ThreadPool } from '../../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A pool with a never-responding worker plus a main-thread crash. Workers
// must be cleaned up so the process exits with the crash (code 1) instead
// of hanging with dangling threads.
const pool = new ThreadPool(path.join(__dirname, 'worker-never.js'), 1);
pool.execute([1]);

setTimeout(() => {
  throw new Error('boom-main-thread');
}, 200);