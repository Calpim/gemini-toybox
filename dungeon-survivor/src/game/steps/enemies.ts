import { hasLineOfSight } from '../../core/collision';
import { computeBfsDistances, findRoomAtTile, isTileInRoom, isWallAtWorld, TILE_SIZE } from '../../core/dungeon';
import { createRng } from '../../core/rng';
import { type EquippedItem, getEquipmentDamage } from '../equipment';
import type { ComputedSkillModifiers } from '../skillTree';
import type { EnemyState, GameState, Vec2 } from '../types';
import { damageEnemy } from './combatHelpers';
import {
  stepNormalEnemyAttack,
  stepScoutBehavior,
  stepShooterEnemyAttack,
  stepTankEnemyAttack,
} from './enemies/archetypes';
import { stepBossBehavior, stepBossLasers, stepMortarZones } from './enemies/boss';
import { type EnemiesStepDeps, handleEnemyDeath, stepFloorRespawn } from './enemies/lifecycle';
import { stepEnemyMovement } from './enemies/movement';
import { handleEnemyContactWithPlayer, stepEnemyProjectilesOnPlayer } from './enemies/playerHit';

export {
  getNormalEnemyShotStats,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
} from './enemies/archetypes';
export { getActiveBossLaserWidth } from './enemies/boss';
export type { EnemiesStepDeps } from './enemies/lifecycle';

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
    if (!enemy) continue;
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
      stepScoutBehavior({
        state,
        enemy,
        etx,
        ety,
        ptx,
        pty,
        distToPlayer,
        playerRoom,
        clampedDt,
        rng,
        alertSpawns,
      });
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
