import { type DungeonMap, isWallAtWorld } from '../../core/dungeon';
import { spawnParticles } from '../effects';
import type { GameState, ProjectileState, Vec2 } from '../types';
import { damageEnemy, findNearestVisibleEnemy } from './combatHelpers';

// REVISIT_IF: プレイテストでチャクラム回転半径の視認性・再ヒット率を調整する場合 (OQ-06)
export const RICOCHET_DISC_LOOP_RADIUS = 32;

export function clearDiscLoopState(proj: ProjectileState): void {
  proj.loopCenterX = undefined;
  proj.loopCenterY = undefined;
  proj.loopRadius = undefined;
  proj.loopAngle = undefined;
  proj.loopProgress = undefined;
  proj.loopDir = undefined;
  proj.loopTargetEnemyId = undefined;
  proj.loopExitAngle = undefined;
}

function scoreLoopCircleClearance(map: DungeonMap, cx: number, cy: number, radius: number): number {
  let score = !isWallAtWorld(map, cx, cy) ? 10 : 0;
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4;
    if (!isWallAtWorld(map, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)) {
      score += 1;
    }
  }
  return score;
}

export function chooseDiscLoopCandidate(
  map: DungeonMap,
  hitX: number,
  hitY: number,
  heading: number,
  radius: number,
): { cx: number; cy: number; startAngle: number; dir: 1 | -1 } {
  const candA = {
    cx: hitX + Math.cos(heading + Math.PI / 2) * radius,
    cy: hitY + Math.sin(heading + Math.PI / 2) * radius,
    startAngle: heading - Math.PI / 2,
    dir: 1 as const,
  };
  const candB = {
    cx: hitX + Math.cos(heading - Math.PI / 2) * radius,
    cy: hitY + Math.sin(heading - Math.PI / 2) * radius,
    startAngle: heading + Math.PI / 2,
    dir: -1 as const,
  };
  const scoreA = scoreLoopCircleClearance(map, candA.cx, candA.cy, radius);
  const scoreB = scoreLoopCircleClearance(map, candB.cx, candB.cy, radius);
  return scoreB > scoreA ? candB : candA;
}

export interface ProjectilesStepDeps {
  getOrbitBitPositions: (state: GameState) => Vec2[];
}

