import { generateDungeon, tileCenterWorld } from '../core/dungeon';
import { emitSound, pushNotification } from './effects';
import { MAX_EQUIP_SLOTS } from './equipment';
import { getLevelUpSkillPoints, grantExpAndCheckLevelUp } from './leveling';
import {
  acquireEquipment,
  type EquipChoice,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getSeekerDronePositions,
  pickChestDrop,
  resolveEquipChoice,
  rollDropEquipmentLevel,
} from './loadout';
import {
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillLevel,
  getSkillMaxLevel,
  getSkillNode,
  getSkillUpgradeCost,
  type SkillNodeId,
} from './skillTree';
import {
  createEnemyByKind,
  getRunnerPackSize,
  pickEnemyKindForFloor,
  populateFloor,
  SHOOTER_AGGRO_RANGE,
} from './spawn';
import { stepPlayerCombat } from './steps/combat';
import {
  getActiveBossLaserWidth,
  getNormalEnemyShotStats,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  stepEnemies,
} from './steps/enemies';
import { stepPickupsAndFx } from './steps/pickups';
import { revealAroundPlayer, stepPlayerAndInteractables } from './steps/player';
import { RICOCHET_DISC_LOOP_RADIUS, stepProjectiles } from './steps/projectiles';
import type { GameState, GameStatus, Vec2 } from './types';
import { CORRIDOR_VISION_RADIUS, isEnemyVisibleToPlayer, isPointInPlayerVision } from './vision';

export {
  acquireEquipment,
  CORRIDOR_VISION_RADIUS,
  createEnemyByKind,
  type EquipChoice,
  getActiveBossLaserWidth,
  getLevelUpSkillPoints,
  getNormalEnemyShotStats,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getRunnerPackSize,
  getSeekerDronePositions,
  isEnemyVisibleToPlayer,
  isPointInPlayerVision,
  pickEnemyKindForFloor,
  pushNotification,
  RICOCHET_DISC_LOOP_RADIUS,
  resolveEquipChoice,
  rollDropEquipmentLevel,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  SHOOTER_AGGRO_RANGE,
};

export const INITIAL_RESPAWN_DELAY = 24;

export interface CreateGameOptions {
  seed?: number;
  startFloor?: number;
  initialStatus?: GameStatus;
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
      droneAngle: 0,
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
