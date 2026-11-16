import { hasLineOfSight, resolveCircleGridCollision } from '../core/collision';
import {
  TILE_SIZE,
  computeBfsDistances,
  findRoomAtTile,
  generateDungeon,
  isBossFloor,
  isGuardianFloor,
  isTileInRoom,
  isWallAtWorld,
  isWallTile,
  tileCenterWorld,
  tileIndex,
  type DungeonMap,
} from '../core/dungeon';
import { createRng } from '../core/rng';
import {
  ALL_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  MAX_EQUIPMENT_LEVEL,
  MAX_EQUIP_SLOTS,
  MAX_EQUIP_SLOTS_CAP,
  MAX_TARGET_RANGE,
  ORBIT_SHIELD_INNER_SLOW,
  clampEquipmentLevel,
  createEquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getOrbitBitCount,
  getOrbitShieldAngularSpeed,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getScrapExpandCost,
  getSeekerDroneCount,
  getSeekerDroneRange,
  type EquipmentId,
  type EquippedItem,
} from './equipment';
import {
  TACTICAL_SPEED_BOOST_DURATION,
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillLevel,
  getSkillNode,
  getSkillUpgradeCost,
  type ComputedSkillModifiers,
  type SkillNodeId,
} from './skillTree';
import type {
  ChestState,
  EnemyKind,
  EnemyState,
  GameNotification,
  GameState,
  GameStatus,
  MainWeaponId,
  PickupState,
  PlayerState,
  Vec2,
} from './types';

export const CORRIDOR_VISION_RADIUS = 210;
export const SCOUT_ALERT_RADIUS = 300;
export const SHOOTER_AGGRO_RANGE = 320;
export const INITIAL_RESPAWN_DELAY = 24;

export interface NormalEnemyShotStats {
  shotCount: number;
  cooldown: number;
  speed: number;
  damageMult: number;
}

export function getNormalEnemyShotStats(playerLevel: number): NormalEnemyShotStats {
  const lv = Math.max(1, Math.floor(playerLevel));
  if (lv >= 9) {
    return { shotCount: 3, cooldown: 2.1, speed: 148, damageMult: 0.62 };
  }
  if (lv >= 6) {
    return { shotCount: 2, cooldown: 2.4, speed: 138, damageMult: 0.6 };
  }
  if (lv >= 3) {
    return { shotCount: 1, cooldown: 2.6, speed: 128, damageMult: 0.58 };
  }
  return { shotCount: 1, cooldown: 3.2, speed: 115, damageMult: 0.55 };
}

export interface CreateGameOptions {
  seed?: number;
  startFloor?: number;
  initialStatus?: GameStatus;
}

export function isPointInPlayerVision(
  map: DungeonMap,
  px: number,
  py: number,
  wx: number,
  wy: number,
  corridorRadius = CORRIDOR_VISION_RADIUS
): boolean {
  const ptx = Math.floor(px / TILE_SIZE);
  const pty = Math.floor(py / TILE_SIZE);
  const activeRoom = findRoomAtTile(map, ptx, pty);
  if (activeRoom) {
    const wtx = Math.floor(wx / TILE_SIZE);
    const wty = Math.floor(wy / TILE_SIZE);
    if (isTileInRoom(activeRoom, wtx, wty, 1)) {
      return true;
    }
  }
  const dist = Math.hypot(wx - px, wy - py);
  return dist <= corridorRadius && hasLineOfSight(px, py, wx, wy, map);
}

export function getStairsLockCount(state: GameState): number {
  let remaining = 0;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    if (enemy.isRoomBoss) {
      remaining++;
    }
  }
  return remaining;
}

export function pushNotification(
  state: GameState,
  kind: GameNotification['kind'],
  text: string,
  color: string,
  life = 2.0
): void {
  if (kind === 'alert') {
    const existingAlert = state.notifications.find((n) => n.kind === 'alert' && n.life > 1.2);
    if (existingAlert) {
      existingAlert.life = life;
      existingAlert.maxLife = life;
      existingAlert.text = text;
      return;
    }
  }
  state.notifications.push({
    id: state.nextEntityId++,
    kind,
    text,
    color,
    life,
    maxLife: life,
  });
  if (state.notifications.length > 3) {
    state.notifications.shift();
  }
}

function revealAroundPlayer(
  map: DungeonMap,
  explored: Uint8Array,
  px: number,
  py: number
): void {
  const ptx = Math.floor(px / TILE_SIZE);
  const pty = Math.floor(py / TILE_SIZE);
  const room = findRoomAtTile(map, ptx, pty);

  if (room) {
    const minY = Math.max(0, room.y - 1);
    const maxY = Math.min(map.height - 1, room.y + room.h);
    const minX = Math.max(0, room.x - 1);
    const maxX = Math.min(map.width - 1, room.x + room.w);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        explored[ty * map.width + tx] = 1;
      }
    }
  }

  // Corridor vision radius (~4.7 tiles) also smoothly connects doorways when inside a room
  const radiusTiles = room ? 3 : 5;
  const r2 = room ? 9 : 22;
  const minY = Math.max(0, pty - radiusTiles);
  const maxY = Math.min(map.height - 1, pty + radiusTiles);
  const minX = Math.max(0, ptx - radiusTiles);
  const maxX = Math.min(map.width - 1, ptx + radiusTiles);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const dx = tx - ptx;
      const dy = ty - pty;
      if (dx * dx + dy * dy <= r2) {
        explored[ty * map.width + tx] = 1;
      }
    }
  }
}

export function createEnemyByKind(
  id: number,
  kind: EnemyKind,
  x: number,
  y: number,
  floor: number,
  aggroRange = MAX_TARGET_RANGE
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

function populateFloor(
  map: DungeonMap,
  floor: number,
  seed: number,
  startId: number,
  lootBonusRate = 0,
  playerLevel = 1
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
  if (isBossFloor(floor) && map.rooms.length >= 2) {
    const arena = map.rooms[1];
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
      freeTiles[j] = freeTiles[swapIdx];
      freeTiles[swapIdx] = tmp;
    }

    const minionCount = Math.min(freeTiles.length, 4 + Math.min(4, Math.floor(floor / 10)));
    for (let m = 0; m < minionCount; m++) {
      const tile = freeTiles[m];
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
    const isStairsRoom = room.cx === map.stairsTile.tx && room.cy === map.stairsTile.ty;
    if (!isStairsRoom) {
      chestCandidates.push(i);
    }
  }

  // 1. Place 1-2 treasure chests on distinct center tiles first
  const targetChests = Math.min(
    chestCandidates.length,
    1 + (rng.next() < 0.45 + lootBonusRate ? 1 : 0)
  );
  for (let c = 0; c < targetChests && chestCandidates.length > 0; c++) {
    const pickIdx = rng.int(0, chestCandidates.length - 1);
    const roomIdx = chestCandidates.splice(pickIdx, 1)[0];
    const room = map.rooms[roomIdx];
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
      freeTiles[j] = freeTiles[swapIdx];
      freeTiles[swapIdx] = tmp;
    }

    let tileCursor = 0;
    if (rng.next() < 0.3 + lootBonusRate * 0.4 && tileCursor < freeTiles.length) {
      const tile = freeTiles[tileCursor++];
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

      if (tileCursor < freeTiles.length) {
        const tile = freeTiles[tileCursor++];
        occupiedTiles.add(tileIndex(map, tile.tx, tile.ty));
        const pos = tileCenterWorld(tile.tx, tile.ty);
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
  const targetPatrols = Math.min(corridorTiles.length, floor >= 3 ? 2 : 1);
  for (let p = 0; p < targetPatrols; p++) {
    const pickIdx = rng.int(0, corridorTiles.length - 1);
    const picked = corridorTiles.splice(pickIdx, 1)[0];
    occupiedTiles.add(tileIndex(map, picked.tx, picked.ty));
    const pos = tileCenterWorld(picked.tx, picked.ty);
    enemies.push(createEnemyByKind(nextId++, 'scout', pos.x, pos.y, floor, MAX_TARGET_RANGE));
  }

  return { enemies, pickups, chests, nextId };
}

export function createGameState(options: CreateGameOptions = {}): GameState {
  const seed = options.seed ?? Date.now();
  const floor = options.startFloor ?? 1;
  const status = options.initialStatus ?? 'playing';
  const map = generateDungeon({ floor, seed });
  const startPos = tileCenterWorld(map.startTile.tx, map.startTile.ty);
  const explored = new Uint8Array(map.width * map.height);
  revealAroundPlayer(map, explored, startPos.x, startPos.y);

  const populated = populateFloor(map, floor, seed, 1, 0, 1);

  return {
    seed,
    floor,
    status,
    map,
    explored,
    player: {
      x: startPos.x,
      y: startPos.y,
      radius: 13,
      baseSpeed: 210,
      hp: 100,
      maxHp: 100,
      autoRegenPerSec: 0,
      level: 1,
      exp: 0,
      expToNext: 25,
      skillPoints: 0,
      spentSkillPoints: 0,
      skillLevels: {},
      mainWeaponId: 'core_shot',
      equipment: [],
      maxEquipSlots: MAX_EQUIP_SLOTS,
      scrapExpandProgress: 0,
      invulnTimer: 0,
      facingAngle: 0,
      orbitAngle: 0,
      orbitRadius: 78,
      baseAttackCooldown: 0,
      repulsorCooldown: 0,
      aegisCooldown: 0,
      tacticalStepCooldown: 0,
      tacticalSpeedTimer: 0,
      tacticalSpeedBonus: 0,
    },
    enemies: populated.enemies,
    projectiles: [],
    enemyProjectiles: [],
    mortarZones: [],
    bossLasers: [],
    chests: populated.chests,
    pendingEquipDrop: null,
    pickups: populated.pickups,
    floatingTexts: [],
    visualFx: [],
    notifications: [],
    elapsedFloorTime: 0,
    respawnTimer: INITIAL_RESPAWN_DELAY,
    stairsNoticeCooldown: 0,
    fountainUsed: false,
    nextEntityId: populated.nextId,
    floorBannerTimer: status === 'playing' ? 2.2 : 0,
    stats: {
      kills: 0,
      floorsCleared: 0,
      totalExp: 0,
      chestsOpened: 0,
    },
  };
}

export function advanceToNextFloor(state: GameState): void {
  state.floor += 1;
  state.stats.floorsCleared += 1;
  state.map = generateDungeon({ floor: state.floor, seed: state.seed });
  state.explored = new Uint8Array(state.map.width * state.map.height);

  const startPos = tileCenterWorld(state.map.startTile.tx, state.map.startTile.ty);
  state.player.x = startPos.x;
  state.player.y = startPos.y;
  revealAroundPlayer(state.map, state.explored, startPos.x, startPos.y);

  const mods = computeSkillModifiers(state.player.skillLevels);
  const populated = populateFloor(
    state.map,
    state.floor,
    state.seed,
    state.nextEntityId,
    mods.lootBonusRate,
    state.player.level
  );
  state.enemies = populated.enemies;
  state.pickups = populated.pickups;
  state.chests = populated.chests;
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.mortarZones = [];
  state.bossLasers = [];
  state.floatingTexts = [];
  state.visualFx = [];
  state.notifications = [];
  state.elapsedFloorTime = 0;
  state.respawnTimer = INITIAL_RESPAWN_DELAY;
  state.stairsNoticeCooldown = 0;
  state.fountainUsed = false;
  state.nextEntityId = populated.nextId;
  state.floorBannerTimer = 2.2;
}

export function upgradeSkillNode(state: GameState, nodeId: SkillNodeId): boolean {
  if (!canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, nodeId)) {
    return false;
  }
  const node = getSkillNode(nodeId);
  const currLv = getSkillLevel(state.player.skillLevels, nodeId);
  const cost = getSkillUpgradeCost(currLv);
  const nextLv = currLv + 1;
  state.player.skillPoints -= cost;
  state.player.spentSkillPoints += cost;
  state.player.skillLevels[nodeId] = nextLv;
  state.floatingTexts.push({
    x: state.player.x,
    y: state.player.y - 24,
    text: `SKILL: ${node.name} Lv${nextLv}`,
    color: '#a7f3d0',
    life: 1.0,
    maxLife: 1.0,
  });
  return true;
}

export const unlockSkillNode = upgradeSkillNode;

export function openSkillTree(state: GameState): void {
  if (state.status === 'playing') {
    state.status = 'skill_tree';
  }
}

export function closeSkillTree(state: GameState): void {
  if (state.status === 'skill_tree') {
    state.status = 'playing';
  }
}

export function startGame(state: GameState): void {
  if (state.status === 'title') {
    state.status = 'playing';
    state.floorBannerTimer = 2.2;
  }
}

export function toggleSkillTree(state: GameState): void {
  if (state.status === 'playing') {
    state.status = 'skill_tree';
  } else if (state.status === 'skill_tree') {
    state.status = 'playing';
  }
}

function grantExpAndCheckLevelUp(state: GameState, gainedExp: number): void {
  const { player } = state;
  player.exp += gainedExp;
  state.stats.totalExp += gainedExp;
  while (player.exp >= player.expToNext) {
    player.exp -= player.expToNext;
    player.level += 1;
    player.skillPoints += 1;
    player.expToNext = Math.round(player.expToNext * 1.22);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 24,
      text: `LEVEL ${player.level}! (+1 SP)`,
      color: '#38bdf8',
      life: 1.0,
      maxLife: 1.0,
    });
    pushNotification(
      state,
      'levelup',
      `🎉 LEVEL UP! Lv${player.level} (+1 SP)`,
      '#38bdf8',
      2.6
    );
  }
}

