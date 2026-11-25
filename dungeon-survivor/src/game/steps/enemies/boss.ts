import { hasLineOfSight, resolveCircleGridCollision } from '../../../core/collision';
import { isWallAtWorld } from '../../../core/dungeon';
import type { createRng } from '../../../core/rng';
import { emitSound, spawnParticles, triggerShake } from '../../effects';
import type { ComputedSkillModifiers } from '../../skillTree';
import type { BossLaserState, EnemyState, GameState, Vec2 } from '../../types';
import { applyPlayerHitDamage, tryTacticalStepEvade } from './playerHit';

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

export function stepBossBehavior(
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

export function stepMortarZones(state: GameState, mods: ComputedSkillModifiers, clampedDt: number): boolean {
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

export function stepBossLasers(state: GameState, mods: ComputedSkillModifiers, clampedDt: number): boolean {
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
