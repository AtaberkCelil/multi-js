import type { TransferList } from './types.js';

/**
 * Wraps a value together with the transfer list that should move it into the
 * worker (or back to the main thread) without copying.
 *
 * Works in both directions:
 *   main:   pool.submit([transferred(buffer, [buffer])])
 *   worker: return transferred(result, [result.buffer]);
 */
export class Transferred<T> {
  readonly value: T;
  readonly transfer: TransferList[];

  constructor(value: T, transfer: TransferList[]) {
    this.value = value;
    this.transfer = transfer;
  }
}

export function transferred<T>(value: T, transfer: TransferList[]): Transferred<T> {
  return new Transferred(value, transfer);
}

export function isTransferred(value: unknown): value is Transferred<unknown> {
  return value instanceof Transferred;
}

export interface CollectedTransfer {
  args: unknown[];
  transfer: TransferList[];
}

/**
 * Unwraps Transferred wrappers found at the top level of `args` and collects
 * their transfer lists, so the caller can pass both to postMessage at once.
 * Buffers wrapped this way are detached from the sender — zero copy.
 */
export function collectTransferables(args: unknown[]): CollectedTransfer {
  const transfer: TransferList[] = [];
  const normalized = args.map((arg) => {
    if (isTransferred(arg)) {
      transfer.push(...arg.transfer);
      return arg.value;
    }
    return arg;
  });
  return { args: normalized, transfer };
}

/**
 * SharedArrayBuffer is never transferred — it is shared by reference, which
 * makes it the cheapest possible cross-thread channel. Both sides must be
 * started with crossOriginIsolated (browser) or COOP/COEP headers.
 */
export function createSharedBuffer(byteLength: number): SharedArrayBuffer {
  return new SharedArrayBuffer(byteLength);
}

/** Convenience: a Float64Array view over a freshly allocated SharedArrayBuffer. */
export function sharedFloat64Array(byteLength: number): Float64Array {
  return new Float64Array(createSharedBuffer(byteLength));
}
