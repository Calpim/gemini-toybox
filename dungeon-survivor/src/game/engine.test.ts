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
  SCOUT_ALERT_RADIUS,
  SHOOTER_AGGRO_RANGE,
  acquireEquipment,
  createEnemyByKind,
  startGame,
  createGameState,
  getNormalEnemyShotStats,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
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

  it('[APP-CMB-05] evolves equipment in two phases (Lv1-6 count/arc max, Lv7-10 power/CD/range), keeps pulse_blade directional, and slows enemies inside orbit_shield', () => {
    // 1. Orbit bit count & seeker drone count cap at Lv6; Lv7-10 boost radius/power/CD
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
    state.player.equipment[0].level = 10;
    state.player.equipment[1].level = 10;
    expect(getOrbitBitPositions(state).length).toBe(6);
    expect(getSeekerDronePositions(state).length).toBe(4);
    expect(getOrbitShieldRadius(10, 1)).toBeGreaterThan(getOrbitShieldRadius(6, 1));
    expect(getOrbitShieldAngularSpeed(1)).toBeGreaterThan(getOrbitShieldAngularSpeed(6));
    expect(getEquipmentCooldownMultiplier(10)).toBeLessThan(getEquipmentCooldownMultiplier(6));

    // 2. Pulse blade stays directional fan (never 360°) even at Lv3 and Lv10
    expect(getPulseBladeStats(10, 84, 1).fullCircle).toBe(false);
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
    expect(skilledStats.range).toBe(MAX_TARGET_RANGE);
    expect(skilledStats.shotCount).toBe(2);

    // Sub-equipment counts/damage/cooldown stay purely determined by equipment level (not arms skills)
    state.player.equipment = [
      createEquippedItem('orbit_shield', 1),
      createEquippedItem('seeker_drone', 1),
    ];
    expect(getOrbitBitPositions(state).length).toBe(1);
    expect(getSeekerDronePositions(state).length).toBe(1);

    // Fires 2 base shots simultaneously at a visible enemy
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
  });

  it('[APP-GRW-01, APP-GRW-02 & APP-GRW-05] enforces Lv1-3=1SP / Lv4=2SP / Lv5=3SP, Lv4-5 breakthroughs, Lv3+ prereqs (incl. magnet->loot->dash), and level-up notifications', () => {
    expect(MAX_SKILL_LEVEL).toBe(5);
    expect(SKILL_PREREQ_LEVEL).toBe(3);
    expect([0, 1, 2, 3, 4].map((lv) => getSkillUpgradeCost(lv))).toEqual([1, 1, 1, 2, 3]);

    const state = createGameState({ seed: 505 });
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
    expect(state.player.skillPoints).toBe(1);
    expect(state.notifications.some((n) => n.kind === 'levelup' && n.text.includes('Lv2'))).toBe(true);

    // Cannot unlock Tier 2 before Tier 1 reaches Lv3
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv1 (cost 1)
    state.player.skillPoints = 5;
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv2 (cost 1)
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);

    // Reaching Tier 1 Lv3 unlocks Tier 2 (cost 1 SP each up to Lv3)
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv3 (cost 1)
    expect(state.player.skillLevels.arm_base).toBe(3);
    expect(state.player.skillPoints).toBe(3);

    // Lv4 requires 2 SP and delivers a large breakthrough jump; Lv5 requires 3 SP
    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // needs 2 SP for Lv4
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv4 (cost 2)
    expect(computeSkillModifiers(state.player.skillLevels).mainDamageMult).toBeCloseTo(1.45, 4);

    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // needs 3 SP for Lv5
    state.player.skillPoints = 3;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv5 (cost 3)
    expect(computeSkillModifiers(state.player.skillLevels).mainDamageMult).toBeCloseTo(1.65, 4);
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

    // Tier 3 unlocks at Tier 2 Lv3 and enables Main Weapon cooldown reduction & pierce
    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true); // Lv1 (cost 1)
    expect(state.player.skillPoints).toBe(0);
    expect(getPlayerBaseAttackStats(state.player).pierce).toBe(true);

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

  it('[APP-MAP-07] prevents overlapping initial enemy spawns and runs tank/runner/shooter (8-way barrage + knockback immunity)/scout archetypes', () => {
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

    // Shooter stays stationary (speed 0), immune to player knockback, never pre-arms while dormant, and fires 8-way barrage
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

    // Floor spawns a free-roaming patrol scout in corridors
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

    // Scout wanders while unawakened, and on spotting player wakes allies, spawns fast ambush runners (> player baseSpeed) with spawnDelay
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
      spotScout.x + SCOUT_ALERT_RADIUS - 30,
      spotScout.y,
      2
    );
    scoutState.enemies = [spotScout, nearbyAlly];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(spotScout.awake).toBe(true);
    expect(nearbyAlly.awake).toBe(true);
    const ambushRunners = scoutState.enemies.filter((e) => e.kind === 'runner' && e.awake);
    expect(ambushRunners.length).toBeGreaterThanOrEqual(2);
    expect(ambushRunners.every((e) => e.isAmbush === true)).toBe(true);
    expect(ambushRunners.every((e) => e.speed > scoutState.player.baseSpeed)).toBe(true);
    expect(ambushRunners.every((e) => (e.spawnDelay ?? 0) > 0.3)).toBe(true);
    expect(scoutState.notifications.some((n) => n.kind === 'alert' && n.text.includes('スカウト'))).toBe(true);

    // Defeating a scout-spawned ambush runner yields zero EXP/heal/equip drops
    scoutState.pickups = [];
    ambushRunners[0].hp = 0;
    scoutState.enemies = [ambushRunners[0]];
    stepGame(scoutState, { x: 0, y: 0 }, 1 / 60);
    expect(scoutState.stats.kills).toBeGreaterThanOrEqual(1);
    expect(scoutState.pickups.length).toBe(0);
  });

  it('[APP-GRW-08] enforces MAX_EQUIPMENT_LEVEL=10 cap, auto-expands slots on Lv10 duplicates when maxEquipSlots < 5, and grants overflow bonus at cap', () => {
    expect(MAX_EQUIPMENT_LEVEL).toBe(10);
    const state = createGameState({ seed: 940 });

    // Lv10 duplicate pickup auto-allocates into slot expansion when maxEquipSlots < MAX_EQUIP_SLOTS_CAP
    state.player.maxEquipSlots = 2;
    state.player.scrapExpandProgress = 0;
    state.player.equipment = [
      createEquippedItem('pulse_blade', 10),
      createEquippedItem('orbit_shield', 5),
    ];
    acquireEquipment(state, createEquippedItem('pulse_blade', 10));
    expect(state.player.maxEquipSlots).toBe(3); // cost 2->3 is 1 scrap
    expect(state.player.scrapExpandProgress).toBe(0);
    // Next Lv10 duplicate advances 3->4 progress (cost 2)
    acquireEquipment(state, createEquippedItem('pulse_blade', 10));
    expect(state.player.maxEquipSlots).toBe(3);
    expect(state.player.scrapExpandProgress).toBe(1);

    // Once maxEquipSlots reaches 5, Lv10 duplicate grants +20HP / +25EXP overflow bonus
    state.player.maxEquipSlots = MAX_EQUIP_SLOTS_CAP;
    state.player.equipment = ALL_EQUIPMENT_IDS.map((id) => createEquippedItem(id, 10));
    state.player.hp = 50;
    const expBefore = state.stats.totalExp;
    acquireEquipment(state, createEquippedItem('pulse_blade', 10));
    expect(state.player.equipment[0].level).toBe(10);
    expect(state.player.hp).toBe(70);
    expect(state.stats.totalExp).toBe(expBefore + 25);

    // scrap_upgrade rejects Lv10 slot
    state.player.equipment[0].level = 9;
    acquireEquipment(state, createEquippedItem('pulse_blade', 1));
    expect(state.player.equipment[0].level).toBe(10);

    state.player.maxEquipSlots = 2;
    state.player.equipment = [
      createEquippedItem('pulse_blade', 10),
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

    // mob_dash triggers tactical step + speed boost on enemy projectile hit
    const dashState = createGameState({ seed: 970 });
    dashState.chests = [];
    dashState.pickups = [];
    dashState.enemies = [];
    dashState.map.tiles.fill('floor');
    dashState.player.skillLevels = { mob_magnet: 3, mob_loot: 3, mob_dash: 5 };
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
    expect(dashState.player.x).toBeLessThan(startX - 50); // stepped left away from projectile
    expect(dashState.player.tacticalSpeedTimer).toBeGreaterThan(2.0);
    expect(dashState.player.tacticalSpeedBonus).toBeCloseTo(0.38, 4);

    // Next movement step moves faster than baseSpeed (210 * 1.38)
    const boostedStartX = dashState.player.x;
    stepGame(dashState, { x: -1, y: 0 }, 0.05);
    const movedDist = boostedStartX - dashState.player.x;
    expect(movedDist).toBeGreaterThan(210 * 0.05 * 1.3);

    // def_aegis parry damage does not scale with arms skills and uses restrained cooldown (>= 4.5s)
    const aegisMods = computeSkillModifiers({
      arm_base: 5,
      def_sensor: 3,
      def_pulse: 3,
      def_aegis: 5,
    });
    expect(aegisMods.aegisCooldown).toBeGreaterThanOrEqual(4.5);
    expect(aegisMods.aegisDamage).toBe(46);
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
});



