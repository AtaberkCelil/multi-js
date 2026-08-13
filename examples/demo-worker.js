import { defineWorker } from '../src/index.js';

defineWorker((index, mult) => {
  if (mult !== undefined) {
    return index + mult; // runTask logic
  }

  // ThreadPool heavy task logic
  let count = 0;
  for (let j = 0; j < 10000000; j++) count++;
  return `Task ${index} finished in true native background thread!`;
});
