"""Карты куба и клина из Unity-клиента → src/assets/models/*.png для 3D-боя.

Запуск из корня прототипа: python3 tools/unity-export/block_maps.py [путь к Assets/Resources/Models]
По умолчанию — соседний клиент: ../CTG/Assets/Resources/Models.

В клиенте материалы блоков — URP Lit: у куба карта нормалей + Cube_HeightMap как карта затенения (AO),
у клина — только карта нормалей (Triangle_HeightMap там parallax на 0.005 — в three.js его нет, не берём).
Оригиналы 2048² — для блоков на экране боя хватает 1024 (нормали) и 512 (AO), сборка в один файл легче.
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join('..', 'CTG', 'Assets', 'Resources', 'Models')
OUT = os.path.join('src', 'assets', 'models')
MAPS = [
    ('Cube/Cube_NormalMap.png', 'cube_normal.png', 'RGB', 1024),
    ('Cube/Cube_HeightMap.png', 'cube_ao.png', 'L', 512),
    ('Triangle/Triangle_NormalMap.png', 'wedge_normal.png', 'RGB', 1024),
]

os.makedirs(OUT, exist_ok=True)
for rel, name, mode, size in MAPS:
    im = Image.open(os.path.join(SRC, rel)).convert(mode).resize((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, optimize=True)
    print(f'{rel} → {path} ({os.path.getsize(path) // 1024} КБ)')
