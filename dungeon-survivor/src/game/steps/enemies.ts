import { hasLineOfSight, resolveCircleGridCollision } from '../../core/collision';
import {
  type DungeonMap,
  TILE_SIZE,
  computeBfsDistances,
  findRoomAtTile,
  isTileInRoom,
  isWallAtWorld,
  isWallTile,
  tileCenterWorld,
  tileIndex,
} from '../../core/dungeon';
import { createRng } from '../../core/rng';
import { emitSound, pushNotification, spawnParticles, triggerShake } from '../effects';
import {
  ALL_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  type EquippedItem,
  MAX_TARGET_RANGE,
  ORBIT_SHIELD_INNER_SLOW,
  clampEquipmentLevel,
  getEquipmentDamage,
  getReactiveCoilStats,
} from '../equipment';
import { BASE_HIT_INVULN_DURATION, type ComputedSkillModifiers, TACTICAL_SPEED_BOOST_DURATION } from '../skillTree';
import { createEnemyByKind, getRunnerPackSize, pickEnemyKindForFloor } from '../spawn';
import type { BossLaserState, EnemyState, GameState, PlayerState, Vec2 } from '../types';
import { damageEnemy, triggerChainLightning } from './combatHelpers';

export const SCOUT_KEEP_DIST = 155;
export const SCOUT_CHASE_DIST = 185;
export const SCOUT_ALERT_COOLDOWN = 5.0;
export const SCOUT_ALERT_SPEED_MULT = 1.45;
export const SCOUT_MAX_ALERT_SPEED = 165;
export const SCOUT_SUMMON_CAP_PER_SCOUT = 3;
export const SCOUT_SUMMON_MAX_PLAYER_DIST = 420;

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

/**
 * Computes the active beam width of a Grand Boss laser as it expands from thin to full width.
 * Returns 0 during windup telegraph.
 */
export function getActiveBossLaserWidth(laser: BossLaserState): number {
  if (laser.elapsed < laser.windup) return 0;
  const activeElapsed = laser.elapsed - laser.windup;
  const growSpan = Math.min(0.18, Math.max(0.01, (laser.duration - laser.windup) * 0.5));
  const t = Math.max(0, Math.min(1, activeElapsed / growSpan));
  const ease = 1 - (1 - t) * (1 - t);
  return laser.width * (0.28 + 0.72 * ease);
}

