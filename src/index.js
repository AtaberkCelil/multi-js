import { ThreadPool } from './worker-pool.js';
import { AutoThreader } from './auto-threader.js';
import { ManualThreader } from './manual-threader.js';
import { parentPort } from 'node:worker_threads';

/**
 * Helper to define the worker's logic inside the worker file.
 * @param {Function} fn - The function to execute.
 */
export function defineWorker(fn) {
  if (!parentPort) {
    throw new Error('defineWorker must be called inside a worker thread.');
  }

  parentPort.on('message', async (msg) => {
    try {
      const result = await fn(...msg.args);
      parentPort.postMessage({ id: msg.id, success: true, result });
    } catch (error) {
      parentPort.postMessage({ id: msg.id, success: false, error: error.message, stack: error.stack });
    }
  });
}

/**
 * Runs a task in a background thread and returns a Promise.
 * @param {string} workerScriptPath - Path to the worker script file.
 * @param {Array} args - Arguments for the function.
 * @returns {Promise<any>}
 */
export async function runTask(workerScriptPath, args = []) {
  const pool = new ThreadPool(workerScriptPath, 1);
  try {
    return await pool.execute(args);
  } finally {
    await pool.terminate();
  }
}

export { ThreadPool, AutoThreader, ManualThreader };
