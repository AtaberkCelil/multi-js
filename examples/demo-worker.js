import { defineWorker } from '../src/index.js';

defineWorker((index, mult) => {
  if (mult !== undefined) {
    return index + mult; // runTask logic
  }

  // ThreadPool heavy task logic
  for (let j = 0; j < 10000000; j++) {
    Math.sqrt(j);
  }
  return `Task ${index} finished in true native background thread!`;
});
