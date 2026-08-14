import { createWorkerEntry } from '../src/index.js';

await createWorkerEntry(async (args: unknown[]) => {
  if (args[0] === 'crash') {
    process.exit(1); // dies before replying — simulates a hard worker crash
  }
  return 'ok';
});
