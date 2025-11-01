#!/usr/bin/env node
import { watch } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_EXTENSIONS, DIST_DIR, SRC_DIR, copyAssets } from './copy-assets.mjs';

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : null;

async function syncSingle(relPath) {
  const extension = extname(relPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return;
  }

  const source = join(SRC_DIR, relPath);
  const destination = join(DIST_DIR, relPath);

  try {
    const info = await stat(source);
    if (info.isDirectory()) {
      // Directory changes are handled by the recursive copy – nothing specific to do.
      return;
    }

    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    console.log(`[watch-assets] Copied ${relPath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await rm(destination, { force: true });
      console.log(`[watch-assets] Removed ${relPath}`);
      return;
    }

    console.error(`[watch-assets] Failed to sync ${relPath}:`, error);
  }
}

async function start() {
  await copyAssets();
  const watcher = watch(SRC_DIR, { recursive: true }, (event, filename) => {
    if (!filename) {
      return;
    }

    const relPath = filename.toString();
    // For safety, fall back to a full sync on complex events.
    const triggerFullSync = () => copyAssets().catch((error) => {
      console.error('[watch-assets] Full resync failed:', error);
    });

    if (event === 'rename') {
      // File added or removed – attempt targeted sync, but fall back to full copy on failure.
      syncSingle(relPath).catch((error) => {
        console.error(`[watch-assets] Rename handling failed for ${relPath}:`, error);
        triggerFullSync();
      });
      return;
    }

    if (event === 'change') {
      syncSingle(relPath).catch((error) => {
        console.error(`[watch-assets] Change handling failed for ${relPath}:`, error);
        triggerFullSync();
      });
      return;
    }

    triggerFullSync();
  });

  watcher.on('error', (error) => {
    console.error('[watch-assets] Watcher error:', error);
  });

  console.log('[watch-assets] Watching src/ for asset changes…');
}

if (invokedPath === modulePath) {
  start().catch((error) => {
    console.error('[watch-assets] Failed to start watcher:', error);
    process.exitCode = 1;
  });
}
