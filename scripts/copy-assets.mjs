#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
export const SRC_DIR = resolve(ROOT, 'src');
export const DIST_DIR = resolve(ROOT, 'dist');
export const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.svg', '.json']);

function shouldCopyFile(pathname) {
  return ALLOWED_EXTENSIONS.has(extname(pathname).toLowerCase());
}

async function ensureDir(pathname) {
  await mkdir(dirname(pathname), { recursive: true });
}

async function copyDirectory(currentSrc) {
  const entries = await readdir(currentSrc, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(currentSrc, entry.name);
    const relPath = srcPath.slice(SRC_DIR.length + 1);
    const destPath = join(DIST_DIR, relPath);

    if (entry.isDirectory()) {
      await mkdir(destPath, { recursive: true });
      await copyDirectory(srcPath);
      continue;
    }

    if (!shouldCopyFile(relPath)) {
      continue;
    }

    await ensureDir(destPath);
    await copyFile(srcPath, destPath);
    console.log(`[copy-assets] Copied ${relPath}`);
  }
}

export async function copyAssets() {
  await mkdir(DIST_DIR, { recursive: true });
  await copyDirectory(SRC_DIR);
  console.log('[copy-assets] Static assets synced.');
}

const invokedPath = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath === modulePath) {
  try {
    await copyAssets();
  } catch (error) {
    console.error('[copy-assets] Failed to sync assets:', error);
    process.exitCode = 1;
  }
}
