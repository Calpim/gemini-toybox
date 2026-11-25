import { hasLineOfSight } from '../core/collision';
import {
  TILE_SIZE,
  findRoomAtTile,
  generateDungeon,
  isTileInRoom,
  tileCenterWorld,
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
  clampEquipmentLevel,
  getOrbitBitCount,
  getOrbitShieldRadius,
  getScrapExpandCost,
  getSeekerDroneCount,
  type EquipmentId,
  type EquippedItem,
} from './equipment';
import {
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillLevel,
  getSkillMaxLevel,
  getSkillNode,
  getSkillUpgradeCost,
  type SkillNodeId,
} from './skillTree';
import { emitSound, pushNotification, spawnParticles } from './effects';
import {
  SHOOTER_AGGRO_RANGE,
  createEnemyByKind,
  getRunnerPackSize,
  pickEnemyKindForFloor,
  populateFloor,
} from './spawn';
import { stepPlayerCombat } from './steps/combat';
import {
  type NormalEnemyShotStats,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_ALERT_SPEED_MULT,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_MAX_ALERT_SPEED,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  getActiveBossLaserWidth,
  getNormalEnemyShotStats,
  stepEnemies,
} from './steps/enemies';
import { stepPickupsAndFx } from './steps/pickups';
import { revealAroundPlayer, stepPlayerAndInteractables } from './steps/player';
import { RICOCHET_DISC_LOOP_RADIUS, stepProjectiles } from './steps/projectiles';
import type { GameState, GameStatus, MainWeaponId, PlayerState, Vec2 } from './types';

export {
  type NormalEnemyShotStats,
  RICOCHET_DISC_LOOP_RADIUS,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_ALERT_SPEED_MULT,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_MAX_ALERT_SPEED,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  SHOOTER_AGGRO_RANGE,
  createEnemyByKind,
  getActiveBossLaserWidth,
  getNormalEnemyShotStats,
  getRunnerPackSize,
  pickEnemyKindForFloor,
  pushNotification,
};

export const CORRIDOR_VISION_RADIUS = 210;
export const INITIAL_RESPAWN_DELAY = 24;

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
  corridorRadius = CORRIDOR_VISION_RADIUS,
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
      skillPoints: 1,
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
    particles: [],
    soundEvents: [],
    shakeTimer: 0,
    shakeIntensity: 0,
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
      elapsedPlayTime: 0,
    },
  };
}

export function formatPlayTime(seconds: number): string {
  const safeSec = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) + 1e-6));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
    state.player.level,
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
  state.particles = [];
  state.shakeTimer = 0;
  state.shakeIntensity = 0;
  state.notifications = [];
  state.elapsedFloorTime = 0;
  state.respawnTimer = INITIAL_RESPAWN_DELAY;
  state.stairsNoticeCooldown = 0;
  state.fountainUsed = false;
  state.nextEntityId = populated.nextId;
  state.floorBannerTimer = 2.2;
  emitSound(state, 'floor_clear');

  if (state.floor === 11 && state.stats.clearTime10F === undefined) {
    state.stats.clearTime10F = state.stats.elapsedPlayTime ?? 0;
    pushNotification(state, 'levelup', `10F CLEAR! タイム ${formatPlayTime(state.stats.clearTime10F)}`, '#fde047', 4.5);
  }
}

export function upgradeSkillNode(state: GameState, nodeId: SkillNodeId): boolean {
  if (!canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, nodeId)) {
    return false;
  }
  const node = getSkillNode(nodeId);
  const currLv = getSkillLevel(state.player.skillLevels, nodeId);
  const cost = getSkillUpgradeCost(currLv, nodeId);
  const nextLv = currLv + 1;
  state.player.skillPoints -= cost;
  state.player.spentSkillPoints += cost;
  state.player.skillLevels[nodeId] = nextLv;
  if (nodeId === 'mob_dash') {
    const maxCharges = getSkillMaxLevel('mob_dash');
    const currentCharges = state.player.tacticalStepCharges ?? currLv;
    state.player.tacticalStepCharges = Math.min(maxCharges, Math.min(nextLv, currentCharges + 1));
  }
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

export function getLevelUpSkillPoints(newLevel: number): number {
  return newLevel <= 10 ? 1 : 2;
}

