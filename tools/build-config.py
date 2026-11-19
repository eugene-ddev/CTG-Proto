#!/usr/bin/env python3
"""Собирает конфиги прототипа (src/data/config/*.json) из выгрузки Unity (tools/unity-export).

Запуск из корня проекта: python3 tools/build-config.py
Конфиги можно править руками, но при перегенерации правки затрутся — правь этот скрипт
или выгрузку, а ручные значения держи в таблицах ниже.
"""
import json
import models
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'unity-export'
OUT = ROOT / 'src' / 'data' / 'config'

CUBE_MESH = '4f0eaa0f0d1c0274fb4097896c91723e'
TRIANGLE_MESH = '1ca5454622955914da84046663ab6635'
MATERIAL_COLOR = {
    '2ea6ca5c28ec39d409841b2dc0c0f565': '#974f17',  # CubeBrown
    '69a782ab04e60e146aab18f7ebe15c50': '#974f17',  # TriangleBrown
    'a520db7c052b3f342ba3be8816a4fac1': '#f2f2f2',  # CubeWhite
    'a62f7d028a6fad74e97a2873563913b1': '#f2f2f2',  # TriangleWhite
    'f1e19f6d3374eb646a3238563b8edc6a': '#d6090c',  # CubeRed
    '1637d0c8038a1d548b04a2c1b278df3d': '#d6090c',  # TriangleRed
    'a17be04aec140d9419e96e3ffed97efc': '#1182ee',  # CubeBlue
    '518e18e102da2f640a952875e3250d55': '#1182ee',  # TriangleBlue
    '56f3a8344936ae148a408ce5406d0100': '#05e716',  # CubeGreen
    '6b0ae0fd378570948994e7592554f32a': '#05e716',  # TriangleGreen
    'ce82545c3a00ee34494c179a0da89076': '#4a4a4a',  # CubeBlack (и материал PropCube по умолчанию)
    '26176efe0c2871b42a9e7d4afd5bdec9': '#4a4a4a',  # TriangleBlack (и PropTriangle по умолчанию)
    '174ef8ae8bb07b84b86f24b70270a104': '#ff7000',  # CubeOrange
    '1bc0bf45759f59242adae14d7a1bf5fa': '#fec903',  # CubeYellow
    '316c64e8394a52f44950fb12b2095734': '#ffffff',  # CubeTransparentIcon — стекло
    'e920a1f38fcc271438b34fe2c71be785': '#f2f2f2',  # TriangleTransparentIcon — стекло
}
MATERIAL_ALPHA = {'316c64e8394a52f44950fb12b2095734': 0.7, 'e920a1f38fcc271438b34fe2c71be785': 0.7}
# префаб зелья → стата: цвет флакона = цвет куба статы
POTION_PREFAB_STAT = {'Black': 'Armor', 'Red': 'Strength', 'Yellow': 'Dexterity', 'Blue': 'Intelligence', 'Green': 'Stamina', 'Orange': 'Luck'}
STAT = ['Armor', 'Strength', 'Dexterity', 'Intelligence', 'Stamina', 'Luck']  # CharacterBlockType

