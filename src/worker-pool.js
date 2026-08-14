import { createWorkerNode } from './adapter-node.js';
import { trackCleanup } from './cleanup.js';
import {
  workerError,
  messageError,
  unexpectedExitError,
  terminatedError,
  destroyedError
} from './errors.js';

/**
 * ThreadPool — a fixed set of persistent worker threads.
 *
 * Tasks are queued when every worker is busy and dispatched to the next
 * idle worker. Calling `terminate()` rejects every pending and queued task
 * with an `ERR_TERMINATED` error so no caller is ever left hanging.
 */
export class ThreadPool {
  constructor(workerScriptPath, size = 4) {
    if (typeof workerScriptPath !== 'string' || workerScriptPath.length === 0) {
      throw new TypeError('ThreadPool: workerScriptPath must be a non-empty string.');
    }
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError('ThreadPool: size must be a positive integer.');
    }
    this.workerScriptPath = workerScriptPath;
    this.size = size;
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.taskId = 0;
    this.callbacks = new Map();
    this.terminated = false;
    this._cleanup = trackCleanup(() => this._hardTerminate());
    this.init();
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      this._spawnWorker();
    }
  }

  _spawnWorker() {
    const worker = createWorkerNode(this.workerScriptPath);
    worker.pendingId = null;
    worker.onMessage((msg) => this.handleMessage(worker, msg));
    worker.onError((err) => this.handleWorkerFailure(worker, err));
    worker.onExit((code) => this.handleWorkerExit(worker, code));
    worker.onMessageError((cause) => this.handleMessageError(worker, cause));
    this.workers.push(worker);
    this.idleWorkers.push(worker);
  }

  handleMessage(worker, msg) {
    const { id, success, result, error, stack } = msg;
    worker.pendingId = null;
    const cb = this.callbacks.get(id);
    if (cb) {
      this.callbacks.delete(id);
      if (success) {
        cb.resolve(result);
      } else {
        cb.reject(workerError(error, stack));
      }
    }
    this.makeIdle(worker);
  }

  handleWorkerFailure(worker, err) {
    this._rejectPendingFor(worker, err);
    this._removeWorker(worker);
  }

  handleWorkerExit(worker, code) {
    if (worker.pendingId !== null) {
      this._rejectPendingFor(worker, unexpectedExitError(code));
    }
    this._removeWorker(worker);
  }

  handleMessageError(worker, cause) {
    this._rejectPendingFor(worker, messageError(cause));
    this._removeWorker(worker);
  }

  _rejectPendingFor(worker, err) {
    const id = worker.pendingId;
    worker.pendingId = null;
    if (id !== null) {
      const cb = this.callbacks.get(id);
      if (cb) {
        this.callbacks.delete(id);
        cb.reject(err);
      }
    }
  }

  _removeWorker(worker) {
    this.workers = this.workers.filter((w) => w !== worker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== worker);
    if (this.workers.length === 0 && this.queue.length > 0) {
      const err = new Error(
        `All worker threads in the pool have exited; ${this.queue.length} queued task(s) were never started.`
      );
      err.code = 'ERR_NO_WORKERS';
      for (const task of this.queue) {
        const cb = this.callbacks.get(task.id);
        if (cb) {
          this.callbacks.delete(task.id);
          cb.reject(err);
        }
      }
      this.queue = [];
    }
  }

  makeIdle(worker) {
    if (this.terminated) return;
    if (this.queue.length > 0) {
      this._dispatch(worker, this.queue.shift());
    } else {
      this.idleWorkers.push(worker);
    }
  }

  _dispatch(worker, task) {
    worker.pendingId = task.id;
    try {
      worker.postMessage(task);
    } catch (err) {
      worker.pendingId = null;
      this.idleWorkers.push(worker);
      const cb = this.callbacks.get(task.id);
      if (cb) {
        this.callbacks.delete(task.id);
        cb.reject(err);
      }
    }
  }

  /**
   * Executes the worker script in a separate thread.
   * @param {Array} args - Arguments to pass to the worker function.
   * @returns {Promise<any>}
   */
  async execute(args = []) {
    if (this.terminated) {
      throw destroyedError('ThreadPool');
    }
    if (this.workers.length === 0) {
      throw new Error('ThreadPool has no worker threads (all workers have exited). Create a new pool.');
    }
    return new Promise((resolve, reject) => {
      const id = ++this.taskId;
      this.callbacks.set(id, { resolve, reject });

      const task = { id, args };
      if (this.idleWorkers.length > 0) {
        this._dispatch(this.idleWorkers.pop(), task);
      } else {
        this.queue.push(task);
      }
    });
  }

  /**
   * Terminates all workers and rejects every pending/queued task.
   * Safe to call more than once.
   */
  async terminate() {
    if (this.terminated) return;
    const err = terminatedError('ThreadPool');
    for (const cb of this.callbacks.values()) cb.reject(err);
    this.callbacks.clear();
    this._hardTerminate();
    this._cleanup();
  }

  /**
   * Shutdown used by the global SIGINT/SIGTERM/uncaughtException cleanup:
   * terminates workers without rejecting pending promises (see cleanup.js).
   */
  _hardTerminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.queue = [];
    for (const worker of this.workers) {
      worker.pendingId = null;
      worker.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
  }
}