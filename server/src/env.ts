import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load <repo>/.env (written by setup.sh). Variables already set in the environment always win.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Python interpreter used to run the OR-Tools solver. setup.sh points PYTHON_BIN at the project's virtualenv so the
 * solver works on systems where only `python3` exists or where packages must not be installed globally.
 */
export function pythonBin(): string {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}
