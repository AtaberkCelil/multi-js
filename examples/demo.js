import { runTask, ThreadPool, AutoThreader, ManualThreader } from '../src/index.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const workerPath = path.join(__dirname, 'demo-worker.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: pretty section header
// ─────────────────────────────────────────────────────────────────────────────
function header(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

async function main() {

  // ── 1. Original API: runTask (one-shot thread) ──────────────────────────────
  header('1. runTask — single one-shot thread');
  const sum = await runTask(workerPath, [10, 20]);
  console.log(`  10 + 20 = ${sum}  (ran on a dedicated OS thread, now terminated)`);


  // ── 2. Original API: ThreadPool ─────────────────────────────────────────────
  header('2. ThreadPool — pool of 3 reusable threads, 5 tasks');
  const pool = new ThreadPool(workerPath, 3);
  const poolResults = await Promise.all(
    Array.from({ length: 5 }, (_, i) => pool.execute([i + 1]))
  );
  poolResults.forEach(r => console.log(' ', r));
  await pool.terminate();


  // ── 3. AutoThreader — auto mode ─────────────────────────────────────────────
  header('3. AutoThreader — each task gets its OWN thread automatically');

  const auto = new AutoThreader(workerPath, { maxConcurrent: 4 });

  // 3a. Single task on its own thread
  console.log('  [single] running 5 + 7 on an auto-spawned thread...');
  const autoSingle = await auto.run([5, 7]);
  console.log(`  [single] result: ${autoSingle}`);

  // 3b. All tasks start simultaneously, each on its own thread
  console.log('\n  [runAll] launching 5 tasks — each on a separate thread...');
  const start = Date.now();
  const autoAll = await auto.runAll([
    [1], [2], [3], [4], [5]
  ]);
  const elapsed = Date.now() - start;
  autoAll.forEach(r => console.log(' ', r));
  console.log(`  (all 5 tasks finished in ~${elapsed}ms — truly parallel)`);

  auto.destroy();


  // ── 4. ManualThreader — manual mode ─────────────────────────────────────────
  header('4. ManualThreader — you control which thread runs which task');

  const mt = new ManualThreader(workerPath);

  // Create three named persistent threads
  mt.createThread('alpha');
  mt.createThread('beta');
  mt.createThread('gamma');
  console.log(`  Created threads: ${mt.listThreads().join(', ')}`);

  // 4a. Route to a specific thread
  console.log('\n  [runOn] sending task to "alpha"...');
  const alphaResult = await mt.runOn('alpha', [3]);
  console.log(`  "alpha" returned: ${alphaResult}`);

  // 4b. Fan-out: same task on several threads in parallel
  console.log('\n  [runOnMany] sending task to "alpha" and "beta" simultaneously...');
  const manyResults = await mt.runOnMany(['alpha', 'beta'], [7]);
  manyResults.forEach((r, i) => console.log(`  thread ${['alpha','beta'][i]} → ${r}`));

  // 4c. Broadcast: same task on ALL threads at once
  console.log('\n  [broadcast] broadcasting task to ALL threads...');
  const broadcastResult = await mt.broadcast([10]);
  for (const [threadName, result] of Object.entries(broadcastResult)) {
    console.log(`  "${threadName}" → ${result}`);
  }

  // 4d. Remove one thread, show remaining
  mt.removeThread('gamma');
  console.log(`\n  Removed "gamma". Remaining: ${mt.listThreads().join(', ')}`);

  mt.destroy();
  console.log('\n  All threads terminated. Done!');
}

main();