function grantExpAndCheckLevelUp(state: GameState, gainedExp: number): void {
  const { player } = state;
  player.exp += gainedExp;
  state.stats.totalExp += gainedExp;
  while (player.exp >= player.expToNext) {
    player.exp -= player.expToNext;
    player.level += 1;
    const gainedSp = getLevelUpSkillPoints(player.level);
    player.skillPoints += gainedSp;
    player.expToNext = Math.round(player.expToNext * 1.22);
    emitSound(state, 'level_up');
    spawnParticles(state, player.x, player.y, '#38bdf8', 14, 55, 165, 3.0, 0.45);
    state.floatingTexts.push({
      x: player.x,
      y: player.y - 24,
      text: `LEVEL ${player.level}! (+${gainedSp} SP)`,
      color: '#38bdf8',
      life: 1.0,
      maxLife: 1.0,
    });
    pushNotification(state, 'levelup', `🎉 LEVEL UP! Lv${player.level} (+${gainedSp} SP)`, '#38bdf8', 2.6);
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
    if (normalizedItem.level >= existing.level + 2) {
      state.pendingEquipDrop = { item: normalizedItem };
      state.status = 'equip_choice';
      return;
    }
    existing.level = clampEquipmentLevel(existing.level + 1);
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

  if (player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP && equipment.every((eq) => eq.level >= MAX_EQUIPMENT_LEVEL)) {
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

export function resolveEquipChoice(state: GameState, choice: EquipChoice): boolean {
  if (state.status !== 'equip_choice' || !state.pendingEquipDrop) {
    return false;
  }

  const dropped = state.pendingEquipDrop.item;
  if (choice.type === 'replace') {
    if (choice.slotIndex < 0 || choice.slotIndex >= state.player.equipment.length) {
      return false;
    }
    if (state.player.equipment.some((eq, idx) => idx !== choice.slotIndex && eq.id === dropped.id)) {
      return false;
    }
    state.player.equipment[choice.slotIndex] = {
      ...dropped,
      level: clampEquipmentLevel(dropped.level),
      cooldown: 0,
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
  dropQualityTier = 0,
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

export interface PlayerBaseAttackStats {
  weaponId: MainWeaponId;
  damage: number;
  cooldown: number;
  range: number;
  shotCount: number;
  homingShots: number;
  homingDamage: number;
  speed: number;
  pierce: boolean;
  armBaseLevel: number;
  armOverclockLevel: number;
  spentSp: number;
}

export function getPlayerBaseAttackStats(player: PlayerState): PlayerBaseAttackStats {
  const mods = computeSkillModifiers(player.skillLevels);
  const weaponId: MainWeaponId = player.mainWeaponId ?? 'core_shot';
  const baseDamage = 14;
  const baseCooldown = 0.58;
  const baseSpeed = 460;
  const damage = Math.round(baseDamage * mods.mainDamageMult * mods.mainParallelDamageMult);
  const cooldown = Math.max(0.2, baseCooldown * mods.mainCooldownMult);
  const range = Math.min(MAX_TARGET_RANGE, Math.round(MAX_TARGET_RANGE * mods.rangeMult)) + mods.mainRangeBonus;
  const baseShots = 1 + mods.mainExtraShots;
  const shotCount =
    mods.armOverclockLevel >= 2
      ? Math.max(5, baseShots)
      : mods.armOverclockLevel === 1
        ? Math.max(3, baseShots)
        : baseShots;
  const homingShots = mods.mainHomingShots;
  const homingDamage = homingShots > 0 ? Math.max(1, Math.round(damage * 0.35)) : 0;
  const speed = baseSpeed + mods.mainSpeedBonus;
  return {
    weaponId,
    damage,
    cooldown,
    range,
    shotCount,
    homingShots,
    homingDamage,
    speed,
    pierce: mods.piercingMainShot,
    armBaseLevel: mods.armBaseLevel,
    armOverclockLevel: mods.armOverclockLevel,
    spentSp: player.spentSkillPoints,
  };
}

export const getMainWeaponStats = getPlayerBaseAttackStats;

/**
 * Advances the simulation by dt seconds.
 * Pure domain update: decoupled from DOM/Canvas for deterministic Vitest verification.
 */
export function stepGame(state: GameState, rawInput: Vec2, dt: number): void {
  if (state.status !== 'playing' || dt <= 0) return;

  const clampedDt = Math.min(dt, 0.05);
  state.stats.elapsedPlayTime = (state.stats.elapsedPlayTime ?? 0) + clampedDt;
  const { player } = state;
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
  if (mods.hasTacticalStep) {
    const charges = player.tacticalStepCharges ?? mods.tacticalMaxCharges;
    if (charges < mods.tacticalMaxCharges) {
      if (player.tacticalStepCooldown <= 0) {
        player.tacticalStepCooldown = mods.tacticalStepCooldown;
      }
      player.tacticalStepCooldown -= clampedDt;
      while (player.tacticalStepCooldown <= 0 && (player.tacticalStepCharges ?? charges) < mods.tacticalMaxCharges) {
        const updated = (player.tacticalStepCharges ?? charges) + 1;
        player.tacticalStepCharges = updated;
        if (updated < mods.tacticalMaxCharges) {
          player.tacticalStepCooldown += mods.tacticalStepCooldown;
        } else {
          player.tacticalStepCooldown = 0;
        }
      }
    } else {
      player.tacticalStepCooldown = 0;
    }
  } else {
    player.tacticalStepCooldown = 0;
  }
  if ((player.tacticalSpeedTimer ?? 0) > 0) {
    player.tacticalSpeedTimer = Math.max(0, (player.tacticalSpeedTimer ?? 0) - clampedDt);
    if (player.tacticalSpeedTimer <= 0) {
      player.tacticalSpeedBonus = 0;
    }
  }
  if ((state.stairsNoticeCooldown ?? 0) > 0) {
    state.stairsNoticeCooldown = Math.max(0, (state.stairsNoticeCooldown ?? 0) - clampedDt);
  }

  // 1-3. Player movement, Fountain, Stairs, and Chests
  if (
    stepPlayerAndInteractables(state, rawInput, clampedDt, {
      getStairsLockCount,
      advanceToNextFloor,
      pickChestDrop,
      acquireEquipment,
    })
  ) {
    return;
  }

  // 4-5. Repulsor Pulse, Main Weapon, and Sub-equipment
  const orbitItem = stepPlayerCombat(state, mods, clampedDt, {
    getPlayerBaseAttackStats,
    getSeekerDronePositions,
  });

  // 7-8. Orbit Shield Bits, Enemy Projectiles, and Player Projectiles
  const bits = stepProjectiles(state, clampedDt, {
    getOrbitBitPositions,
  });

  // 9. Update enemies, respawn, enemy projectiles on player, mortar zones, and boss lasers
  if (
    stepEnemies(state, mods, orbitItem, bits, clampedDt, {
      getStairsLockCount,
      rollDropEquipmentLevel,
    })
  ) {
    return;
  }

  // 10-11. Pickups, Visual FX, Particles, Screen Shake, and Toast Notifications
  stepPickupsAndFx(state, mods, clampedDt, {
    acquireEquipment,
    grantExpAndCheckLevelUp,
  });
}
