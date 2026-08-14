import { Worker } from 'node:worker_threads';

export function createWorkerNode(workerScriptPath) {
  const worker = new Worker(workerScriptPath);

  return {
    postMessage: (msg) => worker.postMessage(msg),
    onMessage: (cb) => worker.on('message', cb),
    onError: (cb) => worker.on('error', cb),
    onExit: (cb) => worker.on('exit', cb),
    onMessageError: (cb) => worker.on('messageerror', cb),
    terminate: () => worker.terminate().catch(() => {})
  };
}