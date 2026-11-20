import { describe, expect, it } from 'vitest';
import { TILE_SIZE, findRoomAtTile, tileCenterWorld } from '../core/dungeon';
import { computeCameraZoom } from '../render/canvasRenderer';
import {
  ALL_EQUIPMENT_IDS,
  MAX_EQUIPMENT_LEVEL,
  MAX_EQUIP_SLOTS,
  MAX_EQUIP_SLOTS_CAP,
  MAX_TARGET_RANGE,
  ORBIT_SHIELD_INNER_SLOW,
  createEquippedItem,
  getEquipmentCooldownMultiplier,
  getOrbitShieldAngularSpeed,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getScrapExpandCost,
} from './equipment';
import {
  CORRIDOR_VISION_RADIUS,
  SCOUT_ALERT_COOLDOWN,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  SHOOTER_AGGRO_RANGE,
  acquireEquipment,
  advanceToNextFloor,
  createEnemyByKind,
  startGame,
  createGameState,
  formatPlayTime,
  getNormalEnemyShotStats,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getRunnerPackSize,
  getSeekerDronePositions,
  getStairsLockCount,
  isPointInPlayerVision,
  pickEnemyKindForFloor,
  resolveEquipChoice,
  rollDropEquipmentLevel,
  stepGame,
  toggleSkillTree,
  upgradeSkillNode,
} from './engine';
import {
  MAX_SKILL_LEVEL,
  SKILL_PREREQ_LEVEL,
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillUpgradeCost,
} from './skillTree';

