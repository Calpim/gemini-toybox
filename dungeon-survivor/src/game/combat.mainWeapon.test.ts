import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tileCenterWorld } from '../core/dungeon';
import { mustAt, mustDefined } from '../testUtils';
import {
  createGameState,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getSeekerDronePositions,
  stepGame,
  upgradeSkillNode,
} from './engine';
import { createEquippedItem, MAX_TARGET_RANGE } from './equipment';
import { MAX_SKILL_LEVEL } from './skillTree';

describe('Player main weapon combat simulation', () => {
  it('[APP-CMB-01 & APP-CMB-03] auto-fires intrinsic base attack, caps range at MAX_TARGET_RANGE (180px), and blocks through walls', () => {
    expect(MAX_TARGET_RANGE).toBe(180);

    const state = createGameState({ seed: 303 });
    state.pickups = [];
    state.chests = [];
    expect(state.player.equipment).toEqual([]);

    // Carve a wide horizontal open corridor around player so wall check doesn't interfere
    const ptx = Math.floor(state.player.x / TILE_SIZE);
    const pty = Math.floor(state.player.y / TILE_SIZE);
    for (let dx = -1; dx <= 6; dx++) {
      const tx = ptx + dx;
      if (tx > 0 && tx < state.map.width - 1) {
        state.map.tiles[pty * state.map.width + tx] = 'floor';
      }
    }
    state.player.x = tileCenterWorld(ptx, pty).x;
    state.player.y = tileCenterWorld(ptx, pty).y;

    state.enemies = [
      {
        id: 500,
        x: state.player.x + 80,
        y: state.player.y,
        radius: 13,
        speed: 0,
        hp: 40,
        maxHp: 40,
        damage: 10,
        aggroRange: MAX_TARGET_RANGE,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.some((p) => p.kind === 'base')).toBe(true);

    // Enemy beyond MAX_TARGET_RANGE (180px) is not targeted even with def_sensor Lv5
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.skillLevels = { def_sensor: MAX_SKILL_LEVEL };
    state.player.equipment = [createEquippedItem('seeker_drone')];
    mustAt(state.enemies, 0, 'state.enemies').x = state.player.x + MAX_TARGET_RANGE + 15;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(0);

    // Wall occlusion blocks targeting inside range
    mustAt(state.enemies, 0, 'state.enemies').x = state.player.x + 80;
    const wallTx = Math.floor((state.player.x + 40) / TILE_SIZE);
    const wallTy = Math.floor(state.player.y / TILE_SIZE);
    state.map.tiles[wallTy * state.map.width + wallTx] = 'wall';
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    mustAt(state.player.equipment, 0, 'state.player.equipment').cooldown = 0;

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(0);
  });

  it('[APP-CMB-06] scales player Main Weapon (Core Shot) via arms skills only, NOT by player.level or non-arms SP, and keeps sub-equipment free from arms multipliers', () => {
    const state = createGameState({ seed: 460 });
    state.chests = [];
    state.pickups = [];
    expect(state.player.equipment).toEqual([]);

    const initialStats = getPlayerBaseAttackStats(state.player);
    expect(initialStats).toMatchObject({
      weaponId: 'core_shot',
      damage: 14,
      shotCount: 1,
      range: MAX_TARGET_RANGE,
      pierce: false,
      spentSp: 0,
    });

    // Raising player.level alone without spending SP does NOT alter Core Shot
    state.player.level = 5;
    expect(getPlayerBaseAttackStats(state.player)).toEqual(initialStats);

    // Spending SP in defense/mobility (e.g. mob_magnet Lv2) does NOT inflate Core Shot damage/shots
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true);
    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true);
    expect(state.player.spentSkillPoints).toBe(2);
    expect(getPlayerBaseAttackStats(state.player)).toMatchObject({
      damage: 14,
      shotCount: 1,
      cooldown: initialStats.cooldown,
      pierce: false,
    });

    // Investing in arms branch (arm_base Lv3 + arm_parallel Lv1) strengthens Main Weapon damage & shotCount
    state.player.skillPoints = 4;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true);

    const skilledStats = getPlayerBaseAttackStats(state.player);
    expect(skilledStats.damage).toBeGreaterThan(initialStats.damage);
    expect(skilledStats.range).toBe(MAX_TARGET_RANGE + 60);
    expect(skilledStats.shotCount).toBe(1);
    expect(skilledStats.homingShots).toBe(2);

    // Sub-equipment counts/damage/cooldown stay purely determined by equipment level (not arms skills)
    state.player.equipment = [createEquippedItem('orbit_shield', 1), createEquippedItem('seeker_drone', 1)];
    expect(getOrbitBitPositions(state).length).toBe(1);
    expect(getSeekerDronePositions(state).length).toBe(1);

    // Fires 1 charge shot + 2 homing lasers at arm_parallel Lv1
    state.enemies = [
      {
        id: 910,
        x: state.player.x + 90,
        y: state.player.y,
        radius: 13,
        speed: 0,
        hp: 100,
        maxHp: 100,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.filter((p) => p.kind === 'base')).toHaveLength(1);
    expect(state.projectiles.filter((p) => p.kind === 'base_homing')).toHaveLength(2);
  });

  it('[APP-CMB-03 & APP-CMB-06] supports DEC-19 parallel main shots, homing scatter shots (35% dmg, 220px), 290px LoS-only range, and overclock min CD 0.20s', () => {
    const state = createGameState({ seed: 1919 });
    state.chests = [];
    state.pickups = [];
    state.player.equipment = [];
    state.player.skillLevels = {
      arm_base: 5,
      arm_parallel: 5,
      arm_overclock: 2,
      def_sensor: 5,
    };

    const stats = getPlayerBaseAttackStats(state.player);
    // 14 * (1 + 1.70) * (1 + 0.35) = 14 * 2.7 * 1.35 = 51.03 -> 51
    expect(stats.damage).toBe(51);
    expect(stats.shotCount).toBe(5);
    expect(stats.homingShots).toBe(8);
    expect(stats.homingDamage).toBe(Math.round(51 * 0.35)); // 18
    // min(180, round(180 * 1.55)) + 110 = 180 + 110 = 290
    expect(stats.range).toBe(290);
    // 0.58 * 0.55 = 0.319 >= 0.20
    expect(stats.cooldown).toBeCloseTo(0.319, 4);
    expect(stats.speed).toBe(460 + 200);
    expect(stats.pierce).toBe(true);
    expect(stats.armBaseLevel).toBe(5);
    expect(stats.armOverclockLevel).toBe(2);

    // Clear a large open area around the player so 270px LoS is guaranteed unobstructed
    const pTileX = Math.floor(state.player.x / TILE_SIZE);
    const pTileY = Math.floor(state.player.y / TILE_SIZE);
    const dir = pTileX < state.map.width / 2 ? 1 : -1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let step = -1; step <= 8; step++) {
        const tx = pTileX + dir * step;
        const ty = pTileY + dy;
        if (tx > 0 && tx < state.map.width - 1 && ty > 0 && ty < state.map.height - 1) {
          state.map.tiles[ty * state.map.width + tx] = 'floor';
        }
      }
    }

    // Enemy at 270px (within 290px, beyond MAX_TARGET_RANGE 180px) with LoS
    state.enemies = [
      {
        id: 9901,
        x: state.player.x + dir * 270,
        y: state.player.y,
        radius: 14,
        speed: 0,
        hp: 500,
        maxHp: 500,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);

    const baseProjs = state.projectiles.filter((p) => p.kind === 'base');
    const homingProjs = state.projectiles.filter((p) => p.kind === 'base_homing');
    expect(baseProjs).toHaveLength(5);
    expect(homingProjs).toHaveLength(8);

    // Parallel shots share the exact same velocity vector and are offset perpendicularly
    for (const bp of baseProjs) {
      expect(bp.vx).toBeCloseTo(dir * stats.speed, 3);
      expect(bp.vy).toBeCloseTo(0, 3);
      expect(bp.pierce).toBe(true);
      expect(bp.overclockLevel).toBe(2);
      expect(bp.baseLevel).toBe(5);
    }
    const yCoords = baseProjs.map((p) => p.y).sort((a, b) => a - b);
    expect(mustAt(yCoords, 4, 'yCoords') - mustAt(yCoords, 0, 'yCoords')).toBeCloseTo(40, 1); // 10px * 4 = 40px

    // Homing shots have 35% damage and start in 44px orbit (0.26s) + expand (0.13s)
    expect(homingProjs[0]?.damage).toBe(stats.homingDamage);
    expect(homingProjs[0]?.orbitTimer).toBeCloseTo(0.26 - 1 / 60, 3);
    expect(homingProjs[0]?.expandTimer).toBeCloseTo(0.13, 3);

    // Wall blocks LoS even within 290px (no sniping through walls)
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    const wallTx = pTileX + dir * 2;
    state.map.tiles[pTileY * state.map.width + wallTx] = 'wall';
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.filter((p) => p.kind === 'base')).toHaveLength(0);
  });

  it('[APP-CMB-06 & DEC-22] guarantees minimum 3 shots at arm_overclock Lv1 and 5 shots at Lv2', () => {
    const state = createGameState({ seed: 2023 });
    state.chests = [];
    state.pickups = [];
    state.player.equipment = [];

    // arm_parallel Lv1 gives baseShots=2, but arm_overclock Lv1 raises it to min 3
    state.player.skillLevels = { arm_base: 3, arm_parallel: 1, arm_overclock: 1 };
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(3);

    // arm_parallel Lv5 keeps baseShots=1, so arm_overclock Lv1 upgrades to 3 slim beams
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 1 };
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(3);

    // arm_overclock Lv2 always guarantees at least 5 shots regardless of arm_parallel Lv
    state.player.skillLevels = { arm_base: 3, arm_parallel: 1, arm_overclock: 2 };
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(5);
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 2 };
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(5);
  });

  it('[APP-CMB-06] uses tight 10px laneSpacing for overclock slim beams and scores multi-beam hits on large enemies', () => {
    const state = createGameState({ seed: 2022 });
    state.chests = [];
    state.pickups = [];
    state.player.equipment = [];

    const pTileX = Math.floor(state.player.x / TILE_SIZE);
    const pTileY = Math.floor(state.player.y / TILE_SIZE);
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const tx = pTileX + dx;
        const ty = pTileY + dy;
        if (tx > 0 && tx < state.map.width - 1 && ty > 0 && ty < state.map.height - 1) {
          state.map.tiles[ty * state.map.width + tx] = 'floor';
        }
      }
    }

    state.enemies = [
      {
        id: 9940,
        x: state.player.x + 150,
        y: state.player.y,
        radius: 14,
        speed: 0,
        hp: 5000,
        maxHp: 5000,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];

    // Normal charge shot (arm_overclock = 0): 1 thick charge shot (radius = 9 at arm_base Lv5)
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 0 };
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    const normalProjs = state.projectiles.filter((p) => p.kind === 'base');
    expect(normalProjs).toHaveLength(1);
    expect(normalProjs[0]?.radius).toBeCloseTo(9, 2);

    // Hybrid shots (arm_overclock = 1, arm_base = 5): center charge (radius 9, 100% dmg) + 2 side slim lasers (radius 4.8, 60% dmg) @ 10px spacing -> span = 20px
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 1 };
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    const oc1Stats = getPlayerBaseAttackStats(state.player);
    const sideDmg1 = Math.max(1, Math.round(oc1Stats.damage * 0.6));
    const laserProjs = state.projectiles.filter((p) => p.kind === 'base').sort((a, b) => a.y - b.y);
    expect(laserProjs).toHaveLength(3);
    expect(mustAt(laserProjs, 2, 'laserProjs').y - mustAt(laserProjs, 0, 'laserProjs').y).toBeCloseTo(20, 1);
    expect(laserProjs[0]?.isCenterCharge).toBe(false);
    expect(laserProjs[0]?.radius).toBeCloseTo(4.8, 2);
    expect(laserProjs[0]?.damage).toBe(sideDmg1);
    expect(laserProjs[1]?.isCenterCharge).toBe(true);
    expect(laserProjs[1]?.radius).toBeCloseTo(9, 2);
    expect(laserProjs[1]?.damage).toBe(oc1Stats.damage);
    expect(laserProjs[2]?.isCenterCharge).toBe(false);
    expect(laserProjs[2]?.damage).toBe(sideDmg1);

    // Large enemy (radius 26, e.g. boss/tank) takes center charge (100%) + 4 side lasers (60% each) from arm_overclock Lv2
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 2 };
    const largeEnemy = {
      id: 9941,
      x: state.player.x + 80,
      y: state.player.y,
      radius: 26,
      speed: 0,
      hp: 5000,
      maxHp: 5000,
      damage: 10,
      aggroRange: 0,
      awake: false,
      hitFlash: 0,
      bitHitCooldown: 0,
    };
    state.enemies = [largeEnemy];
    const oc2Stats = getPlayerBaseAttackStats(state.player);
    const expectedHybridDamage = oc2Stats.damage + Math.max(1, Math.round(oc2Stats.damage * 0.6)) * 4;
    for (let i = 0; i < 15; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    const damageTaken = 5000 - largeEnemy.hp;
    expect(damageTaken).toBeGreaterThanOrEqual(expectedHybridDamage);
  });

  it('[APP-CMB-06] scales arm_parallel Lv1-5 homing counts (2,3,4,6,8) while keeping 1 main charge shot until overclock', () => {
    const state = createGameState({ seed: 2025 });
    state.player.skillLevels = { arm_base: 3 };
    const expected = [
      { lv: 1, shots: 1, homing: 2 },
      { lv: 2, shots: 1, homing: 3 },
      { lv: 3, shots: 1, homing: 4 },
      { lv: 4, shots: 1, homing: 6 },
      { lv: 5, shots: 1, homing: 8 },
    ];
    for (const row of expected) {
      state.player.skillLevels = { arm_base: 3, arm_parallel: row.lv };
      const stats = getPlayerBaseAttackStats(state.player);
      expect(stats.shotCount).toBe(row.shots);
      expect(stats.homingShots).toBe(row.homing);
    }
  });

  it('[APP-CMB-06] moves base_homing in 3 phases: 0.26s orbit (44px) -> 0.13s expand (84px) -> fast homing dash with trail', () => {
    const state = createGameState({ seed: 2021 });
    state.chests = [];
    state.pickups = [];
    state.player.equipment = [];
    state.player.skillLevels = { arm_base: 3, arm_parallel: 2 };

    // Carve an open 15x15 floor around the player so walls never interfere
    const pTileX = Math.floor(state.player.x / TILE_SIZE);
    const pTileY = Math.floor(state.player.y / TILE_SIZE);
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const tx = pTileX + dx;
        const ty = pTileY + dy;
        if (tx > 0 && tx < state.map.width - 1 && ty > 0 && ty < state.map.height - 1) {
          state.map.tiles[ty * state.map.width + tx] = 'floor';
        }
      }
    }

    // 1. Enemy at 235px (within arm_base 3 range 240px, but >220px from player).
    // After Phase 1 (0.26s @ 44px) + Phase 2 (0.13s -> 84px), projectile is at ~84px from player
    // and ~151px from the enemy (<=220px), so Phase 3 dashes fast from projectile's own position.
    state.enemies = [
      {
        id: 9951,
        x: state.player.x + 235,
        y: state.player.y,
        radius: 14,
        speed: 0,
        hp: 1000,
        maxHp: 1000,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    let homing = mustDefined(
      state.projectiles.find((p) => p.kind === 'base_homing'),
      'homing',
    );
    expect(Math.hypot(homing.x - state.player.x, homing.y - state.player.y)).toBeCloseTo(44, 1);
    expect(homing.trail?.length).toBeGreaterThanOrEqual(2);

    // Phase 1: Step through part of the 0.26s orbit (8 frames = ~0.133s)
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = mustDefined(
      state.projectiles.find((p) => p.kind === 'base_homing'),
      'homing (phase 1)',
    );
    expect(homing.orbitTimer).toBeGreaterThan(0);
    expect(homing.expandTimer).toBeCloseTo(0.13, 3);
    expect(Math.hypot(homing.x - state.player.x, homing.y - state.player.y)).toBeCloseTo(44, 1);

    // Finish Phase 1 (8 more frames -> total 17 frames = 0.283s > 0.26s), enter Phase 2 (expand)
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = mustDefined(
      state.projectiles.find((p) => p.kind === 'base_homing'),
      'homing (phase 2)',
    );
    expect(homing.orbitTimer).toBe(0);
    expect(homing.expandTimer).toBeGreaterThan(0);

    // Finish Phase 2 (8 more frames -> 0.133s > 0.13s) -> expands to ~84px and enters fast Phase 3 dash
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = mustDefined(
      state.projectiles.find((p) => p.kind === 'base_homing'),
      'homing (phase 3)',
    );
    expect(homing.orbitTimer).toBe(0);
    expect(homing.expandTimer).toBe(0);
    const distAfterExpand = Math.hypot(homing.x - state.player.x, homing.y - state.player.y);
    expect(distAfterExpand).toBeGreaterThanOrEqual(80);
    expect(distAfterExpand).toBeLessThanOrEqual(115);
    // Velocity should accelerate sharply to dash speed (>= 540) and point toward enemy
    expect(Math.hypot(homing.vx, homing.vy)).toBeGreaterThanOrEqual(540);
    expect(homing.vx).toBeGreaterThan(0);
    expect(homing.trail?.length).toBeLessThanOrEqual(12);
    expect(homing.trail?.length).toBeGreaterThanOrEqual(6);

    // 2. Close enemy on the 44px orbit ring gets intercepted during Phase 1
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.enemies = [
      {
        id: 9952,
        x: state.player.x + 150,
        y: state.player.y,
        radius: 14,
        speed: 0,
        hp: 1000,
        maxHp: 1000,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
      {
        id: 9953,
        x: state.player.x,
        y: state.player.y + 44,
        radius: 12,
        speed: 0,
        hp: 100,
        maxHp: 100,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    for (let i = 0; i < 12; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    const closeEnemy = mustDefined(
      state.enemies.find((e) => e.id === 9953),
      'closeEnemy',
    );
    expect(closeEnemy.hp).toBeLessThan(100);
  });
});
