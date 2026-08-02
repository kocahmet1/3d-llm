/**
 * Windows fix for `vinext start`: serve /assets/* instead of 404ing them.
 *
 * vinext's production server builds an in-memory manifest of dist/client at
 * boot and keys it with `path.relative(base, file)`. On Windows that returns
 * `assets\app-abc123.js`, so the key becomes `/assets\app-abc123.js` while the
 * browser asks for `/assets/app-abc123.js`. The lookup misses, and
 * `tryServeStatic` returns false on a cache miss with no filesystem fallback —
 * so every file in a subdirectory 404s. Root-level files like /favicon.svg
 * still work, which is what makes the failure so confusing: the page's HTML
 * renders, and then not one script loads.
 *
 * The fix is to normalize the separator when the manifest is built. Every
 * other use of that string (the "assets/" hashed-asset test, the .br/.gz/.zst
 * variant lookups, the /index.html aliasing) is written for forward slashes
 * and starts working again for free.
 *
 * Runs from postinstall. It is idempotent, and it never fails the install:
 * if vinext moves the code, this prints a notice and exits 0 rather than
 * blocking `npm install` over a platform-specific convenience.
 *
 * Reported upstream as a vinext bug; delete this once a release fixes it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules/vinext/dist/server/static-file-cache.js",
);

const BUGGY = "relativePath: path.relative(base, batch[j]),";
const FIXED =
  'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';

const note = (message) => console.log(`[patch-vinext] ${message}`);

if (!fs.existsSync(TARGET)) {
  note("vinext static-file-cache not found — nothing to patch.");
  process.exit(0);
}

const source = fs.readFileSync(TARGET, "utf8");

if (source.includes(FIXED)) {
  note("already patched.");
  process.exit(0);
}

if (!source.includes(BUGGY)) {
  note(
    "vinext's static file walk no longer matches the known pattern. If " +
      "`npm run start` 404s /assets/* on Windows, check whether the upstream " +
      "bug is back and update scripts/patch-vinext-windows.mjs.",
  );
  process.exit(0);
}

fs.writeFileSync(TARGET, source.replace(BUGGY, FIXED), "utf8");
note("patched: static assets now resolve on Windows.");
