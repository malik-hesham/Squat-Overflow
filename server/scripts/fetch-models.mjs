// Downloads the BlazePose TF.js graph models (detector + lite landmark) into models/.
// They are committed, so this only needs to run when bumping a model version.
//   node scripts/fetch-models.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'models', 'blazepose');
const MODELS = {
  detector: 'https://tfhub.dev/mediapipe/tfjs-model/blazepose_3d/detector/1',
  'landmark-lite': 'https://tfhub.dev/mediapipe/tfjs-model/blazepose_3d/landmark/lite/2',
};

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

for (const [name, base] of Object.entries(MODELS)) {
  const dir = join(ROOT, name);
  await mkdir(dir, { recursive: true });
  const modelRes = await get(`${base}/model.json?tfjs-format=file`);
  const model = await modelRes.json();
  await writeFile(join(dir, 'model.json'), JSON.stringify(model));
  for (const group of model.weightsManifest) {
    for (const path of group.paths) {
      // Each file redirects to its own signed URL, so resolve shards against the tfhub URL.
      const buf = Buffer.from(await (await get(`${base}/${path}?tfjs-format=file`)).arrayBuffer());
      await writeFile(join(dir, path), buf);
      console.log(`${name}/${path}  ${(buf.length / 1024).toFixed(0)} KiB`);
    }
  }
}