function hasClearCorridorPath(
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

function findBfsSteerTarget(enemy: EnemyState, player: PlayerState, map: DungeonMap, bfsDist: Int32Array): Vec2 {
  const etx = Math.floor(enemy.x / TILE_SIZE);
  const ety = Math.floor(enemy.y / TILE_SIZE);
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);

  if (etx === ptx && ety === pty) {
    return { x: player.x, y: player.y };
  }

  const currIdx = ety * map.width + etx;
  const currDist = etx >= 0 && ety >= 0 && etx < map.width && ety < map.height ? bfsDist[currIdx] : -1;

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

function findScoutFleeTarget(enemy: EnemyState, player: PlayerState, map: DungeonMap, bfsDist: Int32Array): Vec2 {
  const etx = Math.floor(enemy.x / TILE_SIZE);
  const ety = Math.floor(enemy.y / TILE_SIZE);
  const currIdx = ety * map.width + etx;
  const currBfs = etx >= 0 && ety >= 0 && etx < map.width && ety < map.height ? bfsDist[currIdx] : 0;

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
      const exitBfs = bfsDist[c.ty * map.width + c.tx];
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
    const nd = bfsDist[ny * map.width + nx];
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

/**
 * Attempts to consume a mob_dash charge to completely evade an incoming hit (no damage, extended invuln, speed boost).
 * Can evade all attack types including pierceDefense, mortars, boss lasers, and boss dashes.
 */
function tryTacticalStepEvade(state: GameState, mods: ComputedSkillModifiers): boolean {
  const { player } = state;
  const charges = player.tacticalStepCharges ?? mods.tacticalMaxCharges;
  if (!mods.hasTacticalStep || charges <= 0) return false;
  player.tacticalStepCharges = charges - 1;
  if (player.tacticalStepCooldown <= 0) {
    player.tacticalStepCooldown = mods.tacticalStepCooldown;
  }
  player.invulnTimer = mods.tacticalInvulnDuration;
  player.tacticalSpeedTimer = TACTICAL_SPEED_BOOST_DURATION;
  player.tacticalSpeedBonus = mods.tacticalSpeedBonus;
  state.floatingTexts.push({
    x: player.x,
    y: player.y - 22,
    text: 'EVADE!',
    color: '#38bdf8',
    life: 0.65,
    maxLife: 0.65,
  });
  return true;
}

/**
 * Applies standard player hit damage, feedback FX, and base hit invulnerability.
 * Returns true if the player died (status transitioned to gameover).
 */
function applyPlayerHitDamage(
  state: GameState,
  damage: number,
  shakeIntensity: number,
  shakeDuration: number,
  particleColor = '#f87171',
  particleCount = 6,
): boolean {
  const { player } = state;
  player.hp = Math.max(0, player.hp - damage);
  emitSound(state, 'player_hit');
  triggerShake(state, shakeIntensity, shakeDuration);
  spawnParticles(state, player.x, player.y, particleColor, particleCount, 45, 140, 2.5, 0.3);
  state.floatingTexts.push({
    x: player.x,
    y: player.y - player.radius - 6,
    text: `-${damage}`,
    color: particleColor,
    life: 0.7,
    maxLife: 0.7,
  });
  if (player.hp <= 0) {
    state.status = 'gameover';
    return true;
  }
  player.invulnTimer = BASE_HIT_INVULN_DURATION;
  return false;
}

/**
 * Attempts to trigger def_aegis parry against parryable hits (melee contact or normal enemy projectiles).
 * Piercing projectiles, parabolic mortars, and boss lasers bypass parry.
 */
function tryAegisParry(state: GameState, mods: ComputedSkillModifiers, counterTarget?: EnemyState): boolean {
  const { player } = state;
  if (!mods.hasAegisParry || player.aegisCooldown > 0) return false;
  player.aegisCooldown = mods.aegisCooldown;
  player.invulnTimer = BASE_HIT_INVULN_DURATION;
  emitSound(state, 'parry');
  triggerShake(state, 3.5, 0.12);
  spawnParticles(state, player.x, player.y, '#34d399', 8, 55, 140, 2.4, 0.28);
  if (counterTarget) {
    damageEnemy(state, counterTarget, mods.aegisDamage);
    state.visualFx.push({
      kind: 'pulse',
      x: player.x,
      y: player.y,
      radius: 70,
      color: '#34d399',
      life: 0.25,
      maxLife: 0.25,
    });
  }
  state.floatingTexts.push({
    x: player.x,
    y: player.y - 20,
    text: 'PARRY!',
    color: '#34d399',
    life: 0.7,
    maxLife: 0.7,
  });
  return true;
}

export interface EnemiesStepDeps {
  getStairsLockCount: (state: GameState) => number;
  rollDropEquipmentLevel: (
    equipment: readonly EquippedItem[],
    rngNext: () => number,
    dropQualityTier?: number,
  ) => number;
}

export function stepEnemies(
  state: GameState,
  mods: ComputedSkillModifiers,
  orbitItem: EquippedItem | undefined,
  bits: Vec2[],
  clampedDt: number,
  deps: EnemiesStepDeps,
): boolean {
  const { player, map } = state;
  const orbitDmg = orbitItem ? getEquipmentDamage(orbitItem, 1) : 0;

  // 9. Update enemies (with BFS corridor pathfinding, scout wander/alert, shooter 4/6/8-way rotating barrage, boss patterns, room-only repop)
  const rng = createRng(
    (state.seed ^ (state.stats.kills * 7919) ^ (state.floor * 131) ^ Math.floor(state.elapsedFloorTime * 10)) >>> 0,
  );

  // 9a. Timed reinforcement respawn (room tiles only; boss floor spawns inside boss arena only while grand boss is active)
  stepFloorRespawn(state, clampedDt, rng);

  let bfsDist: Int32Array | null = null;
  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  const getBfsDist = (): Int32Array => {
    if (!bfsDist) {
      bfsDist = computeBfsDistances(map.width, map.height, map.tiles, ptx, pty);
    }
    return bfsDist;
  };
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
        if (!isWallAtWorld(map, bit.x, bit.y) && Math.hypot(enemy.x - bit.x, enemy.y - bit.y) <= enemy.radius + 9) {
          damageEnemy(state, enemy, orbitDmg);
          enemy.bitHitCooldown = 0.35;
          break;
        }
      }
    }

    if (enemy.hp <= 0) {
      handleEnemyDeath(state, enemy, i, mods, rng, deps);
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

    // Scout archetype: patrol corridors/rooms freely while unalerted; on alert summon fast runners up to per-scout cap while in range
    if (enemy.kind === 'scout') {
      stepScoutBehavior(state, enemy, etx, ety, ptx, pty, distToPlayer, playerRoom, clampedDt, rng, alertSpawns);
    }

    // Normal enemy archetype: player-level-scaled weak ranged shot (prevents 1F bullet-hell while escalating later)
    if ((!enemy.kind || enemy.kind === 'normal') && enemy.awake) {
      stepNormalEnemyAttack(state, enemy, dx, dy, distToPlayer, wasAwake, clampedDt);
    }

    // Tank archetype: predictive parabolic mortar lobbing ground AoE zones with clear impact timing
    if (enemy.kind === 'tank' && !enemy.isRoomBoss && enemy.awake) {
      stepTankEnemyAttack(state, enemy, distToPlayer, playerRoom, wasAwake, clampedDt);
    }

    // Shooter archetype: stationary knockback-immune turret firing continuous rotating radial barrage once awake
    if (enemy.kind === 'shooter' && enemy.awake) {
      stepShooterEnemyAttack(state, enemy, distToPlayer, playerRoom, wasAwake, clampedDt, rng);
    }

    // Guardian / Grand Boss rotating patterns (ring, spread homing orbs, wall-bouncing shots, lead dash + burst) + independent mortar
    if (enemy.isRoomBoss && enemy.awake) {
      stepBossBehavior(state, enemy, dx, dy, distToPlayer, wasAwake, clampedDt, rng);
    }

    stepEnemyMovement(state, enemy, i, orbitItem, distToPlayer, clampedDt, getBfsDist);

    // Contact damage to player
    if (handleEnemyContactWithPlayer(state, enemy, mods)) {
      return true;
    }
  }

  if (alertSpawns.length > 0) {
    state.enemies.push(...alertSpawns);
  }

  // 9b. Enemy projectiles hitting player
  if (stepEnemyProjectilesOnPlayer(state, mods)) return true;

  // 9c. Tank parabolic mortar ground impact zones (overhead, bypasses shield/blade)
  if (stepMortarZones(state, mods, clampedDt)) return true;

  // 9d. Grand Boss wall-reflecting laser beams (telegraph windup -> active beam hit check)
  if (stepBossLasers(state, mods, clampedDt)) return true;

  return false;
}

