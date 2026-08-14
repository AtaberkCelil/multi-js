import type { SerializedError } from './types.js';

/**
 * Base class for every error thrown by the pool. Every instance carries a
 * stable machine-readable `code` so callers can branch on failure modes.
 */
export class WorkerPoolError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Rebuilds a plain error object from its serialized form (used for worker-reported errors). */
export function errorFromDetail(detail: SerializedError): Error {
  const error = new Error(detail.message);
  error.name = detail.name;
  if (detail.stack !== undefined) error.stack = detail.stack;
  if (detail.code !== undefined) {
    (error as Error & { code?: string }).code = detail.code;
  }
  return error;
}

export function serializeError(value: unknown): SerializedError {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: (value as Error & { code?: string }).code
    };
  }
  const message =
    typeof value === 'string' ? value : `Non-Error value thrown: ${String(value)}`;
  return { name: 'Error', message };
}

/** The handler inside the worker threw / rejected; original message and stack are preserved. */
export class TaskRejectedError extends WorkerPoolError {
  constructor(detail: SerializedError) {
    super(detail.code ?? 'ERR_TASK_REJECTED', detail.message);
    if (detail.stack !== undefined) this.stack = detail.stack;
  }
}

/** A task did not finish within its timeout and was aborted. */
export class TaskTimeoutError extends WorkerPoolError {
  constructor(timeoutMs: number) {
    super(
      'ERR_TASK_TIMEOUT',
      `Task exceeded the ${timeoutMs} ms timeout and was aborted.`
    );
  }
}

/** A worker crashed (error/exit/messageerror) while a task was running. */
export class WorkerCrashedError extends WorkerPoolError {
  constructor(cause: unknown) {
    super(
      'ERR_WORKER_CRASHED',
      'Worker thread crashed or exited unexpectedly while a task was running.',
      { cause }
    );
  }
}

/** postMessage failed — typically a DataCloneError or an invalid transfer list. */
export class TransferFailedError extends WorkerPoolError {
  constructor(cause: unknown) {
    super(
      'ERR_TRANSFER_FAILED',
      'Failed to post the task message to the worker thread.',
      { cause }
    );
  }
}

/** The pool was destroyed; pending and future tasks are rejected with this. */
export class PoolDestroyedError extends WorkerPoolError {
  constructor() {
    super(
      'ERR_POOL_DESTROYED',
      'The worker pool has been destroyed; create a new pool to run more tasks.'
    );
  }
}

/** createWorkerEntry() was called outside a worker thread. */
export class NotInWorkerError extends WorkerPoolError {
  constructor() {
    super(
      'ERR_NOT_IN_WORKER',
      'createWorkerEntry() can only be called inside a worker thread.'
    );
  }
}

/** Spawning a worker thread failed. */
export class WorkerSpawnError extends WorkerPoolError {
  constructor(cause: unknown) {
    super(
      'ERR_WORKER_SPAWN',
      'Failed to spawn a worker thread.',
      { cause }
    );
  }
}
