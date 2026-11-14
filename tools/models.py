"""Модели оружия и сумок прототипа — собраны руками из одинаковых кубов и призм.

Правила (чтобы такую же модель можно было собрать из настоящих деталей):
- все детали одного размера: куб 1×1×1 и призма (половина куба по диагонали), никаких уменьшенных блоков;
- детали стоят в целых клетках сетки;
- модель связная: каждая деталь касается соседней целой квадратной гранью (у призмы таких граней две).
check() проверяет это при сборке конфигов.

Оси как в Unity: X — толщина, Y — вверх (от рукояти к острию), Z — вперёд (куда смотрит лезвие).
Рукоять начинается в (0, 0, 0) — за неё оружие держит слот руки.
У оружия три модели — по уровням: обычное, улучшенное, сияющее.
"""
import itertools
import math

WOOD = '#974f17'
STEEL = '#f2f2f2'
GOLD = '#f2b312'
LEATHER = '#974f17'
STRAP = '#6e3a12'

AXES = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}
NAME = {v: k for k, v in AXES.items()}


def _mat(e):
    """Quaternion.Euler(x, y, z) из Unity — как eulerMatrix в src/render/iso.ts: Ry · Rx · Rz."""
    def mul(a, b):
        return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    cx, sx = round(math.cos(math.radians(e[0]))), round(math.sin(math.radians(e[0])))
    cy, sy = round(math.cos(math.radians(e[1]))), round(math.sin(math.radians(e[1])))
    cz, sz = round(math.cos(math.radians(e[2]))), round(math.sin(math.radians(e[2])))
    rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return mul(ry, mul(rx, rz))


def _apply(m, v):
    return tuple(sum(m[i][k] * v[k] for k in range(3)) for i in range(3))


# Призма чертежа: целые грани — верх (+Y) и задняя (−Z). Для каждой пары целых граней — поворот.
WEDGE_ROT = {}
for _e in itertools.product((0, 90, 180, 270), repeat=3):
    _m = _mat(_e)
    _key = frozenset((NAME[_apply(_m, (0, 1, 0))], NAME[_apply(_m, (0, 0, -1))]))
    WEDGE_ROT.setdefault(_key, list(_e))


def C(x, y, z, color):
    return dict(shape='cube', pos=[x, y, z], rot=[0, 0, 0], color=color)


def W(x, y, z, a, b, color):
    """Призма: a и b — её целые грани (например '-y', '-z'); скос смотрит в противоположный угол."""
    return dict(shape='triangle', pos=[x, y, z], rot=WEDGE_ROT[frozenset((a, b))], color=color, faces=sorted((a, b)))


def c(y, z, color):
    return C(0, y, z, color)


def w(y, z, a, b, color):
    return W(0, y, z, a, b, color)


def check(name, blocks):
    cells = {}
    for b in blocks:
        p = tuple(b['pos'])
        assert all(isinstance(v, int) for v in p), f'{name}: деталь не в целой клетке {p}'
        assert 'scale' not in b, f'{name}: уменьшенная деталь {p}'
        assert p not in cells, f'{name}: две детали в клетке {p}'
        cells[p] = set(AXES) if b['shape'] == 'cube' else set(b['faces'])
    start = next(iter(cells))
    seen, todo = {start}, [start]
    while todo:
        p = todo.pop()
        for face in cells[p]:
            d = AXES[face]
            q = (p[0] + d[0], p[1] + d[1], p[2] + d[2])
            back = NAME[(-d[0], -d[1], -d[2])]
            if q in cells and back in cells[q] and q not in seen:
                seen.add(q)
                todo.append(q)
    assert len(seen) == len(cells), f'{name}: не связана — отдельно висят {sorted(set(cells) - seen)}'
    return [{k: v for k, v in b.items() if k != 'faces'} for b in blocks]


def column(y0, y1, z, color):
    return [c(y, z, color) for y in range(y0, y1 + 1)]


# ───────────── оружие: [обычное, улучшенное, сияющее] ─────────────

