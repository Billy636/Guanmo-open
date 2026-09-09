"""将 newicon.png 外围白色底板转为透明，生成预览 newicon_alpha.png。

从图像四边开始洪水填充：把与四边连通的近白像素（RGB>=阈值）的 alpha 设为 0。
保留图标内部白色（不与四边连通的不处理）。不覆盖母版。
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path("d:/React/guanmo-open/src-tauri/icons/newicon.png")
DST = Path("d:/React/guanmo-open/src-tauri/icons/newicon_alpha.png")
THRESH = 240  # RGB 任一通道 >= 此值视为近白候选

img = Image.open(SRC).convert("RGBA")
arr = np.array(img, dtype=np.uint8)
h, w = arr.shape[:2]
rgb = arr[:, :, :3]
alpha = arr[:, :, 3]

near_white = (rgb >= THRESH).all(axis=2) & (alpha > 0)
visited = np.zeros((h, w), dtype=bool)
stack = deque()

# 从四边所有近白像素入队
for x in range(w):
    for y in (0, h - 1):
        if near_white[y, x] and not visited[y, x]:
            visited[y, x] = True
            stack.append((x, y))
for y in range(h):
    for x in (0, w - 1):
        if near_white[y, x] and not visited[y, x]:
            visited[y, x] = True
            stack.append((x, y))

count = 0
while stack:
    x, y = stack.popleft()
    arr[y, x, 3] = 0
    count += 1
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not visited[ny, nx] and near_white[ny, nx]:
            visited[ny, nx] = True
            stack.append((nx, ny))

Image.fromarray(arr, mode="RGBA").save(DST)
total = h * w
print(f"size: {w}x{h}")
print(f"transparent(bg): {count} ({count / total * 100:.2f}%)")
print(f"remaining near-white(opaque): {int((((rgb >= THRESH).all(axis=2)) & (arr[:,:,3] > 0)).sum())}")
print(f"saved: {DST}")
