import type { Worker as NodeWorker } from 'node:worker_threads';
import { NotInWorkerError, WorkerPoolError } from './errors.js';
import type { ThreadLike, TransferList } from './types.js';

/**
 * Detects whether the current runtime is Node.js. Uses a runtime check (not a
 * bundler flag) so the same compiled output runs unmodified in both worlds.
 */
export function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    process.versions !== undefined &&
    process.versions.node !== undefined
  );
}

/**
 * Message channel used by the worker side. `node:worker_threads` exposes
 * `parentPort`; browsers expose the worker global scope (`self`).
 */
export interface PortLike {
  postMessage(message: unknown, transfer?: TransferList[]): void;
  on(event: 'message' | 'messageerror' | 'error' | 'exit', handler: (arg: unknown) => void): unknown;
}

interface BrowserWorkerScope {
  postMessage?(message: unknown, transfer?: TransferList[]): void;
  addEventListener?(type: string, listener: (event: MessageEvent | ErrorEvent) => void): void;
}

function browserPort(scope: BrowserWorkerScope): PortLike {
  return {
    postMessage: (message, transfer) => {
      scope.postMessage!(message, transfer);
    },
    on: (event, handler) => {
      if (event === 'exit') return scope; // browsers have no worker exit event
      const type = event === 'message' ? 'message' : event === 'messageerror' ? 'messageerror' : 'error';
      scope.addEventListener!(type, (e) => {
        if (type === 'error') {
          const errEvent = e as ErrorEvent;
          handler(errEvent.error instanceof Error ? errEvent.error : new Error(errEvent.message || 'Unknown worker error'));
        } else {
          handler((e as MessageEvent).data);
        }
      });
      return scope;
    }
  };
}

/**
 * Resolves the worker-side message channel. Throws NotInWorkerError when the
 * code runs on the main thread.
 */
export async function resolvePort(): Promise<PortLike> {
  if (isNodeEnvironment()) {
    try {
      const { parentPort } = await import('node:worker_threads');
      if (parentPort) {
        return parentPort as unknown as PortLike;
      }
    } catch {
      // Node worker_threads unavailable; fall through to the browser path.
    }
  }
  const scope = globalThis as unknown as BrowserWorkerScope;
  if (typeof scope.postMessage !== 'function' || typeof scope.addEventListener !== 'function') {
    throw new NotInWorkerError();
  }
  return browserPort(scope);
}

function nodeThread(worker: NodeWorker): ThreadLike {
  return {
    postMessage: (message, transfer) => {
      worker.postMessage(message, transfer as unknown as Parameters<NodeWorker['postMessage']>[1]);
    },
    onMessage: (handler) => {
      worker.on('message', handler);
    },
    onError: (handler) => {
      worker.on('error', handler);
    },
    onExit: (handler) => {
      worker.on('exit', (code) => handler(code));
    },
    onMessageError: (handler) => {
      worker.on('messageerror', handler);
    },
    terminate: async () => {
      await worker.terminate();
    }
  };
}

function browserThread(worker: globalThis.Worker): ThreadLike {
  return {
    postMessage: (message, transfer) => {
      worker.postMessage(message, transfer as unknown as Transferable[]);
    },
    onMessage: (handler) => {
      worker.addEventListener('message', (e) => handler(e.data));
    },
    onError: (handler) => {
      worker.addEventListener('error', (e) => {
        handler(e.error instanceof Error ? e.error : new Error(e.message || 'Unknown worker error'));
      });
    },
    onExit: () => {
      // Web Workers have no exit event; crashes surface through onError.
    },
    onMessageError: (handler) => {
      worker.addEventListener('messageerror', (e) => {
        handler(e instanceof Error ? e : new Error('Worker message could not be deserialized.'));
      });
    },
    terminate: () => worker.terminate()
  };
}

function resolveNodeWorkerURL(workerURL: string | URL): string | URL {
  if (workerURL instanceof URL) return workerURL;
  if (/^(file|node|data|https?):/.test(workerURL)) return workerURL;
  return workerURL; // plain filesystem path, resolved relative to process.cwd()
}

/**
 * Spawns a worker thread on the main side. Uses node:worker_threads in Node,
 * the Web Worker API in browsers.
 */
export async function createThread(workerURL: string | URL): Promise<ThreadLike> {
  if (isNodeEnvironment()) {
    const { Worker } = await import('node:worker_threads');
    return nodeThread(new Worker(resolveNodeWorkerURL(workerURL)));
  }
  if (typeof globalThis.Worker !== 'undefined') {
    const url = workerURL instanceof URL ? workerURL.toString() : workerURL;
    return browserThread(new globalThis.Worker(url));
  }
  throw new WorkerPoolError(
    'ERR_NO_WORKER_IMPL',
    'Neither node:worker_threads nor the Web Worker API is available in this environment.'
  );
}

/**
 * Number of available CPU cores: `os.availableParallelism()` in Node,
 * `navigator.hardwareConcurrency` in browsers.
 */
export async function availableParallelism(): Promise<number> {
  if (isNodeEnvironment()) {
    try {
      const os = await import('node:os');
      if (typeof os.availableParallelism === 'function') {
        return os.availableParallelism();
      }
      return os.cpus().length;
    } catch {
      // fall through to the browser path
    }
  }
  const hardwareConcurrency = (
    globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }
  ).navigator?.hardwareConcurrency;
  if (typeof hardwareConcurrency === 'number' && hardwareConcurrency >= 1) {
    return hardwareConcurrency;
  }
  return 1;
}
