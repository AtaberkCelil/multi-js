import { test } from 'node:test';
import assert from 'node:assert';
import { runTask, ThreadPool, AutoThreader, ManualThreader } from '../src/index.js';
import { workerError, messageError, unexpectedExitError, terminatedError, destroyedError } from '../src/errors.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const fixtures   = path.join(__dirname, 'fixtures');

const workerAdd        = path.join(fixtures, 'worker-add.js');
const workerThrows     = path.join(fixtures, 'worker-throws.js');
const workerThrowsAsync = path.join(fixtures, 'worker-throws-async.js');
const workerSlow       = path.join(fixtures, 'worker-slow.js');
const workerNever      = path.join(fixtures, 'worker-never.js');
const workerCrash      = path.join(fixtures, 'worker-crash.js');
const workerBadSyntax  = path.join(fixtures, 'worker-bad-syntax.js');
const workerSyncThrow  = path.join(fixtures, 'worker-sync-throw.js');
const workerSerialize  = path.join(fixtures, 'worker-serialize.js');
const workerConcurrency = path.join(fixtures, 'worker-concurrency.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── runTask ────────────────────────────────────────────────────────────────────

test('runTask executes correctly in a native background thread', async () => {
  const result = await runTask(workerAdd, [5, 7]);
  assert.strictEqual(result, 12);
});

test('runTask rejects when the worker function throws, preserving stack', async () => {
  try {
    await runTask(workerThrows, [1]);
    assert.fail('runTask should have rejected');
  } catch (err) {
    assert.match(err.message, /boom-from-worker/);
    assert.match(err.stack, /worker-throws\.js/);
  }
});

test('runTask rejects when the worker async function rejects', async () => {
  await assert.rejects(runTask(workerThrowsAsync, [1]), /async-boom-from-worker/);
});

test('runTask rejects when the worker throws synchronously at load', async () => {
  await assert.rejects(runTask(workerSyncThrow, [1]), /sync-boom-at-load/);
});

test('runTask rejects with a clear error when the worker file is missing', async () => {
  const missing = path.join(fixtures, 'does-not-exist.js');
  await assert.rejects(runTask(missing, [1]), /cannot find|not found|ENOENT/i);
});

test('runTask rejects when the worker script has a syntax error', async () => {
  await assert.rejects(runTask(workerBadSyntax, [1]), /syntax/i);
});

test('runTask rejects (not throws) when args are not structured-cloneable', async () => {
  await assert.rejects(runTask(workerAdd, [() => {}]), /could not be cloned/);
});

// A worker that never responds leaves runTask's promise pending forever —
// there is no built-in timeout (documented behavior). The pool-level tests
// below verify that terminate() is the escape hatch that unblocks such tasks.

// ── ThreadPool ─────────────────────────────────────────────────────────────────

test('ThreadPool executes multiple tasks natively', async () => {
  const pool = new ThreadPool(workerAdd, 2);
  const tasks = Array.from({ length: 5 }, (_, i) => pool.execute([i]));
  const results = await Promise.all(tasks);
  assert.deepStrictEqual(results, [0, 2, 4, 6, 8]);
  await pool.terminate();
});

test('ThreadPool queues tasks when all workers are busy and preserves order', async () => {
  const pool = new ThreadPool(workerSlow, 1);
  const results = await Promise.all([
    pool.execute([1, 100]),
    pool.execute([2, 100]),
    pool.execute([3, 100]),
  ]);
  assert.deepStrictEqual(results, [1, 2, 3]);
  await pool.terminate();
});

test('ThreadPool runs up to `size` tasks concurrently (SAB probe)', async () => {
  const pool = new ThreadPool(workerConcurrency, 2);
  const sab = new SharedArrayBuffer(8);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => pool.execute([{ sab, delayMs: 100 }]))
  );
  const peak = Math.max(...results);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded pool size 2`);
  assert.strictEqual(peak, 2, 'peak concurrency should reach the pool size');
  await pool.terminate();
});

test('ThreadPool.terminate() rejects pending and queued tasks (never-resolving worker)', async () => {
  const pool = new ThreadPool(workerNever, 1);
  const pending = pool.execute([1]);
  const queued = pool.execute([2]);
  await sleep(100); // let task 1 dispatch, task 2 queue
  await pool.terminate();
  await assert.rejects(pending, /terminated/);
  await assert.rejects(queued, /terminated/);
});

test('ThreadPool.execute() after terminate() rejects with a clear error', async () => {
  const pool = new ThreadPool(workerAdd, 1);
  await pool.terminate();
  await assert.rejects(pool.execute([1]), /terminated|destroyed/);
});

test('ThreadPool.terminate() is idempotent', async () => {
  const pool = new ThreadPool(workerAdd, 1);
  await pool.terminate();
  await pool.terminate();
  await assert.rejects(pool.execute([1]), /terminated|destroyed/);
});

test('ThreadPool rejects the pending task when a worker exits unexpectedly', async () => {
  const pool = new ThreadPool(workerCrash, 1);
  await assert.rejects(pool.execute([1]), /exited unexpectedly/);
  await pool.terminate();
});

test('ThreadPool rejects when a worker fails to load', async () => {
  const pool = new ThreadPool(workerBadSyntax, 1);
  await assert.rejects(pool.execute([1]), /syntax/i);
  await pool.terminate();
});

test('ThreadPool rejects tasks whose args are not cloneable instead of throwing', async () => {
  const pool = new ThreadPool(workerAdd, 1);
  await assert.rejects(pool.execute([() => {}]), /could not be cloned/);
  const result = await pool.execute([2, 3]); // pool still usable afterwards
  assert.strictEqual(result, 5);
  await pool.terminate();
});

test('ThreadPool rejects invalid constructor arguments', () => {
  assert.throws(() => new ThreadPool('', 1), TypeError);
  assert.throws(() => new ThreadPool(workerAdd, 0), RangeError);
  assert.throws(() => new ThreadPool(workerAdd, 1.5), RangeError);
});

// ── AutoThreader ─────────────────────────────────────────────────────────────

test('AutoThreader.run() returns correct result on a dedicated thread', async () => {
  const auto = new AutoThreader(workerAdd);
  const result = await auto.run([6, 4]);
  assert.strictEqual(result, 10);
  auto.destroy();
});

test('AutoThreader.runAll() executes all tasks in parallel and returns results in order', async () => {
  const auto = new AutoThreader(workerAdd);
  const results = await auto.runAll([
    [0, 1],
    [2, 3],
    [4, 5],
  ]);
  assert.deepStrictEqual(results, [1, 5, 9]);
  auto.destroy();
});

test('AutoThreader respects maxConcurrent limit', async () => {
  const auto = new AutoThreader(workerAdd, { maxConcurrent: 1 });
  const results = await auto.runAll([[1, 1], [2, 2], [3, 3]]);
  assert.deepStrictEqual(results, [2, 4, 6]);
  auto.destroy();
});

test('AutoThreader.maxConcurrent is enforced under load (SAB probe)', async () => {
  const auto = new AutoThreader(workerConcurrency, { maxConcurrent: 2 });
  const sab = new SharedArrayBuffer(8);
  const results = await auto.runAll(
    Array.from({ length: 6 }, () => [{ sab, delayMs: 100 }])
  );
  const peak = Math.max(...results);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded maxConcurrent=2`);
  assert.strictEqual(peak, 2, 'peak concurrency should reach the cap (tasks were queued, then started)');
  auto.destroy();
});

