/**
 * Shared error factories so that every threading class reports failures in
 * the exact same way.
 *
 * Error codes:
 * - `ERR_WORKER_MESSAGEERROR`  — receiving side failed to deserialize a
 *   message from a worker (structured-clone failure). `cause` holds the
 *   original error.
 * - `ERR_WORKER_UNEXPECTED_EXIT` — a worker exited while a task was pending.
 * - `ERR_TERMINATED` — the instance (or named thread) was terminated before
 *   the task completed.
 * - `ERR_NO_WORKERS` — every worker in a pool exited, so queued tasks can
 *   never start.
 */

/** Rebuilds a worker-reported error, preserving its original message/stack. */
export function workerError(message, stack) {
  const err = new Error(message);
  if (stack) err.stack = stack;
  return err;
}

/** Distinguishable error for receive-side structured-clone failures. */
export function messageError(cause) {
  const detail = cause?.message ? ` ${cause.message}` : '';
  const err = new Error(
    `Failed to deserialize a message from the worker (structured-clone failure).${detail}`
  );
  err.code = 'ERR_WORKER_MESSAGEERROR';
  if (cause) err.cause = cause;
  return err;
}

/** Error used when a worker exits while a task is still pending. */
export function unexpectedExitError(code) {
  const err = new Error(
    `Worker exited unexpectedly with code ${code} while a task was still pending.`
  );
  err.code = 'ERR_WORKER_UNEXPECTED_EXIT';
  return err;
}

/** Error used to reject pending tasks when an instance is terminated. */
export function terminatedError(what) {
  const err = new Error(`${what} was terminated before the task completed.`);
  err.code = 'ERR_TERMINATED';
  return err;
}

/** Error used when calling into an instance that was already terminated. */
export function destroyedError(kind) {
  const err = new Error(
    `${kind} has been terminated/destroyed. Create a new instance to run more tasks.`
  );
  err.code = 'ERR_TERMINATED';
  return err;
}