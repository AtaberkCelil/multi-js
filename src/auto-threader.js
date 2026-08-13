import { Worker } from 'node:worker_threads';
import os from 'node:os';

/**
 * AutoThreader — gives every task its own dedicated OS thread automatically.
 *
 * Each call to run() spawns a brand-new Worker, executes the task, then
 * terminates the thread. runAll() launches every task simultaneously.
 *
 * @example
 * const threader = new AutoThreader('./my-worker.js');
 * const result  = await threader.run([1, 2]);
 * const results = await threader.runAll([[1,2], [3,4], [5,6]]);
 * threader.destroy();
 */
export class AutoThreader {
  /**
   * @param {string} workerScriptPath  - Path to the worker script file.
   * @param {object} [options]
   * @param {number} [options.maxConcurrent] - Max simultaneous threads (default: CPU count × 2).
   */
  constructor(workerScriptPath, { maxConcurrent = os.cpus().length * 2 } = {}) {
    this.workerScriptPath = workerScriptPath;
    this.maxConcurrent    = maxConcurrent;
    this._active          = new Set();
    this._queue           = [];
    this._running         = 0;
  }

  /**
   * Spawn a fresh OS thread, execute the task, terminate the thread, return the result.
   * @param {Array} [args=[]] - Arguments forwarded to the worker function.
   * @returns {Promise<any>}
   */
  run(args = []) {
    return new Promise((resolve, reject) => {
      const task = { args, resolve, reject };
      if (this._running < this.maxConcurrent) {
        this._spawnWorker(task);
      } else {
        // Queue and wait for a slot to open
        this._queue.push(task);
      }
    });
  }

  /**
   * Run every task simultaneously — each on its own dedicated thread.
   * Tasks beyond maxConcurrent are queued and start as slots free up.
   * @param {Array<Array>} argsArray - Array of argument arrays.
   * @returns {Promise<Array<any>>}
   */
  runAll(argsArray = []) {
    return Promise.all(argsArray.map(args => this.run(args)));
  }

  /**
   * Terminate any threads still running (e.g. after an error or early exit).
   */
  destroy() {
    for (const worker of this._active) {
      worker.terminate();
    }
    this._active.clear();
    this._running = 0;
    this._queue   = [];
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _spawnWorker({ args, resolve, reject }) {
    this._running++;
    const worker = new Worker(this.workerScriptPath);
    this._active.add(worker);

    // Use id=1 — each worker handles exactly one message
    worker.postMessage({ id: 1, args });

    worker.once('message', (msg) => {
      this._finish(worker);
      if (msg.success) {
        resolve(msg.result);
      } else {
        const err = new Error(msg.error);
        if (msg.stack) err.stack = msg.stack;
        reject(err);
      }
    });

    worker.once('error', (err) => {
      this._finish(worker);
      reject(err);
    });
  }

  _finish(worker) {
    this._active.delete(worker);
    worker.terminate();
    this._running--;
    // Drain the queue now that a slot freed up
    if (this._queue.length > 0) {
      this._spawnWorker(this._queue.shift());
    }
  }
}
