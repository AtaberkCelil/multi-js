import { ManualThreader } from '../../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same idea as exit-child-sigterm-pool.mjs, but with ManualThreader.
const mt = new ManualThreader(path.join(__dirname, 'worker-never.js'));
mt.createThread('stuck');
mt.runOn('stuck', [1]);

setTimeout(() => process.emit('SIGTERM'), 200);