/**
 * Global worker-cleanup registry.
 *
 * The first ThreadPool/AutoThreader/ManualThreader created registers its
 * workers here. When the main process receives SIGINT/SIGTERM, or crashes
 * with an uncaught main-thread exception, every registered worker is
 * terminated so dangling threads can never keep the Node process alive.
 *
 * Pending task promises do NOT settle during this shutdown path (the
 * process is going away anyway); use the explicit terminate()/destroy()
 * methods when you need pending tasks to reject with ERR_TERMINATED.
 */

const cleanupCallbacks = new Set();
let installed = false;

function runCleanup() {
  for (const cb of cleanupCallbacks) cb();
}

function install() {
  if (installed) return;
  installed = true;

  process.once('SIGINT', runCleanup);
  process.once('SIGTERM', runCleanup);

  const onUncaught = (err) => {
    process.removeListener('uncaughtException', onUncaught);
    runCleanup();
    // Restore Node's default crash behavior (print + exit 1) unless the
    // application installed its own handler — that app owns the decision.
    if (process.listenerCount('uncaughtException') === 0) {
      setImmediate(() => {
        throw err;
      });
    }
  };
  process.on('uncaughtException', onUncaught);
}

/**
 * Register a cleanup callback. Returns an unregister function.
 * Installs the global signal/uncaughtException handlers on first use.
 * @param {() => void} cb
 * @returns {() => void}
 */
export function trackCleanup(cb) {
  install();
  cleanupCallbacks.add(cb);
  return () => cleanupCallbacks.delete(cb);
}