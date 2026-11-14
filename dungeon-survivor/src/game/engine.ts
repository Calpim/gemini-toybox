import { hasLineOfSight, resolveCircleGridCollision } from '../core/collision';
import { TILE_SIZE, generateDungeon, isWallAtWorld, tileCenterWorld, type DungeonMap } from '../core/dungeon';
import { createRng } from '../core/rng';
import {
  ALL_EQUIPMENT_IDS,
  EQUIPMENT_CATALOG,
  MAX_EQUIP_SLOTS,
  createEquippedItem,
  getEquipmentDamage,
  type EquipmentId,
  type EquippedItem,
} from './equipment';
import {
  canUnlockSkill,
  computeSkillModifiers,
  getSkillNode,
  type SkillNodeId,
} from './skillTree';
import type { ChestState, EnemyState, GameState, PickupState, Vec2 } from './types';

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
        aggroRange: 280,
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
      baseSpeed: 175,
      hp: 100,
      maxHp: 100,
      autoRegenPerSec: 0,
      level: 1,
      exp: 0,
      expToNext: 25,
      skillPoints: 0,
      unlockedSkills: [],
      equipment: [createEquippedItem('seeker_drone', 1), createEquippedItem('orbit_shield', 1)],
      invulnTimer: 0,
      facingAngle: 0,
      orbitAngle: 0,
      orbitRadius: 64,
      repulsorCooldown: 0,
      aegisCooldown: 0,
      tacticalStepCooldown: 0,
    },
    enemies: populated.enemies,
    projectiles: [],
    enemyProjectiles: [],
    turrets: [],
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

  const mods = computeSkillModifiers(new Set(state.player.unlockedSkills));
  const populated = populateFloor(state.map, state.floor, state.seed, state.nextEntityId, mods.lootBonusRate);
  state.enemies = populated.enemies;
  state.pickups = populated.pickups;
  state.chests = populated.chests;
  state.projectiles = [];
  state.enemyProjectiles = [];
  state.turrets = [];
  state.floatingTexts = [];
  state.visualFx = [];
  state.nextEntityId = populated.nextId;
  state.floorBannerTimer = 2.2;
}

