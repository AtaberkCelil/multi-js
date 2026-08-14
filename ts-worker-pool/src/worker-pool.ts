import { availableParallelism, createThread } from './channel.js';
import {
  errorFromDetail,
  PoolDestroyedError,
  TaskRejectedError,
  TaskTimeoutError,
  TransferFailedError,
  WorkerCrashedError,
  WorkerPoolError,
  WorkerSpawnError
} from './errors.js';
import { collectTransferables } from './transferable.js';
import type {
  PendingTask,
  PoolStats,
  ReplyMessage,
  TaskMessage,
  TaskOptions,
  ThreadLike,
  WorkerPoolOptions
} from './types.js';

interface ManagedThread {
  thread: ThreadLike;
  taskId: number | null;
  killed: boolean;
}

/**
 * WorkerPool — a self-healing pool of worker threads.
 *
 * - Grows dynamically up to `size` workers (default: CPU core count). Workers
 *   are spawned on demand and reused.
 * - Tasks are queued when every worker is busy and dispatched to the next
 *   idle worker.
 * - Per-task timeouts abort stuck tasks by terminating the responsible worker
 *   and spawning a replacement, so a dead worker never blocks the pool.
 * - Worker crashes, unhandled rejections and structured-clone failures are
 *   captured and surfaced as typed errors; the pool heals itself by respawning.
 * - Transferable buffers (ArrayBuffer, TypedArray) move between threads with
 *   zero copying via the `transferred()` wrapper or TaskOptions.transfer.
 * - destroy() terminates every worker and rejects all pending tasks.
 */
export class WorkerPool {
  readonly workerURL: string | URL;
  readonly taskTimeoutMs: number | undefined;

  private maxSize: number | null;
  private readonly sizeResolution: Promise<number>;
  private threads: ManagedThread[] = [];
  private idle: ManagedThread[] = [];
  private queue: PendingTask[] = [];
  private pending = new Map<number, PendingTask>();
  private pendingSpawns = 0;
  private nextTaskId = 1;
  private destroyed = false;
  private destroyPromise: Promise<void> | null = null;

  constructor(workerURL: string | URL, options: WorkerPoolOptions = {}) {
    const validURL =
      typeof workerURL === 'string'
        ? workerURL.length > 0
        : workerURL instanceof URL;
    if (!validURL) {
      throw new TypeError('WorkerPool: workerURL must be a non-empty string or a URL.');
    }
    if (
      options.size !== undefined &&
      (!Number.isInteger(options.size) || options.size < 1)
    ) {
      throw new RangeError('WorkerPool: options.size must be a positive integer.');
    }
    if (
      options.taskTimeoutMs !== undefined &&
      (!Number.isFinite(options.taskTimeoutMs) || options.taskTimeoutMs <= 0)
    ) {
      throw new RangeError('WorkerPool: options.taskTimeoutMs must be a positive number.');
    }
    this.workerURL = workerURL;
    this.maxSize = options.size ?? null;
    this.taskTimeoutMs = options.taskTimeoutMs;
    this.sizeResolution =
      options.size !== undefined
        ? Promise.resolve(options.size)
        : availableParallelism();
  }

  private async resolveSize(): Promise<number> {
    if (this.maxSize === null) {
      this.maxSize = await this.sizeResolution;
    }
    return this.maxSize;
  }

  get stats(): PoolStats {
    const alive = this.threads.length;
    return {
      size: this.maxSize ?? -1,
      alive,
      busy: alive - this.idle.length,
      idle: this.idle.length,
      queued: this.queue.length,
      pending: this.pending.size,
      pendingSpawns: this.pendingSpawns,
      destroyed: this.destroyed
    };
  }

