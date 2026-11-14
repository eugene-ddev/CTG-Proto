// Меши куба и клина из Unity-клиента → src/assets/models/blocks.json для 3D-боя.
// Запуск из корня прототипа: node tools/unity-export/blocks.mjs [путь к Assets/Resources/Models]
// По умолчанию — соседний клиент: ../CTG/Assets/Resources/Models.
//
// Что делает с FBX:
//  - применяет поворот узла (−90° по X от экспорта из Blender), масштаб узла (×100) отбрасывает;
//  - переводит в координаты Unity (её импортёр зеркалит X) и чинит обход треугольников после зеркала;
//  - нормирует размер: куб 2×2×2 в файле → 1×1×1 (как блоки в чертежах), шип сверху остаётся (+0.14);
//  - склеивает одинаковые вершины и пишет индексы.
// Текстуры (карты нормалей и AO) уменьшает tools/unity-export/block_maps.py.
import fs from 'node:fs';
import path from 'node:path';
import { Euler, Matrix4 } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const src = process.argv[2] ?? path.resolve('../CTG/Assets/Resources/Models');
const out = path.resolve('src/assets/models/blocks.json');
const FILES = { cube: 'Cube/CubeLowPoly.fbx', wedge: 'Triangle/TriangleLowPoly.fbx' };
const round = (v) => Math.round(v * 1e4) / 1e4;

// FBXLoader пытается грузить текстуры из файла — в node нет document; текстуры нам не нужны.
globalThis.document ??= { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };

function convert(file) {
  const buf = fs.readFileSync(file);
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  let mesh;
  root.traverse((o) => o.isMesh && (mesh ??= o));
  if (!mesh) throw new Error(`нет меша в ${file}`);
  const g = mesh.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  g.applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler().copy(mesh.rotation)));
  g.applyMatrix4(new Matrix4().makeScale(-0.5, 0.5, 0.5)); // Unity: X зеркально, размер 1
  // зеркало вывернуло треугольники — меняем порядок 2-й и 3-й вершины
  if (g.index) throw new Error('ожидался неиндексированный меш');
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array, k = attr.itemSize;
    for (let t = 0; t < attr.count; t += 3) {
      for (let c = 0; c < k; c++) {
        const i1 = (t + 1) * k + c, i2 = (t + 2) * k + c;
        [a[i1], a[i2]] = [a[i2], a[i1]];
      }
    }
  }
  const merged = mergeVertices(g, 1e-4);
  const pack = (name) => Array.from(merged.attributes[name].array, round);
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox;
  console.log(`${path.basename(file)}: ${merged.attributes.position.count} вершин, ${merged.index.count / 3} треугольников, bbox [${min.toArray().map(round)}] … [${max.toArray().map(round)}]`);
  return { position: pack('position'), normal: pack('normal'), uv: pack('uv'), index: Array.from(merged.index.array) };
}

const result = {};
for (const [key, rel] of Object.entries(FILES)) result[key] = convert(path.join(src, rel));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result));
console.log(`→ ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(1)} КБ)`);
