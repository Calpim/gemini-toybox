import { resolveCircleGridCollision } from '../core/collision';
import {
  type DungeonMap,
  findRoomAtTile,
  isBossFloor,
  isGuardianFloor,
  isWallTile,
  tileCenterWorld,
  tileIndex,
} from '../core/dungeon';
import { createRng } from '../core/rng';
import { MAX_TARGET_RANGE } from './equipment';
import type { ChestState, EnemyKind, EnemyState, PickupState } from './types';

export const SHOOTER_AGGRO_RANGE = 320;

export function createEnemyByKind(
  id: number,
  kind: EnemyKind,
  x: number,
  y: number,
  floor: number,
  aggroRange = MAX_TARGET_RANGE,
): EnemyState {
  const baseHp = 26 + (floor - 1) * 9;
  const baseSpeed = 78 + Math.min(48, (floor - 1) * 6);
  const baseDmg = 10 + (floor - 1) * 2;

  switch (kind) {
    case 'tank':
      return {
        id,
        kind,
        x,
        y,
        radius: 17,
        speed: Math.round(baseSpeed * 0.56),
        hp: Math.round(baseHp * 2.4),
        maxHp: Math.round(baseHp * 2.4),
        damage: Math.round(baseDmg * 1.45),
        aggroRange: Math.max(aggroRange, 280),
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
        attackCooldown: 1.4,
      };
    case 'runner':
      return {
        id,
        kind,
        x,
        y,
        radius: 10,
        speed: Math.min(195, Math.round(baseSpeed * 1.55)),
        hp: Math.round(baseHp * 0.55),
        maxHp: Math.round(baseHp * 0.55),
        damage: Math.round(baseDmg * 0.8),
        aggroRange,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      };
    case 'shooter':
      return {
        id,
        kind,
        x,
        y,
        radius: 14,
        speed: 0,
        hp: Math.round(baseHp * 1.15),
        maxHp: Math.round(baseHp * 1.15),
        damage: Math.round(baseDmg * 0.9),
        aggroRange: Math.max(aggroRange, SHOOTER_AGGRO_RANGE),
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
        attackCooldown: 1.0,
      };
    case 'scout':
      return {
        id,
        kind,
        x,
        y,
        radius: 12,
        speed: Math.round(baseSpeed * 1.05),
        hp: Math.round(baseHp * 0.95),
        maxHp: Math.round(baseHp * 0.95),
        damage: Math.round(baseDmg * 0.85),
        aggroRange,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
        alertCooldown: 0,
        wanderTimer: 0,
        wanderTarget: null,
      };
    default:
      return {
        id,
        kind: 'normal',
        x,
        y,
        radius: 13,
        speed: baseSpeed,
        hp: baseHp,
        maxHp: baseHp,
        damage: baseDmg,
        aggroRange,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
        attackCooldown: 1.0 + ((id * 37) % 10) * 0.1,
      };
  }
}

export function pickEnemyKindForFloor(floor: number, roll: number): EnemyKind {
  if (floor <= 1) {
    if (roll < 0.55) return 'normal';
    if (roll < 0.82) return 'runner';
    return 'tank';
  }
  const extra = Math.min(0.18, (floor - 2) * 0.045);
  const shooterWeight = 0.14 + extra * 0.65;
  const scoutWeight = 0.04 + Math.min(0.05, (floor - 2) * 0.012);
  const tankWeight = 0.17 + Math.min(0.05, (floor - 2) * 0.015);
  const runnerWeight = 0.24;

  if (roll < shooterWeight) return 'shooter';
  if (roll < shooterWeight + scoutWeight) return 'scout';
  if (roll < shooterWeight + scoutWeight + tankWeight) return 'tank';
  if (roll < shooterWeight + scoutWeight + tankWeight + runnerWeight) return 'runner';
  return 'normal';
}

export function getRunnerPackSize(floor: number, roll: number): number {
  if (floor <= 2) {
    return roll < 0.45 ? 2 : 1;
  }
  if (floor <= 5) {
    return roll < 0.55 ? 3 : 2;
  }
  return roll < 0.55 ? 4 : 3;
}

