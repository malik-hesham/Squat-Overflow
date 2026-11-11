// Bundles the part of three.js the extension uses into lib/vendor/three.js: one minified ES module
// (MV3 pages can't load remote code), tree-shaken to the classes below, with lib/vendor/three.d.ts
// so TypeScript reads the real types instead of the minified code. Run after changing the list or
// the three version in package.json (keep @types/three on the same version):
//   cd extension && npm run vendor:three
//
// Who uses it: the sensitive-mode soft toys (avatar.js, lib/avatar-kit.js, lib/avatar-characters.js).
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const CORE = [
  "BufferAttribute",
  "BufferGeometry",
  "CircleGeometry",
  "Color",
  "ConeGeometry",
  "CylinderGeometry",
  "DirectionalLight",
  "DoubleSide",
  "ExtrudeGeometry",
  "Group",
  "HemisphereLight",
  "Mesh",
  "MeshBasicMaterial",
  "MeshPhysicalMaterial",
  "MeshStandardMaterial",
  "NeutralToneMapping",
  "OrthographicCamera",
  "PMREMGenerator",
  "SRGBColorSpace",
  "Scene",
  "Shape",
  "ShapeUtils",
  "SphereGeometry",
  "TorusGeometry",
  "Vector2",
  "Vector3",
  "WebGLRenderer",
];
/** Addons, by the file they come from. */
const ADDONS = {
  RoomEnvironment: "three/examples/jsm/environments/RoomEnvironment.js",
  RoundedBoxGeometry: "three/examples/jsm/geometries/RoundedBoxGeometry.js",
};

const root = new URL("..", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("node_modules/three/package.json", root), "utf8"));
const revision = version.split(".")[1];
const exports = (from) => (names) => `export { ${names.join(", ")} } from "${from}";\n`;
const entry =
  exports("three")(CORE) + Object.entries(ADDONS).map(([name, file]) => exports(file)([name])).join("");

const out = await build({
  stdin: { contents: entry, resolveDir: new URL(".", root).pathname, loader: "js" },
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  write: false,
  legalComments: "inline",
  banner: {
    js: `/* three.js r${revision} (${version}), MIT License, Copyright 2010-2026 Three.js Authors. https://threejs.org - tree-shaken bundle for Squat-Overflow (the soft toys); rebuild with npm run vendor:three. */`,
  },
});
writeFileSync(new URL("lib/vendor/three.js", root), out.outputFiles[0].text);
writeFileSync(
  new URL("lib/vendor/three.d.ts", root),
  `// Types for the tree-shaken three.js r${revision} bundle next to this file, written by
// scripts/vendor-three.mjs (edit the list there). TypeScript reads this instead of type-checking the
// minified three.js. Keep @types/three in extension/package.json on the bundle's three.js version.
${exports("three")(CORE).replace(/, /g, ",\n  ").replace("{ ", "{\n  ").replace(" }", ",\n}")}${Object.entries(ADDONS)
    .map(([name, file]) => exports(file)([name]))
    .join("")}`,
);
console.log(`vendor-three: lib/vendor/three.js (${(out.outputFiles[0].contents.length / 1024).toFixed(0)} KB) from three ${version}`);
