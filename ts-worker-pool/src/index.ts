import { WorkerPool } from './worker-pool.js';
import type { TaskOptions } from './types.js';

export { WorkerPool };
export { createWorkerEntry } from './worker-entry.js';
export {
  Transferred,
  isTransferred,
  transferred,
  collectTransferables,
  createSharedBuffer,
  sharedFloat64Array
} from './transferable.js';
export {
  WorkerPoolError,
  errorFromDetail,
  serializeError,
  TaskRejectedError,
  TaskTimeoutError,
  WorkerCrashedError,
  TransferFailedError,
  PoolDestroyedError,
  NotInWorkerError,
  WorkerSpawnError
} from './errors.js';
export { availableParallelism, createThread, isNodeEnvironment } from './channel.js';

export type {
  WorkerPoolOptions,
  TaskOptions,
  PoolStats,
  TaskMessage,
  ReplyMessage,
  OkReply,
  ErrReply,
  CrashMessage,
  SerializedError,
  ThreadLike,
  WorkerHandler,
  TransferList
} from './types.js';

/**
 * One-shot convenience: spawns a single worker, runs one task, then destroys
 * the pool. Best for infrequent heavy computations.
 */
export async function runTask<T = unknown>(
  workerURL: string | URL,
  args: unknown[] = [],
  options: TaskOptions = {}
): Promise<T> {
  const pool = new WorkerPool(workerURL, {
    size: 1,
    taskTimeoutMs: options.timeoutMs
  });
  try {
    return await pool.submit<T>(args, options);
  } finally {
    await pool.destroy();
  }
}
