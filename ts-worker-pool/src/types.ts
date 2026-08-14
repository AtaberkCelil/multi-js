/**
 * Shared protocol and configuration types.
 *
 * Message protocol (structured-clone serialization):
 *
 *   main -> worker   { type: 'task', id, args }
 *   worker -> main   { type: 'ok',   id, value }            task succeeded
 *   worker -> main   { type: 'err',  id, error }            task rejected
 *   worker -> main   { type: 'crash', id | null, error }    unhandled error in the worker
 */

export type TransferList =
  | ArrayBuffer
  | ArrayBufferView
  | MessagePort
  | ImageBitmap
  | OffscreenCanvas
  | ReadableStream
  | WritableStream
  | TransformStream;

export interface WorkerPoolOptions {
  /** Maximum number of concurrent workers. Defaults to the number of CPU cores. */
  size?: number;
  /** Default per-task timeout in milliseconds; 0/undefined disables it. */
  taskTimeoutMs?: number;
}

export interface TaskOptions {
  /** Timeout for this task only, in milliseconds. Overrides the pool default. */
  timeoutMs?: number;
  /** Explicit transfer list for this task, in addition to any Transferred wrappers in the args. */
  transfer?: TransferList[];
}

export interface TaskMessage {
  type: 'task';
  id: number;
  args: unknown[];
}

export interface OkReply {
  type: 'ok';
  id: number;
  value: unknown;
}

export interface ErrReply {
  type: 'err';
  id: number;
  error: SerializedError;
}

export interface CrashMessage {
  type: 'crash';
  id: number | null;
  error: SerializedError;
}

export type ReplyMessage = OkReply | ErrReply | CrashMessage;

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
}

/**
 * Environment-agnostic handle over a single worker thread.
 * Implemented by the Node adapter (node:worker_threads) and the browser
 * adapter (Web Worker) in channel.ts.
 */
export interface ThreadLike {
  postMessage(message: unknown, transfer?: TransferList[]): void;
  onMessage(handler: (message: unknown) => void): void;
  onError(handler: (error: Error) => void): void;
  onExit(handler: (code: number | null) => void): void;
  onMessageError(handler: (cause: Error) => void): void;
  terminate(): void | Promise<void>;
}

export interface PendingTask {
  id: number;
  args: unknown[];
  transfer: TransferList[];
  timeoutMs: number | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface PoolStats {
  /** Configured maximum worker count (-1 until the CPU count has been resolved). */
  size: number;
  /** Live worker threads. */
  alive: number;
  /** Workers currently running a task. */
  busy: number;
  /** Workers waiting for work. */
  idle: number;
  /** Tasks waiting in the queue. */
  queued: number;
  /** Tasks in flight or queued, waiting for a settle. */
  pending: number;
  /** Threads currently being spawned. */
  pendingSpawns: number;
  destroyed: boolean;
}

export interface WorkerHandler {
  (args: unknown[]): unknown | Promise<unknown>;
}
