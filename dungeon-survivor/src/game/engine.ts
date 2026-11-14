import { hasLineOfSight, resolveCircleGridCollision } from '../core/collision';
import { TILE_SIZE, generateDungeon, isWallAtWorld, tileCenterWorld, type DungeonMap } from '../core/dungeon';
import { createRng } from '../core/rng';
import type { EnemyState, GameState, PickupState, Vec2 } from './types';

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
  startId: number
): { enemies: EnemyState[]; pickups: PickupState[]; nextId: number } {
  const rng = createRng(seed ^ (floor * 0x517cc1b7));
  const enemies: EnemyState[] = [];
  const pickups: PickupState[] = [];
  let nextId = startId;

  // Keep rooms[0] (start room) safe on entry
  for (let i = 1; i < map.rooms.length; i++) {
    const room = map.rooms[i];
    const isStairsRoom = room.cx === map.stairsTile.tx && room.cy === map.stairsTile.ty;
    const count = rng.int(2, 3 + Math.min(3, Math.floor(floor / 2))) + (isStairsRoom ? 1 : 0);

    for (let k = 0; k < count; k++) {
      const tx = rng.int(room.x + 1, room.x + room.w - 2);
      const ty = rng.int(room.y + 1, room.y + room.h - 2);
      const pos = tileCenterWorld(tx, ty);
      const hp = 26 + (floor - 1) * 8;
      enemies.push({
        id: nextId++,
        x: pos.x,
        y: pos.y,
        radius: 13,
        speed: 78 + Math.min(45, (floor - 1) * 6),
        hp,
        maxHp: hp,
        damage: 10 + (floor - 1) * 2,
        aggroRange: 280,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      });
    }

    // Place an occasional recovery orb in non-start rooms to reward exploration
    if (rng.next() < 0.35) {
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

  return { enemies, pickups, nextId };
}

export function createGameState(options: CreateGameOptions = {}): GameState {
  const seed = options.seed ?? Date.now();
  const floor = options.startFloor ?? 1;
  const map = generateDungeon({ floor, seed });
  const startPos = tileCenterWorld(map.startTile.tx, map.startTile.ty);
  const explored = new Uint8Array(map.width * map.height);
  revealAroundPlayer(map, explored, startPos.x, startPos.y);

  const populated = populateFloor(map, floor, seed, 1);

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
      speed: 175,
      hp: 100,
      maxHp: 100,
      autoRegenPerSec: 0,
      level: 1,
      exp: 0,
      expToNext: 30,
      skillPoints: 0,
      invulnTimer: 0,
      facingAngle: 0,
      blasterCooldown: 0,
      blasterRange: 270,
      blasterDamage: 14,
      orbitAngle: 0,
      orbitRadius: 54,
      orbitCount: 1,
      orbitDamage: 12,
    },
    enemies: populated.enemies,
    projectiles: [],
    pickups: populated.pickups,
    floatingTexts: [],
    nextEntityId: populated.nextId,
    floorBannerTimer: 2.2,
    stats: {
      kills: 0,
      floorsCleared: 0,
      totalExp: 0,
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

  const populated = populateFloor(state.map, state.floor, state.seed, state.nextEntityId);
  state.enemies = populated.enemies;
  state.pickups = populated.pickups;
  state.projectiles = [];
  state.floatingTexts = [];
  state.nextEntityId = populated.nextId;
  state.floorBannerTimer = 2.2;
}

export function getOrbitBitPositions(state: GameState): Vec2[] {
  const { player } = state;
  const positions: Vec2[] = [];
  for (let i = 0; i < player.orbitCount; i++) {
    const a = player.orbitAngle + (i * Math.PI * 2) / player.orbitCount;
    positions.push({
      x: player.x + Math.cos(a) * player.orbitRadius,
      y: player.y + Math.sin(a) * player.orbitRadius,
    });
  }
  return positions;
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

/**
 * Advances the simulation by dt seconds.
 * Pure domain update: decoupled from DOM/Canvas for deterministic Vitest verification.
 */
export function stepGame(state: GameState, rawInput: Vec2, dt: number): void {
  if (state.status !== 'playing' || dt <= 0) return;

  const clampedDt = Math.min(dt, 0.05);
  const { player, map } = state;

  if (state.floorBannerTimer > 0) {
    state.floorBannerTimer = Math.max(0, state.floorBannerTimer - clampedDt);
  }

  // Note: autoRegenPerSec is 0 (APP-MAP-03)
  if (player.autoRegenPerSec > 0 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.autoRegenPerSec * clampedDt);
  }

  if (player.invulnTimer > 0) {
    player.invulnTimer = Math.max(0, player.invulnTimer - clampedDt);
  }

  // 1. Player movement & smooth wall collision (APP-MAP-02)
  const inputMag = Math.hypot(rawInput.x, rawInput.y);
  if (inputMag > 1e-4) {
    const scale = inputMag > 1 ? 1 / inputMag : 1;
    const vx = rawInput.x * scale * player.speed;
    const vy = rawInput.y * scale * player.speed;
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

  // 3. Auto-intercept: Pulse Blaster (APP-CMB-01, APP-CMB-03)
  player.blasterCooldown = Math.max(0, player.blasterCooldown - clampedDt);
  if (player.blasterCooldown <= 0 && state.enemies.length > 0) {
    let bestEnemy: EnemyState | null = null;
    let bestDist = player.blasterRange;
    for (const enemy of state.enemies) {
      const d = Math.hypot(enemy.x - player.x, enemy.y - player.y);
      if (d <= bestDist && hasLineOfSight(player.x, player.y, enemy.x, enemy.y, map)) {
        bestDist = d;
        bestEnemy = enemy;
      }
    }
    if (bestEnemy) {
      const angle = Math.atan2(bestEnemy.y - player.y, bestEnemy.x - player.x);
      const speed = 430;
      state.projectiles.push({
        id: state.nextEntityId++,
        x: player.x + Math.cos(angle) * (player.radius + 4),
        y: player.y + Math.sin(angle) * (player.radius + 4),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 5,
        damage: player.blasterDamage,
        life: 0.9,
      });
      player.blasterCooldown = 0.42;
    }
  }

  // 4. Auto-intercept: Orbit Shield Bit
  player.orbitAngle = (player.orbitAngle + 2.7 * clampedDt) % (Math.PI * 2);
  const bits = getOrbitBitPositions(state);

  // 5. Update projectiles & wall/enemy collisions (APP-CMB-03)
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.x += proj.vx * clampedDt;
    proj.y += proj.vy * clampedDt;
    proj.life -= clampedDt;

    if (proj.life <= 0 || isWallAtWorld(map, proj.x, proj.y)) {
      state.projectiles.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const enemy of state.enemies) {
      if (Math.hypot(enemy.x - proj.x, enemy.y - proj.y) <= enemy.radius + proj.radius) {
        damageEnemy(state, enemy, proj.damage);
        hit = true;
        break;
      }
    }
    if (hit) {
      state.projectiles.splice(i, 1);
    }
  }

  // 6. Update enemies, orbit bit hits, separation, and player contact damage
  const rng = createRng((state.seed ^ (state.stats.kills * 7919) ^ (state.floor * 131)) >>> 0);
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const enemy = state.enemies[i];
    if (enemy.hitFlash > 0) enemy.hitFlash = Math.max(0, enemy.hitFlash - clampedDt);
    if (enemy.bitHitCooldown > 0) enemy.bitHitCooldown = Math.max(0, enemy.bitHitCooldown - clampedDt);

    // Check Orbit Bit contact (blocked if wall sits between player & bit)
    if (enemy.bitHitCooldown <= 0) {
      for (const bit of bits) {
        if (
          !isWallAtWorld(map, bit.x, bit.y) &&
          Math.hypot(enemy.x - bit.x, enemy.y - bit.y) <= enemy.radius + 9
        ) {
          damageEnemy(state, enemy, player.orbitDamage);
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
      if (rng.next() < 0.22) {
        state.pickups.push({
          id: state.nextEntityId++,
          kind: 'heal',
          x: enemy.x + 10,
          y: enemy.y + 6,
          value: 25,
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
      let moveX = (dx / distToPlayer) * enemy.speed;
      let moveY = (dy / distToPlayer) * enemy.speed;

      // Soft separation from neighboring enemies so swarms stay readable
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
      player.hp = Math.max(0, player.hp - enemy.damage);
      player.invulnTimer = 0.55;
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

  // 7. Pickups (magnet pull + collect)
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 95 && dist > 1e-3) {
      const pull = 280 * clampedDt;
      p.x += (dx / dist) * Math.min(pull, dist);
      p.y += (dy / dist) * Math.min(pull, dist);
    }

    if (Math.hypot(player.x - p.x, player.y - p.y) <= player.radius + 12) {
      if (p.kind === 'heal') {
        const before = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + p.value);
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
        player.exp += p.value;
        state.stats.totalExp += p.value;
        while (player.exp >= player.expToNext) {
          player.exp -= player.expToNext;
          player.level += 1;
          player.skillPoints += 1;
          player.expToNext = Math.round(player.expToNext * 1.35);
          // Phase 1 baseline stat bump (Phase 2 replaces with interactive Skill Tree spending)
          player.blasterDamage += 2;
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
      state.pickups.splice(i, 1);
    }
  }

  // 8. Floating texts lifetime
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y -= 26 * clampedDt;
    ft.life -= clampedDt;
    if (ft.life <= 0) {
      state.floatingTexts.splice(i, 1);
    }
  }
}
