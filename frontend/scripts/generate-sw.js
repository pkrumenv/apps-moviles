import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(scriptDirectory, "../dist");
const serviceWorkerPath = resolve(outputDirectory, "sw.js");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

const files = (await listFiles(outputDirectory))
  .filter((path) => path !== serviceWorkerPath && !path.endsWith(".map"))
  .sort();
const assets = ["/", ...files.map((path) => `/${relative(outputDirectory, path).split(sep).join("/")}`)];
const hash = createHash("sha256");
for (const path of files) {
  hash.update(relative(outputDirectory, path));
  hash.update(await readFile(path));
}
const version = hash.digest("hex").slice(0, 12);
const template = await readFile(serviceWorkerPath, "utf8");
if (!template.includes('const CACHE_NAME = "foodie-shell-dev";') || !template.includes("const APP_SHELL_ASSETS = [];")) {
  throw new Error("No se encontraron los marcadores del precache en dist/sw.js");
}

const output = template
  .replace('const CACHE_NAME = "foodie-shell-dev";', `const CACHE_NAME = "foodie-shell-${version}";`)
  .replace("const APP_SHELL_ASSETS = [];", `const APP_SHELL_ASSETS = ${JSON.stringify(assets)};`);
await writeFile(serviceWorkerPath, output);
console.log(`Service worker listo: ${assets.length} recursos en foodie-shell-${version}.`);