export function stepProjectiles(state: GameState, clampedDt: number, deps: ProjectilesStepDeps): Vec2[] {
  const { player, map } = state;

  // 7. Orbit Shield Bits & enemy projectile update (including homing steering & wall bounce)
  const bits = deps.getOrbitBitPositions(state);

  for (let i = state.enemyProjectiles.length - 1; i >= 0; i--) {
    const ep = state.enemyProjectiles[i];
    if (!ep) continue;
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
    if (!ep.pierceDefense && bits.length > 0) {
      const blockedByBit = bits.some((bit) => Math.hypot(bit.x - ep.x, bit.y - ep.y) <= ep.radius + 10);
      if (blockedByBit) {
        state.enemyProjectiles.splice(i, 1);
      }
    }
  }

  // 8. Player projectiles & wall/enemy collision + homing/orbiting ricochet disc (APP-CMB-03, APP-CMB-05)
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    if (!proj) continue;
    proj.life -= clampedDt;

    if (proj.kind === 'disc') {
      proj.spinAngle = (proj.spinAngle ?? 0) + 18 * clampedDt;
      const spd = proj.speed ?? 360;
      let runNormalMove = true;

      if (proj.loopCenterX !== undefined && proj.loopCenterY !== undefined) {
        runNormalMove = false;
        const r = proj.loopRadius ?? RICOCHET_DISC_LOOP_RADIUS;
        const angularStep = (spd / r) * clampedDt;
        const dir = proj.loopDir ?? 1;
        const nextAngle = (proj.loopAngle ?? 0) + dir * angularStep;
        const nextProgress = (proj.loopProgress ?? 0) + angularStep;
        const ox = proj.loopCenterX + Math.cos(nextAngle) * r;
        const oy = proj.loopCenterY + Math.sin(nextAngle) * r;

        if (isWallAtWorld(map, ox, oy)) {
          const tangentAngle = (proj.loopAngle ?? 0) + dir * (Math.PI / 2);
          proj.vx = Math.cos(tangentAngle) * spd;
          proj.vy = Math.sin(tangentAngle) * spd;
          if (proj.loopTargetEnemyId !== undefined) {
            const targetId = proj.loopTargetEnemyId;
            proj.hitEnemyIds = proj.hitEnemyIds.filter((id) => id !== targetId);
          }
          clearDiscLoopState(proj);
          runNormalMove = true;
        } else {
          const tangentAngle = nextAngle + dir * (Math.PI / 2);
          proj.vx = Math.cos(tangentAngle) * spd;
          proj.vy = Math.sin(tangentAngle) * spd;
          proj.x = ox;
          proj.y = oy;
          proj.loopAngle = nextAngle;
          proj.loopProgress = nextProgress;

          if (nextProgress >= Math.PI * 2) {
            const targetId = proj.loopTargetEnemyId;
            const exitAngle = proj.loopExitAngle ?? tangentAngle;
            if (targetId !== undefined) {
              proj.hitEnemyIds = proj.hitEnemyIds.filter((id) => id !== targetId);
            }
            clearDiscLoopState(proj);
            const target =
              targetId !== undefined ? state.enemies.find((e) => e.id === targetId && e.hp > 0) : undefined;
            const resumeAngle =
              target && Math.hypot(target.x - proj.x, target.y - proj.y) > 1e-6
                ? Math.atan2(target.y - proj.y, target.x - proj.x)
                : exitAngle;
            proj.vx = Math.cos(resumeAngle) * spd;
            proj.vy = Math.sin(resumeAngle) * spd;
          }
        }
      }

      if (runNormalMove) {
        const homingTarget = findNearestVisibleEnemy(proj.x, proj.y, 170, state, proj.hitEnemyIds);
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
    } else if (proj.kind === 'base_homing') {
      const spd = proj.speed ?? Math.max(1, Math.hypot(proj.vx, proj.vy));
      const dashSpd = proj.homingDashSpeed ?? Math.max(540, Math.round(spd * 1.75));
      if ((proj.orbitTimer ?? 0) > 0) {
        const nextOrbitTimer = Math.max(0, (proj.orbitTimer ?? 0) - clampedDt);
        const angularSpd = proj.orbitAngularSpeed ?? (Math.PI * 2) / 0.26;
        const nextAngle = (proj.orbitAngle ?? 0) + angularSpd * clampedDt;
        const orbitR = proj.orbitRadius ?? 44;
        proj.orbitTimer = nextOrbitTimer;
        proj.orbitAngle = nextAngle;

        let nx = player.x + Math.cos(nextAngle) * orbitR;
        let ny = player.y + Math.sin(nextAngle) * orbitR;
        if (isWallAtWorld(map, nx, ny)) {
          for (const ratio of [0.75, 0.5, 0.25, 0]) {
            const candX = player.x + Math.cos(nextAngle) * orbitR * ratio;
            const candY = player.y + Math.sin(nextAngle) * orbitR * ratio;
            if (!isWallAtWorld(map, candX, candY)) {
              nx = candX;
              ny = candY;
              break;
            }
          }
        }
        proj.x = nx;
        proj.y = ny;

        const tangentAngle = nextAngle + Math.PI / 2;
        proj.vx = Math.cos(tangentAngle) * spd;
        proj.vy = Math.sin(tangentAngle) * spd;

        if (nextOrbitTimer <= 0) {
          if ((proj.expandTimer ?? 0) > 0) {
            proj.vx = Math.cos(nextAngle) * spd;
            proj.vy = Math.sin(nextAngle) * spd;
          } else {
            proj.speed = dashSpd;
            const immediateTarget = findNearestVisibleEnemy(
              proj.x,
              proj.y,
              proj.homingRange ?? 220,
              state,
              proj.hitEnemyIds,
              true,
            );
            if (immediateTarget) {
              const aimAngle = Math.atan2(immediateTarget.y - proj.y, immediateTarget.x - proj.x);
              proj.vx = Math.cos(aimAngle) * dashSpd;
              proj.vy = Math.sin(aimAngle) * dashSpd;
            } else {
              proj.vx = Math.cos(tangentAngle) * dashSpd;
              proj.vy = Math.sin(tangentAngle) * dashSpd;
            }
          }
        }
      } else if ((proj.expandTimer ?? 0) > 0) {
        const expandDur = proj.expandDuration ?? 0.13;
        const nextExpandTimer = Math.max(0, (proj.expandTimer ?? 0) - clampedDt);
        proj.expandTimer = nextExpandTimer;

        const t = Math.min(1, Math.max(0, 1 - nextExpandTimer / expandDur));
        const ease = 1 - (1 - t) * (1 - t);
        const startR = proj.orbitRadius ?? 44;
        const targetR = proj.expandTargetRadius ?? 84;
        const currR = startR + (targetR - startR) * ease;
        const radialAngle = proj.orbitAngle ?? Math.atan2(proj.y - player.y, proj.x - player.x);

        let nx = player.x + Math.cos(radialAngle) * currR;
        let ny = player.y + Math.sin(radialAngle) * currR;
        if (isWallAtWorld(map, nx, ny)) {
          for (const ratio of [0.85, 0.7, 0.55, 0.4, 0.25, 0]) {
            const candX = player.x + Math.cos(radialAngle) * currR * ratio;
            const candY = player.y + Math.sin(radialAngle) * currR * ratio;
            if (!isWallAtWorld(map, candX, candY)) {
              nx = candX;
              ny = candY;
              break;
            }
          }
        }
        proj.x = nx;
        proj.y = ny;
        proj.vx = Math.cos(radialAngle) * spd;
        proj.vy = Math.sin(radialAngle) * spd;

        if (nextExpandTimer <= 0) {
          proj.speed = dashSpd;
          const immediateTarget = findNearestVisibleEnemy(
            proj.x,
            proj.y,
            proj.homingRange ?? 220,
            state,
            proj.hitEnemyIds,
            true,
          );
          if (immediateTarget) {
            const aimAngle = Math.atan2(immediateTarget.y - proj.y, immediateTarget.x - proj.x);
            proj.vx = Math.cos(aimAngle) * dashSpd;
            proj.vy = Math.sin(aimAngle) * dashSpd;
          } else {
            proj.vx = Math.cos(radialAngle) * dashSpd;
            proj.vy = Math.sin(radialAngle) * dashSpd;
          }
        }
      } else {
        const activeSpd = Math.max(spd, dashSpd);
        proj.speed = activeSpd;
        const homingTarget = findNearestVisibleEnemy(
          proj.x,
          proj.y,
          proj.homingRange ?? 220,
          state,
          proj.hitEnemyIds,
          true,
        );
        if (homingTarget) {
          const currAngle = Math.atan2(proj.vy, proj.vx);
          const desiredAngle = Math.atan2(homingTarget.y - proj.y, homingTarget.x - proj.x);
          let diff = desiredAngle - currAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = (proj.homingTurnRate ?? 10) * clampedDt;
          const nextAngle = currAngle + Math.max(-maxTurn, Math.min(maxTurn, diff));
          proj.vx = Math.cos(nextAngle) * activeSpd;
          proj.vy = Math.sin(nextAngle) * activeSpd;
        }
        const nx = proj.x + proj.vx * clampedDt;
        const ny = proj.y + proj.vy * clampedDt;
        proj.traveledDist = (proj.traveledDist ?? 0) + Math.hypot(nx - proj.x, ny - proj.y);
        proj.x = nx;
        proj.y = ny;
      }
      if (!proj.trail) {
        proj.trail = [];
      }
      proj.trail.push({ x: proj.x, y: proj.y });
      if (proj.trail.length > 12) {
        proj.trail.shift();
      }
    } else {
      proj.x += proj.vx * clampedDt;
      proj.y += proj.vy * clampedDt;
    }

    const isLoopingDisc = proj.kind === 'disc' && proj.loopCenterX !== undefined && proj.loopCenterY !== undefined;
    const exceededDist = proj.maxDistance !== undefined && (proj.traveledDist ?? 0) >= proj.maxDistance;
    if (proj.life <= 0 || (!isLoopingDisc && (exceededDist || isWallAtWorld(map, proj.x, proj.y)))) {
      state.projectiles.splice(i, 1);
      continue;
    }

    let consumed = false;
    for (const enemy of state.enemies) {
      if (proj.loopTargetEnemyId === enemy.id || proj.hitEnemyIds.includes(enemy.id)) continue;
      if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
        damageEnemy(state, enemy, proj.damage);
        proj.hitEnemyIds.push(enemy.id);
        if (proj.kind === 'base' && (proj.overclockLevel ?? 0) >= 1) {
          spawnParticles(state, proj.x, proj.y, '#2dd4bf', 4, 45, 130, 2.2, 0.22);
        }

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
            // No unhit enemy in sight: loop 1 full revolution anchored at hit point, then re-hit
            const spd = proj.speed ?? 360;
            const heading =
              Math.hypot(proj.vx, proj.vy) > 1e-6
                ? Math.atan2(proj.vy, proj.vx)
                : Math.atan2(enemy.y - player.y, enemy.x - player.x);
            const loopRadius = RICOCHET_DISC_LOOP_RADIUS;
            const candidate = chooseDiscLoopCandidate(map, proj.x, proj.y, heading, loopRadius);
            proj.loopCenterX = candidate.cx;
            proj.loopCenterY = candidate.cy;
            proj.loopRadius = loopRadius;
            proj.loopAngle = candidate.startAngle;
            proj.loopProgress = 0;
            proj.loopDir = candidate.dir;
            proj.loopTargetEnemyId = enemy.id;
            proj.loopExitAngle = heading;
            proj.vx = Math.cos(heading) * spd;
            proj.vy = Math.sin(heading) * spd;
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

  return bits;
}
