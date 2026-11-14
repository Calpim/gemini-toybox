import { hasLineOfSight, resolveCircleGridCollision } from '../core/collision';
import {
  TILE_SIZE,
  computeBfsDistances,
  generateDungeon,
  isWallAtWorld,
  isWallTile,
  tileCenterWorld,
  type DungeonMap,
} from '../core/dungeon';
import { createRng } from '../core/rng';
import {
  ALL_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  MAX_EQUIP_SLOTS,
  MAX_TARGET_RANGE,
  createEquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getOrbitBitCount,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getSeekerDroneCount,
  type EquipmentId,
  type EquippedItem,
} from './equipment';
import {
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillLevel,
  getSkillNode,
  type SkillNodeId,
} from './skillTree';
import type { ChestState, EnemyState, GameState, PickupState, PlayerState, Vec2 } from './types';

export interface CreateGameOptions {
  seed?: number;
  startFloor?: number;
}

function revealAroundPlayer(map: DungeonMap, explored: Uint8Array, px: number, py: number, radiusTiles = 7): void {
  const ptx = Math.floor(px / TILE_SIZE);
  const pty = Math.floor(py / TILE_SIZE);
  const r2 = radiusTiles * radiusTiles;
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

function populateFloor(
  map: DungeonMap,
  floor: number,
  seed: number,
  startId: number,
  lootBonusRate = 0
): { enemies: EnemyState[]; pickups: PickupState[]; chests: ChestState[]; nextId: number } {
  const rng = createRng(seed ^ (floor * 0x517cc1b7));
  const enemies: EnemyState[] = [];
  const pickups: PickupState[] = [];
  const chests: ChestState[] = [];
  let nextId = startId;

  const chestCandidates: number[] = [];

  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    const isStairsRoom = room.cx === map.stairsTile.tx && room.cy === map.stairsTile.ty;
    const count = rng.int(2, 3 + Math.min(3, Math.floor(floor / 2))) + (isStairsRoom ? 1 : 0);

    for (let k = 0; k < count; k++) {
      const tx = rng.int(room.x + 1, room.x + room.w - 2);
      const ty = rng.int(room.y + 1, room.y + room.h - 2);
      const pos = tileCenterWorld(tx, ty);
      const hp = 26 + (floor - 1) * 9;
      enemies.push({
        id: nextId++,
        x: pos.x,
        y: pos.y,
        radius: 13,
        speed: 78 + Math.min(48, (floor - 1) * 6),
        hp,
        maxHp: hp,
        damage: 10 + (floor - 1) * 2,
        aggroRange: MAX_TARGET_RANGE,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      });
    }

    if (!isStairsRoom) {
      chestCandidates.push(i);
    }

    if (rng.next() < 0.3 + lootBonusRate * 0.4) {
      const pos = tileCenterWorld(room.cx, room.cy);
      pickups.push({
        id: nextId++,
        kind: 'heal',
        x: pos.x + (rng.next() - 0.5) * 24,
        y: pos.y + (rng.next() - 0.5) * 24,
        value: 25,
      });
    }
  }

  // Place 1-2 treasure chests per floor (extra chest chance with mob_loot)
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
  }

  return { enemies, pickups, chests, nextId };
}

