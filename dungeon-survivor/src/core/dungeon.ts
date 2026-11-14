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
  corridorWidth?: 1 | 2 | 3;
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

export function findRoomAtTile(map: Pick<DungeonMap, 'rooms'>, tx: number, ty: number): Room | null {
  for (const room of map.rooms) {
    if (tx >= room.x && tx < room.x + room.w && ty >= room.y && ty < room.y + room.h) {
      return room;
    }
  }
  return null;
}

export function isTileInRoom(room: Room, tx: number, ty: number, margin = 0): boolean {
  return (
    tx >= room.x - margin &&
    tx < room.x + room.w + margin &&
    ty >= room.y - margin &&
    ty < room.y + room.h + margin
  );
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

function roomsOverlap(a: Omit<Room, 'id' | 'cx' | 'cy'>, b: Room, padding = 4): boolean {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  );
}

const CARDINAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function hasCorridorWithin(
  corridorMask: Uint8Array,
  width: number,
  height: number,
  tx: number,
  ty: number,
  radius: number
): boolean {
  const minX = Math.max(1, tx - radius);
  const maxX = Math.min(width - 2, tx + radius);
  const minY = Math.max(1, ty - radius);
  const maxY = Math.min(height - 2, ty + radius);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (corridorMask[y * width + x] === 1) return true;
    }
  }
  return false;
}

