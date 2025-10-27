module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 60000, // 60 seconds for E2E tests
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'core.js',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/web-ext-artifacts/**'
  ]
};