test('AutoThreader.destroy() rejects in-flight and queued tasks', async () => {
  const auto = new AutoThreader(workerSlow, { maxConcurrent: 1 });
  const inFlight = auto.run([1, 300]);
  const queued = auto.run([2, 300]);
  await sleep(80); // let task 1 dispatch, task 2 queue
  auto.destroy();
  await assert.rejects(inFlight, /terminated/);
  await assert.rejects(queued, /terminated/);
});

test('AutoThreader.run() after destroy() rejects with a clear error', async () => {
  const auto = new AutoThreader(workerAdd);
  auto.destroy();
  await assert.rejects(auto.run([1]), /terminated|destroyed/);
});

test('AutoThreader.runAll() rejects fast on the first failing task (Promise.all semantics)', async () => {
  const auto = new AutoThreader(workerThrows, { maxConcurrent: 4 });
  await assert.rejects(auto.runAll([[1], [2]]), /boom-from-worker/);
  auto.destroy();
});

test('AutoThreader: a failing task does not prevent sibling tasks from completing', async () => {
  const auto = new AutoThreader(workerSlow, { maxConcurrent: 4 });
  const ok = auto.run([7, 200]);
  const bad = auto.run([8, 200, true]);
  await assert.rejects(bad, /slow-boom/);
  assert.strictEqual(await ok, 7, 'sibling task should still resolve');
  auto.destroy();
});

