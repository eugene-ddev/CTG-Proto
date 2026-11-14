// Блоки 3D-боя из Unity-клиента: меши куба и клина (с шипом сверху) и материалы URP Lit.
// Источник — CTG/Assets/Resources/Models; конвертеры: tools/unity-export/blocks.mjs (меши) и block_maps.py (карты).
// Геометрия — в координатах Unity, размер блока 1 (как в чертежах).
import {
  BoxGeometry, BufferGeometry, Color, EdgesGeometry, Float32BufferAttribute, MeshStandardMaterial, NoColorSpace, SRGBColorSpace, Texture, TextureLoader,
  Uint16BufferAttribute, Vector3,
} from 'three';
import type { BlockShape } from '../data/types';
import data from '../assets/models/blocks.json';
import cubeAoUrl from '../assets/models/cube_ao.png?url';
import cubeNormalUrl from '../assets/models/cube_normal.png?url';
import wedgeNormalUrl from '../assets/models/wedge_normal.png?url';

interface MeshData { position: number[]; normal: number[]; uv: number[]; index: number[] }

function geometry(d: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(d.position, 3));
  g.setAttribute('normal', new Float32BufferAttribute(d.normal, 3));
  g.setAttribute('uv', new Float32BufferAttribute(d.uv, 2));
  g.setIndex(new Uint16BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

/** Меши общие для всех боёв — не освобождаются вместе с ареной. */
export const BLOCK_GEO: Record<'cube' | 'wedge', BufferGeometry> = {
  cube: geometry(data.cube as MeshData),
  wedge: geometry(data.wedge as MeshData),
};
export const blockGeometry = (shape: BlockShape) => (shape === 'cube' ? BLOCK_GEO.cube : BLOCK_GEO.wedge);

/** Клин из чертежей: призма вдоль X, целые грани — верх и задняя (как WEDGE в render/iso.ts); нужен для контура. */
function wedgeGeometry(): BufferGeometry {
  const h = 0.5;
  const verts: Array<[number, number, number]> = [[-h, -h, -h], [-h, h, -h], [-h, h, h], [h, -h, -h], [h, h, -h], [h, h, h]];
  const faces = [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [0, 2, 5, 3]];
  const centre = new Vector3(0, h / 3, -h / 3);
  const pos: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), mid = new Vector3();
  for (const f of faces) {
    for (let k = 1; k < f.length - 1; k++) {
      a.set(...verts[f[0]]);
      b.set(...verts[f[k]]);
      c.set(...verts[f[k + 1]]);
      n.crossVectors(b.clone().sub(a), c.clone().sub(a));
      mid.copy(a).add(b).add(c).divideScalar(3).sub(centre);
      const tri = n.dot(mid) >= 0 ? [a, b, c] : [a, c, b];
      for (const p of tri) pos.push(p.x, p.y, p.z);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Контуры блоков — по габариту (без шипа). */
export const BLOCK_EDGES: Record<'cube' | 'wedge', EdgesGeometry> = {
  cube: new EdgesGeometry(new BoxGeometry(1, 1, 1)),
  wedge: new EdgesGeometry(wedgeGeometry()),
};
export const blockEdges = (shape: BlockShape) => (shape === 'cube' ? BLOCK_EDGES.cube : BLOCK_EDGES.wedge);

let maps: { cubeNormal: Texture; cubeAo: Texture; wedgeNormal: Texture } | undefined;
let loaded = 0;
/** Сколько карт уже загружено: превью, нарисованные раньше, перерисовываются, когда число меняется. */
export const blockMapsLoaded = () => loaded;
/** Карты грузятся один раз при первом бое; до загрузки блоки рисуются без них. */
function blockMaps() {
  if (maps) return maps;
  const loader = new TextureLoader();
  const load = (url: string, srgb: boolean) => {
    const tex = loader.load(url, () => loaded++);
    tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  maps = { cubeNormal: load(cubeNormalUrl, false), cubeAo: load(cubeAoUrl, false), wedgeNormal: load(wedgeNormalUrl, false) };
  return maps;
}

/**
 * Цвета материалов клиента (Resources/Models/Materials, _BaseColor) вместо цветов прототипа:
 * стата → материал куба (Броня — Black, Сила — Red, Ловкость — Yellow, Интеллект — Blue, Выносливость — Green, Удача — Orange),
 * дерево и металл предметов → Brown и White. Остальные цвета (тёмное дерево, золото, стекло) — как в прототипе.
 */
const UNITY_COLOR = new Map<number, number>([
  [0x3a3a3a, 0x4b4b4b], // Armor → Black
  [0xd01c1c, 0xd6090c], // Strength → Red
  [0xf2c014, 0xfec903], // Dexterity → Yellow
  [0x1e74d0, 0x1283ef], // Intelligence → Blue
  [0x22d022, 0x05e716], // Stamina → Green
  [0xf07818, 0xff7000], // Luck → Orange
  [0x1182ee, 0x1283ef], // синий предметов → Blue
  [0xf2f2f2, 0xf3f3f3], // металл → White
  [0x974f17, 0x974f17], // дерево → Brown
]);
export const unityColor = (color: number) => UNITY_COLOR.get(color) ?? color;

/**
 * Материал блока как в клиенте (URP Lit, металличность 0):
 * куб — гладкость 0.7, нормали ×2, затенение по Cube_HeightMap; клин — гладкость 1, нормали ×1.
 * Каждому блоку свой экземпляр — бой меняет цвет, свечение и прозрачность поблочно; шейдер общий.
 */
export function blockMaterial(shape: BlockShape, color: number, opacity = 1): MeshStandardMaterial {
  const m = blockMaps();
  const cube = shape === 'cube';
  const mat = new MeshStandardMaterial({
    color: unityColor(color),
    metalness: 0,
    // гладкость 1 у клина без отражений в сцене дала бы точечный блик — чуть шероховатее, чтобы блик читался
    roughness: cube ? 0.3 : 0.12,
    normalMap: cube ? m.cubeNormal : m.wedgeNormal,
    aoMap: cube ? m.cubeAo : null,
    aoMapIntensity: 1,
    transparent: opacity < 1,
    opacity,
  });
  mat.normalScale.setScalar(cube ? 2 : 1);
  return mat;
}

/** Материал для разлетающихся целых кубов (InstancedMesh, цвет — по экземплярам). */
export function chunkBlockMaterial(): MeshStandardMaterial {
  const mat = blockMaterial('cube', 0xffffff);
  mat.color = new Color(0xffffff);
  return mat;
}
