# Экспорт из Unity-клиента

Сырые данные, снятые с `F:\Projects\games\CTG\Assets\_CTG` скриптом на машине с проектом. На этапе 1 они
конвертируются в конфиги `src/data`.

| Файл | Что |
| --- | --- |
| `parse_prefab.py` | Разбор YAML префабов: блоки-кубы и клинья (MeshFilter и вложенные PropCube/PropTriangle), мировые позиции, повороты, материал |
| `items.json` | Геометрия (позиция, кватернион `quat`, эйлеры `rot` — только для справки: при X = ±90° они неоднозначны) 13 предметов из `Prefabs/Equipment`: 7 видов оружия, 3 камня, артефакт щита, подсумок, рюкзак |
| `potions.json` | Геометрия 12 зелий из `Prefabs/Equipment/Potions`; стекло — полупрозрачный материал (альфа 0.7) |
| `sandbox_items.json` | Названия и характеристики из `Data/Sandbox` (оружие, камни, артефакт, зелья, эффекты) |
| `blocks.mjs` | Меши `Resources/Models/Cube/CubeLowPoly.fbx` и `Triangle/TriangleLowPoly.fbx` → `src/assets/models/blocks.json` для 3D-боя (координаты Unity, размер 1, шип сверху) |
| `block_maps.py` | Карты нормалей куба и клина и AO куба (`Cube_HeightMap`) → `src/assets/models/*.png`, уменьшенные до 1024 / 512 |

Запуск (из `F:\Projects\games\CTG\Assets\_CTG\Prefabs\Equipment`):
`python3 parse_prefab.py Weapons/*.prefab Gems/*.prefab Artifacts/*.prefab Pouch.prefab Rucksack.prefab > items.json`,
`python3 parse_prefab.py Potions/*.prefab > potions.json`

Цвета материалов (`_BaseColor`): коричневый `#974f17`, белый `#f2f2f2`, красный `#d6090c`,
синий `#1182ee`, зелёный `#05e716`. Меши: `CubeLowPoly 1.fbx` (куб), `TriangleLowPoly 1.fbx` (клин).

Меши и карты блоков для 3D-боя (из корня прототипа, клиент — соседняя папка `../CTG`):
`node tools/unity-export/blocks.mjs`, `python3 tools/unity-export/block_maps.py`
