import { hasLineOfSight, resolveCircleGridCollision } from '../../../core/collision';
import {
  type findRoomAtTile,
  isTileInRoom,
  isWallTile,
  TILE_SIZE,
  tileCenterWorld,
  tileIndex,
} from '../../../core/dungeon';
import type { createRng } from '../../../core/rng';
import { emitSound, pushNotification } from '../../effects';
import { MAX_TARGET_RANGE } from '../../equipment';
import { createEnemyByKind } from '../../spawn';
import type { EnemyState, GameState } from '../../types';

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

export interface StepScoutBehaviorParams {
  state: GameState;
  enemy: EnemyState;
  etx: number;
  ety: number;
  ptx: number;
  pty: number;
  distToPlayer: number;
  playerRoom: ReturnType<typeof findRoomAtTile>;
  clampedDt: number;
  rng: ReturnType<typeof createRng>;
  alertSpawns: EnemyState[];
}

export function stepScoutBehavior({
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
}: StepScoutBehaviorParams): void {
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

export function stepNormalEnemyAttack(
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

export function stepTankEnemyAttack(
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

export function stepShooterEnemyAttack(
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
          ...(isPiercing ? { color: '#e879f9' } : {}),
        });
      }
      enemy.bossPatternIndex = (shotIdx + 1) % 16;
      enemy.attackCooldown = Math.max(0.36, 0.48 - (state.floor - 1) * 0.015);
    }
  }
}
