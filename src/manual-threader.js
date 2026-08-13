import { Worker } from 'node:worker_threads';

/**
 * ManualThreader — you name your threads and decide exactly which thread runs which task.
 *
 * Threads are persistent (no spawn cost per task). Use runOn() to route work to a
 * specific thread, runOnMany() to fan-out to several, and broadcast() to hit them all.
 *
 * @example
 * const mt = new ManualThreader('./my-worker.js');
 * mt.createThread('alpha');
 * mt.createThread('beta');
 * mt.createThread('gamma', './other-worker.js'); // different script per thread
 *
 * const r1      = await mt.runOn('alpha', [1, 2]);
 * const results = await mt.runOnMany(['alpha', 'beta'], [10]);
 * const all     = await mt.broadcast([99]);
 *
 * console.log(mt.listThreads()); // ['alpha', 'beta', 'gamma']
 * mt.removeThread('gamma');
 * mt.destroy();
 */
export class ManualThreader {
  /**
   * @param {string} [defaultScriptPath] - Default worker script for createThread() calls
   *                                       that don't specify their own script.
   */
  constructor(defaultScriptPath) {
    this._defaultScript = defaultScriptPath;
    this._threads       = new Map(); // name → { worker, callbacks, taskId }
  }

  /**
   * Create a persistent named OS thread.
   * @param {string} name           - Unique name for this thread.
   * @param {string} [scriptPath]   - Worker script (falls back to the constructor default).
   * @returns {this}
   */
  createThread(name, scriptPath) {
    if (this._threads.has(name)) {
      throw new Error(`Thread "${name}" already exists.`);
    }
    const script = scriptPath || this._defaultScript;
    if (!script) {
      throw new Error(
        `No worker script provided for thread "${name}" and no default was set.`
      );
    }

    const worker = new Worker(script);
    const state  = { worker, callbacks: new Map(), taskId: 0 };

    worker.on('message', (msg) => {
      const cb = state.callbacks.get(msg.id);
      if (!cb) return;
      state.callbacks.delete(msg.id);
      if (msg.success) {
        cb.resolve(msg.result);
      } else {
        const err = new Error(msg.error);
        if (msg.stack) err.stack = msg.stack;
        cb.reject(err);
      }
    });

    worker.on('error', (err) => {
      // Reject every pending task on this thread
      for (const cb of state.callbacks.values()) cb.reject(err);
      state.callbacks.clear();
    });

    this._threads.set(name, state);
    return this;
  }

  /**
   * Run a task on a specific named thread.
   * @param {string} name   - Thread name (must have been created with createThread).
   * @param {Array}  [args] - Arguments forwarded to the worker function.
   * @returns {Promise<any>}
   */
  runOn(name, args = []) {
    const state = this._getThread(name);
    return new Promise((resolve, reject) => {
      const id = ++state.taskId;
      state.callbacks.set(id, { resolve, reject });
      state.worker.postMessage({ id, args });
    });
  }

  /**
   * Run the same task on several named threads in parallel.
   * Returns an array of results in the same order as `names`.
   * @param {string[]} names - Thread names.
   * @param {Array}    [args]
   * @returns {Promise<any[]>}
   */
  runOnMany(names, args = []) {
    return Promise.all(names.map(name => this.runOn(name, args)));
  }

  /**
   * Run the same task on EVERY named thread simultaneously.
   * Returns an object { threadName: result, … }.
   * @param {Array} [args]
   * @returns {Promise<Object>}
   */
  async broadcast(args = []) {
    const names   = [...this._threads.keys()];
    const results = await Promise.all(names.map(name => this.runOn(name, args)));
    return Object.fromEntries(names.map((name, i) => [name, results[i]]));
  }

  /**
   * Returns an array of all currently registered thread names.
   * @returns {string[]}
   */
  listThreads() {
    return [...this._threads.keys()];
  }

  /**
   * Terminate and remove a specific named thread.
   * @param {string} name
   * @returns {this}
   */
  removeThread(name) {
    const state = this._getThread(name);
    state.worker.terminate();
    this._threads.delete(name);
    return this;
  }

  /**
   * Terminate all threads and clean up.
   */
  destroy() {
    for (const state of this._threads.values()) {
      state.worker.terminate();
    }
    this._threads.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _getThread(name) {
    const state = this._threads.get(name);
    if (!state) throw new Error(`Thread "${name}" does not exist. Did you call createThread("${name}")?`);
    return state;
  }
}
