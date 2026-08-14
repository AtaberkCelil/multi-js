import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { trackCleanup } from './cleanup.js';
import {
  workerError,
  messageError,
  unexpectedExitError,
  terminatedError,
  destroyedError
} from './errors.js';

/**
 * AutoThreader — gives every task its own dedicated OS thread automatically.
 *
 * Each call to run() spawns a brand-new Worker, executes the task, then
 * terminates the thread. runAll() launches every task simultaneously,
 * respecting `maxConcurrent` (excess tasks are queued and start as slots
 * free up).
 *
 * runAll() uses `Promise.all` semantics: it rejects as soon as the first
 * task fails. Sibling tasks keep running to completion but their results
 * are discarded.
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
    if (typeof workerScriptPath !== 'string' || workerScriptPath.length === 0) {
      throw new TypeError('AutoThreader: workerScriptPath must be a non-empty string.');
    }
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError('AutoThreader: maxConcurrent must be a positive integer.');
    }
    this.workerScriptPath = workerScriptPath;
    this.maxConcurrent    = maxConcurrent;
    this._active          = new Set(); // workers currently running a task
    this._queue           = [];        // { args, resolve, reject }
    this._running         = 0;
    this._destroyed       = false;
    this._cleanup         = trackCleanup(() => this._hardDestroy());
  }

  /**
   * Spawn a fresh OS thread, execute the task, terminate the thread, return the result.
   * @param {Array} [args=[]] - Arguments forwarded to the worker function.
   * @returns {Promise<any>}
   */
  run(args = []) {
    if (this._destroyed) {
      return Promise.reject(destroyedError('AutoThreader'));
    }
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
   * Rejects fast on the first failing task (Promise.all semantics).
   * @param {Array<Array>} argsArray - Array of argument arrays.
   * @returns {Promise<Array<any>>}
   */
  runAll(argsArray = []) {
    return Promise.all(argsArray.map((args) => this.run(args)));
  }

  /**
   * Terminate any threads still running and reject all pending/queued tasks.
   * Safe to call more than once.
   */
  destroy() {
    this._destroyed = true;
    const err = terminatedError('AutoThreader');
    for (const task of this._queue) task.reject(err);
    this._queue = [];
    for (const worker of this._active) {
      if (worker.task) worker.task.reject(err);
      this._finish(worker);
    }
    this._running = 0;
    this._cleanup();
  }

  /**
   * Shutdown used by the global SIGINT/SIGTERM/uncaughtException cleanup:
   * terminates workers without rejecting pending promises (see cleanup.js).
   */
  _hardDestroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._queue = [];
    for (const worker of this._active) {
      this._finish(worker);
    }
    this._running = 0;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _spawnWorker(task) {
    this._running++;
    const worker = new Worker(this.workerScriptPath);
    worker.task = task;
    this._active.add(worker);

    // Use id=1 — each worker handles exactly one message
    worker.once('message', (msg) => {
      this._finish(worker);
      if (msg.success) {
        task.resolve(msg.result);
      } else {
        task.reject(workerError(msg.error, msg.stack));
      }
    });

    worker.once('error', (err) => {
      this._finish(worker);
      task.reject(err);
    });

    worker.once('exit', (code) => {
      if (!worker.done) {
        this._finish(worker);
        task.reject(unexpectedExitError(code));
      }
    });

    worker.once('messageerror', (cause) => {
      if (!worker.done) {
        this._finish(worker);
        task.reject(messageError(cause));
      }
    });

    try {
      worker.postMessage({ id: 1, args: task.args });
    } catch (err) {
      if (!worker.done) {
        this._finish(worker);
        task.reject(err);
      }
    }
  }

  _finish(worker) {
    worker.done = true;
    worker.task = null;
    this._active.delete(worker);
    worker.terminate().catch(() => {});
    if (this._running > 0) this._running--;
    // Drain the queue now that a slot freed up
    if (!this._destroyed && this._queue.length > 0) {
      this._spawnWorker(this._queue.shift());
    }
  }
}