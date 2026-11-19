#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST_DIR = resolve(ROOT, 'dist');

try {
  await rm(DIST_DIR, { recursive: true, force: true });
  console.log(`[clean] Removed ${DIST_DIR}`);
} catch (error) {
  console.error('[clean] Failed to remove dist directory:', error);
  process.exitCode = 1;
}