function handleEnemyDeath(
  state: GameState,
  enemy: EnemyState,
  index: number,
  mods: ComputedSkillModifiers,
  rng: ReturnType<typeof createRng>,
  deps: EnemiesStepDeps,
): void {
  const { player, map } = state;
  state.stats.kills += 1;
  const wasRoomBoss = Boolean(enemy.isRoomBoss);
  const wasGrandBoss = Boolean(enemy.isGrandBoss);
  const deathColor = wasGrandBoss
    ? '#fbbf24'
    : wasRoomBoss
      ? '#f43f5e'
      : enemy.kind === 'runner'
        ? '#fde047'
        : enemy.kind === 'tank'
          ? '#c084fc'
          : enemy.kind === 'shooter'
            ? '#38bdf8'
            : enemy.kind === 'scout'
              ? '#fb923c'
              : '#fb7185';
  if (wasRoomBoss || wasGrandBoss) {
    emitSound(state, 'boss_kill');
    triggerShake(state, wasGrandBoss ? 10 : 7.5, wasGrandBoss ? 0.38 : 0.28);
    spawnParticles(state, enemy.x, enemy.y, deathColor, wasGrandBoss ? 24 : 18, 60, 210, 3.6, 0.55);
  } else {
    emitSound(state, 'kill');
    spawnParticles(state, enemy.x, enemy.y, deathColor, 8, 45, 145, 2.6, 0.34);
  }

  // Scout-spawned ambush runners yield no drops so alerts cannot be farmed for EXP (APP-MAP-07)
  if (!enemy.isAmbush) {
    const isPackExtra = Boolean(enemy.isPackFollower);
    const dropRateScale = isPackExtra ? 0.4 : 1.0;
    state.pickups.push({
      id: state.nextEntityId++,
      kind: 'exp',
      x: enemy.x,
      y: enemy.y,
      value: wasGrandBoss ? 120 : wasRoomBoss ? 45 : isPackExtra ? 4 : 10,
    });
    if (wasRoomBoss || rng.next() < (0.22 + mods.lootBonusRate * 0.4) * dropRateScale) {
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
      const equipDropChance = (0.015 + mods.equipDropBonus) * dropRateScale;
      if (rng.next() < equipDropChance) {
        const eqId = rng.pick(ALL_EQUIPMENT_IDS);
        const itemLevel = deps.rollDropEquipmentLevel(player.equipment, () => rng.next(), mods.dropQualityTier);
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
  state.enemies.splice(index, 1);
  if (wasRoomBoss && deps.getStairsLockCount(state) === 0) {
    const stairsWorld = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
    emitSound(state, 'stairs_unlock');
    pushNotification(
      state,
      'info',
      wasGrandBoss
        ? `🏆 階層ボス撃破！階段から先（${state.floor + 1}F）へ進める！`
        : '🔓 中ボス撃破！階段の封印が解けた！',
      '#22d3ee',
      3.2,
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
}

function stepScoutBehavior(
  state: GameState,
  enemy: EnemyState,
  etx: number,
  ety: number,
  ptx: number,
  pty: number,
  distToPlayer: number,
  playerRoom: ReturnType<typeof findRoomAtTile>,
  clampedDt: number,
  rng: ReturnType<typeof createRng>,
  alertSpawns: EnemyState[],
): void {
  const { player, map } = state;
  if (enemy.awake) {
    if ((enemy.alertCooldown ?? 0) <= 0 && distToPlayer <= SCOUT_SUMMON_MAX_PLAYER_DIST) {
      const activeSummons =
        state.enemies.filter((e) => e.isAmbush && e.summonerId === enemy.id).length +
        alertSpawns.filter((e) => e.isAmbush && e.summonerId === enemy.id).length;
      const remainingCap = SCOUT_SUMMON_CAP_PER_SCOUT - activeSummons;
      if (remainingCap > 0) {
        enemy.alertCooldown = SCOUT_ALERT_COOLDOWN;

        // Spawn up to 2-3 fast awake runners nearby (130-320px away) that outpace player baseSpeed
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
        const ambushCount = Math.min(spawnCandidates.length, remainingCap, state.floor >= 3 ? 3 : 2);
        for (let s = 0; s < ambushCount; s++) {
          const pickIdx = rng.int(0, spawnCandidates.length - 1);
          const picked = spawnCandidates.splice(pickIdx, 1)[0];
          const pos = tileCenterWorld(picked.tx, picked.ty);
          const runner = createEnemyByKind(state.nextEntityId++, 'runner', pos.x, pos.y, state.floor, MAX_TARGET_RANGE);
          runner.speed = Math.max(228, Math.min(265, Math.round(224 + (state.floor - 1) * 4)));
          runner.spawnDelay = 0.45;
          runner.awake = true;
          runner.isAmbush = true;
          runner.summonerId = enemy.id;
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

        if (ambushCount > 0) {
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
          emitSound(state, 'alert');
          pushNotification(
            state,
            'alert',
            inCorridorEncounter
              ? '⚠️ 通路でスカウトと遭遇！高速の敵が迫る！'
              : '⚠️ スカウトに発見された！高速の敵が迫る！',
            '#f97316',
            2.8,
          );
        }
      }
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
        const chosen = forward && rng.next() < 0.72 ? forward : pool[rng.int(0, pool.length - 1)];
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
          map,
        );
        enemy.x = resolved.x;
        enemy.y = resolved.y;
      }
    }
  }
}

function stepNormalEnemyAttack(
  state: GameState,
  enemy: EnemyState,
  dx: number,
  dy: number,
  distToPlayer: number,
  wasAwake: boolean,
  clampedDt: number,
): void {
  const { player, map } = state;
  const inSight =
    distToPlayer > 1e-3 && distToPlayer <= 190 && hasLineOfSight(enemy.x, enemy.y, player.x, player.y, map);
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

function stepTankEnemyAttack(
  state: GameState,
  enemy: EnemyState,
  distToPlayer: number,
  playerRoom: ReturnType<typeof findRoomAtTile>,
  wasAwake: boolean,
  clampedDt: number,
): void {
  const { player, map } = state;
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
        const stepped = resolveCircleGridCollision(tx + leadDx / steps, ty + leadDy / steps, player.radius, map);
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

function stepShooterEnemyAttack(
  state: GameState,
  enemy: EnemyState,
  distToPlayer: number,
  playerRoom: ReturnType<typeof findRoomAtTile>,
  wasAwake: boolean,
  clampedDt: number,
  rng: ReturnType<typeof createRng>,
): void {
  const enemyTx = Math.floor(enemy.x / TILE_SIZE);
  const enemyTy = Math.floor(enemy.y / TILE_SIZE);
  const sameRoom = playerRoom !== null && isTileInRoom(playerRoom, enemyTx, enemyTy);
  const canShooterFire = distToPlayer > 1e-3 && ((sameRoom && distToPlayer <= 420) || distToPlayer <= 380);
  if (!canShooterFire) {
    enemy.attackCooldown = Math.max(enemy.attackCooldown ?? 0, 0.75);
  } else if (wasAwake) {
    if ((enemy.attackCooldown ?? 0) > 0) {
      enemy.attackCooldown = Math.max(0, (enemy.attackCooldown ?? 0) - clampedDt);
    }
    if ((enemy.attackCooldown ?? 0) <= 0) {
      const projSpeed = 152 + Math.min(55, (state.floor - 1) * 7);
      const dirCount = state.floor >= 11 ? 8 : state.floor >= 6 ? 6 : 4;
      const angleStep = Math.PI / (dirCount * 2);
      const shotIdx = enemy.bossPatternIndex ?? 0;
      const baseOffset = shotIdx * angleStep;
      const pierceSlotA = rng.int(0, dirCount - 1);
      const pierceSlotB = dirCount >= 6 ? (pierceSlotA + rng.int(1, dirCount - 1)) % dirCount : -1;
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

function stepBossBehavior(
  state: GameState,
  enemy: EnemyState,
  dx: number,
  dy: number,
  distToPlayer: number,
  wasAwake: boolean,
  clampedDt: number,
  rng: ReturnType<typeof createRng>,
): void {
  const { player, map } = state;
  const isGrand = Boolean(enemy.isGrandBoss);
  if (wasAwake && enemy.dashState !== 'dashing' && enemy.dashState !== 'windup' && enemy.dashState !== 'recovering') {
    enemy.mortarCooldown = Math.max(0, (enemy.mortarCooldown ?? 0.6) - clampedDt);
    const canBossMortar = distToPlayer > 1e-3 && distToPlayer <= (isGrand ? 780 : 400);
    if (canBossMortar && (enemy.mortarCooldown ?? 0) <= 0) {
      const mortarDuration = 0.85;
      const burstCount = isGrand ? 3 : 1;
      const mortarRadius = isGrand ? 68 : 52;
      const maxLeadDist = isGrand ? 155 : 115;
      for (let b = 0; b < burstCount; b++) {
        const leadTime = 0.55 + b * 0.28;
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
          const stepped = resolveCircleGridCollision(tx + leadDx / steps, ty + leadDy / steps, player.radius, map);
          tx = stepped.x;
          ty = stepped.y;
        }
        state.mortarZones.push({
          id: state.nextEntityId++,
          startX: enemy.x,
          startY: enemy.y,
          targetX: tx,
          targetY: ty,
          radius: mortarRadius,
          damage: Math.round(enemy.damage * 1.2),
          elapsed: -b * 0.24,
          duration: mortarDuration,
        });
      }
      enemy.mortarCooldown = isGrand ? 2.6 : 2.6;
    }
  }

  if (enemy.dashState === 'windup') {
    enemy.dashTimer = Math.max(0, (enemy.dashTimer ?? 0) - clampedDt);
    if ((enemy.dashTimer ?? 0) <= 0) {
      enemy.dashState = 'dashing';
      enemy.dashTimer = isGrand ? 0.72 : 0.62;
      emitSound(state, 'boss_dash');
    }
  } else if (enemy.dashState === 'dashing' && enemy.dashDir) {
    const dashSpd = enemy.dashSpeed ?? (isGrand ? 540 : 480);
    const stepDist = dashSpd * clampedDt;
    const resolvedDash = resolveCircleGridCollision(
      enemy.x + enemy.dashDir.x * stepDist,
      enemy.y + enemy.dashDir.y * stepDist,
      enemy.radius,
      map,
    );
    const moved = Math.hypot(resolvedDash.x - enemy.x, resolvedDash.y - enemy.y);
    enemy.x = resolvedDash.x;
    enemy.y = resolvedDash.y;
    spawnParticles(state, enemy.x, enemy.y, isGrand ? '#fbbf24' : '#f43f5e', 1, 10, 40, 2.6, 0.22);
    enemy.dashTimer = Math.max(0, (enemy.dashTimer ?? 0) - clampedDt);

    const hitWall = stepDist > 1e-4 && moved < stepDist * 0.65;
    let endedDash = (enemy.dashTimer ?? 0) <= 0;
    if (hitWall) {
      if ((enemy.dashBouncesLeft ?? 0) > 0) {
        const rx = resolveCircleGridCollision(enemy.x + enemy.dashDir.x * stepDist, enemy.y, enemy.radius, map);
        const ry = resolveCircleGridCollision(enemy.x, enemy.y + enemy.dashDir.y * stepDist, enemy.radius, map);
        const blockedX =
          Math.abs(enemy.dashDir.x) > 1e-3 && Math.abs(rx.x - enemy.x) < Math.abs(enemy.dashDir.x) * stepDist * 0.65;
        const blockedY =
          Math.abs(enemy.dashDir.y) > 1e-3 && Math.abs(ry.y - enemy.y) < Math.abs(enemy.dashDir.y) * stepDist * 0.65;
        if (blockedX) enemy.dashDir.x = -enemy.dashDir.x;
        if (blockedY) enemy.dashDir.y = -enemy.dashDir.y;
        if (!blockedX && !blockedY) {
          enemy.dashDir.x = -enemy.dashDir.x;
          enemy.dashDir.y = -enemy.dashDir.y;
        }
        enemy.dashBouncesLeft = (enemy.dashBouncesLeft ?? 1) - 1;
        triggerShake(state, 3.5, 0.12);
        spawnParticles(state, enemy.x, enemy.y, '#fbbf24', 6, 40, 120, 2.4, 0.25);
      } else {
        endedDash = true;
      }
    }

    if (endedDash) {
      enemy.dashState = 'recovering';
      enemy.dashTimer = isGrand ? 1.05 : 0.95;
      const burstCount = isGrand ? 8 : 4;
      const burstSpd = isGrand ? 195 : 170;
      const baseBurstAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
      for (let k = 0; k < burstCount; k++) {
        const ba = baseBurstAngle + (k * Math.PI * 2) / burstCount;
        state.enemyProjectiles.push({
          id: state.nextEntityId++,
          x: enemy.x,
          y: enemy.y,
          vx: Math.cos(ba) * burstSpd,
          vy: Math.sin(ba) * burstSpd,
          radius: 5.5,
          damage: Math.round(enemy.damage * 0.78),
          life: 1.7,
          pierceDefense: false,
          color: '#f97316',
        });
      }
    }
  } else if (enemy.dashState === 'recovering') {
    enemy.dashTimer = Math.max(0, (enemy.dashTimer ?? 0) - clampedDt);
    if ((enemy.dashTimer ?? 0) <= 0) {
      enemy.dashState = 'none';
    }
  } else {
    const inSight =
      distToPlayer > 1e-3 &&
      distToPlayer <= (isGrand ? 780 : 300) &&
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
            const isPiercing =
              (k - pierceStart + count) % pierceStep === 0 &&
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
            if (
              points.length === 1 ||
              Math.hypot(lx - points[points.length - 1].x, ly - points[points.length - 1].y) > 4
            ) {
              points.push({ x: lx, y: ly });
            }
            if (!state.bossLasers) state.bossLasers = [];
            state.bossLasers.push({
              id: state.nextEntityId++,
              points,
              width: 22,
              damage: Math.round(enemy.damage * 1.15),
              elapsed: 0,
              windup: 0.72,
              duration: 1.12,
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
          enemy.dashTimer = isGrand ? 0.55 : 0.58;
          enemy.dashDir = { x: Math.cos(dashAngle), y: Math.sin(dashAngle) };
          enemy.dashSpeed = isGrand ? 540 : 480;
          enemy.dashBouncesLeft = isGrand ? 1 : 0;
        }
        enemy.bossPatternIndex = (pattern + 1) % 4;
        enemy.attackCooldown = isGrand ? 1.35 : 1.85;
      }
    }
  }
}

function stepEnemyMovement(
  state: GameState,
  enemy: EnemyState,
  enemyIndex: number,
  orbitItem: EquippedItem | undefined,
  distToPlayer: number,
  clampedDt: number,
  getBfsDist: () => Int32Array,
): void {
  const { player, map } = state;
  const isBossDashLocked =
    enemy.isRoomBoss &&
    (enemy.dashState === 'windup' || enemy.dashState === 'dashing' || enemy.dashState === 'recovering');

  if (enemy.awake && distToPlayer > 1e-3 && enemy.speed > 0 && !isBossDashLocked) {
    let steerX = player.x;
    let steerY = player.y;
    if (!hasClearCorridorPath(enemy.x, enemy.y, player.x, player.y, enemy.radius, map)) {
      const waypoint = findBfsSteerTarget(enemy, player, map, getBfsDist());
      steerX = waypoint.x;
      steerY = waypoint.y;
    }

    const baseMoveSpeed =
      enemy.kind === 'scout'
        ? Math.min(SCOUT_MAX_ALERT_SPEED, Math.round(enemy.speed * SCOUT_ALERT_SPEED_MULT))
        : enemy.speed;
    const effectiveSpeed =
      orbitItem && distToPlayer <= player.orbitRadius ? baseMoveSpeed * ORBIT_SHIELD_INNER_SLOW : baseMoveSpeed;

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
    } else if (enemy.kind === 'scout') {
      if (distToPlayer < SCOUT_KEEP_DIST) {
        const fleeTarget = findScoutFleeTarget(enemy, player, map, getBfsDist());
        const fdx = fleeTarget.x - enemy.x;
        const fdy = fleeTarget.y - enemy.y;
        const fDist = Math.hypot(fdx, fdy);
        moveX = fDist > 1e-3 ? (fdx / fDist) * effectiveSpeed : 0;
        moveY = fDist > 1e-3 ? (fdy / fDist) * effectiveSpeed : 0;
      } else if (distToPlayer <= SCOUT_CHASE_DIST) {
        // Strafe tangentially around the player to stay annoying just outside weapon range
        const invDist = distToPlayer > 1e-3 ? 1 / distToPlayer : 0;
        const nx = (enemy.x - player.x) * invDist;
        const ny = (enemy.y - player.y) * invDist;
        let dirSign = (enemy.wanderDir?.x ?? (enemy.id % 2 === 0 ? 1 : -1)) >= 0 ? 1 : -1;
        let tx = -ny * dirSign;
        let ty = nx * dirSign;
        const probeTx = Math.floor((enemy.x + tx * (TILE_SIZE * 0.7)) / TILE_SIZE);
        const probeTy = Math.floor((enemy.y + ty * (TILE_SIZE * 0.7)) / TILE_SIZE);
        if (isWallTile(map, probeTx, probeTy)) {
          dirSign = -dirSign;
          tx = -ny * dirSign;
          ty = nx * dirSign;
        }
        enemy.wanderDir = { x: dirSign, y: 0 };
        const strafeSpeed = effectiveSpeed * 0.65;
        moveX = tx * strafeSpeed;
        moveY = ty * strafeSpeed;
      }
    }

    for (let j = 0; j < state.enemies.length; j++) {
      if (enemyIndex === j) continue;
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
      map,
    );
    enemy.x = resolved.x;
    enemy.y = resolved.y;
  }
}

function handleEnemyContactWithPlayer(state: GameState, enemy: EnemyState, mods: ComputedSkillModifiers): boolean {
  const { player } = state;
  if (player.invulnTimer <= 0 && Math.hypot(player.x - enemy.x, player.y - enemy.y) <= player.radius + enemy.radius) {
    const isDashingBoss = Boolean(enemy.isRoomBoss || enemy.isGrandBoss) && enemy.dashState === 'dashing';

    if (!isDashingBoss) {
      if (tryAegisParry(state, mods, enemy)) {
        return false;
      }
      if (tryTacticalStepEvade(state, mods)) {
        return false;
      }
    } else {
      if (tryTacticalStepEvade(state, mods)) {
        return false;
      }
    }

    if (applyPlayerHitDamage(state, enemy.damage, 6, 0.18, '#f87171', 7)) {
      return true;
    }

    // Boss dash bypasses parry damage negation, but def_aegis still triggers a counter-hit (trade)
    if (isDashingBoss && mods.hasAegisParry && player.aegisCooldown <= 0) {
      player.aegisCooldown = mods.aegisCooldown;
      emitSound(state, 'parry');
      damageEnemy(state, enemy, mods.aegisDamage, true);
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
    }

    // Trigger reactive coil counter immediately on hit if equipped
    const coil = player.equipment.find((e) => e.id === 'reactive_coil');
    if (coil) {
      const coilStats = getReactiveCoilStats(coil.level, EQUIPMENT_CATALOG.reactive_coil.baseRange, mods.rangeMult);
      triggerChainLightning(
        state,
        player.x,
        player.y,
        Math.min(MAX_TARGET_RANGE, coilStats.range),
        getEquipmentDamage(coil, 1),
        coilStats.maxTargets,
      );
    }
  }
  return false;
}

function stepFloorRespawn(state: GameState, clampedDt: number, rng: ReturnType<typeof createRng>): void {
  const { player, map } = state;
  state.elapsedFloorTime += clampedDt;
  state.respawnTimer -= clampedDt;
  const maxAlive = 26 + state.floor * 3;
  const isBossArenaFloor = map.floorType === 'boss';
  const activeGrandBoss = isBossArenaFloor ? state.enemies.find((e) => e.isGrandBoss && e.hp > 0) : undefined;
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
          if (candidates.length === 0) break;
          const pickIdx = rng.int(0, candidates.length - 1);
          const picked = candidates.splice(pickIdx, 1)[0];
          const pos = tileCenterWorld(picked.tx, picked.ty);
          const kind = pickEnemyKindForFloor(state.floor, rng.next());
          const spawned = createEnemyByKind(state.nextEntityId++, kind, pos.x, pos.y, state.floor, MAX_TARGET_RANGE);
          if (bossArena) spawned.awake = true;
          state.enemies.push(spawned);

          if (kind === 'runner') {
            const packSize = getRunnerPackSize(state.floor, rng.next());
            for (let p = 1; p < packSize; p++) {
              if (candidates.length === 0 || state.enemies.length >= maxAlive) break;
              // Prefer nearby candidate tiles in the same room for pack cohesion
              let bestCandIdx = 0;
              let bestDist = Infinity;
              for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
                const c = candidates[cIdx];
                const d = Math.hypot(c.tx - picked.tx, c.ty - picked.ty);
                if (d < bestDist) {
                  bestDist = d;
                  bestCandIdx = cIdx;
                }
              }
              const extraTile = candidates.splice(bestCandIdx, 1)[0];
              const extraPos = tileCenterWorld(extraTile.tx, extraTile.ty);
              const follower = createEnemyByKind(
                state.nextEntityId++,
                'runner',
                extraPos.x,
                extraPos.y,
                state.floor,
                MAX_TARGET_RANGE,
              );
              follower.isPackFollower = true;
              if (bossArena) follower.awake = true;
              state.enemies.push(follower);
            }
          }
        }
        pushNotification(
          state,
          'info',
          bossArena ? '👾 ボスアリーナに増援が出現！' : '👾 ダンジョン奥の部屋に新たな敵の気配…',
          '#c084fc',
          2.2,
        );
      }
    }
  }
}

function stepEnemyProjectilesOnPlayer(state: GameState, mods: ComputedSkillModifiers): boolean {
  const { player } = state;
  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    if (player.invulnTimer <= 0 && Math.hypot(player.x - ep.x, player.y - ep.y) <= player.radius + ep.radius) {
      state.enemyProjectiles.splice(i, 1);
      if (!ep.pierceDefense && tryAegisParry(state, mods)) {
        continue;
      }
      if (tryTacticalStepEvade(state, mods)) {
        continue;
      }
      if (applyPlayerHitDamage(state, ep.damage, 5.5, 0.16, '#f87171', 6)) {
        return true;
      }
    }
  }
  return false;
}

