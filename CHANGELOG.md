# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] - 2026-08-13

### Added
- `defineWorker(fn)` — register a function to run inside a worker thread
- `runTask(path, args)` — one-shot thread: spawn, run, terminate, return result
- `ThreadPool` — fixed pool of persistent reusable worker threads
- `AutoThreader` — auto mode: every task gets its own dedicated OS thread
  - `run(args)` — single task on a fresh thread
  - `runAll(argsArray)` — all tasks in parallel, one thread each
  - `maxConcurrent` option (default: `os.cpus().length × 2`)
- `ManualThreader` — manual mode: named persistent threads with explicit routing
  - `createThread(name, scriptPath?)` — create a named thread (optionally with a custom script)
  - `runOn(name, args)` — route a task to a specific thread
  - `runOnMany(names, args)` — fan-out to multiple threads
  - `broadcast(args)` — send task to all threads, returns `{ name: result }` map
  - `listThreads()` — list all thread names
  - `removeThread(name)` — terminate and remove a named thread
  - `destroy()` — terminate all threads
