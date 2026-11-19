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

/** Лобстер с мечом и запасным топором во встроенном рюкзаке — пресет сохранён. */
function withPreset(): { s: PlayerState; uid: string } {
  let s = createInitialState({ ...START, unlockAllBlueprints: true }, BLUEPRINTS.map((b) => b.id), maxStack);
  s = completeCraft(s, lobster, { manual: true, maxStack, blockStats: stats38() })!.state;
  for (const id of ['rustySword', 'rustyAxe']) s = addItem(s, id, 1, 1);
  const uid = s.characters[0].uid;
  const inv = (id: string) => s.inventory.find((e) => e.itemId === id)!.uid;
  s = equip(s, uid, 0, inv('rustySword'))!;
  s = putInBag(s, uid, 0, inv('rustyAxe'))!;
  s = savePreset(s, uid)!;
  return { s, uid };
}

/** Снять всё с бойца прямо в инвентарь (как будто переодели). */
const strip = (s: PlayerState): PlayerState => {
  const c = s.characters[0];
  const inv = [...s.inventory];
  for (const e of c.equipment) if (e) inv.push({ uid: e.uid, itemId: e.itemId, count: 1 });
  for (const e of c.bag) if (e) inv.push({ ...e });
  return { ...s, inventory: inv, characters: [{ ...c, equipment: c.equipment.map(() => null), bag: [] }] };
};

describe('пресет снаряжения', () => {
  it('сохранение и совпадение', () => {
    const { s } = withPreset();
    expect(presetsOf(s.characters[0])[0]).toEqual({ equipment: ['rustySword', null, null, null, null], bag: [{ itemId: 'rustyAxe', count: 1 }, null, null] });
    expect(matchesPreset(s.characters[0])).toBe(true);
    expect(matchesPreset(strip(s).characters[0])).toBe(false);
  });

  it('всё есть в инвентаре — берётся оттуда, кубы не тратятся', () => {
    const { s, uid } = withPreset();
    const st = strip(s);
    const r = applyPreset(st, uid)!;
    const c = r.state.characters[0];
    expect(c.equipment[0]?.itemId).toBe('rustySword');
    expect(c.rucksackLevel).toBe(1);
    expect(c.bag[0]).toMatchObject({ itemId: 'rustyAxe', count: 1 });
    expect(cubeCount(r.state)).toBe(cubeCount(st));
    expect(r.report.built).toEqual([]);
    expect(r.report.missing).toEqual([]);
    expect(matchesPreset(c)).toBe(true);
  });

  it('чего нет — собирается, если чертёж уже собирали вручную; иначе — в отчёт и без него', () => {
    const { s, uid } = withPreset();
    // меч и топор пропали; меч собирали вручную, топор — нет
    let st = strip(s);
    st = { ...st, inventory: st.inventory.filter((e) => e.itemId !== 'rustySword' && e.itemId !== 'rustyAxe'), manuallyCrafted: [...st.manuallyCrafted, getItem('rustySword').blueprintId!] };
    const before = cubeCount(st);
    const r = applyPreset(st, uid)!;
    const c = r.state.characters[0];
    expect(c.equipment[0]?.itemId).toBe('rustySword');
    expect(r.report.built).toEqual([expect.objectContaining({ itemId: 'rustySword', count: 1 })]);
    expect(cubeCount(r.state)).toBeLessThan(before);
    expect(r.report.missing).toEqual([{ itemId: 'rustyAxe', count: 1, reason: 'notLearned' }]);
    expect(c.bag[0]).toBeNull();
    expect(itemCount(r.state, 'rustyAxe')).toBe(0);
  });

  it('5 ячеек: сохранить во вторую, очистить; старый одиночный пресет — первая ячейка', () => {
    const { s, uid } = withPreset();
    let st = savePreset(strip(s), uid, 1)!;
    const list = presetsOf(st.characters[0]);
    expect(list).toHaveLength(5);
    expect(list[0]?.equipment[0]).toBe('rustySword');
    expect(list[1]).toEqual({ equipment: [null, null, null, null, null], bag: [] });
    expect(matchesPreset(st.characters[0], 1)).toBe(true);
    st = clearPreset(st, uid, 0)!;
    expect(presetsOf(st.characters[0])[0]).toBeNull();
    expect(applyPreset(st, uid, 0)).toBeNull();
    expect(clearPreset(st, uid, 0)).toBeNull();
    const legacy = { ...s, characters: s.characters.map((c) => ({ ...c, presets: undefined, preset: presetsOf(c)[0]! })) };
    expect(presetsOf(legacy.characters[0])[0]?.equipment[0]).toBe('rustySword');
  });

  it('в серии арены пресет не надевается', () => {
    const { s, uid } = withPreset();
    const inRun = { ...s, arenaRun: { charUid: uid, fight: 2, wins: 1, inBattle: false } };
    expect(applyPreset(inRun, uid)).toBeNull();
  });
});
