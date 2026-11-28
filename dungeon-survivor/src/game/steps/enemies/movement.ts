import { hasLineOfSight, resolveCircleGridCollision } from '../../../core/collision';
import { isWallTile, TILE_SIZE } from '../../../core/dungeon';
import { type EquippedItem, ORBIT_SHIELD_INNER_SLOW } from '../../equipment';
import type { EnemyState, GameState } from '../../types';
import { SCOUT_ALERT_SPEED_MULT, SCOUT_CHASE_DIST, SCOUT_KEEP_DIST, SCOUT_MAX_ALERT_SPEED } from './archetypes';
import { findBfsSteerTarget, findScoutFleeTarget, hasClearCorridorPath } from './pathfinding';

export function stepEnemyMovement(
  state: GameState,
  enemy: EnemyState,
  enemyIndex: number,
  orbitItem: EquippedItem | undefined,
  distToPlayer: number,
  clampedDt: number,
  getBfsDist: () => Int32Array,
): void {
  const { player, map } = state;
  const isDashLocked =
    enemy.dashState === 'windup' || enemy.dashState === 'dashing' || enemy.dashState === 'recovering';

  if (enemy.awake && distToPlayer > 1e-3 && enemy.speed > 0 && !isDashLocked) {
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
      if (!other) continue;
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