test('AutoThreader rejects the pending task when a worker exits unexpectedly', async () => {
  const auto = new AutoThreader(workerCrash, { maxConcurrent: 1 });
  await assert.rejects(auto.run([1]), /exited unexpectedly/);
  auto.destroy();
});

test('AutoThreader rejects invalid constructor arguments', () => {
  assert.throws(() => new AutoThreader(''), TypeError);
  assert.throws(() => new AutoThreader(workerAdd, { maxConcurrent: 0 }), RangeError);
});

// ── ManualThreader ────────────────────────────────────────────────────────────

test('ManualThreader.runOn() routes task to the correct named thread', async () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('alpha');
  const result = await mt.runOn('alpha', [5]);
  assert.strictEqual(result, 10);
  mt.destroy();
});

test('ManualThreader.runOnMany() fans out task to multiple threads', async () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('a');
  mt.createThread('b');
  const results = await mt.runOnMany(['a', 'b'], [3]);
  assert.deepStrictEqual(results, [6, 6]);
  mt.destroy();
});

test('ManualThreader.broadcast() sends task to all threads and returns named results', async () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('x');
  mt.createThread('y');
  mt.createThread('z');
  const results = await mt.broadcast([4]);
  assert.deepStrictEqual(results, { x: 8, y: 8, z: 8 });
  mt.destroy();
});

test('ManualThreader.listThreads() returns all thread names', () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('t1');
  mt.createThread('t2');
  assert.deepStrictEqual(mt.listThreads(), ['t1', 't2']);
  mt.destroy();
});

test('ManualThreader.removeThread() terminates and removes a named thread', () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('keep');
  mt.createThread('drop');
  mt.removeThread('drop');
  assert.deepStrictEqual(mt.listThreads(), ['keep']);
  mt.destroy();
});

test('ManualThreader throws on duplicate thread name', () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('dup');
  assert.throws(() => mt.createThread('dup'), /already exists/);
  mt.destroy();
});

test('ManualThreader.runOn() with unknown thread name rejects (does not throw)', async () => {
  const mt = new ManualThreader(workerAdd);
  await assert.rejects(mt.runOn('ghost', [1]), /does not exist/);
  mt.destroy();
});

test('ManualThreader.removeThread() rejects a task that is mid-flight', async () => {
  const mt = new ManualThreader(workerSlow);
  mt.createThread('busy');
  const pending = mt.runOn('busy', [1, 300]);
  await sleep(80); // task is running when we remove the thread
  mt.removeThread('busy');
  await assert.rejects(pending, /terminated/);
  mt.destroy();
});

test('ManualThreader.destroy() rejects pending tasks on a never-resolving worker', async () => {
  const mt = new ManualThreader(workerNever);
  mt.createThread('stuck');
  const pending = mt.runOn('stuck', [1]);
  await sleep(80);
  mt.destroy();
  await assert.rejects(pending, /terminated/);
});

test('ManualThreader rejects pending tasks when a named worker exits unexpectedly', async () => {
  const mt = new ManualThreader(workerCrash);
  mt.createThread('frail');
  await assert.rejects(mt.runOn('frail', [1]), /exited unexpectedly/);
  mt.destroy();
});