export function unlockSkillNode(state: GameState, nodeId: SkillNodeId): boolean {
  const unlocked = new Set(state.player.unlockedSkills);
  if (!canUnlockSkill(unlocked, state.player.skillPoints, nodeId)) {
    return false;
  }
  state.player.skillPoints -= 1;
  state.player.unlockedSkills.push(nodeId);
  const node = getSkillNode(nodeId);
  state.floatingTexts.push({
    x: state.player.x,
    y: state.player.y - 24,
    text: `SKILL: ${node.name}`,
    color: '#a7f3d0',
    life: 1.0,
    maxLife: 1.0,
  });
  return true;
}

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
  if (equipment.length < MAX_EQUIP_SLOTS) {
    equipment.push(droppedItem);
    const def = EQUIPMENT_CATALOG[droppedItem.id];
    state.floatingTexts.push({
      x: state.player.x,
      y: state.player.y - 26,
      text: `+GEAR: ${def.name}`,
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
      text: `EQUIPPED: ${def.name}`,
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
  const orbitItems = player.equipment.filter((e) => e.id === 'orbit_shield');
  if (orbitItems.length === 0) return [];

  const mods = computeSkillModifiers(new Set(player.unlockedSkills));
  const totalLevelBonus = orbitItems.reduce((acc, item) => acc + Math.floor((item.level - 1) / 2), 0);
  const count = orbitItems.length + mods.extraBits + totalLevelBonus;

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
  const drones = player.equipment.filter((e) => e.id === 'seeker_drone');
  if (drones.length === 0) return [];

  const mods = computeSkillModifiers(new Set(player.unlockedSkills));
  const count = drones.length + mods.extraBits;
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

function pickChestEquipmentId(state: GameState, chestId: number): EquipmentId {
  const rng = createRng((state.seed ^ (state.floor * 4999) ^ (chestId * 3571)) >>> 0);
  const owned = new Set(state.player.equipment.map((e) => e.id));
  const unowned = ALL_EQUIPMENT_IDS.filter((id) => !owned.has(id));
  if (unowned.length > 0 && state.player.equipment.length < MAX_EQUIP_SLOTS) {
    return rng.pick(unowned);
  }
  return rng.pick(ALL_EQUIPMENT_IDS);
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
  state: GameState
): EnemyState | null {
  let bestEnemy: EnemyState | null = null;
  let bestDist = range;
  for (const enemy of state.enemies) {
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
  damage: number
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
  for (let hop = 0; hop < 2; hop++) {
    let nextTarget: EnemyState | null = null;
    let nextDist = 115;
    for (const candidate of state.enemies) {
      if (hitIds.has(candidate.id) || candidate.hp <= 0) continue;
      const d = Math.hypot(candidate.x - curr.x, candidate.y - curr.y);
      if (d <= nextDist && hasLineOfSight(curr.x, curr.y, candidate.x, candidate.y, state.map)) {
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

/**
 * Advances the simulation by dt seconds.
 * Pure domain update: decoupled from DOM/Canvas for deterministic Vitest verification.
 */
export function stepGame(state: GameState, rawInput: Vec2, dt: number): void {
  if (state.status !== 'playing' || dt <= 0) return;

  const clampedDt = Math.min(dt, 0.05);
  const { player, map } = state;
  const mods = computeSkillModifiers(new Set(player.unlockedSkills));

  if (state.floorBannerTimer > 0) {
    state.floorBannerTimer = Math.max(0, state.floorBannerTimer - clampedDt);
  }

  // Note: autoRegenPerSec is 0 (APP-MAP-03)
  if (player.autoRegenPerSec > 0 && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + player.autoRegenPerSec * clampedDt);
  }

  if (player.invulnTimer > 0) player.invulnTimer = Math.max(0, player.invulnTimer - clampedDt);
  if (player.repulsorCooldown > 0) player.repulsorCooldown = Math.max(0, player.repulsorCooldown - clampedDt);
  if (player.aegisCooldown > 0) player.aegisCooldown = Math.max(0, player.aegisCooldown - clampedDt);
  if (player.tacticalStepCooldown > 0) player.tacticalStepCooldown = Math.max(0, player.tacticalStepCooldown - clampedDt);

  // 1. Player movement & smooth wall collision (APP-MAP-02)
  const moveSpeed = player.baseSpeed * mods.moveSpeedMult;
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

  // 3. Chest check -> acquire equipment or trigger 6th-slot choice modal (APP-GRW-03)
  for (const chest of state.chests) {
    if (!chest.opened && Math.hypot(player.x - chest.x, player.y - chest.y) <= player.radius + 16) {
      chest.opened = true;
      state.stats.chestsOpened += 1;
      const eqId = pickChestEquipmentId(state, chest.id);
      acquireEquipment(state, createEquippedItem(eqId, 1));
      if (state.status !== 'playing') return;
    }
  }

  // 4. Skill tree active modules: Repulsor Pulse (def_pulse)
  if (mods.hasRepulsor && player.repulsorCooldown <= 0 && state.enemies.length > 0) {
    const pulseRange = 115 * mods.rangeMult;
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
        damageEnemy(state, e, 10 * mods.damageMult);
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
      player.repulsorCooldown = 3.5 * mods.cooldownMult;
    }
  }

  // 5. Equipment parallel execution (APP-CMB-01, APP-CMB-02)
  player.orbitAngle = (player.orbitAngle + 2.4 * clampedDt) % (Math.PI * 2);
  const seekerDrones = getSeekerDronePositions(state);
  let droneCursor = 0;

  for (const item of player.equipment) {
    const def = EQUIPMENT_CATALOG[item.id];
    item.cooldown = Math.max(0, item.cooldown - clampedDt);

    if (item.id === 'orbit_shield') {
      continue;
    }

    if (item.cooldown > 0) continue;

    const dmg = getEquipmentDamage(item, mods.damageMult);
    const range = def.baseRange * mods.rangeMult;

    if (item.id === 'pulse_blade') {
      const targets = state.enemies.filter(
        (e) =>
          Math.hypot(e.x - player.x, e.y - player.y) <= range &&
          hasLineOfSight(player.x, player.y, e.x, e.y, map)
      );
      if (targets.length > 0) {
        const lead = targets[0];
        const slashAngle = Math.atan2(lead.y - player.y, lead.x - player.x);
        for (const t of targets) {
          damageEnemy(state, t, dmg);
        }
        state.visualFx.push({
          kind: 'slash',
          x: player.x,
          y: player.y,
          radius: range,
          angle: slashAngle,
          color: def.color,
          life: 0.22,
          maxLife: 0.22,
        });
        item.cooldown = def.baseCooldown * mods.cooldownMult;
      }
    } else if (item.id === 'seeker_drone') {
      const target = findNearestVisibleEnemy(player.x, player.y, range, state);
      if (target) {
        const dronesToFire = Math.max(1, Math.min(seekerDrones.length, 1 + mods.extraBits));
        for (let dIdx = 0; dIdx < dronesToFire; dIdx++) {
          const origin = seekerDrones[(droneCursor + dIdx) % Math.max(1, seekerDrones.length)] ?? player;
          const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
          const speed = mods.piercingDrones ? 520 : 430;
          state.projectiles.push({
            id: state.nextEntityId++,
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: mods.piercingDrones ? 6 : 5,
            damage: dmg,
            life: 0.95,
            pierce: mods.piercingDrones,
            hitEnemyIds: [],
            color: mods.piercingDrones ? '#22d3ee' : '#7dd3fc',
          });
        }
        droneCursor++;
        item.cooldown = def.baseCooldown * mods.cooldownMult;
      }
    } else if (item.id === 'auto_turret') {
      state.turrets.push({
        id: state.nextEntityId++,
        x: player.x,
        y: player.y,
        life: 10,
        maxLife: 10,
        fireCooldown: 0.2,
        range: def.baseRange * mods.rangeMult,
        damage: dmg,
      });
      item.cooldown = def.baseCooldown * mods.cooldownMult;
    } else if (item.id === 'reactive_coil') {
      if (triggerChainLightning(state, player.x, player.y, range, dmg)) {
        item.cooldown = def.baseCooldown * mods.cooldownMult;
      }
    }
  }

  // 6. Deployed turrets
  for (let i = state.turrets.length - 1; i >= 0; i--) {
    const turret = state.turrets[i];
    turret.life -= clampedDt;
    if (turret.life <= 0) {
      state.turrets.splice(i, 1);
      continue;
    }
    turret.fireCooldown = Math.max(0, turret.fireCooldown - clampedDt);
    if (turret.fireCooldown <= 0) {
      const target = findNearestVisibleEnemy(turret.x, turret.y, turret.range, state);
      if (target) {
        const angle = Math.atan2(target.y - turret.y, target.x - turret.x);
        state.projectiles.push({
          id: state.nextEntityId++,
          x: turret.x,
          y: turret.y,
          vx: Math.cos(angle) * 440,
          vy: Math.sin(angle) * 440,
          radius: 4.5,
          damage: turret.damage,
          life: 0.85,
          pierce: false,
          hitEnemyIds: [],
          color: '#fbbf24',
        });
        turret.fireCooldown = 0.62 * mods.cooldownMult;
      }
    }
  }

  // 7. Orbit Shield Bits & projectile destruction
  const bits = getOrbitBitPositions(state);
  const orbitItem = player.equipment.find((e) => e.id === 'orbit_shield');
  const orbitDmg = orbitItem ? getEquipmentDamage(orbitItem, mods.damageMult) : 0;

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

  // 8. Player projectiles & wall/enemy collision (APP-CMB-03)
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const proj = state.projectiles[i];
    proj.x += proj.vx * clampedDt;
    proj.y += proj.vy * clampedDt;
    proj.life -= clampedDt;

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

  // 9. Update enemies, orbit bit contact, and player damage / Aegis / Tactical Step
  const rng = createRng((state.seed ^ (state.stats.kills * 7919) ^ (state.floor * 131)) >>> 0);
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
        player.aegisCooldown = 6.0;
        player.invulnTimer = 0.6;
        damageEnemy(state, enemy, 25 * mods.damageMult);
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
        player.tacticalStepCooldown = 6.0;
        player.invulnTimer = 1.0;
        const awayLen = Math.max(1, Math.hypot(player.x - enemy.x, player.y - enemy.y));
        const stepped = resolveCircleGridCollision(
          player.x + ((player.x - enemy.x) / awayLen) * 44,
          player.y + ((player.y - enemy.y) / awayLen) * 44,
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
        triggerChainLightning(
          state,
          player.x,
          player.y,
          EQUIPMENT_CATALOG.reactive_coil.baseRange * mods.rangeMult,
          getEquipmentDamage(coil, mods.damageMult)
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

  // 10. Pickups (magnet scaled by mob_speed)
  const magnetRange = 95 * mods.pickupMagnetMult;
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    const dx = player.x - p.x;
    const dy = player.y - p.y;
    const dist = Math.hypot(dx, dy);

    if (dist < magnetRange && dist > 1e-3) {
      const pull = 300 * clampedDt;
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
