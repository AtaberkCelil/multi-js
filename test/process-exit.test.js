import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const fixtures   = path.join(__dirname, 'fixtures');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runChild(script, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: 'pipe' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false });
    });
  });
}

// These tests spawn real child Node processes: a child creates a pool/
// threader with a never-responding worker, never calls terminate()/destroy(),
// and only receives a signal (or crashes). A dangling worker would keep the
// child alive forever, so the parent asserts the child still exits.

test('SIGTERM with an active, never-terminated ThreadPool still exits cleanly', async () => {
  const { code, timedOut } = await runChild(path.join(fixtures, 'exit-child-sigterm-pool.mjs'));
  assert.strictEqual(timedOut, false, 'child must not hang after SIGTERM');
  assert.strictEqual(code, 0, `expected clean exit (0), got ${code}`);
});

test('SIGTERM with an active, never-terminated AutoThreader still exits cleanly', async () => {
  const { code, timedOut } = await runChild(path.join(fixtures, 'exit-child-sigterm-auto.mjs'));
  assert.strictEqual(timedOut, false, 'child must not hang after SIGTERM');
  assert.strictEqual(code, 0, `expected clean exit (0), got ${code}`);
});

test('SIGTERM with an active, never-terminated ManualThreader still exits cleanly', async () => {
  const { code, timedOut } = await runChild(path.join(fixtures, 'exit-child-sigterm-manual.mjs'));
  assert.strictEqual(timedOut, false, 'child must not hang after SIGTERM');
  assert.strictEqual(code, 0, `expected clean exit (0), got ${code}`);
});

test('an uncaught main-thread exception crashes (code 1) instead of hanging with dangling workers', async () => {
  const { code, timedOut } = await runChild(path.join(fixtures, 'exit-child-uncaught.mjs'));
  assert.strictEqual(timedOut, false, 'child must not hang after the uncaught exception');
  assert.strictEqual(code, 1, `expected crash exit (1), got ${code}`);
});

test('a real OS-delivered SIGTERM is handled (POSIX only)', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, [path.join(fixtures, 'exit-child-sigterm-pool.mjs')], { stdio: 'pipe' });
  await sleep(300); // let the pool spin up and the worker start busy-looping
  child.kill('SIGTERM');
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true });
    }, 8000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false });
    });
  });
  assert.strictEqual(result.timedOut, false, 'child must not hang after OS SIGTERM');
  assert.strictEqual(result.code, 0, `expected clean exit (0), got ${result.code}`);
});