function applyScrapExpandStep(state: GameState, sourceLabel: string): void {
  const { player } = state;
  const cost = getScrapExpandCost(player.maxEquipSlots);
  player.scrapExpandProgress += 1;
  if (player.scrapExpandProgress >= cost) {
    player.scrapExpandProgress -= cost;
    player.maxEquipSlots = Math.min(MAX_EQUIP_SLOTS_CAP, player.maxEquipSlots + 1);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `${sourceLabel} → SLOT EXPANDED! (${player.maxEquipSlots}/${MAX_EQUIP_SLOTS_CAP})`,
      color: '#34d399',
      life: 1.4,
      maxLife: 1.4,
    });
  } else {
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `${sourceLabel} (${player.scrapExpandProgress}/${cost})`,
      color: '#fbbf24',
      life: 1.25,
      maxLife: 1.25,
    });
  }
}

export function acquireEquipment(state: GameState, droppedItem: EquippedItem): void {
  const { player } = state;
  const { equipment } = player;
  const clampedLevel = clampEquipmentLevel(droppedItem.level);
  const normalizedItem: EquippedItem = { ...droppedItem, level: clampedLevel };
  const existing = equipment.find((eq) => eq.id === normalizedItem.id);
  if (existing) {
    if (existing.level >= MAX_EQUIPMENT_LEVEL) {
      if (player.maxEquipSlots < MAX_EQUIP_SLOTS_CAP) {
        applyScrapExpandStep(state, 'MAX LV → EXPAND');
        return;
      }
      player.hp = Math.min(player.maxHp, player.hp + 20);
      grantExpAndCheckLevelUp(state, 25);
      state.floatingTexts.push({
        x: player.x,
        y: player.y - 26,
        text: 'MAX LV BONUS! (+20HP/+25EXP)',
        color: '#fbbf24',
        life: 1.25,
        maxLife: 1.25,
      });
      return;
    }
    existing.level = clampEquipmentLevel(Math.max(existing.level + 1, clampedLevel));
    const def = EQUIPMENT_CATALOG[existing.id];
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `LV UP! ${def.name} Lv${existing.level}`,
      color: def.color,
      life: 1.25,
      maxLife: 1.25,
    });
    return;
  }

  if (equipment.length < player.maxEquipSlots) {
    equipment.push(normalizedItem);
    const def = EQUIPMENT_CATALOG[normalizedItem.id];
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: `+GEAR: ${def.name} Lv${normalizedItem.level}`,
      color: def.color,
      life: 1.2,
      maxLife: 1.2,
    });
    return;
  }

  if (
    player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP &&
    equipment.every((eq) => eq.level >= MAX_EQUIPMENT_LEVEL)
  ) {
    player.hp = Math.min(player.maxHp, player.hp + 30);
    grantExpAndCheckLevelUp(state, 40);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 26,
      text: 'ALL GEAR MAX! (+30HP/+40EXP)',
      color: '#fbbf24',
      life: 1.3,
      maxLife: 1.3,
    });
    return;
  }

  state.pendingEquipDrop = { item: normalizedItem };
  state.status = 'equip_choice';
}

export type EquipChoice =
  | { type: 'replace'; slotIndex: number }
  | { type: 'scrap_upgrade'; slotIndex: number }
  | { type: 'scrap_expand' };

export function resolveEquipChoice(
  state: GameState,
  choice: EquipChoice
): boolean {
  if (state.status !== 'equip_choice' || !state.pendingEquipDrop) {
    return false;
  }

  const dropped = state.pendingEquipDrop.item;
  if (choice.type === 'replace') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    state.player.equipment[choice.slotIndex] = {
      ...dropped,
      level: clampEquipmentLevel(dropped.level),
    };
    const def = EQUIPMENT_CATALOG[dropped.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `EQUIPPED: ${def.name} Lv${dropped.level}`,
      color: def.color,
      life: 1.1,
      maxLife: 1.1,
    });
  } else if (choice.type === 'scrap_upgrade') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    const target = state.player.equipment[choice.slotIndex];
    if (target.level >= MAX_EQUIPMENT_LEVEL) {
      return false;
    }
    target.level = clampEquipmentLevel(target.level + 1);
    const def = EQUIPMENT_CATALOG[target.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `SCRAP UP! ${def.name} Lv${target.level}`,
      color: '#fbbf24',
      life: 1.2,
      maxLife: 1.2,
    });
  } else {
    if (state.player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP) {
      return false;
    }
    applyScrapExpandStep(state, 'SCRAP BUILD');
  }

  state.pendingEquipDrop = null;
  state.status = 'playing';
  return true;
}

export function getOrbitBitPositions(state: GameState): Vec2[] {
  const { player } = state;
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  if (!orbitItem) return [];

  const mods = computeSkillModifiers(player.skillLevels);
  const count = getOrbitBitCount(orbitItem.level);
  const radius = getOrbitShieldRadius(orbitItem.level, mods.rangeMult);

  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = player.orbitAngle + (i * Math.PI * 2) / count;
    positions.push({
      x: player.x + Math.cos(a) * radius,
      y: player.y + Math.sin(a) * radius,
    });
  }
  return positions;
}

export function getSeekerDronePositions(state: GameState): Vec2[] {
  const { player } = state;
  const droneItem = player.equipment.find((e) => e.id === 'seeker_drone');
  if (!droneItem) return [];

  const count = getSeekerDroneCount(droneItem.level);
  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = -player.orbitAngle * 1.4 + (i * Math.PI * 2) / count;
    positions.push({
      x: player.x + Math.cos(a) * 28,
      y: player.y + Math.sin(a) * 28,
    });
  }
  return positions;
}

export function rollDropEquipmentLevel(
  equipment: readonly EquippedItem[],
  rngNext: () => number,
  dropQualityTier = 0
): number {
  if (equipment.length === 0) return 1;
  let minLevel = Infinity;
  for (const item of equipment) {
    if (item.level < minLevel) minLevel = item.level;
  }
  const tier = Math.max(0, Math.min(5, dropQualityTier));
  const pMinus1 = Math.max(0, 0.2 - tier * 0.04);
  const pPlus1 = 0.22 + tier * 0.036;
  const pPlus2 = 0.08 + tier * 0.024;
  const pZero = Math.max(0, 1 - pMinus1 - pPlus1 - pPlus2);
  const r = rngNext();
  if (r < pMinus1) return clampEquipmentLevel(minLevel - 1);
  if (r < pMinus1 + pZero) return clampEquipmentLevel(minLevel);
  if (r < pMinus1 + pZero + pPlus1) return clampEquipmentLevel(minLevel + 1);
  return clampEquipmentLevel(minLevel + 2);
}

function pickChestDrop(state: GameState, chestId: number): { id: EquipmentId; level: number } {
  const rng = createRng((state.seed ^ (state.floor * 4999) ^ (chestId * 3571)) >>> 0);
  const id = rng.pick(ALL_EQUIPMENT_IDS);
  const mods = computeSkillModifiers(state.player.skillLevels);
  const level = rollDropEquipmentLevel(state.player.equipment, () => rng.next(), mods.dropQualityTier);
  return { id, level };
}

function damageEnemy(state: GameState, enemy: EnemyState, amount: number): void {
  enemy.hp -= amount;
  enemy.hitFlash = 0.14;
  enemy.awake = true;
  state.floatingTexts.push({
    x: enemy.x,
    y: enemy.y - enemy.radius - 4,
    text: `${Math.round(amount)}`,
    color: '#fde047',
    life: 0.55,
    maxLife: 0.55,
  });
}

function findNearestVisibleEnemy(
  originX: number,
  originY: number,
  range: number,
  state: GameState,
  excludeIds: readonly number[] = []
): EnemyState | null {
  let bestEnemy: EnemyState | null = null;
  let bestDist = Math.min(range, MAX_TARGET_RANGE);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || excludeIds.includes(enemy.id)) continue;
    const d = Math.hypot(enemy.x - originX, enemy.y - originY);
    if (d <= bestDist && hasLineOfSight(originX, originY, enemy.x, enemy.y, state.map)) {
      bestDist = d;
      bestEnemy = enemy;
    }
  }
  return bestEnemy;
}

function triggerChainLightning(
  state: GameState,
  sourceX: number,
  sourceY: number,
  range: number,
  damage: number,
  maxTargets = 3
): boolean {
  const first = findNearestVisibleEnemy(sourceX, sourceY, range, state);
  if (!first) return false;

  const hitIds = new Set<number>([first.id]);
  const points: Vec2[] = [
    { x: sourceX, y: sourceY },
    { x: first.x, y: first.y },
  ];
  damageEnemy(state, first, damage);

  let curr = first;
  const maxHops = Math.max(0, maxTargets - 1);
  for (let hop = 0; hop < maxHops; hop++) {
    let nextTarget: EnemyState | null = null;
    let nextDist = Math.min(MAX_TARGET_RANGE, Math.max(105, range * 1.15));
    for (const candidate of state.enemies) {
      if (hitIds.has(candidate.id) || candidate.hp <= 0) continue;
      const d = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
      if (d <= nextDist && hasLineOfSight(curr.x, curr.y, candidate.x, curr.y, state.map)) {
        nextDist = d;
        nextTarget = candidate;
      }
    }
    if (!nextTarget) break;
    hitIds.add(nextTarget.id);
    points.push({ x: nextTarget.x, y: nextTarget.y });
    damageEnemy(state, nextTarget, damage * 0.8);
    curr = nextTarget;
  }

  state.visualFx.push({
    kind: 'lightning',
    x: sourceX,
    y: sourceY,
    points,
    color: '#f472b6',
    life: 0.22,
    maxLife: 0.22,
  });
  return true;
}

function hasClearCorridorPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  map: DungeonMap
): boolean {
  if (!hasLineOfSight(ax, ay, bx, by, map)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return true;
  const nx = (-dy / len) * (radius * 0.75);
  const ny = (dx / len) * (radius * 0.75);
  return (
    hasLineOfSight(ax + nx, ay + ny, bx + nx, by + ny, map) &&
    hasLineOfSight(ax - nx, ay - ny, bx - nx, by - ny, map)
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

function findBfsSteerTarget(
  enemy: EnemyState,
  player: PlayerState,
  map: DungeonMap,
  bfsDist: Int32Array
): Vec2 {
  const etx = Math.floor(enemy.x / TILE_SIZE);
  const ety = Math.floor(enemy.y / TILE_SIZE);
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);

  if (etx === ptx && ety === pty) {
    return { x: player.x, y: player.y };
  }

  const currIdx = ety * map.width + etx;
  const currDist =
    etx >= 0 && ety >= 0 && etx < map.width && ety < map.height ? bfsDist[currIdx] : -1;

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
    const nd = bfsDist[ny * map.width + nx];
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

export interface PlayerBaseAttackStats {
  weaponId: MainWeaponId;
  damage: number;
  cooldown: number;
  range: number;
  shotCount: number;
  speed: number;
  pierce: boolean;
  spentSp: number;
}

export function getPlayerBaseAttackStats(player: PlayerState): PlayerBaseAttackStats {
  const mods = computeSkillModifiers(player.skillLevels);
  const weaponId: MainWeaponId = player.mainWeaponId ?? 'core_shot';
  const baseDamage = 14;
  const baseCooldown = 0.58;
  const baseSpeed = 460;
  const damage = Math.round(baseDamage * mods.mainDamageMult * mods.mainParallelDamageMult);
  const cooldown = Math.max(0.24, baseCooldown * mods.mainCooldownMult);
  const range = Math.min(MAX_TARGET_RANGE, Math.round(MAX_TARGET_RANGE * mods.rangeMult));
  const shotCount = 1 + mods.mainExtraShots;
  const speed = baseSpeed + mods.mainSpeedBonus;
  return {
    weaponId,
    damage,
    cooldown,
    range,
    shotCount,
    speed,
    pierce: mods.piercingMainShot,
    spentSp: player.spentSkillPoints,
  };
}

export const getMainWeaponStats = getPlayerBaseAttackStats;

function applyTacticalStepOnHit(
  state: GameState,
  mods: ComputedSkillModifiers,
  sourceX: number,
  sourceY: number,
  defaultInvuln = 0.5
): void {
  const { player, map } = state;
  if (mods.hasTacticalStep && player.tacticalStepCooldown <= 0) {
    player.tacticalStepCooldown = mods.tacticalStepCooldown;
    player.invulnTimer = mods.tacticalInvulnDuration;
    player.tacticalSpeedTimer = TACTICAL_SPEED_BOOST_DURATION;
    player.tacticalSpeedBonus = mods.tacticalSpeedBonus;
    const dx = player.x - sourceX;
    const dy = player.y - sourceY;
    const awayLen = Math.hypot(dx, dy);
    const dirX = awayLen > 1e-4 ? dx / awayLen : -Math.cos(player.facingAngle);
    const dirY = awayLen > 1e-4 ? dy / awayLen : -Math.sin(player.facingAngle);
    const stepped = resolveCircleGridCollision(
      player.x + dirX * mods.tacticalStepDist,
      player.y + dirY * mods.tacticalStepDist,
      player.radius,
      map
    );
    player.x = stepped.x;
    player.y = stepped.y;
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 22,
      text: 'STEP!',
      color: '#38bdf8',
      life: 0.65,
      maxLife: 0.65,
    });
  } else {
    player.invulnTimer = defaultInvuln;
  }
}

/**
 * Advances the simulation by dt seconds.
 * Pure domain update: decoupled from DOM/Canvas for deterministic Vitest verification.
 */
export function stepGame(state: GameState, rawInput: Vec2, dt: number): void {
  if (state.status !== 'playing' || dt <= 0) return;

  const clampedDt = Math.min(dt, 0.05);
  const { player, map } = state;
  const mods = computeSkillModifiers(player.skillLevels);

  if (state.floorBannerTimer > 0) {
    state.floorBannerTimer = Math.max(0, state.floorBannerTimer - clampedDt);
  }

  // Note: autoRegenPerSec is 0 (APP-MAP-03)
  if (player.autoRegenPerSec > 0 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.autoRegenPerSec * clampedDt);
  }

  if (player.invulnTimer > 0) player.invulnTimer = Math.max(0, player.invulnTimer - clampedDt);
  if (player.baseAttackCooldown > 0) {
    player.baseAttackCooldown = Math.max(0, player.baseAttackCooldown - clampedDt);
  }
  if (player.repulsorCooldown > 0) player.repulsorCooldown = Math.max(0, player.repulsorCooldown - clampedDt);
  if (player.aegisCooldown > 0) player.aegisCooldown = Math.max(0, player.aegisCooldown - clampedDt);
  if (player.tacticalStepCooldown > 0) player.tacticalStepCooldown = Math.max(0, player.tacticalStepCooldown - clampedDt);
  if ((player.tacticalSpeedTimer ?? 0) > 0) {
    player.tacticalSpeedTimer = Math.max(0, (player.tacticalSpeedTimer ?? 0) - clampedDt);
    if (player.tacticalSpeedTimer <= 0) {
      player.tacticalSpeedBonus = 0;
    }
  }
  if ((state.stairsNoticeCooldown ?? 0) > 0) {
    state.stairsNoticeCooldown = Math.max(0, (state.stairsNoticeCooldown ?? 0) - clampedDt);
  }

  // 1. Player movement & smooth wall collision (APP-MAP-02)
  const prevPlayerX = player.x;
  const prevPlayerY = player.y;
  const activeSpeedBonus =
    (player.tacticalSpeedTimer ?? 0) > 0 ? (player.tacticalSpeedBonus ?? 0) : 0;
  const moveSpeed = player.baseSpeed * (1 + activeSpeedBonus);
  const inputMag = Math.hypot(rawInput.x, rawInput.y);
  if (inputMag > 1e-4) {
    const scale = inputMag > 1 ? 1 / inputMag : 1;
    const vx = rawInput.x * scale * moveSpeed;
    const vy = rawInput.y * scale * moveSpeed;
    const resolved = resolveCircleGridCollision(
      player.x + vx * clampedDt,
      player.y + vy * clampedDt,
      player.radius,
      map
    );
    player.x = resolved.x;
    player.y = resolved.y;
    player.facingAngle = Math.atan2(vy, vx);
    revealAroundPlayer(map, state.explored, player.x, player.y);
  }
  const actualVx = (player.x - prevPlayerX) / clampedDt;
  const actualVy = (player.y - prevPlayerY) / clampedDt;
  const velAlpha = 1 - Math.exp(-clampedDt * 10);
  player.velX = (player.velX ?? 0) + (actualVx - (player.velX ?? 0)) * velAlpha;
  player.velY = (player.velY ?? 0) + (actualVy - (player.velY ?? 0)) * velAlpha;

  // 2. Fountain check (Boss floor safe anteroom 100% heal once)
  if (map.fountainTile && !state.fountainUsed) {
    const fountainPos = tileCenterWorld(map.fountainTile.tx, map.fountainTile.ty);
    if (Math.hypot(player.x - fountainPos.x, player.y - fountainPos.y) <= TILE_SIZE * 0.65) {
      player.hp = player.maxHp;
      state.fountainUsed = true;
      state.floatingTexts.push({
        x: player.x,
        y: player.y - 24,
        text: 'FOUNTAIN 100% HP!',
        color: '#2dd4bf',
        life: 1.4,
        maxLife: 1.4,
      });
      state.visualFx.push({
        kind: 'pulse',
        x: fountainPos.x,
        y: fountainPos.y,
        radius: 76,
        color: '#2dd4bf',
        life: 0.55,
        maxLife: 0.55,
      });
      pushNotification(state, 'info', '⛲ 回復の泉でHPが全回復した！', '#2dd4bf', 2.8);
    }
  }

  // 2.5. Stairs check -> unlockable only after defeating mid-boss/grand boss (APP-MAP-01)
  const stairsPos = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
  if (Math.hypot(player.x - stairsPos.x, player.y - stairsPos.y) <= TILE_SIZE * 0.52) {
    const lockCount = getStairsLockCount(state);
    if (lockCount <= 0) {
      advanceToNextFloor(state);
      return;
    }
    if ((state.stairsNoticeCooldown ?? 0) <= 0) {
      pushNotification(
        state,
        'alert',
        `🔒 階段は封印中！ボス（残り${lockCount}体）を倒せ！`,
        '#f43f5e',
        2.4
      );
      state.stairsNoticeCooldown = 2.0;
    }
  }

  // 3. Chest check -> acquire/upgrade equipment or trigger slot choice modal (APP-GRW-03/04/07)
  for (const chest of state.chests) {
    if (!chest.opened && Math.hypot(player.x - chest.x, player.y - chest.y) <= player.radius + 16) {
      chest.opened = true;
      state.stats.chestsOpened += 1;
      const drop = pickChestDrop(state, chest.id);
      acquireEquipment(state, createEquippedItem(drop.id, drop.level));
      if (state.status !== 'playing') return;
    }
  }

  // 4. Skill tree active modules: Repulsor Pulse (def_pulse)
  if (mods.hasRepulsor && player.repulsorCooldown <= 0 && state.enemies.length > 0) {
    const pulseRange = Math.min(MAX_TARGET_RANGE, mods.repulsorRange * mods.rangeMult);
    const nearby = state.enemies.filter(
      (e) =>
        Math.hypot(e.x - player.x, e.y - player.y) <= pulseRange &&
        hasLineOfSight(player.x, player.y, e.x, e.y, map)
    );
    if (nearby.length > 0) {
      for (const e of nearby) {
        const knockbackImmune =
          e.kind === 'shooter' || Boolean(e.isRoomBoss) || Boolean(e.isGrandBoss);
        if (!knockbackImmune) {
          const dx = e.x - player.x;
          const dy = e.y - player.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const pushed = resolveCircleGridCollision(
            e.x + (dx / d) * 38,
            e.y + (dy / d) * 38,
            e.radius,
            map
          );
          e.x = pushed.x;
          e.y = pushed.y;
        }
        damageEnemy(state, e, mods.repulsorDamage);
      }
      state.visualFx.push({
        kind: 'pulse',
        x: player.x,
        y: player.y,
        radius: pulseRange,
        color: '#60a5fa',
        life: 0.25,
        maxLife: 0.25,
      });
      player.repulsorCooldown = mods.repulsorCooldown;
    }
  }

  // 4.5. Player intrinsic Main Weapon auto-attack (Core Shot; scales via arms skills, APP-CMB-01, APP-CMB-06)
  if (player.baseAttackCooldown <= 0 && state.enemies.length > 0) {
    const baseStats = getPlayerBaseAttackStats(player);
    const target = findNearestVisibleEnemy(player.x, player.y, baseStats.range, state);
    if (target) {
      const centerAngle = Math.atan2(target.y - player.y, target.x - player.x);
      const spreadStep = 0.14;
      for (let s = 0; s < baseStats.shotCount; s++) {
        const offset = (s - (baseStats.shotCount - 1) / 2) * spreadStep;
        const angle = centerAngle + offset;
        state.projectiles.push({
          id: state.nextEntityId++,
          kind: 'base',
          x: player.x,
          y: player.y,
          vx: Math.cos(angle) * baseStats.speed,
          vy: Math.sin(angle) * baseStats.speed,
          radius: baseStats.pierce ? 6 : 5,
          damage: baseStats.damage,
          life: 0.75,
          pierce: baseStats.pierce,
          hitEnemyIds: [],
          color: baseStats.pierce ? '#2dd4bf' : '#34d399',
        });
      }
      player.baseAttackCooldown = baseStats.cooldown;
    }
  }

  // 5. Sub-equipment parallel execution & per-level evolutions (APP-CMB-01, APP-CMB-02, APP-CMB-05)
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  const orbitCount = orbitItem ? getOrbitBitCount(orbitItem.level) : 0;
  const orbitAngularSpeed = orbitItem ? getOrbitShieldAngularSpeed(orbitCount) : 2.4;
  if (orbitItem) {
    player.orbitRadius = getOrbitShieldRadius(orbitItem.level, mods.rangeMult);
  }
  player.orbitAngle = (player.orbitAngle + orbitAngularSpeed * clampedDt) % (Math.PI * 2);
  const seekerDrones = getSeekerDronePositions(state);
  let droneCursor = 0;

  for (const item of player.equipment) {
    const def = EQUIPMENT_CATALOG[item.id];
    item.cooldown = Math.max(0, item.cooldown - clampedDt);

    if (item.id === 'orbit_shield') {
      continue;
    }

    if (item.cooldown > 0) continue;

    const dmg = getEquipmentDamage(item, 1);
    const cdMult = getEquipmentCooldownMultiplier(item.level);

    if (item.id === 'pulse_blade') {
      const blade = getPulseBladeStats(item.level, def.baseRange, mods.rangeMult);
      const cappedRange = Math.min(MAX_TARGET_RANGE, blade.range);
      const leadEnemy = findNearestVisibleEnemy(player.x, player.y, cappedRange, state);
      let leadBullet: { x: number; y: number } | null = null;
      if (!leadEnemy) {
        let bestBulletDist = cappedRange;
        for (const ep of state.enemyProjectiles) {
          const d = Math.hypot(ep.x - player.x, ep.y - player.y);
          if (d <= bestBulletDist && hasLineOfSight(player.x, player.y, ep.x, ep.y, map)) {
            bestBulletDist = d;
            leadBullet = ep;
          }
        }
      }
      const aimTarget = leadEnemy ?? leadBullet;
      if (aimTarget) {
        const slashAngle = Math.atan2(aimTarget.y - player.y, aimTarget.x - player.x);
        const targets = state.enemies.filter((e) => {
          if (Math.hypot(e.x - player.x, e.y - player.y) > cappedRange) return false;
          if (!hasLineOfSight(player.x, player.y, e.x, e.y, map)) return false;
          const ea = Math.atan2(e.y - player.y, e.x - player.x);
          let diff = Math.abs(ea - slashAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          return diff <= blade.halfArcRad;
        });
        for (const t of targets) {
          damageEnemy(state, t, dmg);
        }

        let reflectedCount = 0;
        for (let bIdx = state.enemyProjectiles.length - 1; bIdx >= 0; bIdx--) {
          const ep = state.enemyProjectiles[bIdx];
          if (ep.pierceDefense) continue;
          if (Math.hypot(ep.x - player.x, ep.y - player.y) > cappedRange + ep.radius) continue;
          if (!hasLineOfSight(player.x, player.y, ep.x, ep.y, map)) continue;
          const ba = Math.atan2(ep.y - player.y, ep.x - player.x);
          let diff = Math.abs(ba - slashAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff <= blade.halfArcRad) {
            state.enemyProjectiles.splice(bIdx, 1);
            const inSpeed = Math.hypot(ep.vx, ep.vy);
            const refAngle =
              inSpeed > 1e-3
                ? Math.atan2(-ep.vy, -ep.vx)
                : Math.atan2(ep.y - player.y, ep.x - player.x);
            const refSpeed = Math.max(360, inSpeed * 1.6);
            state.projectiles.push({
              id: state.nextEntityId++,
              kind: 'reflected',
              x: ep.x,
              y: ep.y,
              vx: Math.cos(refAngle) * refSpeed,
              vy: Math.sin(refAngle) * refSpeed,
              radius: Math.max(5, ep.radius),
              damage: Math.max(ep.damage, Math.round(dmg * 0.65)),
              life: 1.0,
              pierce: false,
              hitEnemyIds: [],
              color: '#67e8f9',
            });
            reflectedCount++;
          }
        }
        if (reflectedCount > 0) {
          state.floatingTexts.push({
            x: player.x,
            y: player.y - 22,
            text: reflectedCount > 1 ? `REFLECT x${reflectedCount}!` : 'REFLECT!',
            color: '#67e8f9',
            life: 0.55,
            maxLife: 0.55,
          });
        }

        state.visualFx.push({
          kind: 'slash',
          x: player.x,
          y: player.y,
          radius: cappedRange,
          angle: slashAngle,
          halfArcRad: blade.halfArcRad,
          fullCircle: false,
          thickness: blade.thickness,
          color: def.color,
          life: 0.24,
          maxLife: 0.24,
        });
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'seeker_drone') {
      const range = Math.min(
        MAX_TARGET_RANGE,
        getSeekerDroneRange(item.level, def.baseRange, mods.rangeMult)
      );
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const dronesToFire = Math.max(1, seekerDrones.length);
        for (let dIdx = 0; dIdx < dronesToFire; dIdx++) {
          const origin = seekerDrones[(droneCursor + dIdx) % Math.max(1, seekerDrones.length)] ?? player;
          const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
          const speed = 430 + (item.level - 1) * 18;
          state.projectiles.push({
            id: state.nextEntityId++,
            kind: 'drone',
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: 5,
            damage: dmg,
            life: 0.85,
            pierce: false,
            hitEnemyIds: [],
            color: '#7dd3fc',
          });
        }
        droneCursor++;
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'reactive_coil') {
      const coilStats = getReactiveCoilStats(item.level, def.baseRange, mods.rangeMult);
      const cappedRange = Math.min(MAX_TARGET_RANGE, coilStats.range);
      if (triggerChainLightning(state, player.x, player.y, cappedRange, dmg, coilStats.maxTargets)) {
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'ricochet_disc') {
      const discStats = getRicochetDiscStats(item.level, mods.rangeMult);
      const range = Math.min(MAX_TARGET_RANGE, discStats.range);
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const angle = Math.atan2(target.y - player.y, target.x - player.x);
        state.projectiles.push({
          id: state.nextEntityId++,
          kind: 'disc',
          x: player.x,
          y: player.y,
          vx: Math.cos(angle) * discStats.speed,
          vy: Math.sin(angle) * discStats.speed,
          radius: 7,
          damage: dmg,
          life: 1.85,
          pierce: false,
          bouncesLeft: discStats.maxBounces,
          wallBouncesLeft: 3,
          speed: discStats.speed,
          homingTurnRate: discStats.homingTurnRate,
          spinAngle: 0,
          traveledDist: 0,
          maxDistance: Math.min(480, Math.round(range * 2.6)),
          hitEnemyIds: [],
          color: def.color,
        });
        item.cooldown = def.baseCooldown * cdMult;
      }
    }
  }

  // 7. Orbit Shield Bits & enemy projectile update (including homing steering & wall bounce)
  const bits = getOrbitBitPositions(state);
  const orbitDmg = orbitItem ? getEquipmentDamage(orbitItem, 1) : 0;

  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    if ((ep.homingRate ?? 0) > 0) {
      const spd = Math.hypot(ep.vx, ep.vy);
      if (spd > 1e-3) {
        const currAngle = Math.atan2(ep.vy, ep.vx);
        const desiredAngle = Math.atan2(player.y - ep.y, player.x - ep.x);
        let diff = desiredAngle - currAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = (ep.homingRate ?? 0) * clampedDt;
        const nextAngle = currAngle + Math.max(-maxTurn, Math.min(maxTurn, diff));
        ep.vx = Math.cos(nextAngle) * spd;
        ep.vy = Math.sin(nextAngle) * spd;
      }
    }

    let nx = ep.x + ep.vx * clampedDt;
    let ny = ep.y + ep.vy * clampedDt;
    if ((ep.bouncesLeft ?? 0) > 0) {
      let bounced = false;
      if (isWallAtWorld(map, nx, ep.y)) {
        ep.vx = -ep.vx;
        nx = ep.x + ep.vx * clampedDt;
        bounced = true;
      }
      if (isWallAtWorld(map, ep.x, ny)) {
        ep.vy = -ep.vy;
        ny = ep.y + ep.vy * clampedDt;
        bounced = true;
      }
      if (!bounced && isWallAtWorld(map, nx, ny)) {
        ep.vx = -ep.vx;
        ep.vy = -ep.vy;
        nx = ep.x + ep.vx * clampedDt;
        ny = ep.y + ep.vy * clampedDt;
        bounced = true;
      }
      if (bounced) {
        ep.bouncesLeft = (ep.bouncesLeft ?? 0) - 1;
      }
    }

    ep.x = nx;
    ep.y = ny;
    ep.life -= clampedDt;
    if (ep.life <= 0 || isWallAtWorld(map, ep.x, ep.y)) {
      state.enemyProjectiles.splice(i, 1);
      continue;
    }
    if (!ep.pierceDefense) {
      const blockedByBit = bits.some(
        (bit) => Math.hypot(bit.x - ep.x, bit.y - ep.y) <= ep.radius + 10
      );
      if (blockedByBit) {
        state.enemyProjectiles.splice(i, 1);
      }
    }
  }

  // 8. Player projectiles & wall/enemy collision + homing/orbiting ricochet disc (APP-CMB-03, APP-CMB-05)
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.life -= clampedDt;

    if (proj.kind === 'disc') {
      proj.spinAngle = (proj.spinAngle ?? 0) + 18 * clampedDt;
      const spd = proj.speed ?? 360;

      if (proj.orbitTargetId !== undefined) {
        const orbitTarget = state.enemies.find((e) => e.id === proj.orbitTargetId && e.hp > 0);
        if (!orbitTarget) {
          proj.orbitTargetId = undefined;
          proj.orbitProgress = 0;
        } else {
          const orbitRadius = orbitTarget.radius * 1.8 + 18;
          const angularStep = (spd / orbitRadius) * clampedDt;
          const nextOrbitAngle = (proj.orbitAngle ?? 0) + angularStep;
          const nextProgress = (proj.orbitProgress ?? 0) + angularStep;
          const ox = orbitTarget.x + Math.cos(nextOrbitAngle) * orbitRadius;
          const oy = orbitTarget.y + Math.sin(nextOrbitAngle) * orbitRadius;

          if (!isWallAtWorld(map, ox, oy)) {
            proj.vx = (ox - proj.x) / Math.max(1e-4, clampedDt);
            proj.vy = (oy - proj.y) / Math.max(1e-4, clampedDt);
            proj.x = ox;
            proj.y = oy;
          }
          proj.orbitAngle = nextOrbitAngle;
          proj.orbitProgress = nextProgress;

          if (nextProgress >= Math.PI * 2) {
            proj.hitEnemyIds = proj.hitEnemyIds.filter((id) => id !== orbitTarget.id);
            proj.orbitTargetId = undefined;
            proj.orbitProgress = 0;
            const strikeAngle = Math.atan2(orbitTarget.y - proj.y, orbitTarget.x - proj.x);
            proj.vx = Math.cos(strikeAngle) * spd;
            proj.vy = Math.sin(strikeAngle) * spd;
          }
        }
      }

      if (proj.orbitTargetId === undefined) {
        const homingTarget = findNearestVisibleEnemy(
          proj.x,
          proj.y,
          170,
          state,
          proj.hitEnemyIds
        );
        if (homingTarget) {
          const currAngle = Math.atan2(proj.vy, proj.vx);
          const desiredAngle = Math.atan2(homingTarget.y - proj.y, homingTarget.x - proj.x);
          let diff = desiredAngle - currAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = (proj.homingTurnRate ?? 8) * clampedDt;
          const nextAngle = currAngle + Math.max(-maxTurn, Math.min(maxTurn, diff));
          proj.vx = Math.cos(nextAngle) * spd;
          proj.vy = Math.sin(nextAngle) * spd;
        }

        let nx = proj.x + proj.vx * clampedDt;
        let ny = proj.y + proj.vy * clampedDt;
        if ((proj.wallBouncesLeft ?? 0) > 0) {
          let wallBounced = false;
          if (isWallAtWorld(map, nx, proj.y)) {
            proj.vx = -proj.vx;
            nx = proj.x + proj.vx * clampedDt;
            wallBounced = true;
          }
          if (isWallAtWorld(map, proj.x, ny)) {
            proj.vy = -proj.vy;
            ny = proj.y + proj.vy * clampedDt;
            wallBounced = true;
          }
          if (!wallBounced && isWallAtWorld(map, nx, ny)) {
            proj.vx = -proj.vx;
            proj.vy = -proj.vy;
            nx = proj.x + proj.vx * clampedDt;
            ny = proj.y + proj.vy * clampedDt;
            wallBounced = true;
          }
          if (wallBounced) {
            proj.wallBouncesLeft = (proj.wallBouncesLeft ?? 0) - 1;
          }
        }
        proj.traveledDist = (proj.traveledDist ?? 0) + Math.hypot(nx - proj.x, ny - proj.y);
        proj.x = nx;
        proj.y = ny;
      }
    } else {
      proj.x += proj.vx * clampedDt;
      proj.y += proj.vy * clampedDt;
    }

    const exceededDist =
      proj.maxDistance !== undefined && (proj.traveledDist ?? 0) >= proj.maxDistance;
    if (proj.life <= 0 || exceededDist || isWallAtWorld(map, proj.x, proj.y)) {
      state.projectiles.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (const enemy of state.enemies) {
      if (proj.orbitTargetId === enemy.id || proj.hitEnemyIds.includes(enemy.id)) continue;
      if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
        damageEnemy(state, enemy, proj.damage);
        proj.hitEnemyIds.push(enemy.id);

        if (proj.kind === 'disc' && (proj.bouncesLeft ?? 0) > 0) {
          proj.bouncesLeft = (proj.bouncesLeft ?? 0) - 1;
          const nextTarget = findNearestVisibleEnemy(enemy.x, enemy.y, 165, state, proj.hitEnemyIds);
          if (nextTarget) {
            const spd = proj.speed ?? 360;
            const bounceAngle = Math.atan2(nextTarget.y - proj.y, nextTarget.x - proj.x);
            proj.vx = Math.cos(bounceAngle) * spd;
            proj.vy = Math.sin(bounceAngle) * spd;
            proj.life = Math.max(proj.life, 0.9);
          } else {
            // No unhit enemy in sight: orbit around this enemy for 1 full revolution, then re-hit
            proj.orbitTargetId = enemy.id;
            proj.orbitAngle = Math.atan2(proj.y - enemy.y, proj.x - enemy.x);
            proj.orbitProgress = 0;
            proj.life = Math.max(proj.life, 1.0);
          }
          break;
        }

        if (!proj.pierce) {
          consumed = true;
          break;
        }
      }
    }
    if (consumed) {
      state.projectiles.splice(i, 1);
    }
  }

  // 9. Update enemies (with BFS corridor pathfinding, scout wander/alert, shooter 8-way barrage, boss patterns, room-only repop)
  const rng = createRng(
    (state.seed ^ (state.stats.kills * 7919) ^ (state.floor * 131) ^ Math.floor(state.elapsedFloorTime * 10)) >>> 0
  );

  // 9a. Timed reinforcement respawn (room tiles only; boss floor spawns inside boss arena only while grand boss is active)
  state.elapsedFloorTime += clampedDt;
  state.respawnTimer -= clampedDt;
  const maxAlive = 26 + state.floor * 3;
  const isBossArenaFloor = map.floorType === 'boss';
  const activeGrandBoss = isBossArenaFloor
    ? state.enemies.find((e) => e.isGrandBoss && e.hp > 0)
    : undefined;
  const canRespawnOnFloor = !isBossArenaFloor || Boolean(activeGrandBoss && activeGrandBoss.awake);

  if (state.respawnTimer <= 0) {
    state.respawnTimer = isBossArenaFloor ? 5.0 : Math.max(9, 14 - (state.floor - 1) * 0.8);
    const nonBossAlive = isBossArenaFloor
      ? state.enemies.filter((e) => !e.isRoomBoss && !e.isGrandBoss).length
      : state.enemies.length;
    const arenaCap = isBossArenaFloor ? 10 : maxAlive;
    if (canRespawnOnFloor && state.enemies.length < maxAlive && (!isBossArenaFloor || nonBossAlive < arenaCap)) {
      const occupied = new Set<number>();
      for (const e of state.enemies) {
        occupied.add(tileIndex(map, Math.floor(e.x / TILE_SIZE), Math.floor(e.y / TILE_SIZE)));
      }
      for (const c of state.chests) {
        occupied.add(tileIndex(map, Math.floor(c.x / TILE_SIZE), Math.floor(c.y / TILE_SIZE)));
      }
      const candidates: { tx: number; ty: number }[] = [];
      const bossArena = isBossArenaFloor && map.rooms.length >= 2 ? map.rooms[1] : null;
      for (let ty = 1; ty < map.height - 1; ty++) {
        for (let tx = 1; tx < map.width - 1; tx++) {
          if (isWallTile(map, tx, ty) || occupied.has(tileIndex(map, tx, ty))) continue;
          const room = findRoomAtTile(map, tx, ty);
          if (!room) continue; // Corridor respawn suppressed
          if (bossArena && room !== bossArena) continue; // Never spawn inside fountain anteroom
          const pos = tileCenterWorld(tx, ty);
          const minDist = bossArena ? 180 : 260;
          if (Math.hypot(pos.x - player.x, pos.y - player.y) >= minDist) {
            candidates.push({ tx, ty });
          }
        }
      }
      if (candidates.length > 0) {
        const desiredCount = isBossArenaFloor
          ? Math.min(arenaCap - nonBossAlive, rng.next() < 0.5 ? 3 : 2)
          : rng.next() < 0.45
            ? 2
            : 1;
        const spawnCount = Math.min(candidates.length, maxAlive - state.enemies.length, desiredCount);
        for (let s = 0; s < spawnCount; s++) {
          const pickIdx = rng.int(0, candidates.length - 1);
          const picked = candidates.splice(pickIdx, 1)[0];
          const pos = tileCenterWorld(picked.tx, picked.ty);
          const kind = pickEnemyKindForFloor(state.floor, rng.next());
          const spawned = createEnemyByKind(state.nextEntityId++, kind, pos.x, pos.y, state.floor, MAX_TARGET_RANGE);
          if (bossArena) spawned.awake = true;
          state.enemies.push(spawned);
        }
        pushNotification(
          state,
          'info',
          bossArena ? '👾 ボスアリーナに増援が出現！' : '👾 ダンジョン奥の部屋に新たな敵の気配…',
          '#c084fc',
          2.2
        );
      }
    }
  }

  let bfsDist: Int32Array | null = null;
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  const playerRoom = findRoomAtTile(map, ptx, pty);
  const alertSpawns: EnemyState[] = [];

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    const wasAwake = enemy.awake;
    if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - clampedDt);
    if (enemy.bitHitCooldown > 0) enemy.bitHitCooldown = Math.max(0, enemy.bitHitCooldown - clampedDt);
    if ((enemy.alertCooldown ?? 0) > 0) {
      enemy.alertCooldown = Math.max(0, (enemy.alertCooldown ?? 0) - clampedDt);
    }
    if ((enemy.spawnDelay ?? 0) > 0) {
      enemy.spawnDelay = Math.max(0, (enemy.spawnDelay ?? 0) - clampedDt);
    }

    if (orbitItem && enemy.bitHitCooldown <= 0) {
      for (const bit of bits) {
        if (
          !isWallAtWorld(map, bit.x, bit.y) &&
          Math.hypot(enemy.x - bit.x, enemy.y - bit.y) <= enemy.radius + 9
        ) {
          damageEnemy(state, enemy, orbitDmg);
          enemy.bitHitCooldown = 0.35;
          break;
        }
      }
    }

    if (enemy.hp <= 0) {
      state.stats.kills += 1;
      const wasRoomBoss = Boolean(enemy.isRoomBoss);
      const wasGrandBoss = Boolean(enemy.isGrandBoss);

      // Scout-spawned ambush runners yield no drops so alerts cannot be farmed for EXP (APP-MAP-07)
      if (!enemy.isAmbush) {
        state.pickups.push({
          id: state.nextEntityId++,
          kind: 'exp',
          x: enemy.x,
          y: enemy.y,
          value: wasGrandBoss ? 120 : wasRoomBoss ? 45 : 10,
        });
        if (wasRoomBoss || rng.next() < 0.22 + mods.lootBonusRate * 0.4) {
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'heal',
            x: enemy.x + 10,
            y: enemy.y + 6,
            value: wasGrandBoss ? 60 : wasRoomBoss ? 40 : 25,
          });
        }
        if (wasRoomBoss) {
          const eqId = rng.pick(ALL_EQUIPMENT_IDS);
          let minEquippedLv = 1;
          if (player.equipment.length > 0) {
            minEquippedLv = Math.min(...player.equipment.map((eq) => eq.level));
          }
          const bonus = (wasGrandBoss ? 2 : 1) + (rng.next() < 0.35 ? 1 : 0);
          const itemLevel = clampEquipmentLevel(minEquippedLv + bonus);
          state.pickups.push({
            id: state.nextEntityId++,
            kind: 'equip',
            x: enemy.x - 10,
            y: enemy.y + 6,
            value: 1,
            equipmentId: eqId,
            itemLevel,
          });
        } else {
          // Low-probability enemy equipment drop (1.5% base + mob_loot bonus) scaled to player's lowest equipment level & drop quality (APP-GRW-07)
          const equipDropChance = 0.015 + mods.equipDropBonus;
          if (rng.next() < equipDropChance) {
            const eqId = rng.pick(ALL_EQUIPMENT_IDS);
            const itemLevel = rollDropEquipmentLevel(
              player.equipment,
              () => rng.next(),
              mods.dropQualityTier
            );
            state.pickups.push({
              id: state.nextEntityId++,
              kind: 'equip',
              x: enemy.x - 10,
              y: enemy.y + 6,
              value: 1,
              equipmentId: eqId,
              itemLevel,
            });
          }
        }
      }
      state.enemies.splice(i, 1);
      if (wasRoomBoss && getStairsLockCount(state) === 0) {
        const stairsWorld = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
        pushNotification(
          state,
          'info',
          wasGrandBoss
            ? `🏆 階層ボス撃破！階段から先（${state.floor + 1}F）へ進める！`
            : '🔓 中ボス撃破！階段の封印が解けた！',
          '#22d3ee',
          3.2
        );
        state.visualFx.push({
          kind: 'pulse',
          x: stairsWorld.x,
          y: stairsWorld.y,
          radius: 84,
          color: '#22d3ee',
          life: 0.65,
          maxLife: 0.65,
        });
      }
      continue;
    }

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distToPlayer = Math.hypot(dx, dy);
    const etx = Math.floor(enemy.x / TILE_SIZE);
    const ety = Math.floor(enemy.y / TILE_SIZE);
    const inSameRoomAsPlayer = playerRoom !== null && isTileInRoom(playerRoom, etx, ety);

    if (!enemy.awake) {
      const canProxWake = enemy.kind !== 'shooter' && distToPlayer <= 140;
      const canSightWake =
        distToPlayer <= enemy.aggroRange && hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map);
      if (inSameRoomAsPlayer || canProxWake || canSightWake) {
        enemy.awake = true;
        if (enemy.kind === 'shooter') {
          enemy.attackCooldown = Math.max(enemy.attackCooldown ?? 0, 0.95);
        }
        if (enemy.isGrandBoss) {
          state.respawnTimer = Math.min(state.respawnTimer, 2.0);
        }
        if (enemy.isRoomBoss) {
          enemy.mortarCooldown = Math.min(enemy.mortarCooldown ?? 0.6, 0.6);
        }
      }
    }

    // Ambush spawn delay prevents unfair frame-1 contact damage immediately upon popping in
    if ((enemy.spawnDelay ?? 0) > 0) {
      continue;
    }

    // Scout archetype: patrol corridors/rooms freely while unalerted; on alert wake allies & ambush with fast runners
    if (enemy.kind === 'scout') {
      if (enemy.awake) {
        if ((enemy.alertCooldown ?? 0) <= 0) {
          enemy.alertCooldown = 7.5;
          for (const ally of state.enemies) {
            if (ally.id !== enemy.id && Math.hypot(ally.x - enemy.x, ally.y - enemy.y) <= SCOUT_ALERT_RADIUS) {
              if (!ally.awake && ally.kind === 'shooter') {
                ally.attackCooldown = Math.max(ally.attackCooldown ?? 0, 0.95);
              }
              ally.awake = true;
            }
          }

          // Spawn 2-3 fast awake runners nearby (130-320px away) that outpace player baseSpeed
          const spawnCandidates: { tx: number; ty: number }[] = [];
          const occupied = new Set<number>();
          for (const existing of state.enemies) {
            occupied.add(tileIndex(map, Math.floor(existing.x / TILE_SIZE), Math.floor(existing.y / TILE_SIZE)));
          }
          for (const spawned of alertSpawns) {
            occupied.add(tileIndex(map, Math.floor(spawned.x / TILE_SIZE), Math.floor(spawned.y / TILE_SIZE)));
          }
          const minSy = Math.max(1, pty - 9);
          const maxSy = Math.min(map.height - 2, pty + 9);
          const minSx = Math.max(1, ptx - 9);
          const maxSx = Math.min(map.width - 2, ptx + 9);
          for (let ty = minSy; ty <= maxSy; ty++) {
            for (let tx = minSx; tx <= maxSx; tx++) {
              if (isWallTile(map, tx, ty) || occupied.has(tileIndex(map, tx, ty))) continue;
              const c = tileCenterWorld(tx, ty);
              const dPlayer = Math.hypot(c.x - player.x, c.y - player.y);
              if (dPlayer >= 130 && dPlayer <= 320) {
                spawnCandidates.push({ tx, ty });
              }
            }
          }
          if (spawnCandidates.length === 0) {
            for (let ty = 1; ty < map.height - 1; ty++) {
              for (let tx = 1; tx < map.width - 1; tx++) {
                if (isWallTile(map, tx, ty) || occupied.has(tileIndex(map, tx, ty))) continue;
                const c = tileCenterWorld(tx, ty);
                const dPlayer = Math.hypot(c.x - player.x, c.y - player.y);
                if (dPlayer >= 90 && dPlayer <= 380) {
                  spawnCandidates.push({ tx, ty });
                }
              }
            }
          }
          const ambushCount = Math.min(spawnCandidates.length, state.floor >= 3 ? 3 : 2);
          for (let s = 0; s < ambushCount; s++) {
            const pickIdx = rng.int(0, spawnCandidates.length - 1);
            const picked = spawnCandidates.splice(pickIdx, 1)[0];
            const pos = tileCenterWorld(picked.tx, picked.ty);
            const runner = createEnemyByKind(state.nextEntityId++, 'runner', pos.x, pos.y, state.floor, MAX_TARGET_RANGE);
            runner.speed = Math.max(228, Math.min(265, Math.round(224 + (state.floor - 1) * 4)));
            runner.spawnDelay = 0.45;
            runner.awake = true;
            runner.isAmbush = true;
            alertSpawns.push(runner);
            state.visualFx.push({
              kind: 'pulse',
              x: pos.x,
              y: pos.y,
              radius: 36,
              color: '#f59e0b',
              life: 0.35,
              maxLife: 0.35,
            });
          }

          const inCorridorEncounter = playerRoom === null;
          state.visualFx.push({
            kind: 'pulse',
            x: enemy.x,
            y: enemy.y,
            radius: 130,
            color: '#f97316',
            life: 0.45,
            maxLife: 0.45,
          });
          state.floatingTexts.push({
            x: enemy.x,
            y: enemy.y - enemy.radius - 10,
            text: inCorridorEncounter ? 'ENCOUNTER!!' : 'ALERT!!',
            color: '#fb923c',
            life: 1.0,
            maxLife: 1.0,
          });
          pushNotification(
            state,
            'alert',
            inCorridorEncounter
              ? '⚠️ 通路でスカウトと遭遇！高速の敵が迫る！'
              : '⚠️ スカウトに発見された！高速の敵が迫る！',
            '#f97316',
            2.8
          );
        }
      } else if (enemy.speed > 0) {
        enemy.wanderTimer = (enemy.wanderTimer ?? 0) - clampedDt;
        const arrived = enemy.wanderTarget
          ? Math.hypot(enemy.wanderTarget.x - enemy.x, enemy.wanderTarget.y - enemy.y) <= 8
          : true;
        if (!enemy.wanderTarget || arrived || (enemy.wanderTimer ?? 0) <= 0) {
          const dirs: readonly [number, number][] = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          const prevDx = enemy.wanderDir?.x ?? 0;
          const prevDy = enemy.wanderDir?.y ?? 0;
          const validDirs: { dx: number; dy: number; tx: number; ty: number }[] = [];
          for (const [ox, oy] of dirs) {
            const ntx = etx + ox;
            const nty = ety + oy;
            if (ntx <= 0 || nty <= 0 || ntx >= map.width - 1 || nty >= map.height - 1) continue;
            if (!isWallTile(map, ntx, nty)) {
              validDirs.push({ dx: ox, dy: oy, tx: ntx, ty: nty });
            }
          }
          if (validDirs.length > 0) {
            const forward = validDirs.find((d) => d.dx === prevDx && d.dy === prevDy);
            const nonReverse = validDirs.filter((d) => !(d.dx === -prevDx && d.dy === -prevDy));
            const pool = nonReverse.length > 0 ? nonReverse : validDirs;
            const chosen =
              forward && rng.next() < 0.72
                ? forward
                : pool[rng.int(0, pool.length - 1)];
            enemy.wanderTarget = tileCenterWorld(chosen.tx, chosen.ty);
            enemy.wanderDir = { x: chosen.dx, y: chosen.dy };
          } else {
            enemy.wanderTarget = null;
          }
          enemy.wanderTimer = 1.1;
        }
        if (enemy.wanderTarget) {
          const wdx = enemy.wanderTarget.x - enemy.x;
          const wdy = enemy.wanderTarget.y - enemy.y;
          const wDist = Math.hypot(wdx, wdy);
          if (wDist > 1e-3) {
            const wanderSpeed = enemy.speed * 0.78;
            const resolved = resolveCircleGridCollision(
              enemy.x + (wdx / wDist) * wanderSpeed * clampedDt,
              enemy.y + (wdy / wDist) * wanderSpeed * clampedDt,
              enemy.radius,
              map
            );
            enemy.x = resolved.x;
            enemy.y = resolved.y;
          }
        }
      }
    }

    // Normal enemy archetype: player-level-scaled weak ranged shot (prevents 1F bullet-hell while escalating later)
    if ((!enemy.kind || enemy.kind === 'normal') && enemy.awake) {
      const inSight =
        distToPlayer > 1e-3 &&
        distToPlayer <= 190 &&
        hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map);
      if (!inSight) {
        enemy.attackCooldown = Math.max(enemy.attackCooldown ?? 0, 0.55);
      } else if (wasAwake) {
        if ((enemy.attackCooldown ?? 0) > 0) {
          enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDt);
        }
        if ((enemy.attackCooldown ?? 0) <= 0) {
          const shotStats = getNormalEnemyShotStats(player.level);
          const baseAngle = Math.atan2(dy, dx);
          const dmgVal = Math.max(1, Math.round(enemy.damage * shotStats.damageMult));
          for (let s = 0; s < shotStats.shotCount; s++) {
            const offset = (s - (shotStats.shotCount - 1) / 2) * 0.16;
            const a = baseAngle + offset;
            state.enemyProjectiles.push({
              id: state.nextEntityId++,
              x: enemy.x,
              y: enemy.y,
              vx: Math.cos(a) * shotStats.speed,
              vy: Math.sin(a) * shotStats.speed,
              radius: 4.5,
              damage: dmgVal,
              life: 1.3,
              color: '#fb7185',
            });
          }
          enemy.attackCooldown = shotStats.cooldown;
        }
      }
    }

    // Tank archetype: predictive parabolic mortar lobbing ground AoE zones with clear impact timing
    if (enemy.kind === 'tank' && !enemy.isRoomBoss && enemy.awake) {
      const enemyTx = Math.floor(enemy.x / TILE_SIZE);
      const enemyTy = Math.floor(enemy.y / TILE_SIZE);
      const sameRoom = playerRoom !== null && isTileInRoom(playerRoom, enemyTx, enemyTy);
      const canMortarFire =
        distToPlayer > 1e-3 &&
        ((sameRoom && distToPlayer <= 380) ||
          (distToPlayer <= 280 && hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map)));
      if (!canMortarFire) {
        enemy.attackCooldown = Math.max(enemy.attackCooldown ?? 0, 0.75);
      } else if (wasAwake) {
        if ((enemy.attackCooldown ?? 0) > 0) {
          enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDt);
        }
        if ((enemy.attackCooldown ?? 0) <= 0) {
          const mortarDuration = 0.85;
          const leadTime = 0.55;
          const maxLeadDist = 115;
          let leadDx = (player.velX ?? 0) * leadTime;
          let leadDy = (player.velY ?? 0) * leadTime;
          const leadLen = Math.hypot(leadDx, leadDy);
          if (leadLen > maxLeadDist) {
            leadDx = (leadDx / leadLen) * maxLeadDist;
            leadDy = (leadDy / leadLen) * maxLeadDist;
          }
          let tx = player.x;
          let ty = player.y;
          const steps = 5;
          for (let s = 0; s < steps; s++) {
            const stepped = resolveCircleGridCollision(
              tx + leadDx / steps,
              ty + leadDy / steps,
              player.radius,
              map
            );
            tx = stepped.x;
            ty = stepped.y;
          }

          state.mortarZones.push({
            id: state.nextEntityId++,
            startX: enemy.x,
            startY: enemy.y,
            targetX: tx,
            targetY: ty,
            radius: 52,
            damage: Math.round(enemy.damage * 1.45),
            elapsed: 0,
            duration: mortarDuration,
          });
          enemy.attackCooldown = 2.4;
        }
      }
    }

    // Shooter archetype: stationary knockback-immune turret firing continuous rotating radial barrage once awake
    if (enemy.kind === 'shooter' && enemy.awake) {
      const enemyTx = Math.floor(enemy.x / TILE_SIZE);
      const enemyTy = Math.floor(enemy.y / TILE_SIZE);
      const sameRoom = playerRoom !== null && isTileInRoom(playerRoom, enemyTx, enemyTy);
      const canShooterFire =
        distToPlayer > 1e-3 && ((sameRoom && distToPlayer <= 420) || distToPlayer <= 380);
      if (!canShooterFire) {
        enemy.attackCooldown = Math.max(enemy.attackCooldown ?? 0, 0.75);
      } else if (wasAwake) {
        if ((enemy.attackCooldown ?? 0) > 0) {
          enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDt);
        }
        if ((enemy.attackCooldown ?? 0) <= 0) {
          const projSpeed = 152 + Math.min(55, (state.floor - 1) * 7);
          const dirCount = state.floor >= 6 ? 6 : 4;
          const angleStep = Math.PI / (dirCount * 2);
          const shotIdx = enemy.bossPatternIndex ?? 0;
          const baseOffset = shotIdx * angleStep;
          const pierceSlotA = rng.int(0, dirCount - 1);
          const pierceSlotB =
            dirCount >= 6 ? (pierceSlotA + rng.int(1, dirCount - 1)) % dirCount : -1;
          for (let k = 0; k < dirCount; k++) {
            const angle = baseOffset + (k * Math.PI * 2) / dirCount;
            const isPiercing = k === pierceSlotA || k === pierceSlotB;
            state.enemyProjectiles.push({
              id: state.nextEntityId++,
              x: enemy.x,
              y: enemy.y,
              vx: Math.cos(angle) * projSpeed,
              vy: Math.sin(angle) * projSpeed,
              radius: isPiercing ? 5.5 : 5,
              damage: enemy.damage,
              life: 1.85,
              pierceDefense: isPiercing,
              color: isPiercing ? '#e879f9' : undefined,
            });
          }
          enemy.bossPatternIndex = (shotIdx + 1) % 16;
          enemy.attackCooldown = Math.max(0.36, 0.48 - (state.floor - 1) * 0.015);
        }
      }
    }

    // Guardian / Grand Boss rotating patterns (ring, spread homing orbs, wall-bouncing shots, lead dash + burst) + independent mortar
    if (enemy.isRoomBoss && enemy.awake) {
      const isGrand = Boolean(enemy.isGrandBoss);
      if (wasAwake && enemy.dashState !== 'dashing' && enemy.dashState !== 'windup') {
        enemy.mortarCooldown = Math.max(0, (enemy.mortarCooldown ?? 0.6) - clampedDt);
        const canBossMortar =
          distToPlayer > 1e-3 && distToPlayer <= (isGrand ? 520 : 400);
        if (canBossMortar && (enemy.mortarCooldown ?? 0) <= 0) {
          const mortarDuration = 0.85;
          const leadTime = 0.55;
          const maxLeadDist = 115;
          let leadDx = (player.velX ?? 0) * leadTime;
          let leadDy = (player.velY ?? 0) * leadTime;
          const leadLen = Math.hypot(leadDx, leadDy);
          if (leadLen > maxLeadDist) {
            leadDx = (leadDx / leadLen) * maxLeadDist;
            leadDy = (leadDy / leadLen) * maxLeadDist;
          }
          let tx = player.x;
          let ty = player.y;
          const steps = 5;
          for (let s = 0; s < steps; s++) {
            const stepped = resolveCircleGridCollision(
              tx + leadDx / steps,
              ty + leadDy / steps,
              player.radius,
              map
            );
            tx = stepped.x;
            ty = stepped.y;
          }
          state.mortarZones.push({
            id: state.nextEntityId++,
            startX: enemy.x,
            startY: enemy.y,
            targetX: tx,
            targetY: ty,
            radius: 52,
            damage: Math.round(enemy.damage * 1.2),
            elapsed: 0,
            duration: mortarDuration,
          });
          enemy.mortarCooldown = isGrand ? 2.2 : 2.6;
        }
      }

      if (enemy.dashState === 'windup') {
        enemy.dashTimer = Math.max(0, (enemy.dashTimer ?? 0) - clampedDt);
        if ((enemy.dashTimer ?? 0) <= 0) {
          enemy.dashState = 'dashing';
          enemy.dashTimer = isGrand ? 0.55 : 0.50;
        }
      } else if (enemy.dashState === 'dashing' && enemy.dashDir) {
        const dashSpd = enemy.dashSpeed ?? (isGrand ? 460 : 410);
        const stepDist = dashSpd * clampedDt;
        const resolvedDash = resolveCircleGridCollision(
          enemy.x + enemy.dashDir.x * stepDist,
          enemy.y + enemy.dashDir.y * stepDist,
          enemy.radius,
          map
        );
        const moved = Math.hypot(resolvedDash.x - enemy.x, resolvedDash.y - enemy.y);
        enemy.x = resolvedDash.x;
        enemy.y = resolvedDash.y;
        enemy.dashTimer = Math.max(0, (enemy.dashTimer ?? 0) - clampedDt);
        if ((enemy.dashTimer ?? 0) <= 0 || moved < stepDist * 0.45) {
          enemy.dashState = 'none';
          const burstCount = isGrand ? 8 : 4;
          const burstSpd = isGrand ? 195 : 170;
          const baseBurstAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
          const pSlotA = rng.int(0, burstCount - 1);
          const pSlotB = isGrand ? (pSlotA + rng.int(1, burstCount - 1)) % burstCount : -1;
          for (let k = 0; k < burstCount; k++) {
            const ba = baseBurstAngle + (k * Math.PI * 2) / burstCount;
            const isPiercing = k === pSlotA || k === pSlotB;
            state.enemyProjectiles.push({
              id: state.nextEntityId++,
              x: enemy.x,
              y: enemy.y,
              vx: Math.cos(ba) * burstSpd,
              vy: Math.sin(ba) * burstSpd,
              radius: isPiercing ? 6 : 5.5,
              damage: Math.round(enemy.damage * 0.78),
              life: 1.7,
              pierceDefense: isPiercing,
              color: isPiercing ? '#e879f9' : '#f97316',
            });
          }
        }
      } else {
        const inSight =
          distToPlayer > 1e-3 &&
          distToPlayer <= (isGrand ? 420 : 300) &&
          hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map);
        if (inSight && wasAwake) {
          if ((enemy.attackCooldown ?? 0) > 0) {
            enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDt);
          }
          if ((enemy.attackCooldown ?? 0) <= 0) {
            const pattern = enemy.bossPatternIndex ?? 0;
            const aimAngle = Math.atan2(dy, dx);
            const dmgVal = Math.round(enemy.damage * 0.8);

            if (pattern === 0) {
              const count = isGrand ? 12 : 8;
              const spd = isGrand ? 195 : 172;
              const pierceCount = isGrand ? 3 : 2;
              const pierceStart = rng.int(0, count - 1);
              const pierceStep = Math.floor(count / pierceCount);
              for (let k = 0; k < count; k++) {
                const a = aimAngle + (k * Math.PI * 2) / count;
                const isPiercing = ((k - pierceStart + count) % pierceStep === 0) &&
                  Math.floor(((k - pierceStart + count) % count) / pierceStep) < pierceCount;
                state.enemyProjectiles.push({
                  id: state.nextEntityId++,
                  x: enemy.x,
                  y: enemy.y,
                  vx: Math.cos(a) * spd,
                  vy: Math.sin(a) * spd,
                  radius: isPiercing ? 6.5 : 6,
                  damage: dmgVal,
                  life: 2.1,
                  pierceDefense: isPiercing,
                  color: isPiercing ? '#e879f9' : isGrand ? '#f43f5e' : '#fb7185',
                });
              }
            } else if (pattern === 1) {
              const count = isGrand ? 6 : 4;
              const spread = isGrand ? 1.85 : 1.45;
              const baseSpd = isGrand ? 168 : 148;
              for (let k = 0; k < count; k++) {
                const t = count > 1 ? k / (count - 1) - 0.5 : 0; // -0.5 .. +0.5
                const edgeFactor = Math.abs(t) * 2; // 0 (center) .. 1 (outer)
                const a = aimAngle + t * spread;
                const spd = baseSpd - edgeFactor * 36;
                const homingRate = (isGrand ? 1.55 : 1.3) + edgeFactor * (isGrand ? 1.05 : 0.85);
                state.enemyProjectiles.push({
                  id: state.nextEntityId++,
                  x: enemy.x,
                  y: enemy.y,
                  vx: Math.cos(a) * spd,
                  vy: Math.sin(a) * spd,
                  radius: 6.5,
                  damage: dmgVal,
                  life: 2.6,
                  homingRate,
                  color: '#c084fc',
                });
              }
            } else if (pattern === 2) {
              if (isGrand) {
                const leadPx = player.x + (player.velX ?? 0) * 0.45;
                const leadPy = player.y + (player.velY ?? 0) * 0.45;
                const laserAngle = Math.atan2(leadPy - enemy.y, leadPx - enemy.x);
                let ldx = Math.cos(laserAngle);
                let ldy = Math.sin(laserAngle);
                let lx = enemy.x;
                let ly = enemy.y;
                const points: Vec2[] = [{ x: lx, y: ly }];
                const stepSize = 6;
                let bounces = 0;
                const maxBounces = 2;
                let traveled = 0;
                const maxLaserDist = 1800;
                while (traveled < maxLaserDist) {
                  const nx = lx + ldx * stepSize;
                  const ny = ly + ldy * stepSize;
                  if (isWallAtWorld(map, nx, ny)) {
                    points.push({ x: lx, y: ly });
                    if (bounces >= maxBounces) break;
                    const hitX = isWallAtWorld(map, nx, ly);
                    const hitY = isWallAtWorld(map, lx, ny);
                    if (hitX) ldx = -ldx;
                    if (hitY) ldy = -ldy;
                    if (!hitX && !hitY) {
                      ldx = -ldx;
                      ldy = -ldy;
                    }
                    bounces++;
                  } else {
                    lx = nx;
                    ly = ny;
                  }
                  traveled += stepSize;
                }
                if (points.length === 1 || Math.hypot(lx - points[points.length - 1].x, ly - points[points.length - 1].y) > 4) {
                  points.push({ x: lx, y: ly });
                }
                if (!state.bossLasers) state.bossLasers = [];
                state.bossLasers.push({
                  id: state.nextEntityId++,
                  points,
                  width: 11,
                  damage: Math.round(enemy.damage * 1.15),
                  elapsed: 0,
                  windup: 0.65,
                  duration: 0.92,
                  hitPlayer: false,
                });
              } else {
                const count = 4;
                const spd = 168;
                const pSlotA = rng.int(0, count - 1);
                for (let k = 0; k < count; k++) {
                  const a = aimAngle + (k - (count - 1) / 2) * 0.34;
                  const isPiercing = k === pSlotA;
                  state.enemyProjectiles.push({
                    id: state.nextEntityId++,
                    x: enemy.x,
                    y: enemy.y,
                    vx: Math.cos(a) * spd,
                    vy: Math.sin(a) * spd,
                    radius: isPiercing ? 6.5 : 6,
                    damage: dmgVal,
                    life: 2.8,
                    bouncesLeft: 1,
                    pierceDefense: isPiercing,
                    color: isPiercing ? '#e879f9' : '#fbbf24',
                  });
                }
              }
            } else {
              const leadPx = player.x + (player.velX ?? 0) * 0.35;
              const leadPy = player.y + (player.velY ?? 0) * 0.35;
              const dashAngle = Math.atan2(leadPy - enemy.y, leadPx - enemy.x);
              enemy.dashState = 'windup';
              enemy.dashTimer = isGrand ? 0.52 : 0.58;
              enemy.dashDir = { x: Math.cos(dashAngle), y: Math.sin(dashAngle) };
              enemy.dashSpeed = isGrand ? 460 : 410;
            }
            enemy.bossPatternIndex = (pattern + 1) % 4;
            enemy.attackCooldown = isGrand ? 1.35 : 1.85;
          }
        }
      }
    }

    const isBossDashingOrWindup =
      enemy.isRoomBoss && (enemy.dashState === 'windup' || enemy.dashState === 'dashing');

    if (enemy.awake && distToPlayer > 1e-3 && enemy.speed > 0 && !isBossDashingOrWindup) {
      let steerX = player.x;
      let steerY = player.y;
      if (!hasClearCorridorPath(enemy.x, enemy.y, player.x, player.y, enemy.radius, map)) {
        if (!bfsDist) {
          bfsDist = computeBfsDistances(map.width, map.height, map.tiles, ptx, pty);
        }
        const waypoint = findBfsSteerTarget(enemy, player, map, bfsDist);
        steerX = waypoint.x;
        steerY = waypoint.y;
      }

      const effectiveSpeed =
        orbitItem && distToPlayer <= player.orbitRadius
          ? enemy.speed * ORBIT_SHIELD_INNER_SLOW
          : enemy.speed;

      const sdx = steerX - enemy.x;
      const sdy = steerY - enemy.y;
      const steerDist = Math.hypot(sdx, sdy);
      let moveX = steerDist > 1e-3 ? (sdx / steerDist) * effectiveSpeed : 0;
      let moveY = steerDist > 1e-3 ? (sdy / steerDist) * effectiveSpeed : 0;

      if (enemy.kind === 'tank' && !enemy.isRoomBoss) {
        if (distToPlayer < 125) {
          const rdx = enemy.x - player.x;
          const rdy = enemy.y - player.y;
          const rDist = Math.hypot(rdx, rdy);
          moveX = rDist > 1e-3 ? (rdx / rDist) * effectiveSpeed : 0;
          moveY = rDist > 1e-3 ? (rdy / rDist) * effectiveSpeed : 0;
        } else if (distToPlayer <= 175 && hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map)) {
          moveX = 0;
          moveY = 0;
        }
      }

      for (let j = 0; j < state.enemies.length; j++) {
        if (i === j) continue;
        const other = state.enemies[j];
        const sx = enemy.x - other.x;
        const sy = enemy.y - other.y;
        const sd = Math.hypot(sx, sy);
        const minSep = enemy.radius + other.radius + 2;
        if (sd > 1e-4 && sd < minSep) {
          const push = ((minSep - sd) / minSep) * 120;
          moveX += (sx / sd) * push;
          moveY += (sy / sd) * push;
        }
      }

      const resolved = resolveCircleGridCollision(
        enemy.x + moveX * clampedDt,
        enemy.y + moveY * clampedDt,
        enemy.radius,
        map
      );
      enemy.x = resolved.x;
      enemy.y = resolved.y;
    }

    // Contact damage to player
    if (
      player.invulnTimer <= 0 &&
      Math.hypot(player.x - enemy.x, player.y - enemy.y) <= player.radius + enemy.radius
    ) {
      if (mods.hasAegisParry && player.aegisCooldown <= 0) {
        player.aegisCooldown = mods.aegisCooldown;
        player.invulnTimer = 0.6;
        damageEnemy(state, enemy, mods.aegisDamage);
        state.visualFx.push({
          kind: 'pulse',
          x: player.x,
          y: player.y,
          radius: 70,
          color: '#34d399',
          life: 0.25,
          maxLife: 0.25,
        });
        state.floatingTexts.push({
          x: player.x,
          y: player.y - 20,
          text: 'PARRY!',
          color: '#34d399',
          life: 0.7,
          maxLife: 0.7,
        });
        continue;
      }

      player.hp = Math.max(0, player.hp - enemy.damage);

      // Trigger reactive coil counter immediately on hit if equipped
      const coil = player.equipment.find((e) => e.id === 'reactive_coil');
      if (coil) {
        const coilStats = getReactiveCoilStats(
          coil.level,
          EQUIPMENT_CATALOG.reactive_coil.baseRange,
          mods.rangeMult
        );
        triggerChainLightning(
          state,
          player.x,
          player.y,
          Math.min(MAX_TARGET_RANGE, coilStats.range),
          getEquipmentDamage(coil, 1),
          coilStats.maxTargets
        );
      }

      state.floatingTexts.push({
        x: player.x,
        y: player.y - player.radius - 6,
        text: `-${enemy.damage}`,
        color: '#f87171',
        life: 0.7,
        maxLife: 0.7,
      });

      if (player.hp <= 0) {
        state.status = 'gameover';
        return;
      }
      applyTacticalStepOnHit(state, mods, enemy.x, enemy.y, 0.55);
    }
  }

  if (alertSpawns.length > 0) {
    state.enemies.push(...alertSpawns);
  }

  // 9b. Enemy projectiles hitting player
  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    if (
      player.invulnTimer <= 0 &&
      Math.hypot(player.x - ep.x, player.y - ep.y) <= player.radius + ep.radius
    ) {
      state.enemyProjectiles.splice(i, 1);
      if (mods.hasAegisParry && player.aegisCooldown <= 0) {
        player.aegisCooldown = mods.aegisCooldown;
        player.invulnTimer = 0.6;
        state.floatingTexts.push({
          x: player.x,
          y: player.y - 20,
          text: 'PARRY!',
          color: '#34d399',
          life: 0.7,
          maxLife: 0.7,
        });
      } else {
        player.hp = Math.max(0, player.hp - ep.damage);
        state.floatingTexts.push({
          x: player.x,
          y: player.y - player.radius - 6,
          text: `-${ep.damage}`,
          color: '#f87171',
          life: 0.7,
          maxLife: 0.7,
        });
        if (player.hp <= 0) {
          state.status = 'gameover';
          return;
        }
        applyTacticalStepOnHit(state, mods, ep.x, ep.y, 0.5);
      }
    }
  }

  // 9c. Tank parabolic mortar ground impact zones (overhead, bypasses shield/blade)
  for (let i = state.mortarZones.length - 1; i >= 0; i--) {
    const zone = state.mortarZones[i];
    zone.elapsed += clampedDt;
    if (zone.elapsed >= zone.duration) {
      state.mortarZones.splice(i, 1);
      state.visualFx.push({
        kind: 'pulse',
        x: zone.targetX,
        y: zone.targetY,
        radius: zone.radius,
        color: '#c084fc',
        life: 0.28,
        maxLife: 0.28,
      });
      if (
        player.invulnTimer <= 0 &&
        Math.hypot(player.x - zone.targetX, player.y - zone.targetY) <=
          zone.radius + player.radius * 0.5
      ) {
        if (mods.hasAegisParry && player.aegisCooldown <= 0) {
          player.aegisCooldown = mods.aegisCooldown;
          player.invulnTimer = 0.6;
          state.floatingTexts.push({
            x: player.x,
            y: player.y - 20,
            text: 'PARRY!',
            color: '#34d399',
            life: 0.7,
            maxLife: 0.7,
          });
        } else {
          player.hp = Math.max(0, player.hp - zone.damage);
          state.floatingTexts.push({
            x: player.x,
            y: player.y - player.radius - 6,
            text: `-${zone.damage}`,
            color: '#f87171',
            life: 0.7,
            maxLife: 0.7,
          });
          if (player.hp <= 0) {
            state.status = 'gameover';
            return;
          }
          applyTacticalStepOnHit(state, mods, zone.targetX, zone.targetY, 0.5);
        }
      }
    }
  }

  // 9d. Grand Boss wall-reflecting laser beams (telegraph windup -> active beam hit check)
  if (state.bossLasers && state.bossLasers.length > 0) {
    for (let i = state.bossLasers.length - 1; i >= 0; i--) {
      const laser = state.bossLasers[i];
      laser.elapsed += clampedDt;
      if (laser.elapsed >= laser.windup && !laser.hitPlayer && player.invulnTimer <= 0) {
        let minDist = Infinity;
        for (let p = 0; p < laser.points.length - 1; p++) {
          const a = laser.points[p];
          const b = laser.points[p + 1];
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const abLenSq = abx * abx + aby * aby;
          const t =
            abLenSq > 1e-6
              ? Math.max(0, Math.min(1, ((player.x - a.x) * abx + (player.y - a.y) * aby) / abLenSq))
              : 0;
          const cx = a.x + abx * t;
          const cy = a.y + aby * t;
          minDist = Math.min(minDist, Math.hypot(player.x - cx, player.y - cy));
        }
        if (minDist <= player.radius + laser.width * 0.5) {
          laser.hitPlayer = true;
          if (mods.hasAegisParry && player.aegisCooldown <= 0) {
            player.aegisCooldown = mods.aegisCooldown;
            player.invulnTimer = 0.6;
            state.floatingTexts.push({
              x: player.x,
              y: player.y - 20,
              text: 'PARRY!',
              color: '#34d399',
              life: 0.7,
              maxLife: 0.7,
            });
          } else {
            player.hp = Math.max(0, player.hp - laser.damage);
            state.floatingTexts.push({
              x: player.x,
              y: player.y - player.radius - 6,
              text: `-${laser.damage}`,
              color: '#f43f5e',
              life: 0.7,
              maxLife: 0.7,
            });
            if (player.hp <= 0) {
              state.status = 'gameover';
              return;
            }
            const origin = laser.points[0] ?? { x: player.x, y: player.y };
            applyTacticalStepOnHit(state, mods, origin.x, origin.y, 0.5);
          }
        }
      }
      if (laser.elapsed >= laser.duration) {
        state.bossLasers.splice(i, 1);
      }
    }
  }

  // 10. Pickups (magnet & heal bonus scaled by mob_magnet, EXP by mob_loot; equip drops require direct pickup)
  const magnetRange = 95 * mods.pickupMagnetMult;
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (p.kind !== 'equip' && dist < magnetRange && dist > 1e-3) {
      const pull = 300 * clampedDt;
      p.x += (dx / dist) * Math.min(pull, dist);
      p.y += (dy / dist) * Math.min(pull, dist);
    }

    const pickupRadius = p.kind === 'equip' ? player.radius + 14 : player.radius + 12;
    if (Math.hypot(player.x - p.x, player.y - p.y) <= pickupRadius) {
      state.pickups.splice(i, 1);
      if (p.kind === 'equip' && p.equipmentId) {
        acquireEquipment(state, createEquippedItem(p.equipmentId, p.itemLevel ?? 1));
        if (state.status !== 'playing') return;
      } else if (p.kind === 'heal') {
        const before = player.hp;
        const healAmount = Math.round(p.value * mods.healBonusMult);
        player.hp = Math.min(player.maxHp, player.hp + healAmount);
        const healed = Math.round(player.hp - before);
        state.floatingTexts.push({
          x: player.x,
          y: player.y - 18,
          text: healed > 0 ? `+${healed} HP` : 'MAX HP',
          color: '#34d399',
          life: 0.7,
          maxLife: 0.7,
        });
      } else {
        const gainedExp = Math.round(p.value * mods.expMult);
        grantExpAndCheckLevelUp(state, gainedExp);
      }
    }
  }

  // 11. Floating texts, Visual FX, and Toast Notifications lifetimes
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y -= 26 * clampedDt;
    ft.life -= clampedDt;
    if (ft.life <= 0) state.floatingTexts.splice(i, 1);
  }

  for (let i = state.visualFx.length - 1; i >= 0; i--) {
    const fx = state.visualFx[i];
    fx.life -= clampedDt;
    if (fx.life <= 0) state.visualFx.splice(i, 1);
  }

  for (let i = state.notifications.length - 1; i >= 0; i--) {
    const n = state.notifications[i];
    n.life -= clampedDt;
    if (n.life <= 0) state.notifications.splice(i, 1);
  }
}