  /**
   * Submits a task to the pool. Resolves with the worker's return value,
   * rejects with a typed WorkerPoolError on failure.
   */
  submit<T = unknown>(args: unknown[] = [], options: TaskOptions = {}): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new PoolDestroyedError());
    }
    const { args: cleanArgs, transfer } = collectTransferables(args);
    const timeoutMs = options.timeoutMs ?? this.taskTimeoutMs;
    if (options.transfer !== undefined) {
      transfer.push(...options.transfer);
    }
    return new Promise<T>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextTaskId++,
        args: cleanArgs,
        transfer,
        timeoutMs,
        timer: undefined,
        resolve: (value: unknown) => resolve(value as T),
        reject
      };
      this.pending.set(task.id, task);
      if (timeoutMs !== undefined) {
        task.timer = setTimeout(() => this.handleTimeout(task), timeoutMs);
      }
      void this.dispatch(task);
    });
  }

  /** Runs every task in `tasks` through the pool and resolves with all results (fail-fast). */
  async map<T = unknown>(tasks: unknown[][], options: TaskOptions = {}): Promise<T[]> {
    return Promise.all(tasks.map((args) => this.submit<T>(args, options)));
  }

  /** Pre-spawns workers up to the pool size so the first tasks start instantly. */
  async warmUp(): Promise<void> {
    if (this.destroyed) return;
    const size = await this.resolveSize();
    while (this.threads.length + this.pendingSpawns < size) {
      const spawned = await this.spawnThread();
      if (spawned === null) return;
      const task = this.queue.shift();
      if (task) this.runOn(spawned, task);
      else this.idle.push(spawned);
    }
  }

  /**
   * Destroys the pool: rejects every pending/queued task with
   * PoolDestroyedError and terminates all workers. Idempotent.
   */
  destroy(): Promise<void> {
    if (this.destroyPromise !== null) {
      return this.destroyPromise;
    }
    this.destroyPromise = (async () => {
      if (this.destroyed) return;
      this.destroyed = true;
      const error = new PoolDestroyedError();
      for (const task of [...this.queue]) this.settleTask(task, error);
      this.queue = [];
      for (const task of [...this.pending.values()]) this.settleTask(task, error);
      const workers = [...this.threads];
      this.threads = [];
      this.idle = [];
      for (const worker of workers) {
        worker.killed = true;
        worker.taskId = null;
      }
      await Promise.allSettled(workers.map((worker) => worker.thread.terminate()));
    })();
    return this.destroyPromise;
  }

  /** Alias of destroy(). */
  terminate(): Promise<void> {
    return this.destroy();
  }

  private async dispatch(task: PendingTask): Promise<void> {
    if (this.destroyed) {
      this.settleTask(task, new PoolDestroyedError());
      return;
    }
    const worker = this.idle.pop();
    if (worker !== undefined) {
      this.runOn(worker, task);
      return;
    }
    if (this.threads.length + this.pendingSpawns >= (await this.resolveSize())) {
      this.queue.push(task);
      return;
    }
    try {
      const spawned = await this.spawnThread();
      if (spawned === null) return; // pool destroyed while spawning
      if (this.pending.has(task.id)) {
        this.runOn(spawned, task);
      } else {
        // The task timed out while the thread was being spawned.
        this.idle.push(spawned);
      }
    } catch (err) {
      this.settleTask(
        task,
        err instanceof WorkerPoolError ? err : new WorkerSpawnError(err)
      );
    }
  }

  private async spawnThread(): Promise<ManagedThread | null> {
    this.pendingSpawns += 1;
    try {
      const thread = await createThread(this.workerURL);
      if (this.destroyed) {
        await thread.terminate();
        return null;
      }
      const managed: ManagedThread = { thread, taskId: null, killed: false };
      this.threads.push(managed);
      this.attachHandlers(managed);
      return managed;
    } finally {
      this.pendingSpawns -= 1;
    }
  }

  private async spawnReplacement(): Promise<void> {
    if (this.destroyed) return;
    try {
      const spawned = await this.spawnThread();
      if (spawned === null) return;
      const task = this.queue.shift();
      if (task !== undefined) this.runOn(spawned, task);
      else this.idle.push(spawned);
    } catch {
      // Pool temporarily shrinks; the next dispatch retries spawning.
    }
  }

  private attachHandlers(worker: ManagedThread): void {
    const { thread } = worker;
    thread.onMessage((raw) => this.handleMessage(worker, raw));
    thread.onError((err) => this.handleWorkerError(worker, err));
    thread.onExit((code) => this.handleWorkerExit(worker, code));
    thread.onMessageError((cause) => this.handleMessageError(worker, cause));
  }

  private runOn(worker: ManagedThread, task: PendingTask): void {
    if (this.destroyed || !this.pending.has(task.id)) {
      this.idle.push(worker);
      return;
    }
    worker.taskId = task.id;
    const message: TaskMessage = { type: 'task', id: task.id, args: task.args };
    try {
      worker.thread.postMessage(message, task.transfer);
    } catch (err) {
      worker.taskId = null;
      this.settleTask(task, new TransferFailedError(err));
      this.replaceWorker(worker);
    }
  }

  private handleMessage(worker: ManagedThread, raw: unknown): void {
    const msg = raw as Partial<ReplyMessage>;
    if (msg === null || typeof msg !== 'object') return;

    if (msg.type === 'ok' && typeof msg.id === 'number') {
      const task = this.pending.get(msg.id);
      if (task !== undefined) this.settleTask(task, undefined, msg.value);
      this.makeIdle(worker);
      return;
    }

    if (msg.type === 'err' && typeof msg.id === 'number' && msg.error !== undefined) {
      const task = this.pending.get(msg.id);
      if (task !== undefined) this.settleTask(task, new TaskRejectedError(msg.error));
      this.makeIdle(worker);
      return;
    }

    if (msg.type === 'crash' && msg.error !== undefined) {
      const task = typeof msg.id === 'number' ? this.pending.get(msg.id) : undefined;
      if (task !== undefined) this.settleTask(task, errorFromDetail(msg.error));
      this.replaceWorker(worker);
    }
  }

  private makeIdle(worker: ManagedThread): void {
    worker.taskId = null;
    if (this.destroyed) return;
    const task = this.queue.shift();
    if (task !== undefined) this.runOn(worker, task);
    else this.idle.push(worker);
  }

  private handleWorkerError(worker: ManagedThread, error: Error): void {
    if (worker.killed || this.destroyed) return;
    this.failWorker(worker, new WorkerCrashedError(error));
  }

  private handleWorkerExit(worker: ManagedThread, code: number | null): void {
    if (worker.killed || this.destroyed) return;
    this.failWorker(
      worker,
      new WorkerCrashedError(new Error(`Worker exited unexpectedly with code ${String(code)}.`))
    );
  }

  private handleMessageError(worker: ManagedThread, cause: Error): void {
    if (worker.killed || this.destroyed) return;
    this.failWorker(worker, new TransferFailedError(cause));
  }

  private failWorker(worker: ManagedThread, error: WorkerPoolError): void {
    if (worker.taskId !== null) {
      const task = this.pending.get(worker.taskId);
      if (task !== undefined) this.settleTask(task, error);
      worker.taskId = null;
    }
    this.detach(worker);
    void this.spawnReplacement();
  }

  private replaceWorker(worker: ManagedThread): void {
    this.detach(worker);
    void this.spawnReplacement();
  }

  private detach(worker: ManagedThread): void {
    worker.killed = true;
    worker.taskId = null;
    this.threads = this.threads.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    void worker.thread.terminate();
  }

  private handleTimeout(task: PendingTask): void {
    if (!this.pending.has(task.id)) return;
    this.settleTask(task, new TaskTimeoutError(task.timeoutMs ?? 0));
    const worker = this.threads.find((w) => w.taskId === task.id);
    if (worker !== undefined) {
      // The worker may be stuck in an infinite loop — kill it and respawn.
      this.replaceWorker(worker);
    } else {
      const index = this.queue.indexOf(task);
      if (index >= 0) this.queue.splice(index, 1);
    }
  }

  private settleTask(task: PendingTask, error?: Error, value?: unknown): void {
    if (!this.pending.delete(task.id)) return;
    if (task.timer !== undefined) clearTimeout(task.timer);
    if (error !== undefined) task.reject(error);
    else task.resolve(value);
  }
}
