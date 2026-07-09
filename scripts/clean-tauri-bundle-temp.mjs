import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const bundleDir = join(process.cwd(), "src-tauri", "target", "release", "bundle");

async function cleanDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cleanDir(path);
    if (/^rw\.\d+\..+\.dmg$/.test(entry.name)) await rm(path, { force: true });
  }));
}

await cleanDir(bundleDir);
