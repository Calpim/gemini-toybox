import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tileCenterWorld } from '../core/dungeon';
import {
  createEnemyByKind,
  createGameState,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getSeekerDronePositions,
  RICOCHET_DISC_LOOP_RADIUS,
  stepGame,
  upgradeSkillNode,
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
import { MAX_SKILL_LEVEL } from './skillTree';

describe('Player main weapon and sub-equipment combat simulation', () => {
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
    state.enemies[0].x = state.player.x + MAX_TARGET_RANGE + 15;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(0);

    // Wall occlusion blocks targeting inside range
    state.enemies[0].x = state.player.x + 80;
    const wallTx = Math.floor((state.player.x + 40) / TILE_SIZE);
    const wallTy = Math.floor(state.player.y / TILE_SIZE);
    state.map.tiles[wallTy * state.map.width + wallTx] = 'wall';
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.equipment[0].cooldown = 0;

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(0);
  });

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
    expect(state.enemies[0].hp).toBeLessThan(200);
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
    state.player.equipment[0].level = MAX_EQUIPMENT_LEVEL;
    state.player.equipment[1].level = MAX_EQUIPMENT_LEVEL;
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
    expect(bladeState.enemies[0].hp).toBeLessThan(300);
    expect(bladeState.enemies[1].hp).toBe(300);

    bladeState.player.equipment[0].level = 10;
    bladeState.player.equipment[0].cooldown = 0;
    stepGame(bladeState, { x: 0, y: 0 }, 1 / 60);
    expect(bladeState.enemies[1].hp).toBe(300); // Still directional fan, never 360° behind
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
    expect(discState.enemies[0].hp).toBeLessThan(100);
    expect(discState.enemies[1].hp).toBeLessThan(100);

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
    const hpAfterFirstHit = soloDiscState.enemies[0].hp;
    expect(hpAfterFirstHit).toBe(182); // 1 hit only (baseDamage 18), entering hit-originated loop
    const soloLoopDisc = soloDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 903);
    expect(soloLoopDisc).toBeDefined();
    expect(soloLoopDisc!.loopRadius).toBe(RICOCHET_DISC_LOOP_RADIUS);
    const fixedLoopCenterX = soloLoopDisc!.loopCenterX!;
    const fixedLoopCenterY = soloLoopDisc!.loopCenterY!;
    expect(fixedLoopCenterX).toBeTypeOf('number');
    expect(fixedLoopCenterY).toBeTypeOf('number');

    // Move enemy while keeping item on cooldown; loop center stays fixed at hit-origin circle
    soloDiscState.player.equipment[0].cooldown = 5;
    soloDiscState.enemies[0].x += 30;
    soloDiscState.enemies[0].y -= 15;
    for (let f = 0; f < 10; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const midLoopDisc = soloDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 903);
    expect(midLoopDisc).toBeDefined();
    expect(midLoopDisc!.loopCenterX).toBe(fixedLoopCenterX);
    expect(midLoopDisc!.loopCenterY).toBe(fixedLoopCenterY);

    // Finish revolution and pursue moved enemy to re-hit
    for (let f = 0; f < 50; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(soloDiscState.enemies[0].hp).toBeLessThan(hpAfterFirstHit);

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
    const bossLoopDisc = bossDiscState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 904);
    expect(bossLoopDisc).toBeDefined();
    const distFromLoopCenter = Math.hypot(
      bossLoopDisc!.x - bossLoopDisc!.loopCenterX!,
      bossLoopDisc!.y - bossLoopDisc!.loopCenterY!,
    );
    expect(distFromLoopCenter).toBeCloseTo(RICOCHET_DISC_LOOP_RADIUS, 1);
    const orbitTangentialSpeed = Math.hypot(bossLoopDisc!.vx, bossLoopDisc!.vy);
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
    const reflected = reflectState.projectiles.find((p) => p.kind === 'reflected');
    expect(reflected).toBeDefined();
    expect(reflected!.vx).toBeGreaterThan(0);
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

  it('expires ricochet_disc after maxDistance, makes tank retreat at close range, and mixes pierceDefense shots in shooter', () => {
    // 1. Disc expires when traveledDist reaches maxDistance
    const distState = createGameState({ seed: 981 });
    distState.chests = [];
    distState.pickups = [];
    distState.enemies = [];
    distState.map.tiles.fill('floor');
    distState.player.baseAttackCooldown = 999;
    distState.projectiles.push({
      id: 9901,
      kind: 'disc',
      x: distState.player.x,
      y: distState.player.y,
      vx: 360,
      vy: 0,
      radius: 7,
      damage: 18,
      life: 3.0,
      pierce: false,
      bouncesLeft: 3,
      wallBouncesLeft: 3,
      speed: 360,
      traveledDist: 0,
      maxDistance: 120,
      hitEnemyIds: [],
      color: '#facc15',
    });
    for (let f = 0; f < 25; f++) {
      stepGame(distState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(distState.projectiles.some((p) => p.id === 9901)).toBe(false);

    // 2. Tank retreats when player is closer than 125px
    const tankState = createGameState({ seed: 982 });
    tankState.chests = [];
    tankState.pickups = [];
    tankState.map.tiles.fill('floor');
    tankState.player.baseAttackCooldown = 999;
    const tank = createEnemyByKind(9902, 'tank', tankState.player.x + 80, tankState.player.y, 2);
    tank.awake = true;
    tank.attackCooldown = 5;
    tankState.enemies = [tank];
    const startTankX = tank.x;
    for (let f = 0; f < 20; f++) {
      stepGame(tankState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(tank.x).toBeGreaterThan(startTankX);

    // 3. Shooter emits pierceDefense shots that bypass pulse_blade reflection and orbit_shield clearing
    const pierceState = createGameState({ seed: 983, startFloor: 2 });
    pierceState.chests = [];
    pierceState.pickups = [];
    pierceState.map.tiles.fill('floor');
    pierceState.player.baseAttackCooldown = 999;
    pierceState.player.equipment = [createEquippedItem('pulse_blade', 3), createEquippedItem('orbit_shield', 4)];
    const shooter = createEnemyByKind(9903, 'shooter', pierceState.player.x + 150, pierceState.player.y, 2);
    shooter.awake = true;
    shooter.attackCooldown = 0.01;
    pierceState.enemies = [shooter];
    stepGame(pierceState, { x: 0, y: 0 }, 0.02);
    const piercingShots = pierceState.enemyProjectiles.filter((ep) => ep.pierceDefense);
    expect(piercingShots.length).toBeGreaterThanOrEqual(1);

    // Move a piercing shot directly onto player's blade & orbit shield radius; it must NOT be reflected or cleared
    const pShot = piercingShots[0];
    pShot.x = pierceState.player.x + 40;
    pShot.y = pierceState.player.y;
    pShot.vx = -50;
    pShot.vy = 0;
    pierceState.player.equipment[0].cooldown = 0;
    stepGame(pierceState, { x: 0, y: 0 }, 0.016);
    expect(pierceState.enemyProjectiles.some((ep) => ep.id === pShot.id)).toBe(true);
    expect(pierceState.projectiles.some((p) => p.kind === 'reflected')).toBe(false);

    // 4. Awakened tank fires mortar in the same room even when a wall blocks LOS, and awakened shooter keeps firing within 380px
    const losBlockedState = createGameState({ seed: 984, startFloor: 2 });
    losBlockedState.chests = [];
    losBlockedState.pickups = [];
    losBlockedState.player.baseAttackCooldown = 999;
    const room = losBlockedState.map.rooms[0];
    const pCenter = tileCenterWorld(room.x + 1, room.y + 1);
    const wallTx = room.x + 2;
    const wallTy = room.y + 1;
    losBlockedState.map.tiles[wallTy * losBlockedState.map.width + wallTx] = 'wall';
    losBlockedState.player.x = pCenter.x;
    losBlockedState.player.y = pCenter.y;

    const eCenter = tileCenterWorld(room.x + 3, room.y + 1);
    const blockedTank = createEnemyByKind(9904, 'tank', eCenter.x, eCenter.y, 2);
    blockedTank.awake = true;
    blockedTank.attackCooldown = 0.01;
    const blockedShooter = createEnemyByKind(9905, 'shooter', eCenter.x, eCenter.y + 40, 2);
    blockedShooter.awake = true;
    blockedShooter.attackCooldown = 0.01;
    losBlockedState.enemies = [blockedTank, blockedShooter];

    stepGame(losBlockedState, { x: 0, y: 0 }, 0.02);
    expect(losBlockedState.mortarZones.length).toBeGreaterThanOrEqual(1);
    expect(losBlockedState.enemyProjectiles.length).toBeGreaterThanOrEqual(4);
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
    expect(yCoords[4] - yCoords[0]).toBeCloseTo(40, 1); // 10px * 4 = 40px

    // Homing shots have 35% damage and start in 44px orbit (0.26s) + expand (0.13s)
    expect(homingProjs[0].damage).toBe(stats.homingDamage);
    expect(homingProjs[0].orbitTimer).toBeCloseTo(0.26 - 1 / 60, 3);
    expect(homingProjs[0].expandTimer).toBeCloseTo(0.13, 3);

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
    expect(normalProjs[0].radius).toBeCloseTo(9, 2);

    // Hybrid shots (arm_overclock = 1, arm_base = 5): center charge (radius 9, 100% dmg) + 2 side slim lasers (radius 4.8, 60% dmg) @ 10px spacing -> span = 20px
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 1 };
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    const oc1Stats = getPlayerBaseAttackStats(state.player);
    const sideDmg1 = Math.max(1, Math.round(oc1Stats.damage * 0.6));
    const laserProjs = state.projectiles.filter((p) => p.kind === 'base').sort((a, b) => a.y - b.y);
    expect(laserProjs).toHaveLength(3);
    expect(laserProjs[2].y - laserProjs[0].y).toBeCloseTo(20, 1);
    expect(laserProjs[0].isCenterCharge).toBe(false);
    expect(laserProjs[0].radius).toBeCloseTo(4.8, 2);
    expect(laserProjs[0].damage).toBe(sideDmg1);
    expect(laserProjs[1].isCenterCharge).toBe(true);
    expect(laserProjs[1].radius).toBeCloseTo(9, 2);
    expect(laserProjs[1].damage).toBe(oc1Stats.damage);
    expect(laserProjs[2].isCenterCharge).toBe(false);
    expect(laserProjs[2].damage).toBe(sideDmg1);

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
    let homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y)).toBeCloseTo(44, 1);
    expect(homing!.trail?.length).toBeGreaterThanOrEqual(2);

    // Phase 1: Step through part of the 0.26s orbit (8 frames = ~0.133s)
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBeGreaterThan(0);
    expect(homing!.expandTimer).toBeCloseTo(0.13, 3);
    expect(Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y)).toBeCloseTo(44, 1);

    // Finish Phase 1 (8 more frames -> total 17 frames = 0.283s > 0.26s), enter Phase 2 (expand)
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBe(0);
    expect(homing!.expandTimer).toBeGreaterThan(0);

    // Finish Phase 2 (8 more frames -> 0.133s > 0.13s) -> expands to ~84px and enters fast Phase 3 dash
    for (let i = 0; i < 8; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBe(0);
    expect(homing!.expandTimer).toBe(0);
    const distAfterExpand = Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y);
    expect(distAfterExpand).toBeGreaterThanOrEqual(80);
    expect(distAfterExpand).toBeLessThanOrEqual(115);
    // Velocity should accelerate sharply to dash speed (>= 540) and point toward enemy
    expect(Math.hypot(homing!.vx, homing!.vy)).toBeGreaterThanOrEqual(540);
    expect(homing!.vx).toBeGreaterThan(0);
    expect(homing!.trail?.length).toBeLessThanOrEqual(12);
    expect(homing!.trail?.length).toBeGreaterThanOrEqual(6);

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
    const closeEnemy = state.enemies.find((e) => e.id === 9953);
    expect(closeEnemy!.hp).toBeLessThan(100);
  });

  it('[BUG-30] skips pierceDefense shots in pulse_blade/orbit_shield and bypasses def_aegis parry for pierceDefense, mortar, and bossLaser', () => {
    // 1. pulse_blade must NOT trigger idle slash FX/sound/CD when only pierceDefense projectiles are in range
    const bladeState = createGameState({ seed: 3001 });
    bladeState.chests = [];
    bladeState.pickups = [];
    bladeState.enemies = [];
    bladeState.map.tiles.fill('floor');
    bladeState.player.baseAttackCooldown = 999;
    bladeState.player.equipment = [createEquippedItem('pulse_blade', 3)];
    bladeState.player.equipment[0].cooldown = 0;
    bladeState.enemyProjectiles = [
      {
        id: 8801,
        x: bladeState.player.x + 36,
        y: bladeState.player.y,
        vx: -20,
        vy: 0,
        radius: 5,
        damage: 10,
        life: 2.0,
        color: '#f472b6',
        pierceDefense: true,
      },
    ];
    bladeState.soundEvents = [];
    bladeState.visualFx = [];
    stepGame(bladeState, { x: 0, y: 0 }, 0.016);
    expect(bladeState.visualFx.some((fx) => fx.kind === 'slash')).toBe(false);
    expect(bladeState.soundEvents.includes('blade')).toBe(false);
    expect(bladeState.player.equipment[0].cooldown).toBe(0);
    expect(bladeState.enemyProjectiles.some((ep) => ep.id === 8801)).toBe(true);

    // 2. orbit_shield clears normal shots on bit contact but leaves pierceDefense shots intact
    const shieldState = createGameState({ seed: 3002 });
    shieldState.chests = [];
    shieldState.pickups = [];
    shieldState.enemies = [];
    shieldState.map.tiles.fill('floor');
    shieldState.player.baseAttackCooldown = 999;
    shieldState.player.equipment = [createEquippedItem('orbit_shield', 1)];
    const bits = getOrbitBitPositions(shieldState);
    expect(bits.length).toBeGreaterThanOrEqual(1);
    shieldState.enemyProjectiles = [
      {
        id: 8802,
        x: bits[0].x,
        y: bits[0].y,
        vx: 0,
        vy: 0,
        radius: 5,
        damage: 10,
        life: 2.0,
        color: '#f472b6',
        pierceDefense: true,
      },
      {
        id: 8803,
        x: bits[0].x,
        y: bits[0].y,
        vx: 0,
        vy: 0,
        radius: 5,
        damage: 10,
        life: 2.0,
        color: '#fb7185',
        pierceDefense: false,
      },
    ];
    stepGame(shieldState, { x: 0, y: 0 }, 0.001);
    expect(shieldState.enemyProjectiles.some((ep) => ep.id === 8802)).toBe(true);
    expect(shieldState.enemyProjectiles.some((ep) => ep.id === 8803)).toBe(false);

    // 3. def_aegis does NOT parry pierceDefense shots, mortarZones, or bossLasers, but DOES parry normal shots
    const makeAegisState = (seed: number) => {
      const s = createGameState({ seed });
      s.chests = [];
      s.pickups = [];
      s.enemies = [];
      s.map.tiles.fill('floor');
      s.player.baseAttackCooldown = 999;
      s.player.invulnTimer = 0;
      s.player.aegisCooldown = 0;
      s.player.skillLevels = {
        def_sensor: 3,
        def_pulse: 3,
        def_aegis: 1,
      };
      return s;
    };

    // 3a. pierceDefense projectile hits player directly without triggering parry
    const pierceParryState = makeAegisState(3003);
    const hpBeforePierce = pierceParryState.player.hp;
    pierceParryState.enemyProjectiles = [
      {
        id: 8804,
        x: pierceParryState.player.x,
        y: pierceParryState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 12,
        life: 1.0,
        color: '#f472b6',
        pierceDefense: true,
      },
    ];
    stepGame(pierceParryState, { x: 0, y: 0 }, 0.016);
    expect(pierceParryState.player.hp).toBe(hpBeforePierce - 12);
    expect(pierceParryState.player.aegisCooldown).toBe(0);
    expect(pierceParryState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(false);

    // 3b. mortarZone impact hits player without triggering parry
    const mortarParryState = makeAegisState(3004);
    const hpBeforeMortar = mortarParryState.player.hp;
    mortarParryState.mortarZones = [
      {
        id: 8805,
        startX: mortarParryState.player.x - 100,
        startY: mortarParryState.player.y,
        targetX: mortarParryState.player.x,
        targetY: mortarParryState.player.y,
        radius: 40,
        damage: 15,
        elapsed: 0.84,
        duration: 0.85,
      },
    ];
    stepGame(mortarParryState, { x: 0, y: 0 }, 0.02);
    expect(mortarParryState.player.hp).toBe(hpBeforeMortar - 15);
    expect(mortarParryState.player.aegisCooldown).toBe(0);
    expect(mortarParryState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(false);

    // 3c. bossLaser hits player without triggering parry
    const laserParryState = makeAegisState(3005);
    const hpBeforeLaser = laserParryState.player.hp;
    laserParryState.bossLasers = [
      {
        id: 8806,
        points: [
          { x: laserParryState.player.x - 50, y: laserParryState.player.y },
          { x: laserParryState.player.x + 50, y: laserParryState.player.y },
        ],
        width: 12,
        damage: 18,
        elapsed: 0.5,
        windup: 0.4,
        duration: 1.0,
        hitPlayer: false,
      },
    ];
    stepGame(laserParryState, { x: 0, y: 0 }, 0.016);
    expect(laserParryState.player.hp).toBe(hpBeforeLaser - 18);
    expect(laserParryState.player.aegisCooldown).toBe(0);
    expect(laserParryState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(false);

    // 3d. normal projectile IS parried by def_aegis
    const normalParryState = makeAegisState(3006);
    const hpBeforeNormal = normalParryState.player.hp;
    normalParryState.enemyProjectiles = [
      {
        id: 8807,
        x: normalParryState.player.x,
        y: normalParryState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 12,
        life: 1.0,
        color: '#fb7185',
        pierceDefense: false,
      },
    ];
    stepGame(normalParryState, { x: 0, y: 0 }, 0.016);
    expect(normalParryState.player.hp).toBe(hpBeforeNormal);
    expect(normalParryState.player.aegisCooldown).toBeGreaterThan(0);
    expect(normalParryState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(true);

    // 4. Priority & mob_dash no-damage evasion across heavy attacks + boss dash parry trade
    // 4a. When both def_aegis and mob_dash are ready against normal shot, def_aegis takes priority and preserves mob_dash charge
    const priorityState = makeAegisState(3007);
    priorityState.player.skillLevels = {
      def_sensor: 3,
      def_pulse: 3,
      def_aegis: 1,
      mob_magnet: 3,
      mob_loot: 3,
      mob_dash: 1,
    };
    priorityState.player.tacticalStepCharges = 1;
    priorityState.enemyProjectiles = [
      {
        id: 8808,
        x: priorityState.player.x,
        y: priorityState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 12,
        life: 1.0,
        pierceDefense: false,
      },
    ];
    stepGame(priorityState, { x: 0, y: 0 }, 0.016);
    expect(priorityState.player.hp).toBe(100);
    expect(priorityState.player.aegisCooldown).toBeGreaterThan(0);
    expect(priorityState.player.tacticalStepCharges).toBe(1);
    expect(priorityState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(true);

    // 4b. mob_dash evades pierceDefense, mortarZones, and bossLasers with zero damage
    const evadeHeavyState = createGameState({ seed: 3008 });
    evadeHeavyState.chests = [];
    evadeHeavyState.pickups = [];
    evadeHeavyState.enemies = [];
    evadeHeavyState.map.tiles.fill('floor');
    evadeHeavyState.player.baseAttackCooldown = 999;
    evadeHeavyState.player.skillLevels = { mob_magnet: 3, mob_loot: 3, mob_dash: 2 };
    evadeHeavyState.player.tacticalStepCharges = 2;
    evadeHeavyState.player.invulnTimer = 0;
    evadeHeavyState.enemyProjectiles = [
      {
        id: 8809,
        x: evadeHeavyState.player.x,
        y: evadeHeavyState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 15,
        life: 1.0,
        pierceDefense: true,
      },
    ];
    stepGame(evadeHeavyState, { x: 0, y: 0 }, 0.016);
    expect(evadeHeavyState.player.hp).toBe(100);
    expect(evadeHeavyState.player.tacticalStepCharges).toBe(1);
    expect(evadeHeavyState.floatingTexts.some((ft) => ft.text === 'EVADE!')).toBe(true);

    evadeHeavyState.player.invulnTimer = 0;
    evadeHeavyState.floatingTexts = [];
    evadeHeavyState.mortarZones = [
      {
        id: 8810,
        startX: evadeHeavyState.player.x - 80,
        startY: evadeHeavyState.player.y,
        targetX: evadeHeavyState.player.x,
        targetY: evadeHeavyState.player.y,
        radius: 40,
        damage: 18,
        elapsed: 0.84,
        duration: 0.85,
      },
    ];
    stepGame(evadeHeavyState, { x: 0, y: 0 }, 0.02);
    expect(evadeHeavyState.player.hp).toBe(100);
    expect(evadeHeavyState.player.tacticalStepCharges).toBe(0);
    expect(evadeHeavyState.floatingTexts.some((ft) => ft.text === 'EVADE!')).toBe(true);

    // 4c. Boss during dashState === 'dashing' bypasses def_aegis damage negation (player takes hit) but still triggers counter damage (trade)
    const bossTradeState = makeAegisState(3009);
    bossTradeState.player.repulsorCooldown = 999;
    const boss = createEnemyByKind(8811, 'tank', bossTradeState.player.x, bossTradeState.player.y, 3);
    boss.isRoomBoss = true;
    boss.dashState = 'dashing';
    boss.dashTimer = 0.2;
    boss.dashDir = { x: 1, y: 0 };
    boss.damage = 20;
    boss.hp = 300;
    boss.maxHp = 300;
    bossTradeState.enemies = [boss];
    stepGame(bossTradeState, { x: 0, y: 0 }, 0.016);
    expect(bossTradeState.player.hp).toBe(80);
    expect(boss.hp).toBe(300 - 22); // Lv1 def_aegis counter damage = 22
    expect(bossTradeState.player.aegisCooldown).toBeGreaterThan(0);
    expect(bossTradeState.floatingTexts.some((ft) => ft.text === 'PARRY!')).toBe(true);
  });
});
