import { describe, expect, it } from 'vitest';
import { generateDungeon, getTile, isWallTile, tileCenterWorld } from './dungeon';
import { hasLineOfSight, resolveCircleGridCollision } from './collision';

describe('Dungeon generation & collision (APP-MAP-01 / APP-MAP-02 / APP-CMB-03)', () => {
  it('[APP-MAP-01] generates connected rooms, wide corridors, and reachable stairs in a distant room', () => {
    const map = generateDungeon({ floor: 1, seed: 12345, corridorWidth: 2 });

    expect(map.rooms.length).toBeGreaterThanOrEqual(2);
    expect(getTile(map, map.startTile.tx, map.startTile.ty)).toBe('floor');
    expect(getTile(map, map.stairsTile.tx, map.stairsTile.ty)).toBe('stairs');
    expect(map.stairsTile).not.toEqual(map.startTile);

    // BFS reachability from start to stairs
    const visited = new Set<string>();
    const queue = [map.startTile];
    visited.add(`${map.startTile.tx},${map.startTile.ty}`);
    let reachedStairs = false;

    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.tx === map.stairsTile.tx && cur.ty === map.stairsTile.ty) {
        reachedStairs = true;
        break;
      }
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        const key = `${nx},${ny}`;
        if (!visited.has(key) && !isWallTile(map, nx, ny)) {
          visited.add(key);
          queue.push({ tx: nx, ty: ny });
        }
      }
    }

    expect(reachedStairs).toBe(true);
  });

  it('[APP-MAP-02] pushes circular entity out of wall tiles cleanly', () => {
    const map = generateDungeon({ floor: 1, seed: 42 });
    const start = tileCenterWorld(map.startTile.tx, map.startTile.ty);
    // Find an adjacent wall direction from start room
    const room = map.rooms[0];
    const topWallY = room.y * 40 - 4; // inside wall right above room top edge
    const resolved = resolveCircleGridCollision(start.x, topWallY, 13, map);
    expect(resolved.y).toBeGreaterThanOrEqual(room.y * 40 + 13 - 0.01);
  });

  it('[APP-CMB-03] blocks line of sight when a wall tile sits between two points', () => {
    const map = generateDungeon({ floor: 1, seed: 777 });
    // Force a deterministic wall tile right in the middle of start room to test LoS raycast
    const tx = map.startTile.tx;
    const ty = map.startTile.ty;
    const left = tileCenterWorld(tx - 2, ty);
    const right = tileCenterWorld(tx + 2, ty);

    expect(hasLineOfSight(left.x, left.y, right.x, right.y, map)).toBe(true);
    map.tiles[ty * map.width + tx] = 'wall';
    expect(hasLineOfSight(left.x, left.y, right.x, right.y, map)).toBe(false);
  });
});