# префаб → (id чертежа, тип, id предмета). LightningGem в игре — камень льда.
PREFABS = {
    'Sword': ('bp-sword', 'weapon', 'rustySword'),
    'Axe': ('bp-axe', 'weapon', 'rustyAxe'),
    'Club': ('bp-club', 'weapon', 'rustyClub'),
    'Dagger': ('bp-dagger', 'weapon', 'rustyDagger'),
    'Hammer': ('bp-hammer', 'weapon', 'rustyHammer'),
    'Spear': ('bp-spear', 'weapon', 'rustySpear'),
    'Knife': ('bp-knife', 'weapon', 'rustyKnife'),
    'MagicShield': ('bp-magic-shield', 'artifact', 'magicShieldArtifact'),
    'Pouch': ('bp-pouch', 'bag', 'pouch'),
    'Rucksack': ('bp-rucksack', 'bag', 'rucksack'),
}
# масштаб корня префаба предмета (Prefabs/Equipment/**): у оружия 1, у щита 0.5
PREFAB_ROOT_SCALE = {'MagicShield': 0.5}
# категория и очки стат — из бэкенда (CTG-Backend/src/entities/Blueprints): statsPoints / кубов = очков за куб
CHARACTERS = [
    ('bp-lobster', 'Лобстер', 'lobsterBlueprint.json', 3, 40),
    ('bp-waran', 'Варан', 'waranBlueprintNew.json', 1, 30),
]
# Sandbox-ассет → id предмета
SANDBOX_IDS = {
    'rustySword': 'rustySword', 'rustyAxe': 'rustyAxe', 'rustyClub': 'rustyClub', 'rustyDagger': 'rustyDagger',
    'rustyHammer': 'rustyHammer', 'rustySpear': 'rustySpear', 'magic-shield-artifact': 'magicShieldArtifact',
}
# Ручные значения: в Unity их нет
KNIFE = dict(
    name='Ржавый нож', description='Ржавый нож. Черновые характеристики — в Unity нет ассета.',
    scalingStat='Dexterity', minStatRequired=5,
    ability=dict(type='Attack', cooldown=1, staminaCost=2, manaCost=0, range=0.5, damage=130, effects=[]),
)
# Схема удара оружия (battle-rework, этап 4): куда идёт урон сверх прочности куба. В Unity такого нет.
PATTERN = {
    'rustyKnife': 'precise', 'rustyDagger': 'precise', 'rustySword': 'cleave', 'rustySpear': 'pierce',
    'rustyAxe': 'split', 'rustyClub': 'crush', 'rustyHammer': 'crush',
}
# Ударов за одно использование (стамина и кулдаун — один раз): кинжал бьёт дважды за ход.
HITS = {'rustyDagger': 2}
# Баланс прототипа поверх Unity (battle-rework, этапы 4–5 и 0.0.40; подобрано автопоиском по симулятору `npm run sim`):
# оружие в обеих руках (у лобстера две руки, боты берут оружие в обе), сборки с 10/14/18 кубами главной статы;
# у каждого оружия есть, кого оно бьёт и кому проигрывает.
BALANCE = {
    # 0.0.72: прочность куба 10 → 100, весь урон ×10. 0.0.73: остаток у precise — вглубь столбика; копьё и нож вне
    # ротации (combat.json → outOfRotation); урон подобран тюнером (npm run tune: турнир ур. 1 + бои против ботов, ~47–54%).
    'rustyKnife': dict(damage=85),                   # вне ротации
    'rustyDagger': dict(damage=36, staminaCost=4.5), # precise, 2 удара за ход
    'rustySword': dict(damage=240),                  # cleave, кд 2
    'rustySpear': dict(damage=155),                  # вне ротации
    'rustyAxe': dict(cooldown=2, damage=223),        # split
    'rustyClub': dict(cooldown=2, damage=220),       # crush; 0.0.77: кд 3 → 2, урон 505 → 220 (симулятор)
    'rustyHammer': dict(cooldown=2, damage=262, staminaCost=5.5),  # crush, кд 2
    'magicShieldArtifact': dict(damage=20),          # 0.0.72: ×10 вместе с прочностью куба
}

# Кулдауны, которые держим не как в Unity. Щит с кд 1 при длительности 1 ставился бы каждый ход.
COOLDOWN_OVERRIDE = {'magicShieldArtifact': 2}


def fixed_damage(ab):
    """Урон удара без разброса (battle-rework, этап 1): середина диапазона Unity min–max."""
    d = (ab['damageMin'] + ab['damageMax']) / 2
    return int(d) if d == int(d) else d