function stepMortarZones(state: GameState, mods: ComputedSkillModifiers, clampedDt: number): boolean {
  const { player } = state;
  for (let i = state.mortarZones.length - 1; i >= 0; i--) {
    const zone = state.mortarZones[i];
    zone.elapsed += clampedDt;
    if (zone.elapsed >= zone.duration) {
      state.mortarZones.splice(i, 1);
      spawnParticles(state, zone.targetX, zone.targetY, '#c084fc', 10, 55, 160, 2.8, 0.36);
      if (Math.hypot(player.x - zone.targetX, player.y - zone.targetY) <= 260) {
        triggerShake(state, 2.8, 0.11);
      }
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
        Math.hypot(player.x - zone.targetX, player.y - zone.targetY) <= zone.radius + player.radius * 0.5
      ) {
        if (!tryTacticalStepEvade(state, mods)) {
          if (applyPlayerHitDamage(state, zone.damage, 6.5, 0.2, '#f87171', 7)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function stepBossLasers(state: GameState, mods: ComputedSkillModifiers, clampedDt: number): boolean {
  const { player } = state;
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
            abLenSq > 1e-6 ? Math.max(0, Math.min(1, ((player.x - a.x) * abx + (player.y - a.y) * aby) / abLenSq)) : 0;
          const cx = a.x + abx * t;
          const cy = a.y + aby * t;
          minDist = Math.min(minDist, Math.hypot(player.x - cx, player.y - cy));
        }
        const activeWidth = getActiveBossLaserWidth(laser);
        if (activeWidth > 0 && minDist <= player.radius + activeWidth * 0.5) {
          laser.hitPlayer = true;
          if (!tryTacticalStepEvade(state, mods)) {
            if (applyPlayerHitDamage(state, laser.damage, 7, 0.22, '#f43f5e', 8)) {
              return true;
            }
          }
        }
      }
      if (laser.elapsed >= laser.duration) {
        state.bossLasers.splice(i, 1);
      }
    }
  }
  return false;
}
