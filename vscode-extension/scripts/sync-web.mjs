import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(root, "..", "extension");
const dest = path.join(root, "web");

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });

for (const entry of await readdir(src, { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|css|js)$/.test(entry.name)) {
    await cp(path.join(src, entry.name), path.join(dest, entry.name));
  }
}
for (const dir of ["lib", "icons"]) {
  await cp(path.join(src, dir), path.join(dest, dir), { recursive: true, filter: (p) => !p.endsWith(".d.ts") });
}
await writeFile(path.join(dest, "package.json"), JSON.stringify({ type: "module", private: true }));
