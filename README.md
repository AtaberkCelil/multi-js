# mthread-js

> True multithreading for Node.js — auto and manual thread control, built on native `worker_threads`.

[![npm version](https://img.shields.io/npm/v/mthread-js.svg)](https://www.npmjs.com/package/mthread-js)
[![Node.js ≥18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

JavaScript is single-threaded — but Node.js isn't.  
`multi-js` gives you a clean, promise-based API to run real parallel OS threads with zero native dependencies.

---

## Features

- 🚀 **Real OS threads** — powered by Node.js `worker_threads`, not fake async
- 🤖 **Auto mode** — every task gets its own dedicated thread automatically
- 🎯 **Manual mode** — name your threads and decide exactly what runs where
- ♻️ **Thread Pool** — classic reusable worker pool for steady workloads
- 🔗 **One-shot tasks** — fire a task on a background thread and get a Promise back
- 🛡️ **Safe by default** — concurrency cap prevents thread exhaustion
- 0️⃣ **Zero dependencies**

---

## Requirements

- **Node.js ≥ 18** (uses `worker_threads` + `node:test`)

---

## Installation

```bash
npm install mthread-js
```

---

## Quick Start

### 1. Write a worker file

```js
// my-worker.js
import { defineWorker } from 'multi-js';

defineWorker((a, b) => {
  // This runs on a real background thread
  return a + b;
});
```

### 2. Use it from your main file

```js
import { runTask } from 'multi-js';

const result = await runTask('./my-worker.js', [10, 20]);
console.log(result); // 30 — computed on a separate OS thread
```

---

## API

### `defineWorker(fn)` — Worker side

Call this **inside your worker file** to register the function that runs on the background thread.

```js
import { defineWorker } from 'multi-js';

defineWorker(async (x, y) => {
  return x * y;
});
```

The function can be `async`. Arguments are passed from the main thread via `postMessage` (structured-clone serialization).

---

### `runTask(workerPath, args)` — One-shot thread

Spawns a fresh thread, runs one task, terminates the thread, returns the result.  
Best for: infrequent heavy computations.

```js
import { runTask } from 'mthread-js';

const result = await runTask('./my-worker.js', [10, 20]);
```

| Param | Type | Description |
|---|---|---|
| `workerPath` | `string` | Absolute or relative path to the worker script |
| `args` | `Array` | Arguments passed to the worker function |

---

### `ThreadPool` — Reusable thread pool

Creates a fixed pool of persistent threads. Tasks are queued and dispatched to the next idle thread.  
Best for: high-frequency tasks where you want bounded concurrency.

```js
import { ThreadPool } from 'mthread-js';

const pool = new ThreadPool('./my-worker.js', 4); // 4 persistent threads

const results = await Promise.all([
  pool.execute([1, 2]),
  pool.execute([3, 4]),
  pool.execute([5, 6]),
]);

await pool.terminate();
```

#### Constructor

```js
new ThreadPool(workerScriptPath, size = 4)
```

| Param | Type | Default | Description |
|---|---|---|---|
| `workerScriptPath` | `string` | — | Path to the worker script |
| `size` | `number` | `4` | Number of persistent worker threads |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `execute(args)` | `Promise<any>` | Run a task on the next idle thread |
| `terminate()` | `Promise<void>` | Shut down all threads |

---

### `AutoThreader` — Auto threading mode ✨

Every task gets its **own dedicated OS thread**, spawned automatically. No configuration needed.  
Best for: burst workloads where you want maximum parallelism.

```js
import { AutoThreader } from 'mthread-js';

const auto = new AutoThreader('./my-worker.js');

// Single task on its own thread
const result = await auto.run([10, 20]);

// All tasks start simultaneously — each on a separate thread
const results = await auto.runAll([
  [1, 2],
  [3, 4],
  [5, 6],
]);

auto.destroy();
```

#### Constructor

```js
new AutoThreader(workerScriptPath, options?)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxConcurrent` | `number` | `os.cpus().length × 2` | Max threads running at once. Excess tasks are queued. |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `run(args)` | `Promise<any>` | Spawn a fresh thread, run task, return result |
| `runAll(argsArray)` | `Promise<any[]>` | Run all tasks in parallel, one thread each |
| `destroy()` | `void` | Terminate any lingering threads |

---

### `ManualThreader` — Manual threading mode 🎯

You **name your threads** and choose exactly which thread runs which task.  
Best for: long-lived specialized workers where routing matters.

```js
import { ManualThreader } from 'mthread-js';

const mt = new ManualThreader('./my-worker.js');

// Create named persistent threads
mt.createThread('alpha');
mt.createThread('beta');
mt.createThread('gamma', './other-worker.js'); // different script per thread

// Route a task to a specific thread
const r1 = await mt.runOn('alpha', [1, 2]);

// Fan-out: same task on several threads in parallel
const results = await mt.runOnMany(['alpha', 'beta'], [10]);
// → [result_from_alpha, result_from_beta]

// Broadcast: hit every thread at once
const all = await mt.broadcast([99]);
// → { alpha: result, beta: result, gamma: result }

// Inspect and manage threads
console.log(mt.listThreads()); // ['alpha', 'beta', 'gamma']
mt.removeThread('gamma');
mt.destroy();
```

#### Constructor

```js
new ManualThreader(defaultScriptPath?)
```

#### Methods

| Method | Returns | Description |
|---|---|---|
| `createThread(name, scriptPath?)` | `this` | Create a persistent named thread |
| `runOn(name, args)` | `Promise<any>` | Run a task on a specific named thread |
| `runOnMany(names[], args)` | `Promise<any[]>` | Run same task on several threads in parallel |
| `broadcast(args)` | `Promise<{ [name]: any }>` | Run same task on ALL threads, returns named results |
| `listThreads()` | `string[]` | List all thread names |
| `removeThread(name)` | `this` | Terminate and remove a named thread |
| `destroy()` | `void` | Terminate all threads |

---

## Choosing the Right API

| Scenario | Use |
|---|---|
| One heavy task, fire and forget | `runTask()` |
| Many similar tasks, bounded threads | `ThreadPool` |
| Burst of tasks, max parallelism | `AutoThreader.runAll()` |
| Long-lived workers, route by name | `ManualThreader` |
| Same work across all workers | `ManualThreader.broadcast()` |

---

## Important: Data Serialization

Worker threads **cannot share memory** by default. Data passed between the main thread and workers is **copied** using the [structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

- ✅ Works: numbers, strings, arrays, plain objects, `ArrayBuffer`, `TypedArray`
- ❌ Doesn't work: functions, class instances, closures, DOM nodes

If you need true shared memory, use `SharedArrayBuffer` with `Atomics`.

---

## Examples

See the [`examples/`](examples/) folder for runnable demos.

```bash
node examples/demo.js
```

---

## License

[ISC](LICENSE) © 2026
