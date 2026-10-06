import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run against a throwaway data directory (recreated by tests/globalSetup.ts) so they never modify
// the development database, uploads or exports.
const testDataDir = path.resolve(__dirname, '.test-data');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    globalSetup: ['tests/globalSetup.ts'],
    env: { APP_DATA_DIR: testDataDir },
  },
});
