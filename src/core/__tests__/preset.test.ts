import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, START, getBlueprint, getItem } from '../../data/catalog';
import type { CharacterBlueprint, Stat } from '../../data/types';
import { equip, putInBag } from '../character';
import { completeCraft } from '../craft';
import { applyPreset, clearPreset, matchesPreset, presetsOf, savePreset } from '../preset';
import { addItem, createInitialState, cubeCount, itemCount, type PlayerState } from '../state';

const maxStack = (id: string) => { const it = getItem(id); return 'maxStack' in it ? it.maxStack : 1; };
const lobster = getBlueprint('bp-lobster') as CharacterBlueprint;
const stats38 = (): Stat[] => [...Array(13).fill('Strength'), ...Array(13).fill('Dexterity'), ...Array(12).fill('Stamina')];

/** Лобстер с мечом, рюкзаком и 2 флаконами силы в рюкзаке — пресет сохранён. */
function withPreset(): { s: PlayerState; uid: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
  s = completeCraft(s, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
  for (const id of ['rustySword', 'rucksack']) s = addItem(s, id, 1, 1);
  s = addItem(s, 'restoreStrengthFlask', 2, maxStack('restoreStrengthFlask'));
  const uid = s.characters[0].uid;
  const inv = (id: string) => s.inventory.find((e) => e.itemId === id)!.uid;
  s = equip(s, uid, 0, inv('rustySword'))!;
  s = equip(s, uid, 'rucksack', inv('rucksack'))!;
  s = putInBag(s, uid, 0, inv('restoreStrengthFlask'))!;
  s = savePreset(s, uid)!;
  return { s, uid };
}

/** Снять всё с бойца прямо в инвентарь (как будто переодели). */
const strip = (s: PlayerState): PlayerState => {
  const c = s.characters[0];
  const inv = [...s.inventory];
  for (const e of [...c.equipment, c.rucksack]) if (e) inv.push({ uid: e.uid, itemId: e.itemId, count: 1 });
  for (const e of c.bag) if (e) inv.push({ ...e });
  return { ...s, inventory: inv, characters: [{ ...c, equipment: c.equipment.map(() => null), rucksack: null, bag: [] }] };
};

describe('пресет снаряжения', () => {
  it('сохранение и совпадение', () => {
    const { s } = withPreset();
    expect(presetsOf(s.characters[0])[0]).toEqual({ equipment: ['rustySword', null, null, null, null], rucksack: 'rucksack', bag: [{ itemId: 'restoreStrengthFlask', count: 2 }, null, null, null, null, null] });
    expect(matchesPreset(s.characters[0])).toBe(true);
    expect(matchesPreset(strip(s).characters[0])).toBe(false);
  });

  it('всё есть в инвентаре — берётся оттуда, кубы не тратятся', () => {
    const { s, uid } = withPreset();
    const st = strip(s);
    const r = applyPreset(st, uid)!;
    const c = r.state.characters[0];
    expect(c.equipment[0]?.itemId).toBe('rustySword');
    expect(c.rucksack?.itemId).toBe('rucksack');
    expect(c.bag[0]).toMatchObject({ itemId: 'restoreStrengthFlask', count: 2 });
    expect(cubeCount(r.state)).toBe(cubeCount(st));
    expect(r.report.built).toEqual([]);
    expect(r.report.missing).toEqual([]);
    expect(matchesPreset(c)).toBe(true);
  });

  it('чего нет — собирается, если чертёж уже собирали вручную; иначе — в отчёт и без него', () => {
    const { s, uid } = withPreset();
    // меч и флаконы пропали; меч собирали вручную, флакон — нет
    let st = strip(s);
    st = { ...st, inventory: st.inventory.filter((e) => e.itemId !== 'rustySword' && e.itemId !== 'restoreStrengthFlask'), manuallyCrafted: [...st.manuallyCrafted, getItem('rustySword').blueprintId!] };
    const before = cubeCount(st);
    const r = applyPreset(st, uid)!;
    const c = r.state.characters[0];
    expect(c.equipment[0]?.itemId).toBe('rustySword');
    expect(r.report.built).toEqual([expect.objectContaining({ itemId: 'rustySword', count: 1 })]);
    expect(cubeCount(r.state)).toBeLessThan(before);
    expect(r.report.missing).toEqual([{ itemId: 'restoreStrengthFlask', count: 2, reason: 'notLearned' }]);
    expect(c.bag[0]).toBeNull();
    expect(itemCount(r.state, 'restoreStrengthFlask')).toBe(0);
  });

  it('5 ячеек: сохранить во вторую, очистить; старый одиночный пресет — первая ячейка', () => {
    const { s, uid } = withPreset();
    let st = savePreset(strip(s), uid, 1)!;
    const list = presetsOf(st.characters[0]);
    expect(list).toHaveLength(5);
    expect(list[0]?.rucksack).toBe('rucksack');
    expect(list[1]).toEqual({ equipment: [null, null, null, null, null], rucksack: null, bag: [] });
    expect(matchesPreset(st.characters[0], 1)).toBe(true);
    st = clearPreset(st, uid, 0)!;
    expect(presetsOf(st.characters[0])[0]).toBeNull();
    expect(applyPreset(st, uid, 0)).toBeNull();
    expect(clearPreset(st, uid, 0)).toBeNull();
    const legacy = { ...s, characters: s.characters.map((c) => ({ ...c, presets: undefined, preset: presetsOf(c)[0]! })) };
    expect(presetsOf(legacy.characters[0])[0]?.rucksack).toBe('rucksack');
  });

  it('в серии арены пресет не надевается', () => {
    const { s, uid } = withPreset();
    const inRun = { ...s, arenaRun: { charUid: uid, fight: 2, wins: 1, inBattle: false } };
    expect(applyPreset(inRun, uid)).toBeNull();
  });
});
