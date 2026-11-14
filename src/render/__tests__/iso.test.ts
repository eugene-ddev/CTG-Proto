import { describe, expect, it } from 'vitest';
import { eulerMatrix, prepareModel, projectModel, projectPoint } from '../iso';
import type { BlockGeometry } from '../../data/types';
import { getBlueprint } from '../../data/catalog';

const cube = (x: number, y: number, z: number): BlockGeometry => ({ shape: 'cube', pos: [x, y, z], rot: [0, 0, 0] });
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe('эйлеры Unity (Z, потом X, потом Y)', () => {
  it('поворот X на 90 переводит +Y в +Z', () => {
    const m = eulerMatrix([90, 0, 0]);
    close([m[0][1], m[1][1], m[2][1]], [0, 0, 1]);
  });
  it('Y на 90 переводит +Z в +X', () => {
    const m = eulerMatrix([0, 90, 0]);
    close([m[0][2], m[1][2], m[2][2]], [1, 0, 0]);
  });
});

describe('проекция', () => {
  it('у одиночного куба видно 3 грани: верх и две боковые', () => {
    expect(projectModel(prepareModel([cube(0, 0, 0)]))).toHaveLength(3);
  });
  it('грань между соседними кубами скрыта', () => {
    const faces = projectModel(prepareModel([cube(0, 0, 0), cube(1, 0, 0)]));
    expect(faces).toHaveLength(5); // 2 верха + 2 передние + 1 торец
  });
  it('верхний блок выше на экране, дальний — раньше в порядке отрисовки', () => {
    expect(projectPoint([0, 1, 0]).y).toBeLessThan(projectPoint([0, 0, 0]).y);
    const faces = projectModel(prepareModel([cube(0, 0, 0), cube(0, 0, 3)]));
    expect(faces[0].block).toBe(1); // z больше — дальше от камеры
  });
  it('поворот модели на 90° не теряет граней одиночного куба', () => {
    expect(projectModel(prepareModel([cube(0, 0, 0)]), { yaw: 90 })).toHaveLength(3);
  });
  it('клин: видно 3 грани при любом повороте вокруг Y', () => {
    const wedge: BlockGeometry = { shape: 'triangle', pos: [0, 0, 0], rot: [0, 0, 0] };
    for (const yaw of [0, 90, 180, 270]) {
      const n = projectModel(prepareModel([wedge]), { yaw }).length;
      expect(n, `yaw ${yaw}`).toBeGreaterThanOrEqual(2);
      expect(n, `yaw ${yaw}`).toBeLessThanOrEqual(4);
    }
  });
});

describe('кватернионы', () => {
  it('совпадают с эйлерами там, где эйлеры однозначны', async () => {
    const { quatMatrix } = await import('../iso');
    // Quaternion.Euler(-90, 0, 0) = (-0.70711, 0, 0, 0.70711)
    const a = eulerMatrix([-90, 0, 0]);
    const b = quatMatrix([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    for (let i = 0; i < 3; i++) close(a[i], b[i]);
  });
});

describe('прозрачность', () => {
  it('грань непрозрачного блока за стеклом не скрывается, а стекло за непрозрачным — скрывается', () => {
    const glass: BlockGeometry = { shape: 'cube', pos: [0, 0, -1], rot: [0, 0, 0], opacity: 0.7 };
    const prep = prepareModel([cube(0, 0, 0), glass]);
    expect(prep[0].hidden.filter(Boolean)).toHaveLength(0); // жидкость видна сквозь стекло
    expect(prep[1].hidden.filter(Boolean)).toHaveLength(1); // стекло к жидкости — внутренняя грань
  });
});

describe('сборка: силуэт и отсутствующие блоки', () => {
  it('силуэт не закрывает грань поставленного соседа, отсутствующий блок не рисуется', () => {
    const prep = prepareModel([cube(0, 0, 0), cube(1, 0, 0)], (i) => (i === 0 ? 'solid' : 'ghost'));
    expect(prep[0].hidden.filter(Boolean)).toHaveLength(0);
    expect(prep[1].hidden.filter(Boolean)).toHaveLength(1);
    const gone = prepareModel([cube(0, 0, 0), cube(1, 0, 0)], (i) => (i === 0 ? 'solid' : 'hidden'));
    expect(gone[1].hidden.every(Boolean)).toBe(true);
    expect(gone[0].hidden.filter(Boolean)).toHaveLength(0);
  });
});

describe('контур недостроенной части', () => {
  it('не прячет грани доступного силуэта (центр камня окружён контуром)', () => {
    const gem = getBlueprint('bp-gem');
    const seed = gem.blocks.findIndex((b) => b.pos[0] === 0 && b.pos[1] === 0 && b.pos[2] === 0);
    const prep = prepareModel(gem.blocks, (i) => (i === seed ? 'ghost' : 'faint'));
    expect(prep[seed].hidden.filter((h) => !h).length).toBeGreaterThan(1);
    // а внутренние грани контура между собой скрыты
    const center = gem.blocks.findIndex((b) => b.pos[0] === 0 && b.pos[1] === 1 && b.pos[2] === 0);
    expect(prep[center].hidden.filter((h) => h).length).toBeGreaterThan(3);
  });
});