def sword(level):
    guard = WOOD if level == 1 else GOLD
    top = 4 + (level - 1)  # клинок на куб длиннее с каждым уровнем
    blocks = [c(0, 0, WOOD), c(1, -1, guard), c(1, 0, guard), c(1, 1, guard)]
    blocks += column(2, top, 0, STEEL) + [w(top + 1, 0, '-y', '-z', STEEL)]
    if level >= 2:
        blocks.append(c(-1, 0, GOLD))  # навершие
    if level >= 3:
        # гарда с концами и расширение клинка у основания
        blocks += [w(1, 2, '-z', '-y', GOLD), w(1, -2, '+z', '-y', GOLD), w(2, 1, '-z', '-y', STEEL), w(2, -1, '+z', '-y', STEEL)]
    return blocks


def dagger(level):
    guard = WOOD if level == 1 else GOLD
    top = 3 + (level - 1)
    blocks = [c(0, 0, WOOD), c(1, 0, WOOD), w(1, 1, '-z', '-y', guard), w(1, -1, '+z', '-y', guard)]
    blocks += column(2, top, 0, STEEL) + [w(top + 1, 0, '-y', '-z', STEEL)]
    if level >= 3:
        blocks += [c(-1, 0, GOLD), w(3, 1, '-z', '-y', STEEL)]  # навершие и зубец на лезвии
    return blocks


def axe(level):
    blocks = [c(0, 0, WOOD), c(1, 0, WOOD), c(2, 0, WOOD if level == 1 else GOLD)]
    core = STEEL if level < 3 else GOLD
    blocks += [c(3, 0, core), c(4, 0, core), c(3, 1, STEEL), c(4, 1, STEEL), w(2, 1, '+y', '-z', STEEL), w(5, 1, '-y', '-z', STEEL)]
    if level >= 2:
        blocks.append(c(-1, 0, GOLD))
    if level == 2:
        blocks.append(w(4, -1, '+z', '+y', STEEL))  # клюв на обухе
    if level >= 3:
        # второе лезвие и шип сверху
        blocks += [c(3, -1, STEEL), c(4, -1, STEEL), w(2, -1, '+y', '+z', STEEL), w(5, -1, '-y', '+z', STEEL), w(5, 0, '-y', '-z', STEEL)]
    return blocks


def hammer(level):
    blocks = [c(0, 0, WOOD), c(1, 0, WOOD), c(2, 0, WOOD)]
    core = STEEL if level == 1 else GOLD
    blocks += [c(3, 0, core), c(4, 0, core), c(3, -1, STEEL), c(3, 1, STEEL), c(4, 1, STEEL)]
    blocks.append(w(4, -1, '-y', '+z', STEEL) if level == 1 else c(4, -1, STEEL))
    if level >= 2:
        blocks.append(c(-1, 0, GOLD))
    if level >= 3:
        # боёк длиннее с обеих сторон и шип сверху
        blocks += [c(3, 2, STEEL), c(4, 2, STEEL), c(3, -2, STEEL), c(4, -2, STEEL), w(5, 0, '-y', '-z', GOLD)]
    return blocks


def club(level):
    blocks = [C(0, 0, 0, WOOD), C(0, 1, 0, WOOD), C(0, 2, 0, WOOD if level == 1 else GOLD)]
    ring = [('+x', 1, 0), ('-x', -1, 0), ('+z', 0, 1), ('-z', 0, -1)]
    inward = {'+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z'}
    tiers = 2 if level < 3 else 3
    for t in range(tiers):
        y = 3 + t
        blocks.append(C(0, y, 0, GOLD if level >= 3 and t == 1 else STEEL))
        for side, x, z in ring:
            if t == 0:
                blocks.append(W(x, y, z, inward[side], '+y', STEEL))  # нижний ряд — скос вниз
            elif t == tiers - 1:
                blocks.append(W(x, y, z, inward[side], '-y', STEEL))  # верхний ряд — скос вверх
            else:
                blocks.append(C(x, y, z, STEEL))
    if level >= 2:
        blocks.append(W(0, 3 + tiers, 0, '-y', '-z', STEEL))  # шип сверху
    if level >= 3:
        blocks.append(C(0, -1, 0, GOLD))
    return blocks


