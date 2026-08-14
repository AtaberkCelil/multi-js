import { performance } from 'node:perf_hooks';
import {
  WorkerPool,
  availableParallelism,
  runTask,
  createSharedBuffer,
  transferred,
  TaskRejectedError,
  TaskTimeoutError,
  WorkerCrashedError
} from '../src/index.js';
import { countPrimes, matrixSum, multiplyMatrices, randomMatrix } from './kernels.js';

const WORKER_URL = new URL('./benchmark-worker.js', import.meta.url);
const CRASH_WORKER_URL = new URL('./crash-worker.js', import.meta.url);

const MATRIX_N = 512;
const PRIME_LIMIT = 5_000_000;

function formatMs(ms: number): string {
  return `${ms.toFixed(1).padStart(9)} ms`;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}

async function main(): Promise<void> {
  const cpus = await availableParallelism();
  console.log(`CPU cores: ${cpus}   Matrix N=${MATRIX_N}   Prime limit=${PRIME_LIMIT}`);
  console.log('-'.repeat(72));

  const inputs = Array.from({ length: cpus }, (_, i) => ({
    a: randomMatrix(MATRIX_N, 100 + i),
    b: randomMatrix(MATRIX_N, 200 + i)
  }));

  const baseline = await timed(async () => {
    let total = 0;
    for (const { a, b } of inputs) {
      total += matrixSum(multiplyMatrices(a, b, MATRIX_N));
    }
    for (let i = 0; i < cpus; i++) {
      total += countPrimes(PRIME_LIMIT);
    }
    return total;
  });
  console.log('Single thread (main thread)                    :', formatMs(baseline.ms));

  const baselineMatrixSum = baseline.value - cpus * countPrimes(PRIME_LIMIT);
  const baselinePrimeTotal = cpus * countPrimes(PRIME_LIMIT);

  const pool = new WorkerPool(WORKER_URL, { size: cpus });
  const poolRun = await timed(async () => {
    const sentBytes = inputs.reduce((acc, { a, b }) => acc + a.byteLength + b.byteLength, 0);
    const matrices = await Promise.all(
      inputs.map(({ a, b }) =>
        pool.submit<Float64Array>(['matrix', MATRIX_N, transferred(a, [a.buffer as ArrayBuffer]), transferred(b, [b.buffer as ArrayBuffer])])
      )
    );
    const receivedBytes = matrices.reduce((acc, m) => acc + m.byteLength, 0);
    const allDetached = inputs.every(({ a, b }) => a.byteLength === 0 && b.byteLength === 0);
    const total = matrices.reduce((acc, m) => acc + matrixSum(m), 0);
    const checksumOk = Math.abs(total - baselineMatrixSum) < 1e-6;
    console.log('  sent (transferred, zero-copy)          :', `${(sentBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log('  received (transferred, zero-copy)      :', `${(receivedBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log('  sender buffers detached (no copy)      :', allDetached);
    console.log('  checksum vs single-thread baseline      :', checksumOk ? 'PASS' : 'FAIL');
  });
  console.log(`Worker pool  (${cpus} workers, matrix)              :`, formatMs(poolRun.ms));
  console.log(`Speedup                                     : ${(baseline.ms / poolRun.ms).toFixed(2)}x`);
  console.log('  pool stats after run                     :', JSON.stringify(pool.stats));
  await pool.destroy();

  const shared = await timed(async () => {
    const sharedPool = new WorkerPool(WORKER_URL, { size: cpus });
    const sab = createSharedBuffer(cpus * 8);
    await Promise.all(
      Array.from({ length: cpus }, (_, i) => sharedPool.submit(['primes-shared', sab, PRIME_LIMIT, i]))
    );
    const view = new Float64Array(sab);
    const total = Array.from(view).reduce((acc, v) => acc + v, 0);
    console.log('  shared memory checksum vs baseline     :', total === baselinePrimeTotal ? 'PASS' : 'FAIL');
    await sharedPool.destroy();
  });
  console.log('SharedArrayBuffer (primes, no copy at all)        :', formatMs(shared.ms));

  const oneShot = await timed(async () => {
    const result = await runTask<number>(WORKER_URL, ['primes', PRIME_LIMIT]);
    console.log('  one-shot result correct                 :', result === countPrimes(PRIME_LIMIT) ? 'PASS' : 'FAIL');
  });
  console.log('runTask() one-shot (fresh worker per task)        :', formatMs(oneShot.ms));

  const timeoutPool = new WorkerPool(WORKER_URL, { size: 2 });
  const bigN = 1024;
  const timeoutA = randomMatrix(bigN, 3);
  const timeoutB = randomMatrix(bigN, 4);
  try {
    await timeoutPool.submit(['matrix', bigN, transferred(timeoutA, [timeoutA.buffer as ArrayBuffer]), transferred(timeoutB, [timeoutB.buffer as ArrayBuffer])], {
      timeoutMs: 200
    });
    console.log('Timeout: FAIL (task finished too fast)');
  } catch (err) {
    console.log('Timeout: task aborted with', err instanceof TaskTimeoutError ? 'TaskTimeoutError' : `unexpected ${String(err)}`, `(${(err as Error).message})`);
  }
  const recovery = await timeoutPool.submit<number>(['primes', 100]);
  console.log('Pool recovered after timeout:', recovery === 25 ? 'PASS' : 'FAIL');
  await timeoutPool.destroy();

  const errorPool = new WorkerPool(WORKER_URL, { size: 2 });
  try {
    await errorPool.submit(['no-such-task']);
    console.log('Worker rejection: FAIL (task did not throw)');
  } catch (err) {
    const isExpected = err instanceof TaskRejectedError;
    console.log('Worker rejection:', isExpected ? 'PASS' : 'FAIL', `(message: ${(err as Error).message})`);
  }
  await errorPool.destroy();

  const crashPool = new WorkerPool(CRASH_WORKER_URL, { size: 2 });
  try {
    await crashPool.submit(['crash']);
    console.log('Crash recovery: FAIL (task did not fail)');
  } catch (err) {
    console.log('Crash recovery: task failed with', err instanceof WorkerCrashedError ? 'WorkerCrashedError' : `unexpected ${String(err)}`);
  }
  const healed = await crashPool.submit<string>(['ok']);
  console.log('Crash recovery: replacement worker healthy:', healed === 'ok' ? 'PASS' : 'FAIL');
  await crashPool.destroy();

  console.log('-'.repeat(72));
  console.log('All sections complete.');
}

await main();
