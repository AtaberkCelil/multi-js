import { createWorkerNode } from './adapter-node.js';

export class ThreadPool {
  constructor(workerScriptPath, size = 4) {
    this.workerScriptPath = workerScriptPath;
    this.size = size;
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.taskId = 0;
    this.callbacks = new Map();
    this.init();
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      const worker = createWorkerNode(this.workerScriptPath);
      worker.onMessage((msg) => this.handleMessage(worker, msg));
      worker.onError((err) => this.handleError(worker, err));
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  handleMessage(worker, msg) {
    const { id, success, result, error, stack } = msg;
    const cb = this.callbacks.get(id);
    if (cb) {
      this.callbacks.delete(id);
      if (success) {
        cb.resolve(result);
      } else {
        const err = new Error(error);
        if (stack) err.stack = stack;
        cb.reject(err);
      }
    }
    this.makeIdle(worker);
  }

  handleError(worker, err) {
    console.error('Worker encountered an error:', err);
    this.workers = this.workers.filter(w => w !== worker);
    this.idleWorkers = this.idleWorkers.filter(w => w !== worker);
  }

  makeIdle(worker) {
    if (this.queue.length > 0) {
      const task = this.queue.shift();
      worker.postMessage(task);
    } else {
      this.idleWorkers.push(worker);
    }
  }

  /**
   * Executes the worker script in a separate thread.
   * @param {Array} args - Arguments to pass to the worker function.
   * @returns {Promise<any>}
   */
  async execute(args = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.taskId;
      this.callbacks.set(id, { resolve, reject });
      
      const task = { id, args };
      if (this.idleWorkers.length > 0) {
        const worker = this.idleWorkers.pop();
        worker.postMessage(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  /**
   * Terminates all workers in the pool.
   */
  async terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
  }
}
