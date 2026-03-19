import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistencia simple con escritura atómica (temp + rename).
 * Un solo proceso Node es suficiente para la activación en tablet/kiosko.
 */

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function createStore(dataDir) {
  const filePath = path.join(dataDir, 'state.json');
  ensureDir(dataDir);

  let queue = Promise.resolve();

  function readSync() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return { days: {} };
    }
  }

  function writeAtomicSync(obj) {
    ensureDir(dataDir);
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 0), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  /**
   * Serializa mutaciones para evitar condiciones de carrera en lectura/escritura.
   */
  function runMutation(fn) {
    queue = queue.then(() => {
      const state = readSync();
      const out = fn(state);
      writeAtomicSync(state);
      return out;
    });
    return queue;
  }

  return { readSync, runMutation, filePath };
}
