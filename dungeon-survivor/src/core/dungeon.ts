import { createRng, type Rng } from './rng';

export const TILE_SIZE = 40;

export type TileType = 'wall' | 'floor' | 'stairs';

export interface Room {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface DungeonMap {
  width: number;
  height: number;
  tiles: TileType[];
  rooms: Room[];
  startTile: { tx: number; ty: number };
  stairsTile: { tx: number; ty: number };
  floor: number;
  seed: number;
}

export interface GenerateDungeonOptions {
  floor: number;
  seed: number;
  corridorWidth?: 2 | 3;
}

export function tileIndex(map: Pick<DungeonMap, 'width'>, tx: number, ty: number): number {
  return ty * map.width + tx;
}

export function getTile(map: DungeonMap, tx: number, ty: number): TileType {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) {
    return 'wall';
  }
  return map.tiles[ty * map.width + tx];
}

export function isWallTile(map: DungeonMap, tx: number, ty: number): boolean {
  return getTile(map, tx, ty) === 'wall';
}

export function isWallAtWorld(map: DungeonMap, wx: number, wy: number): boolean {
  const tx = Math.floor(wx / TILE_SIZE);
  const ty = Math.floor(wy / TILE_SIZE);
  return isWallTile(map, tx, ty);
}

export function tileCenterWorld(tx: number, ty: number): { x: number; y: number } {
  return {
    x: (tx + 0.5) * TILE_SIZE,
    y: (ty + 0.5) * TILE_SIZE,
  };
}

function carveRect(tiles: TileType[], width: number, height: number, rx: number, ry: number, rw: number, rh: number): void {
  const x0 = Math.max(1, rx);
  const y0 = Math.max(1, ry);
  const x1 = Math.min(width - 2, rx + rw - 1);
  const y1 = Math.min(height - 2, ry + rh - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      tiles[y * width + x] = 'floor';
    }
  }
}

function carveWideCorridor(
  tiles: TileType[],
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  corridorWidth: number,
  horizontalFirst: boolean
): void {
  const halfBefore = Math.floor((corridorWidth - 1) / 2);
  const paintBrush = (cx: number, cy: number) => {
    carveRect(tiles, width, height, cx - halfBefore, cy - halfBefore, corridorWidth, corridorWidth);
  };

  if (horizontalFirst) {
    const stepX = x1 <= x2 ? 1 : -1;
    for (let x = x1; x !== x2 + stepX; x += stepX) {
      paintBrush(x, y1);
    }
    const stepY = y1 <= y2 ? 1 : -1;
    for (let y = y1; y !== y2 + stepY; y += stepY) {
      paintBrush(x2, y);
    }
  } else {
    const stepY = y1 <= y2 ? 1 : -1;
    for (let y = y1; y !== y2 + stepY; y += stepY) {
      paintBrush(x1, y);
    }
    const stepX = x1 <= x2 ? 1 : -1;
    for (let x = x1; x !== x2 + stepX; x += stepX) {
      paintBrush(x, y2);
    }
  }
}

function roomsOverlap(a: Omit<Room, 'id' | 'cx' | 'cy'>, b: Room, padding = 2): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  );
}

function computeBfsDistances(width: number, height: number, tiles: TileType[], startTx: number, startTy: number): Int32Array {
  const dist = new Int32Array(width * height).fill(-1);
  const startIdx = startTy * width + startTx;
  if (tiles[startIdx] === 'wall') return dist;

  const queue: number[] = [startIdx];
  dist[startIdx] = 0;
  let head = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % width;
    const cy = Math.floor(idx / width);
    const d = dist[idx];

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (tiles[nIdx] !== 'wall' && dist[nIdx] === -1) {
        dist[nIdx] = d + 1;
        queue.push(nIdx);
      }
    }
  }

  return dist;
}

/**
 * Generates a connected dungeon floor with rectangular rooms, wide (2-3 tile) corridors,
 * a safe start room, and an upstairs tile in the farthest reachable room (APP-MAP-01).
 */
export function generateDungeon(options: GenerateDungeonOptions): DungeonMap {
  const { floor, seed } = options;
  const rng: Rng = createRng(seed ^ (floor * 0x9e3779b1));
  const corridorWidth: 2 | 3 = options.corridorWidth ?? (rng.next() < 0.5 ? 2 : 3);

  const width = Math.min(60, 38 + floor * 3);
  const height = Math.min(48, 30 + floor * 2);
  const targetRooms = Math.min(12, 6 + floor);

  const tiles: TileType[] = new Array(width * height).fill('wall');
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < 160 && rooms.length < targetRooms; attempt++) {
    const rw = rng.int(6, 10);
    const rh = rng.int(5, 9);
    const rx = rng.int(2, width - rw - 3);
    const ry = rng.int(2, height - rh - 3);
    const candidate = { x: rx, y: ry, w: rw, h: rh };

    if (rooms.some((r) => roomsOverlap(candidate, r, 2))) {
      continue;
    }

    const room: Room = {
      id: rooms.length,
      ...candidate,
      cx: rx + Math.floor(rw / 2),
      cy: ry + Math.floor(rh / 2),
    };
    rooms.push(room);
    carveRect(tiles, width, height, room.x, room.y, room.w, room.h);
  }

  // Fallback guarantee: at least 2 rooms even on pathological seeds
  if (rooms.length < 2) {
    const fallbackA: Room = { id: 0, x: 3, y: 3, w: 7, h: 7, cx: 6, cy: 6 };
    const fallbackB: Room = {
      id: 1,
      x: width - 11,
      y: height - 11,
      w: 7,
      h: 7,
      cx: width - 8,
      cy: height - 8,
    };
    rooms.length = 0;
    rooms.push(fallbackA, fallbackB);
    carveRect(tiles, width, height, fallbackA.x, fallbackA.y, fallbackA.w, fallbackA.h);
    carveRect(tiles, width, height, fallbackB.x, fallbackB.y, fallbackB.w, fallbackB.h);
  }

  // Connect rooms in sequence to their nearest previously connected neighbor (Prim-like MST)
  for (let i = 1; i < rooms.length; i++) {
    const current = rooms[i];
    let bestPrev = rooms[0];
    let bestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const prev = rooms[j];
      const d = Math.hypot(current.cx - prev.cx, current.cy - prev.cy);
      if (d < bestDist) {
        bestDist = d;
        bestPrev = prev;
      }
    }
    carveWideCorridor(
      tiles,
      width,
      height,
      bestPrev.cx,
      bestPrev.cy,
      current.cx,
      current.cy,
      corridorWidth,
      rng.next() < 0.5
    );
  }

  const startRoom = rooms[0];
  const startTile = { tx: startRoom.cx, ty: startRoom.cy };
  const bfsDist = computeBfsDistances(width, height, tiles, startTile.tx, startTile.ty);

  let stairsRoom = rooms[rooms.length - 1];
  let maxDist = -1;
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const d = bfsDist[r.cy * width + r.cx];
    if (d > maxDist) {
      maxDist = d;
      stairsRoom = r;
    }
  }

  const stairsTile = { tx: stairsRoom.cx, ty: stairsRoom.cy };
  tiles[stairsTile.ty * width + stairsTile.tx] = 'stairs';

  return {
    width,
    height,
    tiles,
    rooms,
    startTile,
    stairsTile,
    floor,
    seed,
  };
}