describe('Game simulation engine (Phase 1 & Phase 2-A updated)', () => {
  it('[APP-MAP-03] does not regenerate HP over time and heals only on recovery orb pickup', () => {
    const state = createGameState({ seed: 100 });
    state.enemies = [];
    state.pickups = [];
    state.chests = [];
    state.player.hp = 60;
    expect(state.player.autoRegenPerSec).toBe(0);

    for (let i = 0; i < 300; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 30);
    }
    expect(state.player.hp).toBe(60);

    state.pickups.push({
      id: 9999,
      kind: 'heal',
      x: state.player.x,
      y: state.player.y,
      value: 30,
    });
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(90);
  });

  it('[APP-MAP-02] moves with raised baseSpeed (210 px/s) without speed skill', () => {
    const state = createGameState({ seed: 123 });
    state.enemies = [];
    state.pickups = [];
    state.chests = [];
    expect(state.player.baseSpeed).toBe(210);

    const startX = state.player.x;
    stepGame(state, { x: 1, y: 0 }, 0.05);
    expect(state.player.x - startX).toBeCloseTo(210 * 0.05, 1);
  });

  it('[APP-MAP-01 & APP-MAP-08] keeps normal floor stairs unlocked, spawns Guardian mid-boss every 3/6/9F to lock stairs, and drops higher-level gear on defeat', () => {
    // 1F (normal floor) has unlocked stairs without mid-boss
    const normalState = createGameState({ seed: 2026, startFloor: 1 });
    expect(normalState.floor).toBe(1);
    expect(normalState.enemies.some((e) => e.isRoomBoss)).toBe(false);
    expect(getStairsLockCount(normalState)).toBe(0);
    const f1Stairs = tileCenterWorld(normalState.map.stairsTile.tx, normalState.map.stairsTile.ty);
    normalState.player.x = f1Stairs.x;
    normalState.player.y = f1Stairs.y;
    stepGame(normalState, { x: 0, y: 0 }, 1 / 60);
    expect(normalState.floor).toBe(2);
    expect(normalState.stats.floorsCleared).toBe(1);

    // 3F (guardian floor) spawns Guardian mid-boss scaled with player level and locks stairs
    const state = createGameState({ seed: 2026, startFloor: 3 });
    expect(state.floor).toBe(3);
    const guards = state.enemies.filter((e) => e.isStairsGuard);
    const roomBoss = state.enemies.find((e) => e.isRoomBoss && !e.isGrandBoss);
    expect(guards.length).toBeGreaterThanOrEqual(5);
    expect(roomBoss).toBeDefined();
    expect(getStairsLockCount(state)).toBe(1);

    const stairs = tileCenterWorld(state.map.stairsTile.tx, state.map.stairsTile.ty);
    state.player.x = stairs.x;
    state.player.y = stairs.y;

    // Locked while Guardian mid-boss is still alive
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.floor).toBe(3);
    expect(state.notifications.some((n) => n.text.includes('封印'))).toBe(true);

    // Defeating Guardian unlocks stairs AND guarantees a higher-level equip pickup drop
    state.player.equipment = [createEquippedItem('pulse_blade', 3)];
    roomBoss!.hp = 0;
    state.player.x = state.map.rooms[0].cx * TILE_SIZE;
    state.player.y = state.map.rooms[0].cy * TILE_SIZE;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(getStairsLockCount(state)).toBe(0);
    expect(state.notifications.some((n) => n.text.includes('封印が解けた'))).toBe(true);
    const bossDrop = state.pickups.find((p) => p.kind === 'equip');
    expect(bossDrop).toBeDefined();
    expect(bossDrop!.itemLevel).toBeGreaterThanOrEqual(4);

    state.player.x = stairs.x;
    state.player.y = stairs.y;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.floor).toBe(4);
    expect(state.stats.floorsCleared).toBe(1);
  });

  it('[APP-MAP-05] pursues player along shortest corridor path around intervening walls via BFS', () => {
    const state = createGameState({ seed: 150 });
    state.chests = [];
    state.pickups = [];
    state.player.baseAttackCooldown = 999;

    // Carve an isolated arena with an intervening vertical wall at tx=4, ty=3..5 and a top corridor at ty=2
    for (let ty = 1; ty <= 6; ty++) {
      for (let tx = 2; tx <= 6; tx++) {
        const isBorder = ty === 1 || ty === 6 || tx === 2 || tx === 6;
        const isWallBlock = tx === 4 && ty >= 3 && ty <= 5;
        state.map.tiles[ty * state.map.width + tx] = isBorder || isWallBlock ? 'wall' : 'floor';
      }
    }

    const playerStart = tileCenterWorld(3, 3);
    const enemyStart = tileCenterWorld(5, 3);
    state.player.x = playerStart.x;
    state.player.y = playerStart.y;
    state.enemies = [
      {
        id: 550,
        x: enemyStart.x,
        y: enemyStart.y,
        radius: 13,
        speed: 110,
        hp: 100,
        maxHp: 100,
        damage: 0,
        aggroRange: MAX_TARGET_RANGE,
        awake: true,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];

    for (let f = 0; f < 130; f++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }

    const enemy = state.enemies[0];
    // Should have navigated around the wall (past tx=4 wall center) toward the player
    expect(enemy.x).toBeLessThan(4 * TILE_SIZE);
    expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)).toBeLessThan(45);
  });

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
    state.player.equipment = [
      createEquippedItem('orbit_shield', 6),
      createEquippedItem('seeker_drone', 6),
    ];
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

    // Solo enemy: hits once, orbits 1 full loop (~0.6s) without instant burst, then re-hits
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
    for (let f = 0; f < 15; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const hpAfterFirstHit = soloDiscState.enemies[0].hp;
    expect(hpAfterFirstHit).toBe(182); // 1 hit only (baseDamage 18), entering circular orbit
    expect(soloDiscState.projectiles.some((p) => p.kind === 'disc' && p.orbitTargetId === 903)).toBe(
      true
    );

    // Keep item on cooldown so only the orbiting disc can re-hit after completing 1 revolution
    soloDiscState.player.equipment[0].cooldown = 5;
    for (let f = 0; f < 60; f++) {
      stepGame(soloDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(soloDiscState.enemies[0].hp).toBeLessThan(hpAfterFirstHit);

    // Large boss (radius 26): orbit radius scales with enemy radius and maintains constant linear speed (no 11.5 rad/s clamp)
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
    for (let f = 0; f < 20; f++) {
      stepGame(bossDiscState, { x: 0, y: 0 }, 1 / 60);
    }
    const bossOrbitDisc = bossDiscState.projectiles.find(
      (p) => p.kind === 'disc' && p.orbitTargetId === 904
    );
    expect(bossOrbitDisc).toBeDefined();
    const distFromBossCenter = Math.hypot(
      bossOrbitDisc!.x - bossDiscState.enemies[0].x,
      bossOrbitDisc!.y - bossDiscState.enemies[0].y
    );
    // orbitRadius = 26 * 1.8 + 18 = 64.8px (far wider than old 48px)
    expect(distFromBossCenter).toBeCloseTo(64.8, 1);
    const orbitTangentialSpeed = Math.hypot(bossOrbitDisc!.vx, bossOrbitDisc!.vy);
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
    expect(skilledStats.shotCount).toBe(2);
    expect(skilledStats.homingShots).toBe(1);

    // Sub-equipment counts/damage/cooldown stay purely determined by equipment level (not arms skills)
    state.player.equipment = [
      createEquippedItem('orbit_shield', 1),
      createEquippedItem('seeker_drone', 1),
    ];
    expect(getOrbitBitPositions(state).length).toBe(1);
    expect(getSeekerDronePositions(state).length).toBe(1);

    // Fires 2 parallel base shots + 1 homing scatter shot simultaneously at a visible enemy
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
    expect(state.projectiles.filter((p) => p.kind === 'base')).toHaveLength(2);
    expect(state.projectiles.filter((p) => p.kind === 'base_homing')).toHaveLength(1);
  });

  it('[APP-GRW-01, APP-GRW-02 & APP-GRW-05] enforces Tier-based SP costs (Tier1:6, Tier2:8, Tier3:5 = 19SP), Lv4-5 breakthroughs, Lv3+ prereqs (incl. magnet->loot->dash), and level-up notifications', () => {
    expect(MAX_SKILL_LEVEL).toBe(5);
    expect(SKILL_PREREQ_LEVEL).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map((lv) => getSkillUpgradeCost(lv, 'arm_base'))).toEqual([
      1,
      1,
      1,
      1,
      2,
      Infinity,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((lv) => getSkillUpgradeCost(lv, 'arm_parallel'))).toEqual([
      1,
      1,
      1,
      2,
      3,
      Infinity,
    ]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'arm_overclock'))).toEqual([
      2,
      3,
      Infinity,
    ]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'def_aegis'))).toEqual([2, 3, Infinity]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'mob_dash'))).toEqual([2, 3, Infinity]);

    const state = createGameState({ seed: 505 });
    expect(state.player.skillPoints).toBe(3);
    state.enemies = [];
    state.chests = [];
    state.player.equipment = [
      createEquippedItem('orbit_shield'),
      createEquippedItem('seeker_drone'),
    ];
    state.pickups = [
      { id: 700, kind: 'exp', x: state.player.x, y: state.player.y, value: 30 },
    ];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.level).toBe(2);
    expect(state.player.skillPoints).toBe(4);
    expect(state.notifications.some((n) => n.kind === 'levelup' && n.text.includes('Lv2'))).toBe(true);

    // Cannot unlock Tier 2 before Tier 1 reaches Lv3
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv1 (cost 1)
    state.player.skillPoints = 5;
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv2 (cost 1)
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);

    // Reaching Tier 1 Lv3 unlocks Tier 2
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv3 (cost 1)
    expect(state.player.skillLevels.arm_base).toBe(3);
    expect(state.player.skillPoints).toBe(3);

    // Tier 1: Lv4 requires 1 SP, Lv5 requires 2 SP (total 6 SP)
    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv4 (cost 1)
    expect(computeSkillModifiers(state.player.skillLevels).mainDamageMult).toBeCloseTo(2.2, 4);

    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // needs 2 SP for Tier1 Lv5
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv5 (cost 2)
    expect(computeSkillModifiers(state.player.skillLevels).mainDamageMult).toBeCloseTo(2.7, 4);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // capped at Lv5

    // Tier 2 also costs 1 SP up to Lv3, increases Main Weapon shots (not sub-gear bits/drones)
    state.player.skillPoints = 3;
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // Lv1 (cost 1)
    expect(state.player.skillPoints).toBe(2);
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(2);
    expect(getOrbitBitPositions(state).length).toBe(1);
    expect(getSeekerDronePositions(state).length).toBe(1);

    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // Lv2 (cost 1)
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // Lv3 (cost 1)
    expect(state.player.skillPoints).toBe(0);

    // Tier 3 unlocks at Tier 2 Lv3, costs 2 SP for Lv1 and 3 SP for Lv2 (capped at Lv2)
    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(false); // needs 2 SP for Lv1
    state.player.skillPoints = 5;
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true); // Lv1 (cost 2)
    expect(state.player.skillPoints).toBe(3);
    expect(getPlayerBaseAttackStats(state.player).pierce).toBe(true);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true); // Lv2 (cost 3)
    expect(state.player.skillPoints).toBe(0);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(false); // capped at Lv2

    // Mobility branch order: mob_magnet (Tier 1) -> mob_loot (Tier 2) -> mob_dash (Tier 3)
    state.player.skillPoints = 10;
    expect(upgradeSkillNode(state, 'mob_loot')).toBe(false);
    expect(upgradeSkillNode(state, 'mob_dash')).toBe(false);
    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true); // Lv1 (+10% heal)
    state.player.hp = 50;
    state.pickups = [{ id: 701, kind: 'heal', x: state.player.x, y: state.player.y, value: 20 }];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(72);

    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true); // Lv2 (+20% heal)
    state.player.hp = 50;
    state.pickups = [{ id: 702, kind: 'heal', x: state.player.x, y: state.player.y, value: 20 }];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(74);

    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true); // Lv3 -> unlocks mob_loot
    expect(upgradeSkillNode(state, 'mob_dash')).toBe(false);
    expect(upgradeSkillNode(state, 'mob_loot')).toBe(true); // Lv1
    expect(upgradeSkillNode(state, 'mob_loot')).toBe(true); // Lv2
    expect(upgradeSkillNode(state, 'mob_loot')).toBe(true); // Lv3 -> unlocks mob_dash
    expect(upgradeSkillNode(state, 'mob_dash')).toBe(true); // Lv1
  });

  it('[APP-GRW-03 & APP-GRW-04] enforces initial 2-slot limit, auto-levels owned duplicates (including higher-Lv drops), prompts on 3rd unowned gear, and expands via Scrap & Build', () => {
    expect(MAX_EQUIP_SLOTS).toBe(2);

    const state = createGameState({ seed: 606 });
    expect(state.player.maxEquipSlots).toBe(2);
    state.player.equipment = [
      createEquippedItem('pulse_blade'),
      createEquippedItem('seeker_drone'),
    ];
    expect(state.player.equipment.length).toBe(MAX_EQUIP_SLOTS);

    // Duplicate item auto-levels up without opening modal
    acquireEquipment(state, createEquippedItem('seeker_drone', 1));
    expect(state.status).toBe('playing');
    expect(state.pendingEquipDrop).toBeNull();
    expect(state.player.equipment.find((e) => e.id === 'seeker_drone')?.level).toBe(2);

    // Higher-level duplicate drop jumps to droppedItem.level via Math.max(existing + 1, dropped)
    acquireEquipment(state, createEquippedItem('seeker_drone', 5));
    expect(state.player.equipment.find((e) => e.id === 'seeker_drone')?.level).toBe(5);

    // Unowned 3rd item triggers replace/scrap_upgrade/scrap_expand choice modal
    acquireEquipment(state, createEquippedItem('reactive_coil', 1));
    expect(state.status).toBe('equip_choice');
    expect(state.pendingEquipDrop).not.toBeNull();

    // Scrap & Build: upgrade a single selected slot (slot 1) by Lv+1
    expect(resolveEquipChoice(state, { type: 'scrap_upgrade', slotIndex: 1 })).toBe(true);
    expect(state.status).toBe('playing');
    expect(state.player.equipment.map((e) => e.level)).toEqual([1, 6]);

    // Replace slot 0 on next unowned drop (preserving drop level)
    acquireEquipment(state, createEquippedItem('ricochet_disc', 4));
    expect(resolveEquipChoice(state, { type: 'replace', slotIndex: 0 })).toBe(true);
    expect(state.player.equipment[0].id).toBe('ricochet_disc');
    expect(state.player.equipment[0].level).toBe(4);

    // Scrap & Build: progressive 1 / 2 / 3 cost unlocks slots 2->3 (1), 3->4 (2), 4->5 (3)
    expect(getScrapExpandCost(2)).toBe(1);
    expect(getScrapExpandCost(3)).toBe(2);
    expect(getScrapExpandCost(4)).toBe(3);

    acquireEquipment(state, createEquippedItem('pulse_blade', 1));
    expect(state.status).toBe('equip_choice');
    expect(resolveEquipChoice(state, { type: 'scrap_expand' })).toBe(true);
    expect(state.player.scrapExpandProgress).toBe(0);
    expect(state.player.maxEquipSlots).toBe(3);

    // 3rd unowned equipment now equips directly without modal
    acquireEquipment(state, createEquippedItem('pulse_blade', 2));
    expect(state.status).toBe('playing');
    expect(state.player.equipment.length).toBe(3);

    // 3->4 requires 2 scraps
    acquireEquipment(state, createEquippedItem('orbit_shield', 1));
    expect(resolveEquipChoice(state, { type: 'scrap_expand' })).toBe(true);
    expect(state.player.scrapExpandProgress).toBe(1);
    expect(state.player.maxEquipSlots).toBe(3);
    acquireEquipment(state, createEquippedItem('orbit_shield', 1));
    expect(resolveEquipChoice(state, { type: 'scrap_expand' })).toBe(true);
    expect(state.player.scrapExpandProgress).toBe(0);
    expect(state.player.maxEquipSlots).toBe(4);
  });

  it('[APP-GRW-06] starts run with 0 items without Room 0 chest and fights using intrinsic base attack', () => {
    const state = createGameState({ seed: 707 });
    expect(state.player.equipment).toEqual([]);

    const startRoom = state.map.rooms[0];
    const minX = startRoom.x * 40;
    const maxX = (startRoom.x + startRoom.w) * 40;
    const minY = startRoom.y * 40;
    const maxY = (startRoom.y + startRoom.h) * 40;

    const chestInStartRoom = state.chests.find(
      (c) => c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY
    );
    expect(chestInStartRoom).toBeUndefined();
    expect(state.chests.length).toBeGreaterThanOrEqual(1);

    // Even with 0 equipment, player defeats an approaching enemy using intrinsic Core Shot
    state.enemies = [
      {
        id: 777,
        x: state.player.x + 80,
        y: state.player.y,
        radius: 13,
        speed: 0,
        hp: 20,
        maxHp: 20,
        damage: 10,
        aggroRange: 0,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];
    for (let i = 0; i < 60; i++) {
      stepGame(state, { x: 0, y: 0 }, 0.02);
    }
    expect(state.stats.kills).toBe(1);
  });

  it('[APP-GRW-07] scales drop levels around lowest equipped level, drops rarely from enemies (~1.5%), and equips ground drops on direct pickup', () => {
    expect(rollDropEquipmentLevel([], () => 0.99)).toBe(1);

    // Lowest level is 2 (not average 5)
    const minLv2 = [
      createEquippedItem('pulse_blade', 2),
      createEquippedItem('orbit_shield', 6),
      createEquippedItem('seeker_drone', 8),
    ];
    expect(rollDropEquipmentLevel(minLv2, () => 0.1)).toBe(1);
    expect(rollDropEquipmentLevel(minLv2, () => 0.4)).toBe(2);
    expect(rollDropEquipmentLevel(minLv2, () => 0.8)).toBe(3);
    expect(rollDropEquipmentLevel(minLv2, () => 0.95)).toBe(4);

    // Enemy drop rate is low (~1.5% base) across many kills
    const dropSim = createGameState({ seed: 809 });
    dropSim.chests = [];
    dropSim.pickups = [];
    for (let k = 0; k < 500; k++) {
      dropSim.enemies = [
        {
          id: 2000 + k,
          x: dropSim.player.x + 120,
          y: dropSim.player.y,
          radius: 13,
          speed: 0,
          hp: 0,
          maxHp: 26,
          damage: 0,
          aggroRange: 0,
          awake: false,
          hitFlash: 0,
          bitHitCooldown: 0,
        },
      ];
      stepGame(dropSim, { x: 0, y: 0 }, 1 / 60);
    }
    const equipDropCount = dropSim.pickups.filter((p) => p.kind === 'equip').length;
    expect(equipDropCount).toBeGreaterThanOrEqual(1);
    expect(equipDropCount).toBeLessThan(18);

    const state = createGameState({ seed: 808 });
    state.enemies = [];
    state.chests = [];
    state.pickups = [
      {
        id: 950,
        kind: 'equip',
        x: state.player.x + 55,
        y: state.player.y,
        value: 1,
        equipmentId: 'ricochet_disc',
        itemLevel: 4,
      },
    ];

    // Equip pickup is NOT magnetized from afar
    stepGame(state, { x: 0, y: 0 }, 0.05);
    expect(state.pickups.length).toBe(1);
    expect(state.player.equipment.length).toBe(0);

    // Direct contact equips the dropped item at its rolled level
    state.pickups[0].x = state.player.x;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.pickups.length).toBe(0);
    expect(state.player.equipment).toHaveLength(1);
    expect(state.player.equipment[0]).toMatchObject({ id: 'ricochet_disc', level: 4 });
  });

  it('[APP-MAP-04] respawns reinforcements away from player on long floor stays and scales tricky enemy types by floor', () => {
    // 1F has only normal/runner/tank; 2F+ introduces shooter and caller with rising rates
    const f1Kinds = new Set([0, 0.2, 0.5, 0.7, 0.9].map((r) => pickEnemyKindForFloor(1, r)));
    expect(f1Kinds.has('shooter')).toBe(false);
    expect(f1Kinds.has('scout')).toBe(false);

    const f4Kinds = [0.02, 0.16, 0.22, 0.5, 0.95].map((r) => pickEnemyKindForFloor(4, r));
    expect(f4Kinds).toContain('shooter');
    expect(f4Kinds).toContain('scout');

    const state = createGameState({ seed: 910, startFloor: 2 });
    state.enemies = [];
    state.respawnTimer = 0.01;
    stepGame(state, { x: 0, y: 0 }, 0.02);

    expect(state.enemies.length).toBeGreaterThanOrEqual(1);
    for (const spawned of state.enemies) {
      expect(Math.hypot(spawned.x - state.player.x, spawned.y - state.player.y)).toBeGreaterThanOrEqual(260);
      // Corridor respawn suppressed: must spawn inside a room tile
      const r = findRoomAtTile(
        state.map,
        Math.floor(spawned.x / TILE_SIZE),
        Math.floor(spawned.y / TILE_SIZE)
      );
      expect(r).not.toBeNull();
    }
    expect(state.notifications.some((n) => n.kind === 'info')).toBe(true);

    // 1F must never spawn scouts during initial population or timed respawns
    const f1State = createGameState({ seed: 911, startFloor: 1 });
    expect(f1State.enemies.some((e) => e.kind === 'scout')).toBe(false);
    f1State.enemies = [];
    for (let t = 0; t < 15; t++) {
      f1State.respawnTimer = 0.01;
      stepGame(f1State, { x: 0, y: 0 }, 0.02);
    }
    expect(f1State.enemies.length).toBeGreaterThanOrEqual(1);
    expect(f1State.enemies.some((e) => e.kind === 'scout')).toBe(false);
  });

  it('[APP-MAP-06] scales camera zoom by viewport width (including zoomed-out mobile) and switches between room illumination and corridor circular vision', () => {
    // Smartphone zooms out to 0.72x so surrounding area stays readable; PC scales cleanly around 840px target
    expect(computeCameraZoom(390, 844)).toBeCloseTo(0.72, 2);
    expect(computeCameraZoom(1280, 720)).toBeCloseTo(1.5, 2);
    expect(computeCameraZoom(1440, 900)).toBeCloseTo(1440 / 840, 3);

    const state = createGameState({ seed: 920 });
    const room0 = state.map.rooms[0];
    // Corner inside room 0 is visible when player stands in room 0
    const roomCorner = tileCenterWorld(room0.x, room0.y);
    expect(isPointInPlayerVision(state.map, state.player.x, state.player.y, roomCorner.x, roomCorner.y)).toBe(true);

    // When in a corridor (isolated non-room floor), vision is limited to CORRIDOR_VISION_RADIUS (210px)
    const testMap = {
      ...state.map,
      rooms: [],
      tiles: new Array(state.map.width * state.map.height).fill('floor' as const),
    };
    expect(
      isPointInPlayerVision(testMap, 200, 200, 200 + CORRIDOR_VISION_RADIUS - 10, 200)
    ).toBe(true);
    expect(
      isPointInPlayerVision(testMap, 200, 200, 200 + CORRIDOR_VISION_RADIUS + 20, 200)
    ).toBe(false);
  });

  it('[APP-MAP-07] prevents overlapping initial enemy spawns and runs tank/runner/shooter (4/6/8-way rotating barrage + knockback immunity)/scout archetypes', () => {
    // Verify no duplicate exact spawn positions across multiple seeds
    for (const seed of [101, 202, 303]) {
      const s = createGameState({ seed, startFloor: 3 });
      const coords = new Set(s.enemies.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`));
      expect(coords.size).toBe(s.enemies.length);
    }

    // Stat comparison across tank / runner / normal
    const tank = createEnemyByKind(1, 'tank', 0, 0, 2);
    const runner = createEnemyByKind(2, 'runner', 0, 0, 2);
    const normal = createEnemyByKind(3, 'normal', 0, 0, 2);
    expect(tank.hp).toBeGreaterThan(normal.hp * 2);
    expect(tank.speed).toBeLessThan(normal.speed);
    expect(runner.hp).toBeLessThan(normal.hp);
    expect(runner.speed).toBeGreaterThan(normal.speed);

    // Shooter stays stationary (speed 0), immune to player knockback, never pre-arms while dormant, and fires 4/6/8-way rotating barrage
    const shootState = createGameState({ seed: 930, startFloor: 2 });
    shootState.chests = [];
    shootState.pickups = [];
    shootState.player.baseAttackCooldown = 999;
    shootState.map.tiles.fill('floor');

    const dormantTurret = createEnemyByKind(
      9000,
      'shooter',
      shootState.player.x + SHOOTER_AGGRO_RANGE + 70,
      shootState.player.y,
      2
    );
    expect(dormantTurret.aggroRange).toBeGreaterThanOrEqual(SHOOTER_AGGRO_RANGE);
    shootState.enemies = [dormantTurret];
    for (let f = 0; f < 120; f++) {
      stepGame(shootState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(dormantTurret.awake).toBe(false);
    expect(dormantTurret.attackCooldown).toBeCloseTo(1.0, 2);

    // Move turret into expanded aggroRange (280px <= 320px): awakens without firing frame 1
    dormantTurret.x = shootState.player.x + 280;
    stepGame(shootState, { x: 0, y: 0 }, 1 / 60);
    expect(dormantTurret.awake).toBe(true);
    expect(shootState.enemyProjectiles.length).toBe(0);
    expect(dormantTurret.attackCooldown).toBeGreaterThanOrEqual(0.95);

    // Once wind-up finishes (~1.0s), it fires continuous rotating waves while staying stationary
    const turretStartX = dormantTurret.x;
    for (let f = 0; f < 100; f++) {
      stepGame(shootState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(dormantTurret.x).toBe(turretStartX);
    expect(shootState.enemyProjectiles.length).toBeGreaterThanOrEqual(8);

    // Verify per-wave direction count by floor: 1-5F => 4, 6-10F => 6, 11F+ => 8
    for (const [floorNum, expectedDirs] of [
      [2, 4],
      [6, 6],
      [11, 8],
    ] as const) {
      const floorState = createGameState({ seed: 931, startFloor: floorNum });
      floorState.chests = [];
      floorState.pickups = [];
      floorState.player.baseAttackCooldown = 999;
      floorState.map.tiles.fill('floor');
      const turret = createEnemyByKind(9001, 'shooter', floorState.player.x + 160, floorState.player.y, floorNum);
      turret.awake = true;
      turret.attackCooldown = 0.01;
      floorState.enemies = [turret];
      stepGame(floorState, { x: 0, y: 0 }, 1 / 60);
      expect(floorState.enemyProjectiles.length).toBe(expectedDirs);
    }

    // Shooter is immune to Repulsor Pulse knockback (takes damage, stays put)
    shootState.player.skillLevels = { def_pulse: 1 };
    shootState.player.repulsorCooldown = 0;
    dormantTurret.x = shootState.player.x + 60;
    const hpBeforePulse = dormantTurret.hp;
    stepGame(shootState, { x: 0, y: 0 }, 1 / 60);
    expect(dormantTurret.hp).toBeLessThan(hpBeforePulse);
    expect(dormantTurret.x).toBe(shootState.player.x + 60);

    // Entering a room wakes ALL enemies inside that room (while shooters still wait for wind-up)
    const roomWakeState = createGameState({ seed: 932, startFloor: 2 });
    roomWakeState.chests = [];
    roomWakeState.pickups = [];
    roomWakeState.player.baseAttackCooldown = 999;
    const room0 = roomWakeState.map.rooms[0];
    const farCorner = tileCenterWorld(room0.x, room0.y);
    const farNormal = createEnemyByKind(9020, 'normal', farCorner.x, farCorner.y, 2, 0);
    const farTurret = createEnemyByKind(9021, 'shooter', farCorner.x + 40, farCorner.y, 2, 0);
    roomWakeState.enemies = [farNormal, farTurret];
    stepGame(roomWakeState, { x: 0, y: 0 }, 1 / 60);
    expect(farNormal.awake).toBe(true);
    expect(farTurret.awake).toBe(true);
    expect(roomWakeState.enemyProjectiles.length).toBe(0);

    // 1F never places patrol scouts; 2F+ places free-roaming patrol scouts in corridors
    const f1PatrolFloor = createGameState({ seed: 933, startFloor: 1 });
    expect(f1PatrolFloor.enemies.some((e) => e.kind === 'scout')).toBe(false);

    const patrolFloor = createGameState({ seed: 933, startFloor: 2 });
    const corridorScouts = patrolFloor.enemies.filter(
      (e) =>
        e.kind === 'scout' &&
        !patrolFloor.map.rooms.some(
          (r) =>
            Math.floor(e.x / 40) >= r.x &&
            Math.floor(e.x / 40) < r.x + r.w &&
            Math.floor(e.y / 40) >= r.y &&
            Math.floor(e.y / 40) < r.y + r.h
        )
    );
    expect(corridorScouts.length).toBeGreaterThanOrEqual(1);

    // Scout wanders while unawakened, does NOT wake nearby allies, and summons fast ambush runners up to per-scout cap
    const scoutState = createGameState({ seed: 931, startFloor: 2 });
    scoutState.chests = [];
    scoutState.pickups = [];
    scoutState.player.baseAttackCooldown = 999;
    scoutState.map.tiles.fill('floor');

    const wanderScout = createEnemyByKind(9010, 'scout', scoutState.player.x + 400, scoutState.player.y, 2);
    const wanderStart = { x: wanderScout.x, y: wanderScout.y };
    scoutState.enemies = [wanderScout];
    for (let f = 0; f < 30; f++) {
      stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(Math.hypot(wanderScout.x - wanderStart.x, wanderScout.y - wanderStart.y)).toBeGreaterThan(5);

    const spotScout = createEnemyByKind(9011, 'scout', scoutState.player.x + 100, scoutState.player.y, 2);
    const nearbyAlly = createEnemyByKind(
      9012,
      'normal',
      spotScout.x + 180,
      spotScout.y,
      2
    );
    scoutState.enemies = [spotScout, nearbyAlly];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(spotScout.awake).toBe(true);
    expect(nearbyAlly.awake).toBe(false);
    const ambushRunners = scoutState.enemies.filter((e) => e.kind === 'runner' && e.awake);
    expect(ambushRunners.length).toBeGreaterThanOrEqual(2);
    expect(ambushRunners.every((e) => e.isAmbush === true)).toBe(true);
    expect(ambushRunners.every((e) => e.summonerId === spotScout.id)).toBe(true);
    expect(ambushRunners.every((e) => e.speed > scoutState.player.baseSpeed)).toBe(true);
    expect(ambushRunners.every((e) => (e.spawnDelay ?? 0) > 0.3)).toBe(true);
    expect(scoutState.notifications.some((n) => n.kind === 'alert' && n.text.includes('スカウト'))).toBe(true);

    // Per-scout summon cap prevents infinite runner stacking while allowing a second scout its own quota
    spotScout.alertCooldown = 0;
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    const afterSecondAlert = scoutState.enemies.filter((e) => e.isAmbush && e.summonerId === spotScout.id);
    expect(afterSecondAlert.length).toBeLessThanOrEqual(SCOUT_SUMMON_CAP_PER_SCOUT);

    const secondScout = createEnemyByKind(9013, 'scout', scoutState.player.x - 100, scoutState.player.y, 2);
    scoutState.enemies.push(secondScout);
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    const secondScoutRunners = scoutState.enemies.filter((e) => e.isAmbush && e.summonerId === secondScout.id);
    expect(secondScoutRunners.length).toBeGreaterThanOrEqual(2);

    // Stop summoning if player runs beyond SCOUT_SUMMON_MAX_PLAYER_DIST
    const farScout = createEnemyByKind(9014, 'scout', scoutState.player.x + SCOUT_SUMMON_MAX_PLAYER_DIST + 60, scoutState.player.y, 2);
    farScout.awake = true;
    farScout.alertCooldown = 0;
    scoutState.enemies = [farScout];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(scoutState.enemies.some((e) => e.isAmbush && e.summonerId === farScout.id)).toBe(false);

    // Scout kites away faster when awake, strafes in sweet spot (220-280px), and closes in beyond SCOUT_CHASE_DIST
    const kiteScout = createEnemyByKind(9015, 'scout', scoutState.player.x + 120, scoutState.player.y, 2);
    kiteScout.awake = true;
    kiteScout.alertCooldown = 0;
    scoutState.enemies = [kiteScout];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(kiteScout.alertCooldown).toBeCloseTo(SCOUT_ALERT_COOLDOWN, 2);

    const closeDistBefore = Math.hypot(kiteScout.x - scoutState.player.x, kiteScout.y - scoutState.player.y);
    for (let f = 0; f < 20; f++) {
      stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    }
    const closeDistAfter = Math.hypot(kiteScout.x - scoutState.player.x, kiteScout.y - scoutState.player.y);
    expect(closeDistAfter).toBeGreaterThan(closeDistBefore);
    expect(closeDistAfter - closeDistBefore).toBeGreaterThan(25);

    // In sweet spot (between SCOUT_KEEP_DIST and SCOUT_CHASE_DIST), scout strafes tangentially rather than standing still
    kiteScout.x = scoutState.player.x + Math.round((SCOUT_KEEP_DIST + SCOUT_CHASE_DIST) / 2);
    kiteScout.y = scoutState.player.y;
    const strafeStartY = kiteScout.y;
    for (let f = 0; f < 15; f++) {
      stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(Math.abs(kiteScout.y - strafeStartY)).toBeGreaterThan(10);

    kiteScout.x = scoutState.player.x + SCOUT_CHASE_DIST + 80;
    kiteScout.y = scoutState.player.y;
    const farDistBefore = Math.hypot(kiteScout.x - scoutState.player.x, kiteScout.y - scoutState.player.y);
    for (let f = 0; f < 20; f++) {
      stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    }
    const farDistAfter = Math.hypot(kiteScout.x - scoutState.player.x, kiteScout.y - scoutState.player.y);
    expect(farDistAfter).toBeLessThan(farDistBefore);

    // Wild runner pack scaling by floor and scaled-down EXP drop on pack extras
    expect(getRunnerPackSize(1, 0.9)).toBe(1);
    expect(getRunnerPackSize(2, 0.1)).toBe(2);
    expect(getRunnerPackSize(4, 0.1)).toBe(3);
    expect(getRunnerPackSize(6, 0.1)).toBe(4);
    const highFloor = createGameState({ seed: 935, startFloor: 6 });
    expect(highFloor.enemies.some((e) => e.kind === 'runner' && e.isPackFollower === true)).toBe(true);

    const packExtra = createEnemyByKind(9020, 'runner', scoutState.player.x + 80, scoutState.player.y, 6);
    packExtra.isPackFollower = true;
    packExtra.hp = 0;
    scoutState.pickups = [];
    scoutState.enemies = [packExtra];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    const expPickup = scoutState.pickups.find((p) => p.kind === 'exp');
    expect(expPickup?.value).toBe(4);

    // Cornered room scout steers toward a corridor exit instead of getting pinned in the corner
    const cornerState = createGameState({ seed: 932, startFloor: 2 });
    cornerState.chests = [];
    cornerState.pickups = [];
    cornerState.player.baseAttackCooldown = 999;
    cornerState.map.tiles.fill('wall');
    const testRoom = { id: 0, x: 2, y: 2, w: 6, h: 6, cx: 5, cy: 5 };
    cornerState.map.rooms = [testRoom];
    for (let ty = testRoom.y; ty < testRoom.y + testRoom.h; ty++) {
      for (let tx = testRoom.x; tx < testRoom.x + testRoom.w; tx++) {
        cornerState.map.tiles[ty * cornerState.map.width + tx] = 'floor';
      }
    }
    // Corridor exit on the top edge (tx=6, ty=1)
    cornerState.map.tiles[1 * cornerState.map.width + 6] = 'floor';
    cornerState.map.tiles[0 * cornerState.map.width + 6] = 'floor';
    cornerState.player.x = 4 * 40 + 20;
    cornerState.player.y = 4 * 40 + 20;
    const cornerScout = createEnemyByKind(9016, 'scout', 6 * 40 + 20, 3 * 40 + 20, 2);
    cornerScout.awake = true;
    cornerScout.alertCooldown = 99;
    cornerState.enemies = [cornerScout];
    const startY = cornerScout.y;
    for (let f = 0; f < 30; f++) {
      stepGame(cornerState, { x: 0, y: 0 }, 1 / 60);
    }
    expect(cornerScout.y).toBeLessThan(startY);

    // Defeating a scout-spawned ambush runner yields zero EXP/heal/equip drops
    scoutState.pickups = [];
    ambushRunners[0].hp = 0;
    scoutState.enemies = [ambushRunners[0]];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(scoutState.stats.kills).toBeGreaterThanOrEqual(1);
    expect(scoutState.pickups.length).toBe(0);
  });

  it('[APP-GRW-08] enforces MAX_EQUIPMENT_LEVEL=8 cap, auto-expands slots on Lv8 duplicates when maxEquipSlots < 5, and grants overflow bonus at cap', () => {
    expect(MAX_EQUIPMENT_LEVEL).toBe(8);
    const state = createGameState({ seed: 940 });

    // Lv8 duplicate pickup auto-allocates into slot expansion when maxEquipSlots < MAX_EQUIP_SLOTS_CAP
    state.player.maxEquipSlots = 2;
    state.player.scrapExpandProgress = 0;
    state.player.equipment = [
      createEquippedItem('pulse_blade', 8),
      createEquippedItem('orbit_shield', 5),
    ];
    acquireEquipment(state, createEquippedItem('pulse_blade', 8));
    expect(state.player.maxEquipSlots).toBe(3); // cost 2->3 is 1 scrap
    expect(state.player.scrapExpandProgress).toBe(0);
    // Next Lv8 duplicate advances 3->4 progress (cost 2)
    acquireEquipment(state, createEquippedItem('pulse_blade', 8));
    expect(state.player.maxEquipSlots).toBe(3);
    expect(state.player.scrapExpandProgress).toBe(1);

    // Once maxEquipSlots reaches 5, Lv8 duplicate grants +20HP / +25EXP overflow bonus
    state.player.maxEquipSlots = MAX_EQUIP_SLOTS_CAP;
    state.player.equipment = ALL_EQUIPMENT_IDS.map((id) => createEquippedItem(id, 8));
    state.player.hp = 50;
    const expBefore = state.stats.totalExp;
    acquireEquipment(state, createEquippedItem('pulse_blade', 8));
    expect(state.player.equipment[0].level).toBe(8);
    expect(state.player.hp).toBe(70);
    expect(state.stats.totalExp).toBe(expBefore + 25);

    // scrap_upgrade rejects Lv8 slot
    state.player.equipment[0].level = 7;
    acquireEquipment(state, createEquippedItem('pulse_blade', 1));
    expect(state.player.equipment[0].level).toBe(8);

    state.player.maxEquipSlots = 2;
    state.player.equipment = [
      createEquippedItem('pulse_blade', 8),
      createEquippedItem('orbit_shield', 5),
    ];
    acquireEquipment(state, createEquippedItem('seeker_drone', 1));
    expect(state.status).toBe('equip_choice');
    expect(resolveEquipChoice(state, { type: 'scrap_upgrade', slotIndex: 0 })).toBe(false);
    expect(state.status).toBe('equip_choice');
    expect(resolveEquipChoice(state, { type: 'scrap_upgrade', slotIndex: 1 })).toBe(true);
    expect(state.player.equipment[1].level).toBe(6);
  });

  it('[APP-MAP-09 & APP-UI-01] heals 100% once at 10F Fountain, fights Grand Boss with 4 barrage/dash patterns, continues endlessly to 11F, and pauses cleanly via toggleSkillTree', () => {
    const state = createGameState({ seed: 950, startFloor: 10 });
    expect(state.map.floorType).toBe('boss');
    expect(state.map.fountainTile).not.toBeNull();

    // Pause toggle only switches playing <-> skill_tree and stepGame freezes while paused
    toggleSkillTree(state);
    expect(state.status).toBe('skill_tree');
    const frozenTime = state.elapsedFloorTime;
    stepGame(state, { x: 1, y: 0 }, 0.05);
    expect(state.elapsedFloorTime).toBe(frozenTime);
    toggleSkillTree(state);
    expect(state.status).toBe('playing');

    // Fountain heals 100% HP once
    state.player.hp = 25;
    const fountainWorld = tileCenterWorld(state.map.fountainTile!.tx, state.map.fountainTile!.ty);
    state.player.x = fountainWorld.x;
    state.player.y = fountainWorld.y;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.fountainUsed).toBe(true);

    // Stepping on fountain again does NOT heal again
    state.player.hp = 40;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(40);

    // Grand Boss exists with buffed HP (6.8x tank base), locks stairs, and cycles 4 patterns incl. windup->dashing
    const grandBoss = state.enemies.find((e) => e.isGrandBoss);
    expect(grandBoss).toBeDefined();
    expect(grandBoss!.maxHp).toBe(Math.round(createEnemyByKind(1, 'tank', 0, 0, 10).maxHp * 6.8));
    expect(getStairsLockCount(state)).toBe(1);

    state.enemies = [grandBoss!];
    state.player.baseAttackCooldown = 999;
    state.player.x = grandBoss!.x - 160;
    state.player.y = grandBoss!.y;
    grandBoss!.awake = true;
    grandBoss!.attackCooldown = 0.01;
    stepGame(state, { x: 0, y: 0 }, 0.02); // pattern 0: 12-way ring (with piercing shots)
    expect(state.enemyProjectiles.length).toBeGreaterThanOrEqual(12);
    expect(state.enemyProjectiles.some((p) => p.pierceDefense)).toBe(true);

    state.enemyProjectiles = [];
    grandBoss!.attackCooldown = 0.01;
    stepGame(state, { x: 0, y: 0 }, 0.02); // pattern 1: 6 spread homing orbs (non-piercing)
    const homingOrbs = state.enemyProjectiles.filter((p) => (p.homingRate ?? 0) > 0);
    expect(homingOrbs.length).toBe(6);
    expect(homingOrbs.every((p) => !p.pierceDefense)).toBe(true);

    state.enemyProjectiles = [];
    state.bossLasers = [];
    grandBoss!.attackCooldown = 0.01;
    stepGame(state, { x: 0, y: 0 }, 0.02); // pattern 2: wall-reflecting lead laser
    expect((state.bossLasers ?? []).length).toBeGreaterThanOrEqual(1);
    expect(state.bossLasers![0].points.length).toBeGreaterThanOrEqual(3);

    // pattern 3: high-speed dash (windup -> dashing movement -> landing burst) + independent mortar
    state.enemyProjectiles = [];
    state.mortarZones = [];
    grandBoss!.mortarCooldown = 0.01;
    grandBoss!.attackCooldown = 0.01;
    state.player.invulnTimer = 3.0;
    stepGame(state, { x: 0, y: 0 }, 0.02);
    expect(state.mortarZones.length).toBeGreaterThanOrEqual(1);
    expect(grandBoss!.dashState).toBe('windup');
    const preDashX = grandBoss!.x;
    for (let f = 0; f < 60; f++) {
      stepGame(state, { x: 0, y: 0 }, 0.02);
    }
    expect(Math.abs(grandBoss!.x - preDashX)).toBeGreaterThan(50);
    expect(state.enemyProjectiles.length).toBeGreaterThanOrEqual(8);

    // Defeating Grand Boss unlocks stairs, drops high-level gear, and advances endlessly to 11F
    state.player.equipment = [createEquippedItem('orbit_shield', 4)];
    grandBoss!.hp = 0;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(getStairsLockCount(state)).toBe(0);
    const grandDrop = state.pickups.find((p) => p.kind === 'equip');
    expect(grandDrop).toBeDefined();
    expect(grandDrop!.itemLevel).toBeGreaterThanOrEqual(6);

    const stairsWorld = tileCenterWorld(state.map.stairsTile.tx, state.map.stairsTile.ty);
    state.player.x = stairsWorld.x;
    state.player.y = stairsWorld.y;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.floor).toBe(11);
    expect(state.map.floorType).toBe('normal');
  });

  it('[APP-MAP-07 & APP-CMB-02] grants Guardian knockback immunity, tank parabolic mortar zones bypassing orbit shield, and player-level-scaled normal enemy shots', () => {
    // Normal enemy shot scaling by player level
    const s1 = getNormalEnemyShotStats(1);
    const s6 = getNormalEnemyShotStats(6);
    const s9 = getNormalEnemyShotStats(9);
    expect(s1.shotCount).toBe(1);
    expect(s6.shotCount).toBe(2);
    expect(s9.shotCount).toBe(3);
    expect(s9.cooldown).toBeLessThan(s1.cooldown);

    // Guardian on 3F has buffed HP (2.9x) and ignores def_pulse knockback
    const floor3 = createGameState({ seed: 960, startFloor: 3 });
    const guardian = floor3.enemies.find((e) => e.isRoomBoss && !e.isGrandBoss);
    expect(guardian).toBeDefined();
    expect(guardian!.maxHp).toBe(Math.round(createEnemyByKind(1, 'tank', 0, 0, 3).maxHp * 2.9));
    const guardianStairs = tileCenterWorld(floor3.map.stairsTile.tx, floor3.map.stairsTile.ty);
    expect(guardian!.x).toBeCloseTo(guardianStairs.x, 1);
    expect(guardian!.y).toBeCloseTo(guardianStairs.y, 1);

    const kbState = createGameState({ seed: 961 });
    kbState.chests = [];
    kbState.pickups = [];
    kbState.map.tiles.fill('floor');
    kbState.player.baseAttackCooldown = 999;
    kbState.player.skillLevels.def_pulse = 3;
    kbState.player.repulsorCooldown = 0.01;
    const bossStub = createEnemyByKind(7701, 'tank', kbState.player.x + 40, kbState.player.y, 3);
    bossStub.isRoomBoss = true;
    bossStub.speed = 0; // isolate knockback check from chasing
    bossStub.awake = true;
    const bossStartX = bossStub.x;
    kbState.enemies = [bossStub];
    kbState.player.hp = 10;
    stepGame(kbState, { x: 0, y: 0 }, 0.02);
    expect(bossStub.x).toBe(bossStartX); // knockback immune

    // Non-boss tank lobs parabolic mortar zone; orbit_shield does NOT clear mortarZones; mortar deals AoE on landing
    const mortarState = createGameState({ seed: 962 });
    mortarState.chests = [];
    mortarState.pickups = [];
    mortarState.map.tiles.fill('floor');
    mortarState.player.baseAttackCooldown = 999;
    mortarState.player.equipment = [createEquippedItem('orbit_shield', 4)];
    const tank = createEnemyByKind(7702, 'tank', mortarState.player.x + 120, mortarState.player.y, 2);
    tank.awake = true;
    tank.attackCooldown = 0.01;
    mortarState.enemies = [tank];
    stepGame(mortarState, { x: 0, y: 0 }, 0.02);
    expect(mortarState.mortarZones.length).toBe(1);
    const hpBeforeImpact = mortarState.player.hp;
    // Stand still inside landing zone until duration expires
    for (let f = 0; f < 40; f++) {
      stepGame(mortarState, { x: 0, y: 0 }, 0.04);
    }
    expect(mortarState.mortarZones.length).toBe(0);
    expect(mortarState.player.hp).toBeLessThan(hpBeforeImpact);

    // Tank predicts smoothed actual player movement (lead-target mortar) without overshooting through walls
    tank.attackCooldown = 0.5;
    for (let f = 0; f < 15; f++) {
      stepGame(mortarState, { x: 0, y: 1 }, 0.02);
    }
    const playerBeforeShotY = mortarState.player.y;
    tank.attackCooldown = 0.01;
    stepGame(mortarState, { x: 0, y: 1 }, 0.02);
    expect(mortarState.mortarZones.length).toBe(1);
    expect(mortarState.mortarZones[0].radius).toBe(52);
    expect(mortarState.mortarZones[0].duration).toBeCloseTo(0.85, 2);
    expect(mortarState.mortarZones[0].targetY).toBeGreaterThan(playerBeforeShotY + 70);

    // Normal enemy fires level-scaled spread shots when awake & in sight
    const normState = createGameState({ seed: 963 });
    normState.chests = [];
    normState.pickups = [];
    normState.map.tiles.fill('floor');
    normState.player.baseAttackCooldown = 999;
    normState.player.level = 6; // 2-way spread
    const normalEnemy = createEnemyByKind(7703, 'normal', normState.player.x + 100, normState.player.y, 1);
    normalEnemy.awake = true;
    normalEnemy.attackCooldown = 0.01;
    normState.enemies = [normalEnemy];
    stepGame(normState, { x: 0, y: 0 }, 0.02);
    expect(normState.enemyProjectiles.length).toBe(2);
  });

  it('[APP-GRW-07 & APP-GRW-02] improves drop quality with mob_loot and triggers tactical step + temporary speed boost on projectile hit', () => {
    const minLv2 = [
      createEquippedItem('pulse_blade', 2),
      createEquippedItem('orbit_shield', 6),
    ];
    // At dropQualityTier 0, r=0.1 rolls M-1 (1). At tier 5, M-1 is eliminated (0%) so r=0.1 rolls M (2)
    expect(rollDropEquipmentLevel(minLv2, () => 0.1, 0)).toBe(1);
    expect(rollDropEquipmentLevel(minLv2, () => 0.1, 5)).toBe(2);
    // At tier 5, r=0.85 enters the top 20% bracket (M+2 = 4)
    expect(rollDropEquipmentLevel(minLv2, () => 0.85, 5)).toBe(4);

    // Base hit invulnerability is 1.0s without mob_dash (prevents rapid multi-hits)
    const baseHitState = createGameState({ seed: 969 });
    baseHitState.chests = [];
    baseHitState.pickups = [];
    baseHitState.enemies = [];
    baseHitState.map.tiles.fill('floor');
    baseHitState.enemyProjectiles = [
      {
        id: 8800,
        x: baseHitState.player.x + 6,
        y: baseHitState.player.y,
        vx: -100,
        vy: 0,
        radius: 6,
        damage: 10,
        life: 1.0,
      },
      {
        id: 8809,
        x: baseHitState.player.x + 6,
        y: baseHitState.player.y,
        vx: -100,
        vy: 0,
        radius: 6,
        damage: 10,
        life: 1.0,
      },
    ];
    stepGame(baseHitState, { x: 0, y: 0 }, 0.02);
    expect(baseHitState.player.hp).toBe(90); // second projectile ignored by invulnTimer
    expect(baseHitState.player.invulnTimer).toBeCloseTo(1.0, 2);

    // mob_dash triggers charge-based invuln extension + speed boost without forced movement
    const dashState = createGameState({ seed: 970 });
    dashState.chests = [];
    dashState.pickups = [];
    dashState.enemies = [];
    dashState.map.tiles.fill('floor');
    dashState.player.skillLevels = { mob_magnet: 3, mob_loot: 3, mob_dash: 2 };
    const startX = dashState.player.x;
    dashState.enemyProjectiles = [
      {
        id: 8801,
        x: dashState.player.x + 6,
        y: dashState.player.y,
        vx: -100,
        vy: 0,
        radius: 6,
        damage: 10,
        life: 1.0,
      },
    ];
    stepGame(dashState, { x: 0, y: 0 }, 0.02);
    expect(dashState.player.hp).toBe(90);
    expect(dashState.player.x).toBe(startX); // no forced teleport/step into walls
    expect(dashState.player.invulnTimer).toBeCloseTo(1.6, 2);
    expect(dashState.player.tacticalStepCharges).toBe(1);
    expect(dashState.player.tacticalSpeedTimer).toBeGreaterThan(2.0);
    expect(dashState.player.tacticalSpeedBonus).toBeCloseTo(0.38, 4);

    // Next movement step moves faster than baseSpeed (210 * 1.38)
    const boostedStartX = dashState.player.x;
    stepGame(dashState, { x: -1, y: 0 }, 0.05);
    const movedDist = boostedStartX - dashState.player.x;
    expect(movedDist).toBeGreaterThan(210 * 0.05 * 1.3);

    // Consume 2nd charge after invuln expires, then fallback to 1.0s base invuln when out of charges
    dashState.player.invulnTimer = 0;
    dashState.enemyProjectiles = [
      {
        id: 8802,
        x: dashState.player.x,
        y: dashState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 10,
        life: 1.0,
      },
    ];
    stepGame(dashState, { x: 0, y: 0 }, 0.02);
    expect(dashState.player.tacticalStepCharges).toBe(0);
    expect(dashState.player.invulnTimer).toBeCloseTo(1.6, 2);

    dashState.player.invulnTimer = 0;
    dashState.enemyProjectiles = [
      {
        id: 8803,
        x: dashState.player.x,
        y: dashState.player.y,
        vx: 0,
        vy: 0,
        radius: 6,
        damage: 10,
        life: 1.0,
      },
    ];
    stepGame(dashState, { x: 0, y: 0 }, 0.02);
    expect(dashState.player.tacticalStepCharges).toBe(0);
    expect(dashState.player.invulnTimer).toBeCloseTo(1.0, 2);

    // def_aegis parry damage is capped at Lv2, does not scale with arms skills, and uses 4.5s cooldown
    const aegisMods = computeSkillModifiers({
      arm_base: 5,
      def_sensor: 3,
      def_pulse: 3,
      def_aegis: 5,
    });
    expect(aegisMods.aegisCooldown).toBeGreaterThanOrEqual(4.5);
    expect(aegisMods.aegisDamage).toBe(42);
    expect(aegisMods.repulsorDamage).toBe(10);
  });

  it('freezes simulation in title status until startGame transitions to playing and shows floor banner', () => {
    const state = createGameState({ seed: 42, initialStatus: 'title' });
    expect(state.status).toBe('title');
    expect(state.floorBannerTimer).toBe(0);

    const startX = state.player.x;
    stepGame(state, { x: 1, y: 0 }, 0.05);
    expect(state.player.x).toBe(startX);
    expect(state.elapsedFloorTime).toBe(0);

    startGame(state);
    expect(state.status).toBe('playing');
    expect(state.floorBannerTimer).toBeGreaterThan(2.0);

    stepGame(state, { x: 1, y: 0 }, 0.05);
    expect(state.player.x).toBeGreaterThan(startX);
    expect(state.elapsedFloorTime).toBeGreaterThan(0);
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
    pierceState.player.equipment = [
      createEquippedItem('pulse_blade', 3),
      createEquippedItem('orbit_shield', 4),
    ];
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

  it('emits soundEvents, spawns particles, and triggers screen shake on combat and level-up events', () => {
    const state = createGameState({ seed: 999, startFloor: 2 });
    state.chests = [];
    state.pickups = [];
    state.map.tiles.fill('floor');
    state.player.baseAttackCooldown = 0;

    // 1. Firing core shot emits 'shot'; killing enemy emits 'kill' and spawns particles
    const weakEnemy = createEnemyByKind(9950, 'runner', state.player.x + 80, state.player.y, 2);
    weakEnemy.hp = 1;
    state.enemies = [weakEnemy];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.soundEvents).toContain('shot');

    for (let f = 0; f < 20; f++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    expect(state.soundEvents).toContain('kill');
    expect((state.particles ?? []).length).toBeGreaterThan(0);

    // 2. Player hit emits 'player_hit' and activates screen shake
    state.soundEvents = [];
    state.shakeTimer = 0;
    const contactEnemy = createEnemyByKind(9951, 'normal', state.player.x, state.player.y, 2);
    state.enemies = [contactEnemy];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.soundEvents).toContain('player_hit');
    expect(state.shakeTimer ?? 0).toBeGreaterThan(0);

    // 3. Picking up enough EXP for level up emits 'pickup_exp' and 'level_up'
    state.soundEvents = [];
    state.enemies = [];
    state.pickups = [
      {
        id: 9952,
        kind: 'exp',
        x: state.player.x,
        y: state.player.y,
        value: state.player.expToNext,
      },
    ];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.soundEvents).toContain('pickup_exp');
    expect(state.soundEvents).toContain('level_up');
  });

  it('tracks elapsedPlayTime only while playing, formats MM:SS, and records clearTime10F upon clearing 10F', () => {
    expect(formatPlayTime(0)).toBe('00:00');
    expect(formatPlayTime(65.9)).toBe('01:05');
    expect(formatPlayTime(-5)).toBe('00:00');

    const state = createGameState({ seed: 777, startFloor: 10 });
    expect(state.stats.elapsedPlayTime).toBe(0);
    expect(state.stats.clearTime10F).toBeUndefined();

    for (let i = 0; i < 40; i++) {
      stepGame(state, { x: 0, y: 0 }, 0.05);
    }
    expect(state.stats.elapsedPlayTime).toBeCloseTo(2.0, 5);

    // Paused state should not advance elapsedPlayTime
    toggleSkillTree(state);
    expect(state.status).toBe('skill_tree');
    stepGame(state, { x: 0, y: 0 }, 0.05);
    expect(state.stats.elapsedPlayTime).toBeCloseTo(2.0, 5);

    toggleSkillTree(state);
    expect(state.status).toBe('playing');

    // Advancing from 10F to 11F records 10F clear time and pushes notification
    advanceToNextFloor(state);
    expect(state.floor).toBe(11);
    expect(state.stats.clearTime10F).toBeCloseTo(2.0, 5);
    expect(state.notifications.some((n) => n.text.includes('10F CLEAR!') && n.text.includes('00:02'))).toBe(true);
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
    // 14 * (1 + 1.70) * (1 + 0.25) = 14 * 2.7 * 1.25 = 47.25 -> 47
    expect(stats.damage).toBe(47);
    expect(stats.shotCount).toBe(4);
    expect(stats.homingShots).toBe(3);
    expect(stats.homingDamage).toBe(Math.round(47 * 0.35)); // 16
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
    expect(baseProjs).toHaveLength(4);
    expect(homingProjs).toHaveLength(3);

    // Parallel shots share the exact same velocity vector and are offset perpendicularly
    for (const bp of baseProjs) {
      expect(bp.vx).toBeCloseTo(dir * stats.speed, 3);
      expect(bp.vy).toBeCloseTo(0, 3);
      expect(bp.pierce).toBe(true);
      expect(bp.overclockLevel).toBe(2);
      expect(bp.baseLevel).toBe(5);
    }
    const yCoords = baseProjs.map((p) => p.y).sort((a, b) => a - b);
    expect(yCoords[3] - yCoords[0]).toBeCloseTo(54, 1); // (14 + min(4, 5)) * 3 = 54px

    // Homing shots have 35% damage and start in 48px orbit (0.34s) + expand (0.18s)
    expect(homingProjs[0].damage).toBe(stats.homingDamage);
    expect(homingProjs[0].orbitTimer).toBeCloseTo(0.34 - 1 / 60, 3);
    expect(homingProjs[0].expandTimer).toBeCloseTo(0.18, 3);

    // Wall blocks LoS even within 290px (no sniping through walls)
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    const wallTx = pTileX + dir * 2;
    state.map.tiles[pTileY * state.map.width + wallTx] = 'wall';
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.filter((p) => p.kind === 'base')).toHaveLength(0);
  });

  it('[APP-GRW-02 & APP-GRW-05] allows completing an entire branch with 19 SP at Lv20 and applies 2-tier arm_overclock scaling', () => {
    const state = createGameState({ seed: 2020 });
    state.player.level = 20;
    state.player.skillPoints = 19; // Lv1 -> Lv20 grants 19 SP

    // Max out Tier 1 (6 SP) + Tier 2 (8 SP) + Tier 3 (5 SP) = 19 SP
    for (let i = 0; i < 5; i++) expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    for (let i = 0; i < 5; i++) expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true);
    const lv1Stats = getPlayerBaseAttackStats(state.player);
    expect(lv1Stats.cooldown).toBeCloseTo(0.58 * 0.78, 4); // -22%
    expect(lv1Stats.speed).toBe(460 + 100);
    expect(lv1Stats.pierce).toBe(true);

    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true);
    expect(state.player.skillPoints).toBe(0);
    expect(state.player.spentSkillPoints).toBe(19);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(false); // Tier 3 capped at Lv2

    const lv2Stats = getPlayerBaseAttackStats(state.player);
    expect(lv2Stats.cooldown).toBeCloseTo(0.58 * 0.55, 4); // -45%
    expect(lv2Stats.speed).toBe(460 + 200);
    expect(lv2Stats.pierce).toBe(true);
  });

  it('[APP-CMB-06] widens parallel shot laneSpacing when overclock laser is active (7px normal vs 14+min(4,baseLv)px laser)', () => {
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

    // Normal shots (arm_overclock = 0): 4 shots * 7px laneSpacing -> span = 21px
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 0 };
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    const normalYs = state.projectiles
      .filter((p) => p.kind === 'base')
      .map((p) => p.y)
      .sort((a, b) => a - b);
    expect(normalYs).toHaveLength(4);
    expect(normalYs[3] - normalYs[0]).toBeCloseTo(21, 1);

    // Laser shots (arm_overclock = 1, arm_base = 5): 4 shots * (14 + 4)px -> span = 54px
    state.projectiles = [];
    state.player.baseAttackCooldown = 0;
    state.player.skillLevels = { arm_base: 5, arm_parallel: 5, arm_overclock: 1 };
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    const laserYs = state.projectiles
      .filter((p) => p.kind === 'base')
      .map((p) => p.y)
      .sort((a, b) => a - b);
    expect(laserYs).toHaveLength(4);
    expect(laserYs[3] - laserYs[0]).toBeCloseTo(54, 1);
  });

  it('[APP-CMB-06] moves base_homing in 3 phases: 0.34s orbit (48px) -> 0.18s expand (90px) -> projectile-origin homing (220px)', () => {
    const state = createGameState({ seed: 2021 });
    state.chests = [];
    state.pickups = [];
    state.player.equipment = [];
    state.player.skillLevels = { arm_base: 3, arm_parallel: 1 };

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
    // After Phase 1 (0.34s @ 48px) + Phase 2 (0.18s -> 90px), projectile is at ~90px from player
    // and ~145px from the enemy (<=220px), so Phase 3 homes from projectile's own position.
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
    expect(Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y)).toBeCloseTo(48, 1);

    // Phase 1: Step through part of the 0.34s orbit (10 frames = ~0.167s)
    for (let i = 0; i < 10; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBeGreaterThan(0);
    expect(homing!.expandTimer).toBeCloseTo(0.18, 3);
    expect(Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y)).toBeCloseTo(48, 1);

    // Finish Phase 1 (11 more frames -> total 21 frames = 0.35s > 0.34s), enter Phase 2 (expand)
    for (let i = 0; i < 11; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBe(0);
    expect(homing!.expandTimer).toBeGreaterThan(0);

    // Finish Phase 2 (11 more frames -> 0.183s > 0.18s) -> expands to ~90px and enters Phase 3
    for (let i = 0; i < 11; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 60);
    }
    homing = state.projectiles.find((p) => p.kind === 'base_homing');
    expect(homing).toBeDefined();
    expect(homing!.orbitTimer).toBe(0);
    expect(homing!.expandTimer).toBe(0);
    const distAfterExpand = Math.hypot(homing!.x - state.player.x, homing!.y - state.player.y);
    expect(distAfterExpand).toBeGreaterThanOrEqual(85);
    expect(distAfterExpand).toBeLessThanOrEqual(110);
    // Velocity should now point toward the enemy (positive vx)
    expect(homing!.vx).toBeGreaterThan(0);

    // 2. Close enemy on the 48px orbit ring gets intercepted during Phase 1
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
        y: state.player.y + 48,
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
});



