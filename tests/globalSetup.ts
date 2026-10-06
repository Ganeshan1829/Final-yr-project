import fs from 'node:fs';
import path from 'node:path';

const testDataDir = path.resolve(__dirname, '../.test-data');

export default function setup() {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  fs.mkdirSync(testDataDir, { recursive: true });
  return () => fs.rmSync(testDataDir, { recursive: true, force: true });
}