export function populateFloor(
  map: DungeonMap,
  floor: number,
  seed: number,
  startId: number,
  lootBonusRate = 0,
  playerLevel = 1,
): { enemies: EnemyState[]; pickups: PickupState[]; chests: ChestState[]; nextId: number } {
  const rng = createRng(seed ^ (floor * 0x517cc1b7));
  const enemies: EnemyState[] = [];
  const pickups: PickupState[] = [];
  const chests: ChestState[] = [];
  let nextId = startId;

  const occupiedTiles = new Set<number>();
  occupiedTiles.add(tileIndex(map, map.startTile.tx, map.startTile.ty));
  occupiedTiles.add(tileIndex(map, map.stairsTile.tx, map.stairsTile.ty));
  if (map.fountainTile) {
    occupiedTiles.add(tileIndex(map, map.fountainTile.tx, map.fountainTile.ty));
  }

  // Boss floor (10F, 20F...): Room 0 is safe fountain anteroom; Room 1 is Grand Boss Arena
  const bossArena = map.rooms[1];
  if (isBossFloor(floor) && bossArena) {
    const arena = bossArena;
    const bossPos = tileCenterWorld(arena.cx, arena.cy);
    occupiedTiles.add(tileIndex(map, arena.cx, arena.cy));

    const grandBoss = createEnemyByKind(nextId++, 'tank', bossPos.x, bossPos.y, floor, 360);
    const lvScale = 1 + Math.max(0, playerLevel - 1) * 0.16;
    grandBoss.maxHp = Math.round(grandBoss.maxHp * 6.8 * lvScale);
    grandBoss.hp = grandBoss.maxHp;
    grandBoss.radius += 8;
    grandBoss.speed = Math.max(58, Math.round(grandBoss.speed * 1.15));
    grandBoss.damage = Math.round(grandBoss.damage * 1.35);
    grandBoss.isRoomBoss = true;
    grandBoss.isGrandBoss = true;
    grandBoss.isStairsGuard = true;
    grandBoss.attackCooldown = 1.3;
    grandBoss.bossPatternIndex = 0;
    grandBoss.dashState = 'none';
    enemies.push(grandBoss);

    const freeTiles: { tx: number; ty: number }[] = [];
    for (let ty = arena.y + 2; ty <= arena.y + arena.h - 3; ty++) {
      for (let tx = arena.x + 3; tx <= arena.x + arena.w - 3; tx++) {
        const idx = tileIndex(map, tx, ty);
        if (!isWallTile(map, tx, ty) && !occupiedTiles.has(idx)) {
          freeTiles.push({ tx, ty });
        }
      }
    }
    for (let j = freeTiles.length - 1; j > 0; j--) {
      const swapIdx = rng.int(0, j);
      const tmp = freeTiles[j];
      const swapped = freeTiles[swapIdx];
      if (tmp && swapped) {
        freeTiles[j] = swapped;
        freeTiles[swapIdx] = tmp;
      }
    }

    const minionCount = Math.min(freeTiles.length, 4 + Math.min(4, Math.floor(floor / 10)));
    for (let m = 0; m < minionCount; m++) {
      const tile = freeTiles[m];
      if (!tile) continue;
      occupiedTiles.add(tileIndex(map, tile.tx, tile.ty));
      const pos = tileCenterWorld(tile.tx, tile.ty);
      const kind = pickEnemyKindForFloor(floor, rng.next());
      const minion = createEnemyByKind(nextId++, kind, pos.x, pos.y, floor, 320);
      minion.isStairsGuard = true;
      enemies.push(minion);
    }

    return { enemies, pickups, chests, nextId };
  }

  const chestCandidates: number[] = [];
  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    if (!room) continue;
    const isStairsRoom = room.cx === map.stairsTile.tx && room.cy === map.stairsTile.ty;
    if (!isStairsRoom) {
      chestCandidates.push(i);
    }
  }

  // 1. Place 1-2 treasure chests on distinct center tiles first
  const targetChests = Math.min(chestCandidates.length, 1 + (rng.next() < 0.45 + lootBonusRate ? 1 : 0));
  for (let c = 0; c < targetChests && chestCandidates.length > 0; c++) {
    const pickIdx = rng.int(0, chestCandidates.length - 1);
    const roomIdx = chestCandidates.splice(pickIdx, 1)[0];
    if (roomIdx === undefined) continue;
    const room = map.rooms[roomIdx];
    if (!room) continue;
    const pos = tileCenterWorld(room.cx, room.cy);
    chests.push({
      id: nextId++,
      x: pos.x,
      y: pos.y,
      opened: false,
    });
    occupiedTiles.add(tileIndex(map, room.cx, room.cy));
  }

  const guardianFloor = isGuardianFloor(floor);

  // 2. Populate rooms with non-overlapping heal orbs & enemies
  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    if (!room) continue;
    const isStairsRoom = room.cx === map.stairsTile.tx && room.cy === map.stairsTile.ty;

    const freeTiles: { tx: number; ty: number }[] = [];
    for (let ty = room.y + 1; ty <= room.y + room.h - 2; ty++) {
      for (let tx = room.x + 1; tx <= room.x + room.w - 2; tx++) {
        const idx = tileIndex(map, tx, ty);
        if (!isWallTile(map, tx, ty) && !occupiedTiles.has(idx)) {
          freeTiles.push({ tx, ty });
        }
      }
    }
    // Fisher-Yates shuffle for unique non-overlapping tile picks
    for (let j = freeTiles.length - 1; j > 0; j--) {
      const swapIdx = rng.int(0, j);
      const tmp = freeTiles[j];
      const swapped = freeTiles[swapIdx];
      if (tmp && swapped) {
        freeTiles[j] = swapped;
        freeTiles[swapIdx] = tmp;
      }
    }

    let tileCursor = 0;
    if (rng.next() < 0.3 + lootBonusRate * 0.4 && tileCursor < freeTiles.length) {
      const tile = freeTiles[tileCursor++];
      if (tile) {
        occupiedTiles.add(tileIndex(map, tile.tx, tile.ty));
        const pos = tileCenterWorld(tile.tx, tile.ty);
        pickups.push({
          id: nextId++,
          kind: 'heal',
          x: pos.x,
          y: pos.y,
          value: 25,
        });
      }
    }

    const extraStairsMobs = isStairsRoom ? (guardianFloor ? 3 : 1) : 0;
    const count = rng.int(2, 3 + Math.min(3, Math.floor(floor / 2))) + extraStairsMobs;
    for (let k = 0; k < count; k++) {
      let wx: number;
      let wy: number;
      if (guardianFloor && isStairsRoom && k === 0) {
        occupiedTiles.add(tileIndex(map, map.stairsTile.tx, map.stairsTile.ty));
        const stairsPos = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
        wx = stairsPos.x;
        wy = stairsPos.y;
        const boss = createEnemyByKind(nextId++, 'tank', wx, wy, floor, 260);
        const lvScale = 1 + Math.max(0, playerLevel - 1) * 0.14;
        boss.maxHp = Math.round(boss.maxHp * 2.9 * lvScale);
        boss.hp = boss.maxHp;
        boss.radius += 5;
        boss.damage = Math.round(boss.damage * 1.25);
        boss.isRoomBoss = true;
        boss.isStairsGuard = true;
        boss.attackCooldown = 1.15;
        boss.mortarCooldown = 0.6;
        boss.bossPatternIndex = 0;
        boss.dashState = 'none';
        enemies.push(boss);
        continue;
      }

      const nextTile = freeTiles[tileCursor];
      if (nextTile) {
        tileCursor++;
        occupiedTiles.add(tileIndex(map, nextTile.tx, nextTile.ty));
        const pos = tileCenterWorld(nextTile.tx, nextTile.ty);
        wx = pos.x;
        wy = pos.y;
      } else {
        const fallback = tileCenterWorld(room.cx, room.cy);
        const angle = (k * Math.PI * 2) / Math.max(1, count);
        wx = fallback.x + Math.cos(angle) * 26;
        wy = fallback.y + Math.sin(angle) * 26;
      }

      {
        const kind = pickEnemyKindForFloor(floor, rng.next());
        const spawned = createEnemyByKind(nextId++, kind, wx, wy, floor, MAX_TARGET_RANGE);
        if (isStairsRoom) {
          spawned.isStairsGuard = true;
        }
        enemies.push(spawned);

        if (kind === 'runner') {
          const packSize = getRunnerPackSize(floor, rng.next());
          for (let p = 1; p < packSize; p++) {
            let px: number;
            let py: number;
            const pTile = freeTiles[tileCursor];
            if (pTile) {
              tileCursor++;
              occupiedTiles.add(tileIndex(map, pTile.tx, pTile.ty));
              const pPos = tileCenterWorld(pTile.tx, pTile.ty);
              px = pPos.x;
              py = pPos.y;
            } else {
              const pAngle = (p * Math.PI * 2) / Math.max(1, packSize);
              const resolved = resolveCircleGridCollision(
                wx + Math.cos(pAngle) * 24,
                wy + Math.sin(pAngle) * 24,
                spawned.radius,
                map,
              );
              px = resolved.x;
              py = resolved.y;
            }
            const follower = createEnemyByKind(nextId++, 'runner', px, py, floor, MAX_TARGET_RANGE);
            follower.isPackFollower = true;
            if (isStairsRoom) {
              follower.isStairsGuard = true;
            }
            enemies.push(follower);
          }
        }
      }
    }
  }

  // 3. Place 1-2 free-roaming patrol scouts inside corridors so corridor encounters occur naturally
  const startCenter = tileCenterWorld(map.startTile.tx, map.startTile.ty);
  const corridorTiles: { tx: number; ty: number }[] = [];
  for (let ty = 1; ty < map.height - 1; ty++) {
    for (let tx = 1; tx < map.width - 1; tx++) {
      if (isWallTile(map, tx, ty) || findRoomAtTile(map, tx, ty) !== null) continue;
      if (occupiedTiles.has(tileIndex(map, tx, ty))) continue;
      const pos = tileCenterWorld(tx, ty);
      if (Math.hypot(pos.x - startCenter.x, pos.y - startCenter.y) >= 260) {
        corridorTiles.push({ tx, ty });
      }
    }
  }
  const targetPatrols = Math.min(corridorTiles.length, floor <= 1 ? 0 : floor >= 3 ? 2 : 1);
  for (let p = 0; p < targetPatrols; p++) {
    const pickIdx = rng.int(0, corridorTiles.length - 1);
    const picked = corridorTiles.splice(pickIdx, 1)[0];
    if (!picked) continue;
    occupiedTiles.add(tileIndex(map, picked.tx, picked.ty));
    const pos = tileCenterWorld(picked.tx, picked.ty);
    enemies.push(createEnemyByKind(nextId++, 'scout', pos.x, pos.y, floor, MAX_TARGET_RANGE));
  }

  return { enemies, pickups, chests, nextId };
}
