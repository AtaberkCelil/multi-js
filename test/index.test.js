import { test } from 'node:test';
import assert from 'node:assert';
import { runTask, ThreadPool, AutoThreader, ManualThreader } from '../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const workerPath = path.join(__dirname, 'worker.js');

// ── Original API ──────────────────────────────────────────────────────────────

test('runTask executes correctly in a native background thread', async () => {
  const result = await runTask(workerPath, [5, 7]);
  assert.strictEqual(result, 12);
});

test('ThreadPool executes multiple tasks natively', async () => {
  const pool = new ThreadPool(workerPath, 2);
  const tasks = Array.from({ length: 5 }, (_, i) => pool.execute([i]));
  const results = await Promise.all(tasks);
  assert.deepStrictEqual(results, [0, 2, 4, 6, 8]);
  await pool.terminate();
});

// ── AutoThreader ─────────────────────────────────────────────────────────────

test('AutoThreader.run() returns correct result on a dedicated thread', async () => {
  const auto = new AutoThreader(workerPath);
  const result = await auto.run([6, 4]);   // worker: val2 !== undefined → val1 + val2
  assert.strictEqual(result, 10);
  auto.destroy();
});

test('AutoThreader.runAll() executes all tasks in parallel and returns results in order', async () => {
  const auto = new AutoThreader(workerPath);
  const results = await auto.runAll([
    [0, 1],  // 1
    [2, 3],  // 5
    [4, 5],  // 9
  ]);
  assert.deepStrictEqual(results, [1, 5, 9]);
  auto.destroy();
});

test('AutoThreader respects maxConcurrent limit', async () => {
  // maxConcurrent=1 means tasks run sequentially even when submitted together
  const auto = new AutoThreader(workerPath, { maxConcurrent: 1 });
  const results = await auto.runAll([[1, 1], [2, 2], [3, 3]]);
  assert.deepStrictEqual(results, [2, 4, 6]);
  auto.destroy();
});

// ── ManualThreader ────────────────────────────────────────────────────────────

test('ManualThreader.runOn() routes task to the correct named thread', async () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('alpha');
  const result = await mt.runOn('alpha', [5]);  // worker: val2 === undefined → val1 * 2
  assert.strictEqual(result, 10);
  mt.destroy();
});

test('ManualThreader.runOnMany() fans out task to multiple threads', async () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('a');
  mt.createThread('b');
  const results = await mt.runOnMany(['a', 'b'], [3]);
  assert.deepStrictEqual(results, [6, 6]);
  mt.destroy();
});

test('ManualThreader.broadcast() sends task to all threads and returns named results', async () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('x');
  mt.createThread('y');
  mt.createThread('z');
  const results = await mt.broadcast([4]);
  assert.deepStrictEqual(results, { x: 8, y: 8, z: 8 });
  mt.destroy();
});

test('ManualThreader.listThreads() returns all thread names', () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('t1');
  mt.createThread('t2');
  assert.deepStrictEqual(mt.listThreads(), ['t1', 't2']);
  mt.destroy();
});

test('ManualThreader.removeThread() terminates and removes a named thread', () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('keep');
  mt.createThread('drop');
  mt.removeThread('drop');
  assert.deepStrictEqual(mt.listThreads(), ['keep']);
  mt.destroy();
});

test('ManualThreader throws on duplicate thread name', () => {
  const mt = new ManualThreader(workerPath);
  mt.createThread('dup');
  assert.throws(() => mt.createThread('dup'), /already exists/);
  mt.destroy();
});

test('ManualThreader throws on runOn with unknown thread name', async () => {
  const mt = new ManualThreader(workerPath);
  await assert.rejects(async () => mt.runOn('ghost', [1]), /does not exist/);
  mt.destroy();
});
