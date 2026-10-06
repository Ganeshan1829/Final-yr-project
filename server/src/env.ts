import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load <repo>/.env (written by setup.sh). Variables already set in the environment always win.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let cachedPython: string | null = null;

function canRun(bin: string, code: string): boolean {
  try {
    execFileSync(bin, ['-c', code], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Python interpreter used to run the OR-Tools solver. PYTHON_BIN wins. Otherwise the first of python / python3 / py
 * that can run and (preferably) import ortools is used, so machines where only `py` or `python3` exists still work
 * and the Windows Store "python" stub does not break the solver.
 */
export function pythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  if (cachedPython) return cachedPython;
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  const working = candidates.filter((c) => canRun(c, 'import sys'));
  cachedPython = working.find((c) => canRun(c, 'import ortools')) ?? working[0] ?? candidates[0];
  return cachedPython;
}