# Камни: один чертёж, стихия выбирается при крафте. Геометрия — с FireGem, все блоки перекрашиваются.
GEMS = [  # id, название, описание, эффект, вариант, цвет
    ('fireGem', 'Камень огня', 'Накладывает горение', 'burn', 'Огонь', '#d6090c'),
    ('iceGem', 'Камень льда', 'Накладывает заморозку', 'freeze', 'Лёд', '#1182ee'),
    ('poisonGem', 'Камень яда', 'Накладывает яд', 'poison', 'Яд', '#05e716'),
]
# цвет жидкости зелья = цвет куба статы (материалы Cube*Material)
STAT_NOM = {'Armor': 'Броня', 'Strength': 'Сила', 'Dexterity': 'Ловкость', 'Intelligence': 'Интеллект', 'Stamina': 'Выносливость', 'Luck': 'Удача'}
STAT_TINT = {'Armor': '#4a4a4a', 'Strength': '#d6090c', 'Dexterity': '#fec903', 'Intelligence': '#1182ee', 'Stamina': '#05e716', 'Luck': '#ff7000'}
BAGS = {
    'rucksack': dict(name='Рюкзак', description='Лут и снаряжение на арене — 6 ячеек', slot='Rucksack', capacity=6, unused=False),
    # подсумок — стартовый рюкзак на 3 ячейки (надевается в слот рюкзака); отдельного слота подсумка нет
    'pouch': dict(name='Подсумок', description='Лут и снаряжение на арене — 3 ячейки', slot='Rucksack', capacity=3, unused=False),
}
# Рюкзаки побольше — своих моделей в Unity нет; модели всех сумок и оружия — в tools/models.py.
EXTRA_RUCKSACKS = [
    dict(id='rucksackLarge', bp='bp-rucksack-large', name='Большой рюкзак', capacity=12,
         description='Лут и снаряжение на арене — 12 ячеек'),
    dict(id='rucksackHuge', bp='bp-rucksack-huge', name='Походный рюкзак', capacity=18,
         description='Лут и снаряжение на арене — 18 ячеек'),
]

# Эффекты — по таблице «Стихийные эффекты» в доке (черновые значения), длительности в ходах носителя
# Значения горения/яда/щита — из Sandbox Arena клиента (Data/Sandbox/Effects); лёд — по доке.
EFFECTS = {
    'burn': dict(kind='Burn', name='Горение', damageType='Fire', duration=3, interval=1, damagePerTick=30,
                 spreadChance=0.3, maxStacks=3, removes=['freeze']),
    'poison': dict(kind='Poison', name='Яд', damageType='Poison', duration=5, interval=1, damagePerTick=40,
                   statMultiplier=0.7, maxStacks=3),
    'freeze': dict(kind='Freeze', name='Лёд', damageType='Ice', duration=2, interval=1, damagePerTick=10,
                   durabilityMultiplier=0.5, statDisabled=True, maxStacks=1),
    'shield': dict(kind='Shield', name='Магический щит', duration=1),
}
POTION_STATS = [('Armor', 'брони', 'Black'), ('Strength', 'силы', 'Red'), ('Dexterity', 'ловкости', 'Yellow'),
                ('Intelligence', 'интеллекта', 'Blue'), ('Stamina', 'выносливости', 'Green'), ('Luck', 'удачи', 'Orange')]
# Открытые с начала чертежи: варан и меч. Зелья и рюкзак встроены в персонажа и не собираются.
START = dict(cubes=300, unlockAllBlueprints=False,
             blueprints=['bp-waran', 'bp-sword'], inventory=[])


def weapon_base_name(title):
    """«Ржавый меч» → «Меч», «Ржавая булава» → «Булава»."""
    words = title.split(' ')
    name = ' '.join(words[1:]) if len(words) > 1 and words[0].lower().startswith('ржав') else title
    return name[0].upper() + name[1:]


def r(v, n=3):
    v = round(v, n)
    return 0 if v == 0 else v


