import { isNodeEnvironment, resolvePort } from './channel.js';
import { serializeError } from './errors.js';
import { isTransferred } from './transferable.js';
import type { CrashMessage, ErrReply, OkReply, TaskMessage, WorkerHandler } from './types.js';

/**
 * Registers the message loop on the worker side.
 *
 * - Runs `handler` for every incoming task message.
 * - Captures synchronous throws and async rejections and reports them as
 *   `err` replies (original name/message/stack are preserved).
 * - Supports returning a Transferred wrapper so results travel back to the
 *   main thread without copying.
 * - Hooks `unhandledRejection`/`uncaughtException` in Node workers and
 *   reports them as `crash` messages, so the pool can fail the affected
 *   task and replace the worker instead of hanging forever.
 *
 * Must be called exactly once, inside a worker thread.
 */
export async function createWorkerEntry(handler: WorkerHandler): Promise<void> {
  const port = await resolvePort();
  let currentTaskId: number | null = null;

  async function runTask(msg: TaskMessage): Promise<void> {
    try {
      const result = await handler(msg.args);
      if (isTransferred(result)) {
        const reply: OkReply = { type: 'ok', id: msg.id, value: result.value };
        port.postMessage(reply, result.transfer);
      } else {
        const reply: OkReply = { type: 'ok', id: msg.id, value: result };
        port.postMessage(reply);
      }
    } catch (err) {
      const reply: ErrReply = { type: 'err', id: msg.id, error: serializeError(err) };
      port.postMessage(reply);
    } finally {
      if (currentTaskId === msg.id) {
        currentTaskId = null;
      }
    }
  }

  port.on('message', (raw: unknown) => {
    const msg = raw as TaskMessage;
    if (msg === null || typeof msg !== 'object' || msg.type !== 'task' || typeof msg.id !== 'number') {
      return;
    }
    currentTaskId = msg.id;
    void runTask(msg);
  });

  if (isNodeEnvironment()) {
    const reportCrash = (reason: unknown): void => {
      const crash: CrashMessage = {
        type: 'crash',
        id: currentTaskId,
        error: serializeError(reason)
      };
      port.postMessage(crash);
    };
    process.on('unhandledRejection', reportCrash);
    process.on('uncaughtException', (err) => {
      reportCrash(err);
      throw err; // let Node tear the worker down
    });
  }
}