export function createGameState(options: CreateGameOptions = {}): GameState {
  const seed = options.seed ?? Date.now();
  const floor = options.startFloor ?? 1;
  const map = generateDungeon({ floor, seed });
  const startPos = tileCenterWorld(map.startTile.tx, map.startTile.ty);
  const explored = new Uint8Array(map.width * map.height);
  revealAroundPlayer(map, explored, startPos.x, startPos.y);

  const populated = populateFloor(map, floor, seed, 1, 0);

  return {
    seed,
    floor,
    status: 'playing',
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
      equipment: [],
      invulnTimer: 0,
      facingAngle: 0,
      orbitAngle: 0,
      orbitRadius: 64,
      baseAttackCooldown: 0,
      repulsorCooldown: 0,
      aegisCooldown: 0,
      tacticalStepCooldown: 0,
    },
    enemies: populated.enemies,
    projectiles: [],
    enemyProjectiles: [],
    chests: populated.chests,
    pendingEquipDrop: null,
    pickups: populated.pickups,
    floatingTexts: [],
    visualFx: [],
    nextEntityId: populated.nextId,
    floorBannerTimer: 2.2,
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
  const populated = populateFloor(state.map, state.floor, state.seed, state.nextEntityId, mods.lootBonusRate);
  state.enemies = populated.enemies;
  state.pickups = populated.pickups;
  state.chests = populated.chests;
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.floatingTexts = [];
  state.visualFx = [];
  state.nextEntityId = populated.nextId;
  state.floorBannerTimer = 2.2;
}

export function upgradeSkillNode(state: GameState, nodeId: SkillNodeId): boolean {
  if (!canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, nodeId)) {
    return false;
  }
  const node = getSkillNode(nodeId);
  const nextLv = getSkillLevel(state.player.skillLevels, nodeId) + 1;
  state.player.skillPoints -= node.cost;
  state.player.spentSkillPoints += node.cost;
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

export function acquireEquipment(state: GameState, droppedItem: EquippedItem): void {
  const { equipment } = state.player;
  const existing = equipment.find((eq) => eq.id === droppedItem.id);
  if (existing) {
    existing.level = Math.max(existing.level + 1, droppedItem.level);
    const def = EQUIPMENT_CATALOG[existing.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `LV UP! ${def.name} Lv${existing.level}`,
      color: def.color,
      life: 1.25,
      maxLife: 1.25,
    });
    return;
  }

  if (equipment.length < MAX_EQUIP_SLOTS) {
    equipment.push(droppedItem);
    const def = EQUIPMENT_CATALOG[droppedItem.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `+GEAR: ${def.name} Lv${droppedItem.level}`,
      color: def.color,
      life: 1.2,
      maxLife: 1.2,
    });
    return;
  }

  state.pendingEquipDrop = { item: droppedItem };
  state.status = 'equip_choice';
}

export function resolveEquipChoice(
  state: GameState,
  choice: { type: 'replace'; slotIndex: number } | { type: 'scrap' }
): boolean {
  if (state.status !== 'equip_choice' || !state.pendingEquipDrop) {
    return false;
  }

  const dropped = state.pendingEquipDrop.item;
  if (choice.type === 'replace') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    state.player.equipment[choice.slotIndex] = dropped;
    const def = EQUIPMENT_CATALOG[dropped.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `EQUIPPED: ${def.name} Lv${dropped.level}`,
      color: def.color,
      life: 1.1,
      maxLife: 1.1,
    });
  } else {
    for (const eq of state.player.equipment) {
      eq.level += 1;
    }
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: 'ALL GEAR LV+1!',
      color: '#fbbf24',
      life: 1.2,
      maxLife: 1.2,
    });
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
  const count = getOrbitBitCount(orbitItem.level, mods.extraBits);

  const positions: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = player.orbitAngle + (i * Math.PI * 2) / count;
    positions.push({
      x: player.x + Math.cos(a) * player.orbitRadius,
      y: player.y + Math.sin(a) * player.orbitRadius,
    });
  }
  return positions;
}

export function getSeekerDronePositions(state: GameState): Vec2[] {
  const { player } = state;
  const droneItem = player.equipment.find((e) => e.id === 'seeker_drone');
  if (!droneItem) return [];

  const mods = computeSkillModifiers(player.skillLevels);
  const count = getSeekerDroneCount(droneItem.level, mods.extraBits);
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
  rngNext: () => number
): number {
  if (equipment.length === 0) return 1;
  let minLevel = Infinity;
  for (const item of equipment) {
    if (item.level < minLevel) minLevel = item.level;
  }
  const r = rngNext();
  if (r < 0.2) return Math.max(1, minLevel - 1);
  if (r < 0.7) return minLevel;
  if (r < 0.92) return minLevel + 1;
  return minLevel + 2;
}