def item_blocks(raw):
    blocks = []
    for b in raw:
        mesh = b['mesh']
        shape = 'cube' if mesh == 'cube' or mesh.endswith(CUBE_MESH) else 'triangle' if mesh == 'triangle' or mesh.endswith(TRIANGLE_MESH) else None
        if not shape:
            continue  # трейлы, эффекты
        # кватернион — источник истины: эйлеры из него при X = ±90° (gimbal lock) неоднозначны
        block = dict(shape=shape, pos=[r(v) for v in b['pos']], rot=[r(v, 1) for v in b['rot']], quat=[r(v, 5) for v in b['quat']],
                     color=MATERIAL_COLOR[b['mat']])
        if b['mat'] in MATERIAL_ALPHA:
            block['opacity'] = MATERIAL_ALPHA[b['mat']]
        if any(abs(s - 1) > 1e-3 for s in b['scale']):
            block['scale'] = r(b['scale'][0])
        blocks.append(block)
    return blocks


def main():
    items_geo = json.loads((SRC / 'items.json').read_text(encoding='utf-8'))
    potions_geo = json.loads((SRC / 'potions.json').read_text(encoding='utf-8'))
    sandbox = {i['id']: i for i in json.loads((SRC / 'sandbox_items.json').read_text(encoding='utf-8')) if i.get('id')}
    blueprints, items = [], []

    for bp_id, name, file, category, stats_points in CHARACTERS:
        d = json.loads((SRC / 'blueprints' / file).read_text(encoding='utf-8-sig'))
        blocks = [dict(shape='cube' if b['shape'] == 0 else 'triangle',
                       pos=[b['position'][k] for k in 'xyz'], rot=[r(b['rotation'][k], 1) for k in 'xyz']) for b in d['blocks']]
        slots = [dict(type=['Hand', 'Artifact', 'Pouch', 'Rucksack'][s['type']], pos=[r(s['position'][k]) for k in 'xyz'],
                      isLeftHand=s['isLeftHand'], scale=r(s['scale']['x'])) for s in d['slots']]
        base = {k[0].upper() + k[1:]: v for k, v in d['baseStats'].items()}
        blueprints.append(dict(id=bp_id, kind='character', name=name, category=category, statsPoints=stats_points, baseStats=base, slots=slots, blocks=blocks))

    for prefab, (bp_id, kind, item_id) in PREFABS.items():
        # оружие и сумки — модели из tools/models.py (одинаковые кубы и призмы, собираются в жизни);
        # у оружия три модели по уровням. Остальное (артефакт) — геометрия из Unity.
        levels = models.weapon_levels(item_id) if item_id in models.WEAPONS else None
        blocks = levels[0] if levels else models.bag_blocks(item_id) if item_id in models.BAGS else item_blocks(items_geo[prefab])
        if kind == 'weapon' and item_id == 'rustyKnife':
            item = dict(id=item_id, kind='weapon', slot='Hand', itemLevel=1, gemSlots=0, **KNIFE)
        elif kind in ('weapon', 'artifact'):
            s = sandbox[next(k for k, v in SANDBOX_IDS.items() if v == item_id)]
            ab = s['ability']
            effects = ['shield'] if kind == 'artifact' else []
            item = dict(id=item_id, kind=kind, name=s['title'], description=s['description'],
                        slot='Hand' if kind == 'weapon' else 'Artifact', scalingStat=STAT[s['scalingStat']],
                        minStatRequired=s.get('minStatRequired', 0), itemLevel=s.get('itemLevel', 1), gemSlots=s.get('gemSlotsCount', 0),
                        ability=dict(type=['Attack', 'ProjectileAttack', 'ApplyEffect'][int(ab['type'])], cooldown=COOLDOWN_OVERRIDE.get(item_id, int(ab['cooldown'])),
                                     staminaCost=ab['staminaCost'], manaCost=ab['manaCost'], range=ab['range'],
                                     damage=fixed_damage(ab), effects=effects))
        else:
            item = dict(id=item_id, kind='bag', **BAGS[item_id])
        if item_id in PATTERN:
            item['pattern'] = PATTERN[item_id]
        if item_id in HITS:
            item['ability']['hits'] = HITS[item_id]
        if 'ability' in item:
            item['ability'].update(BALANCE.get(item_id, {}))
        if kind == 'weapon':
            # название ур. 1 — просто «Меч»; «Улучшенный …» и «Сияющий …» даёт уровень (data/weaponLooks.ts)
            item['name'] = weapon_base_name(item['name'])
        item['blueprintId'] = bp_id
        items.append(item)
        bp = dict(id=bp_id, kind=kind, name=item['name'], itemId=item_id, blocks=blocks)
        if levels:
            bp['levelBlocks'] = levels[1:]
        if prefab in PREFAB_ROOT_SCALE:
            bp['modelScale'] = PREFAB_ROOT_SCALE[prefab]
        blueprints.append(bp)

    for extra in EXTRA_RUCKSACKS:
        items.append(dict(id=extra['id'], kind='bag', name=extra['name'], description=extra['description'], slot='Rucksack',
                          capacity=extra['capacity'], unused=False, blueprintId=extra['bp']))
        blueprints.append(dict(id=extra['bp'], kind='bag', name=extra['name'], itemId=extra['id'],
                               blocks=models.bag_blocks(extra['id'])))

    # Зелья: два чертежа — малый и большой флакон. Стата (цвет жидкости) выбирается при крафте,
    # каждая стата — отдельный предмет. Геометрия — с красного флакона, жидкость помечена tinted.
    LIQUID = {'#d6090c'}
    for tier, title, amount, blocks_title in (('Vial', 'Малый флакон', 3, 'малый'), ('Flask', 'Большой флакон', 5, 'большой')):
        bp_id = f'bp-potion-{tier.lower()}'
        blocks = item_blocks(potions_geo[f'RedRestore{tier}'])
        for b in blocks:
            if b['color'] in LIQUID:
                del b['color']
                b['tinted'] = True
        variants = []
        for stat, gen, color in POTION_STATS:
            item_id = f'restore{stat}{tier}'
            assert POTION_PREFAB_STAT[color] == stat
            items.append(dict(id=item_id, kind='potion', name=f'{title} {gen}',
                              description=f'Восстанавливает {amount} разбит{"ый куб" if amount == 1 else "ых куба"} {gen}',
                              restoreStat=stat, restoreAmount=amount, maxStack=10, tint=STAT_TINT[stat], blueprintId=bp_id))
            variants.append(dict(key=stat, label=STAT_NOM[stat], itemId=item_id, tint=STAT_TINT[stat]))
        blueprints.append(dict(id=bp_id, kind='potion', name=title, variantLabel='Стата', restoreAmount=amount, variants=variants, blocks=blocks))

    gem_blocks = item_blocks(items_geo['FireGem'])
    for b in gem_blocks:
        del b['color']
        b['tinted'] = True
    gem_variants = []
    for item_id, name, desc, eff, label, tint in GEMS:
        items.append(dict(id=item_id, kind='gem', name=name, description=desc, effects=[eff], tint=tint, blueprintId='bp-gem'))
        gem_variants.append(dict(key=eff, label=label, itemId=item_id, tint=tint))
    blueprints.append(dict(id='bp-gem', kind='gem', name='Камень', variantLabel='Стихия', variants=gem_variants, blocks=gem_blocks))

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda name, data: (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    dump('blueprints.json', blueprints)
    dump('items.json', items)
    dump('effects.json', EFFECTS)
    dump('start.json', START)
    print(f'blueprints: {len(blueprints)}, items: {len(items)}, effects: {len(EFFECTS)}')


if __name__ == '__main__':
    main()
