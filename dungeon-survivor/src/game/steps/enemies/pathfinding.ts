import { hasLineOfSight } from '../../../core/collision';
import { type DungeonMap, findRoomAtTile, isWallTile, TILE_SIZE, tileCenterWorld } from '../../../core/dungeon';
import type { EnemyState, PlayerState, Vec2 } from '../../types';

export function hasClearCorridorPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  map: DungeonMap,
): boolean {
  if (!hasLineOfSight(ax, ay, bx, by, map)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return true;
  const nx = (-dy / len) * (radius * 0.75);
  const ny = (dx / len) * (radius * 0.75);
  return (
    hasLineOfSight(ax + nx, ay + ny, bx + nx, by + ny, map) && hasLineOfSight(ax - nx, ay - ny, bx - nx, by - ny, map)
  );
}

const BFS_NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function findBfsSteerTarget(enemy: EnemyState, player: PlayerState, map: DungeonMap, bfsDist: Int32Array): Vec2 {
  const etx = Math.floor(enemy.x / TILE_SIZE);
  const ety = Math.floor(enemy.y / TILE_SIZE);
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);

  if (etx === ptx && ety === pty) {
    return { x: player.x, y: player.y };
  }

  const currIdx = ety * map.width + etx;
  const currDist = etx >= 0 && ety >= 0 && etx < map.width && ety < map.height ? (bfsDist[currIdx] ?? -1) : -1;

  let bestTx = etx;
  let bestTy = ety;
  let bestDist = currDist >= 0 ? currDist : Infinity;

  for (const [dx, dy] of BFS_NEIGHBORS) {
    const nx = etx + dx;
    const ny = ety + dy;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    if (isWallTile(map, nx, ny)) continue;
    // Prevent diagonal corner clipping against adjacent wall tiles
    if (dx !== 0 && dy !== 0) {
      if (isWallTile(map, etx + dx, ety) || isWallTile(map, etx, ety + dy)) continue;
    }
    const nd = bfsDist[ny * map.width + nx] ?? -1;
    if (nd >= 0 && nd < bestDist) {
      bestDist = nd;
      bestTx = nx;
      bestTy = ny;
    }
  }

  if (bestTx === etx && bestTy === ety) {
    return { x: player.x, y: player.y };
  }
  return tileCenterWorld(bestTx, bestTy);
}

export function findScoutFleeTarget(
  enemy: EnemyState,
  player: PlayerState,
  map: DungeonMap,
  bfsDist: Int32Array,
): Vec2 {
  const etx = Math.floor(enemy.x / TILE_SIZE);
  const ety = Math.floor(enemy.y / TILE_SIZE);
  const currIdx = ety * map.width + etx;
  const currBfs = etx >= 0 && ety >= 0 && etx < map.width && ety < map.height ? (bfsDist[currIdx] ?? 0) : 0;

  // If scout is inside a room, look for nearby corridor exits that lead away from (or not closer to) the player
  const scoutRoom = findRoomAtTile(map, etx, ety);
  let preferredExit: Vec2 | null = null;
  if (scoutRoom) {
    const exitCandidates: { tx: number; ty: number }[] = [];
    for (let tx = scoutRoom.x; tx < scoutRoom.x + scoutRoom.w; tx++) {
      exitCandidates.push({ tx, ty: scoutRoom.y - 1 });
      exitCandidates.push({ tx, ty: scoutRoom.y + scoutRoom.h });
    }
    for (let ty = scoutRoom.y; ty < scoutRoom.y + scoutRoom.h; ty++) {
      exitCandidates.push({ tx: scoutRoom.x - 1, ty });
      exitCandidates.push({ tx: scoutRoom.x + scoutRoom.w, ty });
    }

    let bestExitScore = -Infinity;
    for (const c of exitCandidates) {
      if (c.tx <= 0 || c.ty <= 0 || c.tx >= map.width - 1 || c.ty >= map.height - 1) continue;
      if (isWallTile(map, c.tx, c.ty)) continue;
      const exitWorld = tileCenterWorld(c.tx, c.ty);
      const exitBfs = bfsDist[c.ty * map.width + c.tx] ?? -1;
      const distFromScout = Math.hypot(exitWorld.x - enemy.x, exitWorld.y - enemy.y);
      const distFromPlayer = Math.hypot(exitWorld.x - player.x, exitWorld.y - player.y);
      const bfsGain = exitBfs >= 0 && currBfs >= 0 ? exitBfs - currBfs : 0;
      const score = distFromPlayer * 1.1 + bfsGain * TILE_SIZE * 0.8 - distFromScout * 0.7;
      if (score > bestExitScore) {
        bestExitScore = score;
        preferredExit = exitWorld;
      }
    }
  }

  // Check if direct away vector is blocked by an adjacent wall (cornered)
  const awayDx = enemy.x - player.x;
  const awayDy = enemy.y - player.y;
  const awayLen = Math.hypot(awayDx, awayDy);
  let directBlocked = false;
  if (awayLen > 1e-3) {
    const probeX = enemy.x + (awayDx / awayLen) * (TILE_SIZE * 0.85);
    const probeY = enemy.y + (awayDy / awayLen) * (TILE_SIZE * 0.85);
    const probeTx = Math.floor(probeX / TILE_SIZE);
    const probeTy = Math.floor(probeY / TILE_SIZE);
    directBlocked = isWallTile(map, probeTx, probeTy);
  }

  let bestScore = -Infinity;
  let bestTarget: Vec2 | null = null;
  const exitWeight = directBlocked ? 0.95 : 0.45;

  for (const [dx, dy] of BFS_NEIGHBORS) {
    const nx = etx + dx;
    const ny = ety + dy;
    if (nx <= 0 || ny <= 0 || nx >= map.width - 1 || ny >= map.height - 1) continue;
    if (isWallTile(map, nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (isWallTile(map, etx + dx, ety) || isWallTile(map, etx, ety + dy)) continue;
    }
    const nw = tileCenterWorld(nx, ny);
    const nd = bfsDist[ny * map.width + nx] ?? -1;
    const bfsScore = nd >= 0 ? nd * TILE_SIZE : 0;
    const distScore = Math.hypot(nw.x - player.x, nw.y - player.y);
    const exitBonus = preferredExit ? -Math.hypot(nw.x - preferredExit.x, nw.y - preferredExit.y) * exitWeight : 0;
    const momentumBonus = enemy.wanderDir && enemy.wanderDir.x === dx && enemy.wanderDir.y === dy ? 14 : 0;

    const total = bfsScore * 0.65 + distScore * 0.85 + exitBonus + momentumBonus;
    if (total > bestScore) {
      bestScore = total;
      bestTarget = nw;
      enemy.wanderDir = { x: dx, y: dy };
    }
  }

  if (bestTarget) {
    return bestTarget;
  }
  if (awayLen > 1e-3) {
    return {
      x: enemy.x + (awayDx / awayLen) * TILE_SIZE,
      y: enemy.y + (awayDy / awayLen) * TILE_SIZE,
    };
  }
  return { x: enemy.x + TILE_SIZE, y: enemy.y };
}
