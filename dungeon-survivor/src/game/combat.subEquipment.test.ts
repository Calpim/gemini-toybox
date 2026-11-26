import { describe, expect, it } from 'vitest';
import { mustAt, mustDefined } from '../testUtils';
import {
  createEnemyByKind,
  createGameState,
  getOrbitBitPositions,
  getSeekerDronePositions,
  RICOCHET_DISC_LOOP_RADIUS,
  stepGame,
} from './engine';
import {
  ALL_EQUIPMENT_IDS,
  createEquippedItem,
  getEquipmentCooldownMultiplier,
  getOrbitShieldAngularSpeed,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  MAX_EQUIPMENT_LEVEL,
  MAX_TARGET_RANGE,
  ORBIT_SHIELD_INNER_SLOW,
} from './equipment';

describe('Player sub-equipment combat simulation', () => {
  it('[APP-CMB-02 & APP-CMB-04] excludes auto_turret and runs 5 active equipment categories in parallel', () => {
    expect(ALL_EQUIPMENT_IDS).toEqual([
      'pulse_blade',
      'orbit_shield',
      'seeker_drone',
      'reactive_coil',
      'ricochet_disc',
    ]);
    expect(ALL_EQUIPMENT_IDS).not.toContain('auto_turret');

    const state = createGameState({ seed: 404 });
    state.pickups = [];
    state.chests = [];
    state.player.equipment = [
      createEquippedItem('pulse_blade'),
      createEquippedItem('orbit_shield'),
      createEquippedItem('seeker_drone'),
      createEquippedItem('reactive_coil'),
      createEquippedItem('ricochet_disc'),
    ];
    state.enemies = [
      {
        id: 601,
        x: state.player.x + 55,
        y: state.player.y,
        radius: 13,
        speed: 0,
        hp: 200,
        maxHp: 200,
        damage: 10,
        aggroRange: MAX_TARGET_RANGE,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.enemies[0]?.hp).toBeLessThan(200);
    expect(state.projectiles.some((p) => p.kind === 'drone')).toBe(true);
    expect(state.projectiles.some((p) => p.kind === 'disc')).toBe(true);
    expect(state.visualFx.some((fx) => fx.kind === 'slash')).toBe(true);
    expect(state.visualFx.some((fx) => fx.kind === 'lightning')).toBe(true);
  });

  it('[APP-CMB-05] evolves equipment in two phases (Lv1-6 count/arc max, Lv7-8 power/CD/range), keeps pulse_blade directional, and slows enemies inside orbit_shield', () => {
    // 1. Orbit bit count & seeker drone count cap at Lv6; Lv7-8 boost radius/power/CD
    const state = createGameState({ seed: 450 });
    state.chests = [];
    state.pickups = [];
    state.enemies = [];
    state.player.equipment = [createEquippedItem('orbit_shield', 6), createEquippedItem('seeker_drone', 6)];
    expect(getOrbitBitPositions(state).length).toBe(6);
    expect(getSeekerDronePositions(state).length).toBe(4);
    mustAt(state.player.equipment, 0, 'state.player.equipment').level = MAX_EQUIPMENT_LEVEL;
    mustAt(state.player.equipment, 1, 'state.player.equipment').level = MAX_EQUIPMENT_LEVEL;
    expect(getOrbitBitPositions(state).length).toBe(6);
    expect(getSeekerDronePositions(state).length).toBe(4);
    expect(getOrbitShieldRadius(MAX_EQUIPMENT_LEVEL, 1)).toBeGreaterThan(getOrbitShieldRadius(6, 1));
    expect(getOrbitShieldAngularSpeed(1)).toBeGreaterThan(getOrbitShieldAngularSpeed(6));
    expect(getEquipmentCooldownMultiplier(MAX_EQUIPMENT_LEVEL)).toBeLessThan(getEquipmentCooldownMultiplier(6));

    // 2. Pulse blade stays directional fan (never 360°) even at Lv3 and Lv8
    expect(getPulseBladeStats(MAX_EQUIPMENT_LEVEL, 84, 1).fullCircle).toBe(false);
    const bladeState = createGameState({ seed: 451 });
    bladeState.chests = [];
    bladeState.pickups = [];
    bladeState.player.baseAttackCooldown = 999;
    bladeState.player.equipment = [createEquippedItem('pulse_blade', 1)];
    bladeState.enemies = [
      {
        id: 801,
        x: bladeState.player.x + 45,
        y: bladeState.player.y,
        radius: 13,
        speed: 0,
        hp: 300,
        maxHp: 300,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
      {
        id: 802,
        x: bladeState.player.x - 60,
        y: bladeState.player.y,
        radius: 13,
        speed: 0,
        hp: 300,
        maxHp: 300,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    stepGame(bladeState, { x: 0, y: 0 }, 1 / 60);
    expect(bladeState.enemies[0]?.hp).toBeLessThan(300);
    expect(bladeState.enemies[1]?.hp).toBe(300);

    const bladeEquip = mustAt(bladeState.player.equipment, 0, 'bladeState.player.equipment');
    bladeEquip.level = 10;
    bladeEquip.cooldown = 0;
    stepGame(bladeState, { x: 0, y: 0 }, 1 / 60);
    expect(bladeState.enemies[1]?.hp).toBe(300); // Still directional fan, never 360° behind
    expect(bladeState.visualFx.some((fx) => fx.kind === 'slash' && !fx.fullCircle)).toBe(true);

    // 3. Orbit shield slows enemies inside its ring (nerfed to 0.86x)
    const slowState = createGameState({ seed: 453 });
    slowState.chests = [];
    slowState.pickups = [];
    slowState.player.baseAttackCooldown = 999;
    slowState.player.equipment = [createEquippedItem('orbit_shield', 1)];
    const insideEnemy = createEnemyByKind(850, 'normal', slowState.player.x + 40, slowState.player.y, 1);
    insideEnemy.awake = true;
    const baseSpd = insideEnemy.speed;
    slowState.enemies = [insideEnemy];
    const startEx = insideEnemy.x;
    stepGame(slowState, { x: 0, y: 0 }, 0.05);
    const movedDist = startEx - insideEnemy.x;
    expect(movedDist).toBeCloseTo(baseSpd * ORBIT_SHIELD_INNER_SLOW * 0.05, 1);

    // 4. Reactive coil & single homing ricochet disc cap bounces at Lv6
    expect(getReactiveCoilStats(1, 78, 1).maxTargets).toBe(3);
    expect(getReactiveCoilStats(6, 78, 1).maxTargets).toBe(8);
    expect(getReactiveCoilStats(10, 78, 1).maxTargets).toBe(8);
    expect(getRicochetDiscStats(1)).toMatchObject({ count: 1, maxBounces: 2 });
    expect(getRicochetDiscStats(3)).toMatchObject({ count: 1, maxBounces: 4 });
    expect(getRicochetDiscStats(6)).toMatchObject({ count: 1, maxBounces: 7 });
    expect(getRicochetDiscStats(10)).toMatchObject({ count: 1, maxBounces: 7 });

    // 5. Ricochet disc bounces between two enemies, and against a solo enemy circles 1 loop before re-hitting
    const discState = createGameState({ seed: 452 });
    discState.chests = [];
    discState.pickups = [];
    discState.player.baseAttackCooldown = 999;
    discState.player.equipment = [createEquippedItem('ricochet_disc', 1)];
    discState.enemies = [
      {
        id: 901,
        x: discState.player.x + 40,
        y: discState.player.y,
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
      {
        id: 902,
        x: discState.player.x + 50,
        y: discState.player.y + 45,
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
    for (let f = 0; f < 30; f++) {
      stepGame(discState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(discState.enemies[0]?.hp).toBeLessThan(100);
    expect(discState.enemies[1]?.hp).toBeLessThan(100);

    // Solo enemy: hits once, loops 1 full revolution anchored at hit point (fixed center even if enemy moves), then re-hits
    const soloDiscState = createGameState({ seed: 454 });
    soloDiscState.chests = [];
    soloDiscState.pickups = [];
    soloDiscState.player.baseAttackCooldown = 999;
    soloDiscState.map.tiles.fill('floor');
    soloDiscState.player.equipment = [createEquippedItem('ricochet_disc', 1)];
    soloDiscState.enemies = [
      {
        id: 903,
        x: soloDiscState.player.x + 55,
        y: soloDiscState.player.y,
        radius: 13,
        speed: 0,
        hp: 200,
        maxHp: 200,
        damage: 0,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    for (let f = 0; f < 10; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const hpAfterFirstHit = mustAt(soloDiscState.enemies, 0, 'soloDiscState.enemies').hp;
    expect(hpAfterFirstHit).toBe(182); // 1 hit only (baseDamage 18), entering hit-originated loop
    const soloLoopDisc = mustDefined(
      soloDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 903),
      'soloLoopDisc',
    );
    expect(soloLoopDisc.loopRadius).toBe(RICOCHET_DISC_LOOP_RADIUS);
    const fixedLoopCenterX = mustDefined(soloLoopDisc.loopCenterX, 'soloLoopDisc.loopCenterX');
    const fixedLoopCenterY = mustDefined(soloLoopDisc.loopCenterY, 'soloLoopDisc.loopCenterY');
    expect(fixedLoopCenterX).toBeTypeOf('number');
    expect(fixedLoopCenterY).toBeTypeOf('number');

    // Move enemy while keeping item on cooldown; loop center stays fixed at hit-origin circle
    mustAt(soloDiscState.player.equipment, 0, 'soloDiscState.player.equipment').cooldown = 5;
    const soloEnemy = mustAt(soloDiscState.enemies, 0, 'soloDiscState.enemies');
    soloEnemy.x += 30;
    soloEnemy.y -= 15;
    for (let f = 0; f < 10; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const midLoopDisc = mustDefined(
      soloDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 903),
      'midLoopDisc',
    );
    expect(midLoopDisc.loopCenterX).toBe(fixedLoopCenterX);
    expect(midLoopDisc.loopCenterY).toBe(fixedLoopCenterY);

    // Finish revolution and pursue moved enemy to re-hit
    for (let f = 0; f < 50; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(soloDiscState.enemies[0]?.hp).toBeLessThan(hpAfterFirstHit);

    // Large boss (radius 26): hit-originated loop keeps constant radius and linear speed
    const bossDiscState = createGameState({ seed: 4541 });
    bossDiscState.chests = [];
    bossDiscState.pickups = [];
    bossDiscState.player.baseAttackCooldown = 999;
    bossDiscState.map.tiles.fill('floor');
    bossDiscState.player.equipment = [createEquippedItem('ricochet_disc', 1)];
    bossDiscState.enemies = [
      {
        id: 904,
        x: bossDiscState.player.x + 80,
        y: bossDiscState.player.y,
        radius: 26,
        speed: 0,
        hp: 500,
        maxHp: 500,
        damage: 0,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
        isRoomBoss: true,
        isGrandBoss: true,
      },
    ];
    for (let f = 0; f < 15; f++) {
      stepGame(bossDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const bossLoopDisc = mustDefined(
      bossDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 904),
      'bossLoopDisc',
    );
    const distFromLoopCenter = Math.hypot(
      bossLoopDisc.x - mustDefined(bossLoopDisc.loopCenterX, 'bossLoopDisc.loopCenterX'),
      bossLoopDisc.y - mustDefined(bossLoopDisc.loopCenterY, 'bossLoopDisc.loopCenterY'),
    );
    expect(distFromLoopCenter).toBeCloseTo(RICOCHET_DISC_LOOP_RADIUS, 1);
    const orbitTangentialSpeed = Math.hypot(bossLoopDisc.vx, bossLoopDisc.vy);
    expect(orbitTangentialSpeed).toBeLessThan(400);

    // 6. Pulse blade triggers on incoming enemy projectiles even with no enemy in range and reflects them
    const reflectState = createGameState({ seed: 455 });
    reflectState.chests = [];
    reflectState.pickups = [];
    reflectState.enemies = [];
    reflectState.map.tiles.fill('floor');
    reflectState.player.equipment = [createEquippedItem('pulse_blade', 1)];
    reflectState.enemyProjectiles = [
      {
        id: 951,
        x: reflectState.player.x + 48,
        y: reflectState.player.y,
        vx: -140,
        vy: 0,
        radius: 5,
        damage: 10,
        life: 2.0,
      },
    ];
    stepGame(reflectState, { x: 0, y: 0 }, 1 / 60);
    expect(reflectState.enemyProjectiles.length).toBe(0);
    const reflected = mustDefined(
      reflectState.projectiles.find((p) => p.kind === 'reflected'),
      'reflected',
    );
    expect(reflected.vx).toBeGreaterThan(0);
  });
});
