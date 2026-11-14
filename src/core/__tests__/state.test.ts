import { describe, expect, it } from 'vitest';
import { addCubes, addItem, createInitialState, moveInventory, removeItem, sortInventory, spendCubes, totalItemCount, type PlayerState } from '../state';
import { SAVE_KEY, clearSave, loadState, saveState, type KeyValueStorage } from '../save';
import { cubeCount } from '../state';

const start = { cubes: 300, unlockAllBlueprints: true, inventory: [{ itemId: 'potion', count: 7 }] };
const stack = (id: string) => (id === 'potion' ? 5 : 1);
const fresh = () => createInitialState(start, ['bp-a', 'bp-b'], stack);
const pots = (s: PlayerState) => s.inventory.filter((e) => e.itemId === 'potion');

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

describe('начальное состояние', () => {
  it('кубы, открытые чертежи и стопки зелий по maxStack', () => {
    const s = fresh();
    expect(cubeCount(s)).toBe(300);
    expect(s.unlockedBlueprints).toEqual(['bp-a', 'bp-b']);
    expect(pots(s).map((e) => e.count)).toEqual([5, 2]);
    expect(s.inventory.filter((e) => e.itemId === 'cube').map((e) => e.count)).toEqual([100, 100, 100]); // кубы — стопки по 100
    expect(new Set(s.inventory.map((e) => e.uid)).size).toBe(5);
  });
});

describe('кубы', () => {
  it('не уходят в минус и не тратятся сверх запаса', () => {
    expect(cubeCount(addCubes(fresh(), -1000))).toBe(0);
    expect(spendCubes(fresh(), 301)).toBeNull();
    expect(cubeCount(spendCubes(fresh(), 38)!)).toBe(262);
  });
});

describe('инвентарь', () => {
  it('стакающиеся докладываются в неполную стопку', () => {
    const s = addItem(fresh(), 'potion', 4, 5);
    expect(pots(s).map((e) => e.count)).toEqual([5, 5, 1]);
    expect(totalItemCount(s)).toBe(311);
  });
  it('снаряжение — отдельной записью на штуку', () => {
    const s = addItem(fresh(), 'sword', 2, 1);
    expect(s.inventory.filter((e) => e.itemId === 'sword')).toHaveLength(2);
  });
  it('removeItem убирает пустую запись', () => {
    const s0 = fresh();
    const s = removeItem(s0, pots(s0)[1].uid, 2);
    expect(pots(s)).toHaveLength(1);
  });
  it('операции не мутируют исходное состояние', () => {
    const s0 = fresh();
    const snapshot = JSON.stringify(s0);
    addItem(s0, 'potion', 3, 5);
    removeItem(s0, s0.inventory[0].uid, 1);
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});

describe('сохранение', () => {
  it('сохраняет и загружает то же состояние', () => {
    const st = new MemoryStorage();
    const s = addCubes(fresh(), 100);
    expect(saveState(st, s)).toBe(true);
    expect(loadState(st, fresh())).toEqual(s);
  });
  it('новые поля добираются из свежего состояния', () => {
    const st = new MemoryStorage();
    const { manuallyCrafted: _, ...old } = addCubes(fresh(), 5);
    st.setItem(SAVE_KEY, JSON.stringify(old));
    const loaded = loadState(st, fresh()) as PlayerState;
    expect(cubeCount(loaded)).toBe(305);
    expect(loaded.manuallyCrafted).toEqual([]);
  });
  it('битый JSON, чужая версия и пустое хранилище → null', () => {
    const st = new MemoryStorage();
    expect(loadState(st, fresh())).toBeNull();
    st.setItem(SAVE_KEY, '{oops');
    expect(loadState(st, fresh())).toBeNull();
    st.setItem(SAVE_KEY, JSON.stringify({ ...fresh(), version: 999 }));
    expect(loadState(st, fresh())).toBeNull();
    expect(loadState(null, fresh())).toBeNull();
  });
  it('clearSave удаляет сейв', () => {
    const st = new MemoryStorage();
    saveState(st, fresh());
    clearSave(st);
    expect(st.getItem(SAVE_KEY)).toBeNull();
  });
});

describe('порядок инвентаря', () => {
  const ms = (id: string) => (id.startsWith('restore') ? 5 : 1);
  const base = () => {
    let s = createInitialState({ cubes: 0, unlockAllBlueprints: false, inventory: [] }, [], ms);
    s = addItem(s, 'rustySword', 1, 1);
    s = addItem(s, 'restoreStrengthVial', 3, 5);
    s = addItem(s, 'rustyAxe', 1, 1);
    return { ...s, inventory: [...s.inventory, { uid: 'v2', itemId: 'restoreStrengthVial', count: 4 }] };
  };
  it('на другой предмет — обмен местами, на пустое — в конец', () => {
    const s = base();
    const [sword, vial, axe] = s.inventory;
    const swapped = moveInventory(s, sword.uid, axe.uid, ms)!;
    expect(swapped.inventory.map((e) => e.itemId)).toEqual(['rustyAxe', 'restoreStrengthVial', 'rustySword', 'restoreStrengthVial']);
    const toEnd = moveInventory(s, vial.uid, null, ms)!;
    expect(toEnd.inventory[3].uid).toBe(vial.uid);
    expect(moveInventory(s, sword.uid, sword.uid, ms)).toBeNull();
  });
  it('то же зелье — в стопку до максимума, остаток на месте', () => {
    const s = base();
    const vial = s.inventory[1];
    const out = moveInventory(s, 'v2', vial.uid, ms)!; // 3 + 4 → 5 и 2
    expect(out.inventory.find((e) => e.uid === vial.uid)!.count).toBe(5);
    expect(out.inventory.find((e) => e.uid === 'v2')!.count).toBe(2);
    const sorted = sortInventory(out, (a, b) => a.itemId.localeCompare(b.itemId));
    expect(sorted.inventory.map((e) => e.itemId)[0]).toBe('restoreStrengthVial');
  });
});
