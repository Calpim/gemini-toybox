import { TILE_SIZE, isWallAtWorld, isWallTile, type DungeonMap } from './dungeon';

/**
 * Smooth circle-vs-tile-grid collision resolution (APP-MAP-02).
 * Pushes circular entities out of nearby wall tiles along the minimum penetration axis.
 */
export function resolveCircleGridCollision(
  x: number,
  y: number,
  radius: number,
  map: DungeonMap
): { x: number; y: number } {
  let nx = x;
  let ny = y;

  const minTx = Math.floor((nx - radius) / TILE_SIZE) - 1;
  const maxTx = Math.floor((nx + radius) / TILE_SIZE) + 1;
  const minTy = Math.floor((ny - radius) / TILE_SIZE) - 1;
  const maxTy = Math.floor((ny + radius) / TILE_SIZE) + 1;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isWallTile(map, tx, ty)) continue;

      const left = tx * TILE_SIZE;
      const right = left + TILE_SIZE;
      const top = ty * TILE_SIZE;
      const bottom = top + TILE_SIZE;

      const closestX = Math.max(left, Math.min(nx, right));
      const closestY = Math.max(top, Math.min(ny, bottom));

      const dx = nx - closestX;
      const dy = ny - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 1e-6) {
          const overlap = radius - dist;
          nx += (dx / dist) * overlap;
          ny += (dy / dist) * overlap;
        } else {
          // Center inside tile fallback: push out via nearest edge
          const penLeft = nx - left;
          const penRight = right - nx;
          const penTop = ny - top;
          const penBottom = bottom - ny;
          const minPen = Math.min(penLeft, penRight, penTop, penBottom);
          if (minPen === penLeft) nx = left - radius;
          else if (minPen === penRight) nx = right + radius;
          else if (minPen === penTop) ny = top - radius;
          else ny = bottom + radius;
        }
      }
    }
  }

  return { x: nx, y: ny };
}

/**
 * Raycast line-of-sight check across the tile grid (APP-CMB-03).
 * Returns false if any wall tile blocks the straight segment between (x1, y1) and (x2, y2).
 */
export function hasLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  map: DungeonMap
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return !isWallAtWorld(map, x1, y1);

  const stepSize = TILE_SIZE * 0.25;
  const steps = Math.ceil(dist / stepSize);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = x1 + dx * t;
    const sy = y1 + dy * t;
    if (isWallAtWorld(map, sx, sy)) {
      return false;
    }
  }
  return true;
}
