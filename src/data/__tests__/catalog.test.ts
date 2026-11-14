import { describe, expect, it } from 'vitest';
import { BLUEPRINTS, EFFECTS, ITEMS, START, blueprintCost, getBlueprint, hasItem } from '../catalog';

describe('каталог', () => {
  it('2 персонажа, 12 чертежей снаряжения и сумок, 1 камень, 2 флакона', () => {
    expect(BLUEPRINTS.filter((b) => b.kind === 'character')).toHaveLength(2);
    expect(BLUEPRINTS.filter((b) => ['weapon', 'artifact', 'bag'].includes(b.kind))).toHaveLength(12);
    expect(BLUEPRINTS.filter((b) => b.kind === 'gem')).toHaveLength(1);
    expect(BLUEPRINTS.filter((b) => b.kind === 'potion')).toHaveLength(2);
  });
  it('стоимость = число блоков: лобстер 38, варан 22, меч 8, рюкзак 27', () => {
    expect(blueprintCost(getBlueprint('bp-lobster'))).toBe(38);
    expect(blueprintCost(getBlueprint('bp-waran'))).toBe(22);
    expect(blueprintCost(getBlueprint('bp-sword'))).toBe(8);
    expect(blueprintCost(getBlueprint('bp-rucksack'))).toBe(27);
    expect(blueprintCost(getBlueprint('bp-potion-vial'))).toBe(3);
    expect(blueprintCost(getBlueprint('bp-potion-flask'))).toBe(10);
  });
  it('чертёж предмета и предмет ссылаются друг на друга', () => {
    for (const bp of BLUEPRINTS) {
      if (bp.kind === 'character') continue;
      const ids = 'variants' in bp ? bp.variants.map((v) => v.itemId) : [bp.itemId];
      for (const id of ids) {
        expect(hasItem(id), `${bp.id} → ${id}`).toBe(true);
        expect(ITEMS.find((i) => i.id === id)?.blueprintId).toBe(bp.id);
      }
    }
  });
  it('у предметов цвета блоков из чертежа (кроме жидкости зелий), у персонажей — нет', () => {
    for (const bp of BLUEPRINTS) {
      if (bp.kind === 'character') expect(bp.blocks.some((b) => b.color), bp.id).toBe(false);
      else expect(bp.blocks.every((b) => !!b.color || b.tinted), bp.id).toBe(true);
    }
  });
  it('эффекты предметов и стартовый инвентарь существуют', () => {
    for (const i of ITEMS) {
      const effects = 'ability' in i ? i.ability.effects : 'effects' in i ? i.effects : [];
      for (const e of effects) expect(EFFECTS[e], `${i.id} → ${e}`).toBeDefined();
    }
    for (const { itemId } of START.inventory) expect(hasItem(itemId), itemId).toBe(true);
  });
  it('камень льда вместо камня молнии, нож с характеристиками', () => {
    expect(ITEMS.find((i) => i.id === 'iceGem')?.name).toBe('Камень льда');
    expect(ITEMS.some((i) => i.id.toLowerCase().includes('lightning'))).toBe(false);
    const knife = ITEMS.find((i) => i.id === 'rustyKnife');
    expect(knife && 'ability' in knife && knife.ability.damage).toBeGreaterThan(0);
  });
});

describe('модели оружия и сумок', () => {
  const handmade = BLUEPRINTS.filter((bp) => bp.kind === 'weapon' || bp.kind === 'bag');
  const models = handmade.flatMap((bp) => [bp.blocks, ...('levelBlocks' in bp ? bp.levelBlocks ?? [] : [])].map((blocks, k) => ({ id: `${bp.id} ур. ${k + 1}`, blocks })));
  it('все детали одного размера и стоят в целых клетках, по одной в клетке', () => {
    for (const { id, blocks } of models) {
      const cells = new Set(blocks.map((b) => b.pos.join(',')));
      expect(cells.size, id).toBe(blocks.length);
      for (const b of blocks) {
        expect(b.scale, id).toBeUndefined();
        expect(b.pos.every((v) => Number.isInteger(v)), id).toBe(true);
      }
    }
  });
  it('у оружия три модели — по уровням, каждая следующая крупнее', () => {
    for (const bp of handmade) {
      if (bp.kind !== 'weapon' || !('levelBlocks' in bp)) continue;
      expect(bp.levelBlocks, bp.id).toHaveLength(2);
      expect(bp.levelBlocks![0].length, bp.id).toBeGreaterThan(bp.blocks.length);
      expect(bp.levelBlocks![1].length, bp.id).toBeGreaterThan(bp.levelBlocks![0].length);
    }
  });
  it('кватернион есть у блоков из выгрузки Unity (артефакт, зелья, камень)', () => {
    for (const bp of BLUEPRINTS) if (bp.kind === 'artifact' || bp.kind === 'potion' || bp.kind === 'gem') for (const b of bp.blocks) expect(b.quat, bp.id).toHaveLength(4);
  });
});

describe('зелья', () => {
  it('два флакона на 6 стат: жидкость перекрашивается, стекло полупрозрачное', () => {
    for (const [id, liquid] of [['bp-potion-vial', 2], ['bp-potion-flask', 3]] as const) {
      const bp = getBlueprint(id);
      if (bp.kind !== 'potion') throw new Error(id);
      expect(bp.variants).toHaveLength(6);
      expect(bp.blocks.filter((b) => b.tinted)).toHaveLength(liquid);
      expect(bp.blocks.some((b) => b.opacity === 0.7)).toBe(true);
    }
    expect(ITEMS.filter((i) => i.kind === 'potion')).toHaveLength(12);
  });
});

describe('камни', () => {
  it('один чертёж на три стихии, все блоки перекрашиваются', () => {
    const bp = getBlueprint('bp-gem');
    if (bp.kind !== 'gem') throw new Error('bp-gem');
    expect(bp.variants.map((v) => v.itemId)).toEqual(['fireGem', 'iceGem', 'poisonGem']);
    expect(bp.blocks.every((b) => b.tinted)).toBe(true);
    expect(blueprintCost(bp)).toBe(19);
  });
});
