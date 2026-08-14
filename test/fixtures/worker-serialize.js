import { defineWorker } from '../../src/index.js';

// Echo worker — returns whatever structured-clone delivered, so tests can
// verify serialization semantics (copies, cycles, undefined, TypedArrays…).
defineWorker((payload) => payload);