/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  clearMocks: true,
};
