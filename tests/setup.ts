// Jest setup file for E2E tests
import { toMatchImageSnapshot } from 'jest-image-snapshot';

expect.extend({ toMatchImageSnapshot });

// Global test timeout
jest.setTimeout(60000);
