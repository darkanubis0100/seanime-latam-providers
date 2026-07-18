import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const rawBase = process.argv[2]?.replace(/\/$/, "");
if (!rawBase || !/^https:\/\/raw\.githubusercontent\.com\//.test(rawBase)) {
  console.error("Uso: node configure.mjs https://raw.githubusercontent.com/USUARIO/REPO/RAMA");
  process.exit(1);
}

const root = process.cwd();
const manifests = [
  "anime/animeflv/manifest.json",
  "anime/jkanime/manifest.json",
  "manga/manhwaweb/manifest.json",
];

for (const relative of manifests) {
  const file = path.join(root, relative);
  const original = await fs.readFile(file, "utf8");
  const updated = original.replaceAll("__RAW_BASE__", rawBase);
  await fs.writeFile(file, updated, "utf8");
  console.log(`Configurado: ${relative}`);
}

await fs.writeFile(
  path.join(root, "manifest-urls.txt"),
  manifests.map((relative) => `${rawBase}/${relative}`).join("\n") + "\n",
  "utf8",
);
console.log("Listo. URLs guardadas en manifest-urls.txt");
