#!/usr/bin/env node
// Assembles the AMO source-code submission package.
//
// AMO policy requires a reviewable source copy whenever the shipped code is
// machine-generated — here the `dist/` shipped in the extension zip is
// TypeScript compiled by `tsc` (plus copied static assets). This script
// stages everything a reviewer needs to rebuild the shipped extension zip
// byte-for-byte — src/, build scripts, pinned dependencies (lockfile), and a
// README with exact build instructions — and zips it into
// `web-ext-artifacts/<slug>-<version>-source.zip`.
//
// The package is deliberately minimal: no node_modules (restored via
// `npm ci` from the lockfile), no repo docs, no website. All build tools
// (TypeScript compiler, web-ext) are open source and run locally.

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const ARTIFACTS_DIR = resolve(ROOT, "web-ext-artifacts");

// Files/dirs a reviewer must have to reproduce the build. Everything else
// (README, docs/, website/, docker/, artifacts/) is repo documentation, not
// build input.
const SOURCE_DIRS = ["src", "scripts", "tests"];
const ROOT_FILES = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.ts",
  ".nvmrc",
];

function reviewerReadme({ name, version, webExtZipName }) {
  return `# ${name} — source code for AMO review

This package contains the complete source of version ${version}. The
extension submitted for review was built from this exact source using two
open-source, locally run tools: the TypeScript compiler (\`tsc\`) and
Mozilla's \`web-ext\` (packaging). No web services, no other tools.

## Requirements

- Node.js — version pinned in \`.nvmrc\` (\`nvm use\`), any current LTS works
- npm (bundled with Node.js)

## Build

Unzip this package, then from its root:

    npm ci
    npm run build

This compiles \`src/\` → \`dist/\` and packages it into
\`web-ext-artifacts/${webExtZipName}\`. The contents of that zip are
identical to the submitted extension package. (\`tsc\` emits \`.js.map\`
source maps next to each output file; both the \`.js\` and the \`.js.map\`
files are shipped.)

Optional checks:

    npm test        # Vitest unit tests (tests/, jsdom)
    npm run lint    # typecheck + tests + rebuild + web-ext lint

## Package layout

- \`src/\` — extension source: TypeScript modules, \`popup.html\`,
  \`popup.css\`, \`icons/\`, \`manifest.json\`
- \`scripts/\` — build scripts (\`clean.mjs\` wipes \`dist/\`, \`copy-assets.mjs\`
  copies static assets, \`package-source.mjs\` rebuilt this very package)
- \`tests/\` — unit tests; not shipped with the extension
- \`package.json\` / \`package-lock.json\` — pinned dependencies. All of them
  are dev-time only: the shipped extension contains **no third-party
  code**.

## Data practices

The extension collects no data and makes no network requests. The
\`data_collection_permissions.required\` entry in \`manifest.json\` is
\`"none"\`. Runtime state (UI prefs, last reap for the undo toast) stays in
\`browser.storage.session\`, which Firefox clears when the session ends.
`;
}

try {
  const manifest = JSON.parse(
    await readFile(resolve(ROOT, "src", "manifest.json"), "utf8"),
  );
  const slug = manifest.name.toLowerCase().replace(/\s+/g, "_");
  const webExtZipName = `${slug}-${manifest.version}.zip`;
  const zipName = `${slug}-${manifest.version}-source.zip`;

  const stage = await mkdtemp(join(tmpdir(), "tabocalypse-source-"));

  // Stage sources and root build metadata.
  for (const dir of SOURCE_DIRS) {
    await cp(resolve(ROOT, dir), join(stage, dir), { recursive: true });
    console.log(`[package-source] Staged ${dir}/`);
  }
  for (const file of ROOT_FILES) {
    await cp(resolve(ROOT, file), join(stage, file));
    console.log(`[package-source] Staged ${file}`);
  }

  await writeFile(
    join(stage, "README.md"),
    reviewerReadme({
      name: manifest.name,
      version: manifest.version,
      webExtZipName,
    }),
  );
  console.log("[package-source] Generated README.md (build instructions)");

  // Zip the staging root so the archive holds the files themselves
  // (AMO requirement), not a wrapping directory.
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const zipPath = resolve(ARTIFACTS_DIR, zipName);
  await rm(zipPath, { force: true });
  await execFileAsync("zip", ["-r", "-X", zipPath, "."], { cwd: stage });
  const { size } = await readFile(zipPath).then((buf) => ({ size: buf.length }));
  console.log(
    `[package-source] Wrote web-ext-artifacts/${zipName} (${(size / 1024).toFixed(1)} KiB)`,
  );
  console.log(
    "[package-source] Attach this zip when AMO asks for source code " +
      "(upload as-is; the README inside documents the rebuild).",
  );
} catch (error) {
  console.error("[package-source] Failed:", error);
  process.exitCode = 1;
}
