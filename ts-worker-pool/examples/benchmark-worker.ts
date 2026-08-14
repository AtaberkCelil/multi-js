import { createWorkerEntry, transferred } from '../src/index.js';
import { countPrimes, multiplyMatrices } from './kernels.js';

await createWorkerEntry(async (args: unknown[]) => {
  const kind = args[0] as string;

  switch (kind) {
    case 'matrix': {
      const n = args[1] as number;
      const a = args[2] as Float64Array;
      const b = args[3] as Float64Array;
      const c = multiplyMatrices(a, b, n);
      return transferred(c, [c.buffer as ArrayBuffer]);
    }
    case 'primes': {
      return countPrimes(args[1] as number);
    }
    case 'primes-shared': {
      const sab = args[1] as SharedArrayBuffer;
      const limit = args[2] as number;
      const slot = args[3] as number;
      const view = new Float64Array(sab);
      view[slot] = countPrimes(limit);
      return 'written';
    }
    default: {
      throw new Error(`Unknown benchmark task: ${String(kind)}`);
    }
  }
});