function routeNonOverlappingCorridor(
  tiles: TileType[],
  width: number,
  height: number,
  roomMask: Int16Array,
  nearRoomMask: Int16Array,
  corridorMask: Uint8Array,
  roomA: Room,
  roomB: Room,
  corridorWidth: number
): void {
  const totalStates = width * height * 5;
  const bestCost = new Float64Array(totalStates).fill(Infinity);
  const prevState = new Int32Array(totalStates).fill(-1);

  const heapState: number[] = [];
  const heapCost: number[] = [];
  const pushHeap = (state: number, cost: number) => {
    heapState.push(state);
    heapCost.push(cost);
    let idx = heapState.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (heapCost[parent] <= heapCost[idx]) break;
      [heapState[parent], heapState[idx]] = [heapState[idx], heapState[parent]];
      [heapCost[parent], heapCost[idx]] = [heapCost[idx], heapCost[parent]];
      idx = parent;
    }
  };
  const popHeap = (): [number, number] => {
    const topS = heapState[0];
    const topC = heapCost[0];
    const lastS = heapState.pop()!;
    const lastC = heapCost.pop()!;
    if (heapState.length > 0) {
      heapState[0] = lastS;
      heapCost[0] = lastC;
      let idx = 0;
      const len = heapState.length;
      while (true) {
        let smallest = idx;
        const left = idx * 2 + 1;
        const right = left + 1;
        if (left < len && heapCost[left] < heapCost[smallest]) smallest = left;
        if (right < len && heapCost[right] < heapCost[smallest]) smallest = right;
        if (smallest === idx) break;
        [heapState[idx], heapState[smallest]] = [heapState[smallest], heapState[idx]];
        [heapCost[idx], heapCost[smallest]] = [heapCost[smallest], heapCost[idx]];
        idx = smallest;
      }
    }
    return [topS, topC];
  };

  const startIdx = roomA.cy * width + roomA.cx;
  const targetIdx = roomB.cy * width + roomB.cx;
  const startState = startIdx * 5 + 4;
  bestCost[startState] = 0;
  pushHeap(startState, 0);

  const halfBefore = Math.floor((corridorWidth - 1) / 2);

  let reachedState = -1;
  while (heapState.length > 0) {
    const [curState, curCost] = popHeap();
    if (curCost > bestCost[curState]) continue;

    const curIdx = Math.floor(curState / 5);
    const curDir = curState % 5;
    if (curIdx === targetIdx) {
      reachedState = curState;
      break;
    }

    const cx = curIdx % width;
    const cy = Math.floor(curIdx / width);

    for (let d = 0; d < 4; d++) {
      const nx = cx + CARDINAL_DIRS[d][0];
      const ny = cy + CARDINAL_DIRS[d][1];
      if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;

      const nIdx = ny * width + nx;
      const inEndpointRoom = roomMask[nIdx] === roomA.id || roomMask[nIdx] === roomB.id;

      let tileCost = 4;
      let outOfBounds = false;
      if (inEndpointRoom) {
        tileCost = 1;
      } else {
        const bx0 = nx - halfBefore;
        const by0 = ny - halfBefore;
        const bx1 = bx0 + corridorWidth - 1;
        const by1 = by0 + corridorWidth - 1;

        for (let by = by0; by <= by1; by++) {
          for (let bx = bx0; bx <= bx1; bx++) {
            if (bx < 1 || by < 1 || bx >= width - 1 || by >= height - 1) {
              outOfBounds = true;
              break;
            }
            const bIdx = by * width + bx;
            if (roomMask[bIdx] === roomA.id || roomMask[bIdx] === roomB.id) continue;
            const nearRoom = nearRoomMask[bIdx];
            if (nearRoom !== -1 && nearRoom !== roomA.id && nearRoom !== roomB.id) {
              tileCost = Math.max(tileCost, 5000);
            } else if (corridorMask[bIdx] === 1) {
              tileCost = Math.max(tileCost, 400);
            } else if (hasCorridorWithin(corridorMask, width, height, bx, by, 1)) {
              tileCost = Math.max(tileCost, 220);
            } else if (hasCorridorWithin(corridorMask, width, height, bx, by, 2)) {
              tileCost = Math.max(tileCost, 24);
            }
          }
          if (outOfBounds) break;
        }

        // Prevent 1-tile corner doorways: when a brush touches an endpoint room's 1-tile perimeter,
        // the full corridorWidth span must align within the room's X edge or Y edge.
        if (!outOfBounds && corridorWidth > 1) {
          for (const endRoom of [roomA, roomB]) {
            const touchesRoomMargin =
              bx1 >= endRoom.x - 1 &&
              bx0 <= endRoom.x + endRoom.w &&
              by1 >= endRoom.y - 1 &&
              by0 <= endRoom.y + endRoom.h;
            if (touchesRoomMargin) {
              const alignedTopBottom = bx0 >= endRoom.x && bx1 <= endRoom.x + endRoom.w - 1;
              const alignedLeftRight = by0 >= endRoom.y && by1 <= endRoom.y + endRoom.h - 1;
              if (!alignedTopBottom && !alignedLeftRight) {
                tileCost = Math.max(tileCost, 5000);
              }
            }
          }
        }
      }
      if (outOfBounds) continue;

      const turnCost = curDir !== 4 && curDir !== d ? 6 : 0;
      const nextCost = curCost + tileCost + turnCost;
      const nextState = nIdx * 5 + d;
      if (nextCost < bestCost[nextState]) {
        bestCost[nextState] = nextCost;
        prevState[nextState] = curState;
        pushHeap(nextState, nextCost);
      }
    }
  }

  if (reachedState === -1) return;

  const pathTiles: number[] = [];
  let trace = reachedState;
  while (trace !== -1) {
    pathTiles.push(Math.floor(trace / 5));
    trace = prevState[trace];
  }

  for (const idx of pathTiles) {
    if (roomMask[idx] === roomA.id || roomMask[idx] === roomB.id) continue;
    const tx = idx % width;
    const ty = Math.floor(idx / width);
    carveRect(tiles, width, height, tx - halfBefore, ty - halfBefore, corridorWidth, corridorWidth);
    const x0 = Math.max(1, tx - halfBefore);
    const y0 = Math.max(1, ty - halfBefore);
    const x1 = Math.min(width - 2, x0 + corridorWidth - 1);
    const y1 = Math.min(height - 2, y0 + corridorWidth - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cIdx = y * width + x;
        if (roomMask[cIdx] === -1) {
          corridorMask[cIdx] = 1;
        }
      }
    }
  }
}

