import { describe, expect, it } from 'vitest';
import { generateDungeon, getTile, isWallTile, tileCenterWorld } from './dungeon';
import { hasLineOfSight, resolveCircleGridCollision } from './collision';

describe('Dungeon generation & collision (APP-MAP-01 / APP-MAP-02 / APP-CMB-03)', () => {
  it('[APP-MAP-01] generates wider rooms, clean 2-tile non-overlapping corridors by default, and reachable stairs in a distant room', () => {
    const map = generateDungeon({ floor: 1, seed: 12345 });

    expect(map.rooms.length).toBeGreaterThanOrEqual(2);
    for (const room of map.rooms) {
      expect(room.w).toBeGreaterThanOrEqual(8);
      expect(room.h).toBeGreaterThanOrEqual(7);
    }
    expect(getTile(map, map.startTile.tx, map.startTile.ty)).toBe('floor');
    expect(getTile(map, map.stairsTile.tx, map.stairsTile.ty)).toBe('stairs');
    expect(map.stairsTile).not.toEqual(map.startTile);

    const hasCorridor3x3Blob = (m: ReturnType<typeof generateDungeon>) => {
      const inRoom = (tx: number, ty: number) =>
        m.rooms.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
      let blobs = 0;
      for (let y = 1; y < m.height - 3; y++) {
        for (let x = 1; x < m.width - 3; x++) {
          let allNonRoomFloor = true;
          for (let oy = 0; oy < 3 && allNonRoomFloor; oy++) {
            for (let ox = 0; ox < 3; ox++) {
              if (inRoom(x + ox, y + oy) || isWallTile(m, x + ox, y + oy)) {
                allNonRoomFloor = false;
                break;
              }
            }
          }
          if (allNonRoomFloor) blobs++;
        }
      }
      return blobs;
    };

    const countSingleTileDoorways = (m: ReturnType<typeof generateDungeon>) => {
      let singles = 0;
      const checkEdge = (len: number, getIsFloor: (i: number) => boolean) => {
        let run = 0;
        for (let i = 0; i < len; i++) {
          if (getIsFloor(i)) {
            run++;
          } else {
            if (run === 1) singles++;
            run = 0;
          }
        }
        if (run === 1) singles++;
      };
      for (const r of m.rooms) {
        checkEdge(r.w, (i) => !isWallTile(m, r.x + i, r.y - 1));
        checkEdge(r.w, (i) => !isWallTile(m, r.x + i, r.y + r.h));
        checkEdge(r.h, (i) => !isWallTile(m, r.x - 1, r.y + i));
        checkEdge(r.h, (i) => !isWallTile(m, r.x + r.w, r.y + i));
      }
      return singles;
    };

    // Verify across multiple seeds/floors that rooms stay large, corridors do not merge into 3x3+ blobs, and all doorways are >=2 tiles wide
    for (const [f, s] of [
      [1, 12345],
      [2, 42],
      [3, 777],
      [4, 9999],
      [5, 2026],
      [1, 101],
      [2, 202],
      [3, 303],
      [4, 808],
      [5, 999],
    ] as const) {
      const m = generateDungeon({ floor: f, seed: s });
      expect(m.rooms.length).toBeGreaterThanOrEqual(2);
      for (const r of m.rooms) {
        expect(r.w).toBeGreaterThanOrEqual(8);
        expect(r.h).toBeGreaterThanOrEqual(7);
      }
      expect(hasCorridor3x3Blob(m)).toBe(0);
      expect(countSingleTileDoorways(m)).toBe(0);
    }

    expect(hasCorridor3x3Blob(map)).toBe(0);
    expect(countSingleTileDoorways(map)).toBe(0);

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

  it('[APP-MAP-01 & APP-BOS-01] guarantees spacious stairs room on Guardian floors (3/6/9F) and generates Boss Arena + Fountain anteroom on 10F/20F', () => {
    for (const gf of [3, 6, 9, 13]) {
      const gMap = generateDungeon({ floor: gf, seed: 4242 });
      expect(gMap.floorType).toBe('guardian');
      const stairsRoom = gMap.rooms.find(
        (r) =>
          gMap.stairsTile.tx >= r.x &&
          gMap.stairsTile.tx < r.x + r.w &&
          gMap.stairsTile.ty >= r.y &&
          gMap.stairsTile.ty < r.y + r.h,
      );
      expect(stairsRoom).toBeDefined();
      expect(stairsRoom!.w).toBeGreaterThanOrEqual(11);
      expect(stairsRoom!.h).toBeGreaterThanOrEqual(9);
    }

    for (const bf of [10, 20]) {
      const bMap = generateDungeon({ floor: bf, seed: 999 });
      expect(bMap.floorType).toBe('boss');
      expect(bMap.rooms).toHaveLength(2);
      const [anteroom, arena] = bMap.rooms;
      expect(anteroom.w).toBeGreaterThanOrEqual(8);
      expect(arena.w).toBeGreaterThanOrEqual(20);
      expect(arena.h).toBeGreaterThanOrEqual(20);
      expect(bMap.fountainTile).not.toBeNull();
      expect(getTile(bMap, bMap.fountainTile!.tx, bMap.fountainTile!.ty)).toBe('fountain');
      expect(getTile(bMap, bMap.stairsTile.tx, bMap.stairsTile.ty)).toBe('stairs');

      // Verify BFS reachability from start -> fountain -> stairs
      const visited = new Set<string>();
      const queue = [bMap.startTile];
      visited.add(`${bMap.startTile.tx},${bMap.startTile.ty}`);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cur.tx + dx;
          const ny = cur.ty + dy;
          const key = `${nx},${ny}`;
          if (!visited.has(key) && !isWallTile(bMap, nx, ny)) {
            visited.add(key);
            queue.push({ tx: nx, ty: ny });
          }
        }
      }
      expect(visited.has(`${bMap.fountainTile!.tx},${bMap.fountainTile!.ty}`)).toBe(true);
      expect(visited.has(`${bMap.stairsTile.tx},${bMap.stairsTile.ty}`)).toBe(true);
    }
  });
});