test('ManualThreader.broadcast() rejects if any thread fails (Promise.all semantics)', async () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('good', workerSlow);
  mt.createThread('bad', workerThrows);
  await assert.rejects(mt.broadcast([1, 50]), /boom-from-worker/);
  mt.destroy();
});

test('ManualThreader.runOn() rejects when args are not cloneable', async () => {
  const mt = new ManualThreader(workerAdd);
  mt.createThread('t');
  await assert.rejects(mt.runOn('t', [() => {}]), /could not be cloned/);
  mt.destroy();
});

// ── Data serialization ────────────────────────────────────────────────────────

test('serialization: undefined round-trips', async () => {
  const result = await runTask(workerSerialize, [undefined]);
  assert.strictEqual(result, undefined);
});

test('serialization: circular references are supported (structured clone handles cycles)', async () => {
  const circle = { name: 'root' };
  circle.self = circle;
  circle.nested = { parent: circle };
  const result = await runTask(workerSerialize, [circle]);
  assert.strictEqual(result.name, 'root');
  assert.strictEqual(result.self, result, 'cycle must be preserved');
  assert.strictEqual(result.nested.parent, result);
});

test('serialization: large ArrayBuffer is copied, not transferred or detached', async () => {
  const buf = new ArrayBuffer(8 * 1024 * 1024);
  new Uint8Array(buf).fill(7);
  const result = await runTask(workerSerialize, [buf]);
  assert.ok(result instanceof ArrayBuffer);
  assert.strictEqual(result.byteLength, buf.byteLength);
  assert.strictEqual(new Uint8Array(result)[0], 7);
  assert.strictEqual(new Uint8Array(result)[buf.byteLength - 1], 7);
  assert.strictEqual(
    buf.byteLength,
    8 * 1024 * 1024,
    'original buffer must stay intact — payloads are copied (structured clone), not transferred'
  );
});

test('serialization: TypedArrays round-trip with values intact', async () => {
  const floats = new Float64Array(1000).fill(Math.PI);
  const result = await runTask(workerSerialize, [floats]);
  assert.ok(result instanceof Float64Array);
  assert.strictEqual(result.length, 1000);
  assert.strictEqual(result[500], Math.PI);
});

test('serialization: large payload through runTask', async () => {
  const data = { bytes: new Uint8Array(4 * 1024 * 1024).fill(1) };
  const result = await runTask(workerSerialize, [data]);
  assert.strictEqual(result.bytes.length, 4 * 1024 * 1024);
  assert.strictEqual(result.bytes[result.bytes.length - 1], 1);
});

// ── Shared error helpers ──────────────────────────────────────────────────────

test('errors: workerError preserves message and stack', () => {
  const err = workerError('kaboom', 'Error: kaboom\n    at worker.js:1:1');
  assert.strictEqual(err.message, 'kaboom');
  assert.strictEqual(err.stack, 'Error: kaboom\n    at worker.js:1:1');
});

test('errors: messageError is distinguishable via code and keeps the cause', () => {
  const cause = new DOMException('data could not be cloned', 'DataCloneError');
  const err = messageError(cause);
  assert.strictEqual(err.code, 'ERR_WORKER_MESSAGEERROR');
  assert.strictEqual(err.cause, cause);
  assert.match(err.message, /deserialize/i);
});

test('errors: unexpectedExitError carries a clear message and code', () => {
  const err = unexpectedExitError(1);
  assert.strictEqual(err.code, 'ERR_WORKER_UNEXPECTED_EXIT');
  assert.match(err.message, /exited unexpectedly with code 1/);
});

test('errors: terminatedError/destroyedError carry ERR_TERMINATED', () => {
  assert.strictEqual(terminatedError('ThreadPool').code, 'ERR_TERMINATED');
  assert.match(terminatedError('ThreadPool').message, /ThreadPool/);
  assert.strictEqual(destroyedError('AutoThreader').code, 'ERR_TERMINATED');
  assert.match(destroyedError('AutoThreader').message, /new instance/);
});