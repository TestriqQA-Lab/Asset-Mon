/**
 * Unit tests for the web app's pure client-side logic (src/lib).
 *
 * Deliberately node-environment and component-free: this exists so that logic
 * like "which MFA step do we resume at" can be exercised without a browser or a
 * rendering library. Nothing tested here touches the DOM; if that changes, this
 * config needs jsdom and a testing-library setup rather than a quiet loosening.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/lib'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
};