export function computeBfsDistances(width: number, height: number, tiles: TileType[], startTx: number, startTy: number): Int32Array {
  const dist = new Int32Array(width * height).fill(-1);
  const startIdx = startTy * width + startTx;
  if (tiles[startIdx] === 'wall') return dist;

  const queue: number[] = [startIdx];
  dist[startIdx] = 0;
  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % width;
    const cy = Math.floor(idx / width);
    const d = dist[idx];

    for (const [dx, dy] of CARDINAL_DIRS) {
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
 * Generates a connected dungeon floor with wide rectangular rooms (8-13 x 7-11),
 * clean 2-tile non-overlapping corridors routed via Prim MST + Dijkstra,
 * a safe start room, and an upstairs tile in the farthest reachable room (APP-MAP-01).
 */
export function generateDungeon(options: GenerateDungeonOptions): DungeonMap {
  const { floor, seed } = options;
  const rng: Rng = createRng(seed ^ (floor * 0x9e3779b1));
  const corridorWidth: 1 | 2 | 3 = options.corridorWidth ?? 2;

  const width = Math.min(76, 48 + floor * 3);
  const height = Math.min(58, 38 + floor * 2);
  const targetRooms = Math.min(11, 6 + floor);

  const tiles: TileType[] = new Array(width * height).fill('wall');
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < 240 && rooms.length < targetRooms; attempt++) {
    const rw = rng.int(8, 13);
    const rh = rng.int(7, 11);
    const rx = rng.int(2, width - rw - 3);
    const ry = rng.int(2, height - rh - 3);
    const candidate = { x: rx, y: ry, w: rw, h: rh };

    if (rooms.some((r) => roomsOverlap(candidate, r, 4))) {
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

  // Fallback guarantee: at least 2 wide rooms even on pathological seeds
  if (rooms.length < 2) {
    const fallbackA: Room = { id: 0, x: 3, y: 3, w: 9, h: 8, cx: 7, cy: 7 };
    const fallbackB: Room = {
      id: 1,
      x: width - 13,
      y: height - 12,
      w: 9,
      h: 8,
      cx: width - 9,
      cy: height - 8,
    };
    rooms.length = 0;
    rooms.push(fallbackA, fallbackB);
    carveRect(tiles, width, height, fallbackA.x, fallbackA.y, fallbackA.w, fallbackA.h);
    carveRect(tiles, width, height, fallbackB.x, fallbackB.y, fallbackB.w, fallbackB.h);
  }

  const roomMask = new Int16Array(width * height).fill(-1);
  const nearRoomMask = new Int16Array(width * height).fill(-1);
  for (const room of rooms) {
    for (let y = Math.max(1, room.y - 1); y <= Math.min(height - 2, room.y + room.h); y++) {
      for (let x = Math.max(1, room.x - 1); x <= Math.min(width - 2, room.x + room.w); x++) {
        const idx = y * width + x;
        nearRoomMask[idx] = room.id;
        if (x >= room.x && x < room.x + room.w && y >= room.y && y < room.y + room.h) {
          roomMask[idx] = room.id;
        }
      }
    }
  }

  // True Prim's MST so rooms connect cleanly without long criss-crossing edges,
  // routed via weighted Dijkstra to prevent overlapping/adjacent corridor blobs.
  const corridorMask = new Uint8Array(width * height);
  const connectedIds = new Set<number>([rooms[0].id]);
  const remaining = rooms.slice(1);

  while (remaining.length > 0) {
    let bestRemIdx = 0;
    let bestFromRoom = rooms[0];
    let bestDist = Infinity;

    for (let rIdx = 0; rIdx < remaining.length; rIdx++) {
      const cand = remaining[rIdx];
      for (const connId of connectedIds) {
        const from = rooms[connId];
        const d = Math.hypot(cand.cx - from.cx, cand.cy - from.cy);
        if (d < bestDist) {
          bestDist = d;
          bestRemIdx = rIdx;
          bestFromRoom = from;
        }
      }
    }

    const nextRoom = remaining.splice(bestRemIdx, 1)[0];
    connectedIds.add(nextRoom.id);
    routeNonOverlappingCorridor(
      tiles,
      width,
      height,
      roomMask,
      nearRoomMask,
      corridorMask,
      bestFromRoom,
      nextRoom,
      corridorWidth
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
