import { AutoThreader } from '../../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same idea as exit-child-sigterm-pool.mjs, but with AutoThreader.
const auto = new AutoThreader(path.join(__dirname, 'worker-never.js'), { maxConcurrent: 1 });
auto.run([1]);

setTimeout(() => process.emit('SIGTERM'), 200);