def spear(level):
    blocks = column(-2, 1, 0, WOOD) + [c(2, 0, WOOD if level == 1 else GOLD)]
    top = 4 if level < 3 else 5
    blocks += column(3, top, 0, STEEL) + [w(top + 1, 0, '-y', '-z', STEEL), w(4, 1, '-z', '+y', STEEL)]
    if level >= 2:
        blocks.append(w(4, -1, '+z', '+y', STEEL))
    if level >= 3:
        # листовидный наконечник и подток
        blocks += [w(5, 1, '-z', '-y', STEEL), w(5, -1, '+z', '-y', STEEL), w(-3, 0, '+y', '-z', GOLD)]
    return blocks


def knife(level):
    blocks = [c(0, 0, WOOD), c(1, 0, WOOD if level == 1 else GOLD)]
    top = 3 + (level - 1)
    blocks += column(2, top, 0, STEEL) + [w(top + 1, 0, '-y', '+z', STEEL), w(2, 1, '-z', '+y', STEEL)]
    if level >= 3:
        blocks += [c(-1, 0, GOLD), w(3, 1, '-z', '-y', STEEL)]
    return blocks


# ───────────── сумки ─────────────

def bag(width_x, height, depth, pocket_rows, side_pockets, pocket_cap=False):
    """Короб со скошенным клапаном сверху, тёмным ремнём по центру, пряжкой и карманами."""
    xs = range(-(width_x // 2), width_x // 2 + 1)
    blocks = []
    for x in xs:
        for y in range(height):
            for z in range(depth):
                blocks.append(C(x, y, z, STRAP if x == 0 else LEATHER))
        for z in range(depth - 1):
            blocks.append(C(x, height, z, STRAP if x == 0 else LEATHER))
        blocks.append(W(x, height, depth - 1, '-y', '-z', STRAP if x == 0 else LEATHER))  # клапан
        for y in range(pocket_rows):
            blocks.append(C(x, y, depth, GOLD if x == 0 and y == 0 else STRAP))  # передний карман с пряжкой
    if pocket_cap:
        blocks.append(C(0, pocket_rows, depth, STRAP))
    for x in (xs[0] - 1, xs[-1] + 1):
        for z in side_pockets:
            blocks.append(C(x, 0, z, STRAP))
    return blocks


def pouch():
    blocks = bag(3, 1, 2, 0, [])
    blocks.append(C(0, 0, 2, GOLD))  # пряжка
    return blocks


def facing_camera(blocks):
    """Развернуть сумку лицом к камере иконок (она смотрит на грани −X и −Z): зеркало по Z."""
    flip = {'+z': '-z', '-z': '+z'}
    out = []
    for b in blocks:
        pos = [b['pos'][0], b['pos'][1], -b['pos'][2]]
        if b['shape'] == 'cube':
            out.append(dict(b, pos=pos))
        else:
            a, c2 = (flip.get(f, f) for f in b['faces'])
            out.append(W(pos[0], pos[1], pos[2], a, c2, b['color']))
    return out


WEAPONS = {
    'rustySword': sword, 'rustyDagger': dagger, 'rustyAxe': axe, 'rustyHammer': hammer,
    'rustyClub': club, 'rustySpear': spear, 'rustyKnife': knife,
}
BAGS = {
    'pouch': pouch,
    'rucksack': lambda: bag(3, 3, 2, 1, []),
    'rucksackLarge': lambda: bag(3, 4, 2, 2, [0, 1]),
    'rucksackHuge': lambda: bag(3, 5, 3, 1, [1], pocket_cap=True),
}


def weapon_levels(item_id):
    return [check(f'{item_id} ур. {level}', WEAPONS[item_id](level)) for level in (1, 2, 3)]


def bag_blocks(item_id):
    return check(item_id, facing_camera(BAGS[item_id]()))


if __name__ == '__main__':
    for item_id in WEAPONS:
        print(item_id, [len(m) for m in weapon_levels(item_id)])
    for item_id in BAGS:
        print(item_id, len(bag_blocks(item_id)))