function pickChestDrop(state: GameState, chestId: number): { id: EquipmentId; level: number } {
  const rng = createRng((state.seed ^ (state.floor * 4999) ^ (chestId * 3571)) >>> 0);
  const id = rng.pick(ALL_EQUIPMENT_IDS);
  const level = rollDropEquipmentLevel(state.player.equipment, () => rng.next());
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
  damage: number;
  cooldown: number;
  range: number;
  shotCount: number;
  speed: number;
  spentSp: number;
}

export function getPlayerBaseAttackStats(player: PlayerState): PlayerBaseAttackStats {
  const mods = computeSkillModifiers(player.skillLevels);
  const spentSp = player.spentSkillPoints;
  const damage = Math.round((12 + spentSp * 1.8) * mods.damageMult);
  const cooldown = Math.max(
    0.24,
    (0.62 - Math.min(0.24, spentSp * 0.015)) * mods.cooldownMult
  );
  const range = Math.min(
    MAX_TARGET_RANGE,
    Math.round((140 + spentSp * 3) * mods.rangeMult)
  );
  const shotCount = Math.min(
    4,
    1 + (spentSp >= 3 ? 1 : 0) + (spentSp >= 7 ? 1 : 0) + (spentSp >= 12 ? 1 : 0)
  );
  const speed = 460 + Math.min(180, spentSp * 8);
  return { damage, cooldown, range, shotCount, speed, spentSp };
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

  // 1. Player movement & smooth wall collision (APP-MAP-02)
  const moveSpeed = player.baseSpeed;
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

  // 2. Stairs check -> next floor (APP-MAP-01)
  const stairsPos = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
  if (Math.hypot(player.x - stairsPos.x, player.y - stairsPos.y) <= TILE_SIZE * 0.52) {
    advanceToNextFloor(state);
    return;
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
        damageEnemy(state, e, mods.repulsorDamage * mods.damageMult);
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
      player.repulsorCooldown = mods.repulsorCooldown * mods.cooldownMult;
    }
  }

  // 4.5. Player intrinsic Core Shot auto-attack (scales with player.level & skillRank; APP-CMB-01, APP-CMB-06)
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
          radius: 5,
          damage: baseStats.damage,
          life: 0.75,
          pierce: false,
          hitEnemyIds: [],
          color: '#34d399',
        });
      }
      player.baseAttackCooldown = baseStats.cooldown;
    }
  }

  // 5. Equipment parallel execution & per-level evolutions (APP-CMB-01, APP-CMB-02, APP-CMB-05)
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  const orbitAngularSpeed = 2.4 + (orbitItem ? (orbitItem.level - 1) * 0.18 : 0);
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

    const rawDmg = getEquipmentDamage(item, mods.damageMult);
    const dmg =
      item.id === 'seeker_drone' ? rawDmg * mods.bitDroneDamageMult : rawDmg;
    const cdMult = mods.cooldownMult * getEquipmentCooldownMultiplier(item.level);

    if (item.id === 'pulse_blade') {
      const blade = getPulseBladeStats(item.level, def.baseRange, mods.rangeMult);
      const cappedRange = Math.min(MAX_TARGET_RANGE, blade.range);
      const lead = findNearestVisibleEnemy(player.x, player.y, cappedRange, state);
      if (lead) {
        const slashAngle = Math.atan2(lead.y - player.y, lead.x - player.x);
        const targets = state.enemies.filter((e) => {
          if (Math.hypot(e.x - player.x, e.y - player.y) > cappedRange) return false;
          if (!hasLineOfSight(player.x, player.y, e.x, e.y, map)) return false;
          if (blade.fullCircle) return true;
          const ea = Math.atan2(e.y - player.y, e.x - player.x);
          let diff = Math.abs(ea - slashAngle);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          return diff <= blade.halfArcRad;
        });
        for (const t of targets) {
          damageEnemy(state, t, dmg);
        }
        state.visualFx.push({
          kind: 'slash',
          x: player.x,
          y: player.y,
          radius: cappedRange,
          angle: slashAngle,
          halfArcRad: blade.halfArcRad,
          fullCircle: blade.fullCircle,
          color: def.color,
          life: 0.22,
          maxLife: 0.22,
        });
        item.cooldown = def.baseCooldown * cdMult;
      }
    } else if (item.id === 'seeker_drone') {
      const range = Math.min(MAX_TARGET_RANGE, def.baseRange * mods.rangeMult);
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const dronesToFire = Math.max(1, seekerDrones.length);
        for (let dIdx = 0; dIdx < dronesToFire; dIdx++) {
          const origin = seekerDrones[(droneCursor + dIdx) % Math.max(1, seekerDrones.length)] ?? player;
          const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
          const speed =
            (mods.piercingDrones ? 480 : 430) +
            mods.droneSpeedBonus +
            (item.level - 1) * 18;
          state.projectiles.push({
            id: state.nextEntityId++,
            kind: 'drone',
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: mods.piercingDrones ? 6 : 5,
            damage: dmg,
            life: 0.85,
            pierce: mods.piercingDrones,
            hitEnemyIds: [],
            color: mods.piercingDrones ? '#22d3ee' : '#7dd3fc',
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
      const range = Math.min(MAX_TARGET_RANGE, def.baseRange * mods.rangeMult);
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const discStats = getRicochetDiscStats(item.level);
        const baseAngle = Math.atan2(target.y - player.y, target.x - player.x);
        for (let d = 0; d < discStats.count; d++) {
          const spread = discStats.count > 1 ? (d === 0 ? -0.18 : 0.18) : 0;
          const angle = baseAngle + spread;
          state.projectiles.push({
            id: state.nextEntityId++,
            kind: 'disc',
            x: player.x,
            y: player.y,
            vx: Math.cos(angle) * discStats.speed,
            vy: Math.sin(angle) * discStats.speed,
            radius: 7,
            damage: dmg,
            life: 1.15,
            pierce: false,
            bouncesLeft: discStats.maxBounces,
            speed: discStats.speed,
            spinAngle: 0,
            hitEnemyIds: [],
            color: def.color,
          });
        }
        item.cooldown = def.baseCooldown * cdMult;
      }
    }
  }

  // 7. Orbit Shield Bits & projectile destruction
  const bits = getOrbitBitPositions(state);
  const orbitDmg = orbitItem
    ? getEquipmentDamage(orbitItem, mods.damageMult) * mods.bitDroneDamageMult
    : 0;

  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    ep.x += ep.vx * clampedDt;
    ep.y += ep.vy * clampedDt;
    ep.life -= clampedDt;
    if (ep.life <= 0 || isWallAtWorld(map, ep.x, ep.y)) {
      state.enemyProjectiles.splice(i, 1);
      continue;
    }
    const blockedByBit = bits.some((bit) => Math.hypot(bit.x - ep.x, bit.y - ep.y) <= ep.radius + 10);
    if (blockedByBit) {
      state.enemyProjectiles.splice(i, 1);
    }
  }

  // 8. Player projectiles & wall/enemy collision + ricochet bounce (APP-CMB-03, APP-CMB-05)
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.x += proj.vx * clampedDt;
    proj.y += proj.vy * clampedDt;
    proj.life -= clampedDt;
    if (proj.kind === 'disc') {
      proj.spinAngle = (proj.spinAngle ?? 0) + 16 * clampedDt;
    }

    if (proj.life <= 0 || isWallAtWorld(map, proj.x, proj.y)) {
      state.projectiles.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (const enemy of state.enemies) {
      if (proj.hitEnemyIds.includes(enemy.id)) continue;
      if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
        damageEnemy(state, enemy, proj.damage);
        proj.hitEnemyIds.push(enemy.id);

        if (proj.kind === 'disc' && (proj.bouncesLeft ?? 0) > 0) {
          const nextTarget = findNearestVisibleEnemy(enemy.x, enemy.y, 150, state, proj.hitEnemyIds);
          if (nextTarget) {
            const spd = proj.speed ?? 390;
            const bounceAngle = Math.atan2(nextTarget.y - proj.y, nextTarget.x - proj.x);
            proj.vx = Math.cos(bounceAngle) * spd;
            proj.vy = Math.sin(bounceAngle) * spd;
            proj.bouncesLeft = (proj.bouncesLeft ?? 0) - 1;
            proj.life = Math.max(proj.life, 0.75);
            break;
          }
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

  // 9. Update enemies (with BFS corridor pathfinding), orbit bit contact, and player damage / Aegis / Tactical Step
  const rng = createRng((state.seed ^ (state.stats.kills * 7919) ^ (state.floor * 131)) >>> 0);
  let bfsDist: Int32Array | null = null;
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - clampedDt);
    if (enemy.bitHitCooldown > 0) enemy.bitHitCooldown = Math.max(0, enemy.bitHitCooldown - clampedDt);

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
      state.pickups.push({
        id: state.nextEntityId++,
        kind: 'exp',
        x: enemy.x,
        y: enemy.y,
        value: 10,
      });
      if (rng.next() < 0.22 + mods.lootBonusRate * 0.4) {
        state.pickups.push({
          id: state.nextEntityId++,
          kind: 'heal',
          x: enemy.x + 10,
          y: enemy.y + 6,
          value: 25,
        });
      }
      // Low-probability enemy equipment drop (1.5% base) scaled to player's lowest equipment level (APP-GRW-07)
      const equipDropChance = 0.015 + mods.equipDropBonus;
      if (rng.next() < equipDropChance) {
        const eqId = rng.pick(ALL_EQUIPMENT_IDS);
        const itemLevel = rollDropEquipmentLevel(player.equipment, () => rng.next());
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
      state.enemies.splice(i, 1);
      continue;
    }

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distToPlayer = Math.hypot(dx, dy);

    if (!enemy.awake) {
      if (
        distToPlayer <= 140 ||
        (distToPlayer <= enemy.aggroRange && hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map))
      ) {
        enemy.awake = true;
      }
    }

    if (enemy.awake && distToPlayer > 1e-3) {
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

      const sdx = steerX - enemy.x;
      const sdy = steerY - enemy.y;
      const steerDist = Math.hypot(sdx, sdy);
      let moveX = steerDist > 1e-3 ? (sdx / steerDist) * enemy.speed : 0;
      let moveY = steerDist > 1e-3 ? (sdy / steerDist) * enemy.speed : 0;

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
        damageEnemy(state, enemy, mods.aegisDamage * mods.damageMult);
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
      if (mods.hasTacticalStep && player.tacticalStepCooldown <= 0) {
        player.tacticalStepCooldown = mods.tacticalStepCooldown;
        player.invulnTimer = mods.tacticalInvulnDuration;
        const awayLen = Math.max(1, Math.hypot(player.x - enemy.x, player.y - enemy.y));
        const stepped = resolveCircleGridCollision(
          player.x + ((player.x - enemy.x) / awayLen) * mods.tacticalStepDist,
          player.y + ((player.y - enemy.y) / awayLen) * mods.tacticalStepDist,
          player.radius,
          map
        );
        player.x = stepped.x;
        player.y = stepped.y;
      } else {
        player.invulnTimer = 0.55;
      }

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
          getEquipmentDamage(coil, mods.damageMult),
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
        }
      }
    }
  }

  // 11. Floating texts & Visual FX lifetimes
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
}
