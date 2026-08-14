export function randomMatrix(n: number, seed = 1): Float64Array {
  const matrix = new Float64Array(n * n);
  let s = seed >>> 0;
  for (let i = 0; i < matrix.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    matrix[i] = s / 4294967296;
  }
  return matrix;
}

export function multiplyMatrices(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const aik = a[i * n + k];
      if (aik === 0) continue;
      const crow = i * n;
      const brow = k * n;
      for (let j = 0; j < n; j++) {
        c[crow + j] += aik * b[brow + j];
      }
    }
  }
  return c;
}

export function matrixSum(matrix: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < matrix.length; i++) {
    sum += matrix[i];
  }
  return sum;
}

export function countPrimes(limit: number): number {
  const sieve = new Uint8Array(limit + 1);
  sieve[0] = 1;
  sieve[1] = 1;
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i] === 0) {
      for (let j = i * i; j <= limit; j += i) {
        sieve[j] = 1;
      }
    }
  }
  let count = 0;
  for (let i = 2; i <= limit; i++) {
    if (sieve[i] === 0) count++;
  }
  return count;
}
