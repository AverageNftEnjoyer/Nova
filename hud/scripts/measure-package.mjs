#!/usr/bin/env node
// Reports the apparent size (sum of file sizes, not disk clusters) of the unpacked Electron build in
// hud/dist/win-unpacked, per top-level area. Plain Node walk: `du` is far slower on Windows.
// Usage: `npm run package:size` from hud/ (optional arg: alternate win-unpacked path).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hudDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.argv[2] || path.join(hudDir, "dist", "win-unpacked"));

function measure(dir) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        bytes += fs.statSync(full).size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).padStart(9);

if (!fs.existsSync(root)) {
  console.error(`[package-size] ${root} not found. Run electron-builder --win --x64 --dir first.`);
  process.exit(1);
}

const total = measure(root);
const areas = [
  ["resources/app/node_modules", path.join(root, "resources", "app", "node_modules")],
  ["resources/app/.next", path.join(root, "resources", "app", ".next")],
  ["resources/app (other)", null],
  ["resources/runtime-resources", path.join(root, "resources", "runtime-resources")],
];

const rows = [];
for (const [label, dir] of areas) {
  if (!dir) continue;
  const m = fs.existsSync(dir) ? measure(dir) : { bytes: 0, files: 0 };
  rows.push([label, m]);
}
const appDir = path.join(root, "resources", "app");
const app = fs.existsSync(appDir) ? measure(appDir) : { bytes: 0, files: 0 };
const appNm = rows[0][1];
const appNext = rows[1][1];
rows.splice(2, 0, ["resources/app (other)", { bytes: app.bytes - appNm.bytes - appNext.bytes, files: app.files - appNm.files - appNext.files }]);
const resourcesDir = path.join(root, "resources");
const resources = measure(resourcesDir);
const resourcesOther = {
  bytes: resources.bytes - app.bytes - rows[3][1].bytes,
  files: resources.files - app.files - rows[3][1].files,
};
rows.push(["resources (other, e.g. app-update.yml)", resourcesOther]);
rows.push(["Electron files (everything outside resources/)", { bytes: total.bytes - resources.bytes, files: total.files - resources.files }]);

console.log(`[package-size] ${root}`);
for (const [label, m] of rows) {
  console.log(`${mb(m.bytes)} MB  ${String(m.files).padStart(7)} files  ${label}`);
}
console.log(`${mb(total.bytes)} MB  ${String(total.files).padStart(7)} files  TOTAL (apparent)`);
const locales = path.join(root, "locales");
if (fs.existsSync(locales)) console.log(`locales: ${fs.readdirSync(locales).join(", ")}`);
