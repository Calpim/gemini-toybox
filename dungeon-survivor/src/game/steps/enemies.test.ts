import { describe, expect, it } from 'vitest';
import { TILE_SIZE, findRoomAtTile, tileCenterWorld } from '../../core/dungeon';
import { createEquippedItem } from '../equipment';
import {
  SCOUT_ALERT_COOLDOWN,
  SCOUT_CHASE_DIST,
  SCOUT_KEEP_DIST,
  SCOUT_SUMMON_CAP_PER_SCOUT,
  SCOUT_SUMMON_MAX_PLAYER_DIST,
  SHOOTER_AGGRO_RANGE,
  createEnemyByKind,
  createGameState,
  getNormalEnemyShotStats,
  getRunnerPackSize,
  getStairsLockCount,
  getActiveBossLaserWidth,
  stepGame,
  toggleSkillTree,
} from '../engine';

describe('Enemy AI, spawning, and boss simulation', () => {
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
      2,
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
            Math.floor(e.y / 40) < r.y + r.h,
        ),
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
    const nearbyAlly = createEnemyByKind(9012, 'normal', spotScout.x + 180, spotScout.y, 2);
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
    const farScout = createEnemyByKind(
      9014,
      'scout',
      scoutState.player.x + SCOUT_SUMMON_MAX_PLAYER_DIST + 60,
      scoutState.player.y,
      2,
    );
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

  it('[APP-BOS-01 & APP-BOS-02 & ST-01] heals 100% once at 10F Fountain, fights Grand Boss with 4 barrage/dash patterns, continues endlessly to 11F, and pauses cleanly via toggleSkillTree', () => {
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
    for (let f = 0; f < 80; f++) {
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

  it('[ENH-13] grants boss dash invulnerability (parry trade pierces), bounces Grand Boss dash off walls once into recovering stun with non-piercing burst, and expands boss laser width over time', () => {
    // 1. Boss takes damage during windup, is invulnerable to normal attacks during dashing, and takes damage again during recovering
    const invulnState = createGameState({ seed: 1301 });
    invulnState.chests = [];
    invulnState.pickups = [];
    invulnState.map.tiles.fill('floor');
    invulnState.player.invulnTimer = 99;
    invulnState.player.baseAttackCooldown = 0;
    const gBoss = createEnemyByKind(9101, 'tank', invulnState.player.x + 80, invulnState.player.y, 10);
    gBoss.isRoomBoss = true;
    gBoss.isGrandBoss = true;
    gBoss.awake = true;
    gBoss.hp = 1000;
    gBoss.maxHp = 1000;
    gBoss.attackCooldown = 99;
    gBoss.mortarCooldown = 99;
    gBoss.dashState = 'windup';
    gBoss.dashTimer = 0.5;
    gBoss.dashDir = { x: 1, y: 0 };
    gBoss.dashSpeed = 540;
    invulnState.enemies = [gBoss];

    // Windup: normal player attack hits
    stepGame(invulnState, { x: 0, y: 0 }, 0.02);
    for (let f = 0; f < 15; f++) {
      stepGame(invulnState, { x: 0, y: 0 }, 0.02);
    }
    const hpAfterWindup = gBoss.hp;
    expect(hpAfterWindup).toBeLessThan(1000);

    // Dashing: direct projectile hits do NOT reduce boss HP
    gBoss.dashState = 'dashing';
    gBoss.dashTimer = 0.5;
    gBoss.dashBouncesLeft = 1;
    gBoss.x = invulnState.player.x + 60;
    gBoss.y = invulnState.player.y;
    invulnState.projectiles.push({
      id: 9102,
      kind: 'base',
      x: gBoss.x,
      y: gBoss.y,
      vx: 0,
      vy: 0,
      radius: 8,
      damage: 50,
      life: 1.0,
      pierce: false,
      hitEnemyIds: [],
      color: '#67e8f9',
    });
    stepGame(invulnState, { x: 0, y: 0 }, 0.016);
    expect(gBoss.hp).toBe(hpAfterWindup);

    // Recovering: boss stands still and takes damage again
    gBoss.dashState = 'recovering';
    gBoss.dashTimer = 0.8;
    const recX = gBoss.x;
    const recY = gBoss.y;
    invulnState.projectiles.push({
      id: 9103,
      kind: 'base',
      x: gBoss.x,
      y: gBoss.y,
      vx: 0,
      vy: 0,
      radius: 8,
      damage: 50,
      life: 1.0,
      pierce: false,
      hitEnemyIds: [],
      color: '#67e8f9',
    });
    stepGame(invulnState, { x: 0, y: 0 }, 0.016);
    expect(gBoss.x).toBe(recX);
    expect(gBoss.y).toBe(recY);
    expect(gBoss.hp).toBe(hpAfterWindup - 50);

    // 2. Grand Boss bounces once off a wall during dash, continues dashing, then transitions to recovering with all non-piercing burst shots
    const bounceState = createGameState({ seed: 1302 });
    bounceState.chests = [];
    bounceState.pickups = [];
    bounceState.map.tiles.fill('floor');
    // Put a vertical wall column at tile x = 12
    const pTile = findRoomAtTile(
      bounceState.map,
      Math.floor(bounceState.player.x / TILE_SIZE),
      Math.floor(bounceState.player.y / TILE_SIZE),
    );
    const baseTx = Math.floor(bounceState.player.x / TILE_SIZE);
    const baseTy = Math.floor(bounceState.player.y / TILE_SIZE);
    const wallTx = baseTx + 3;
    for (let wy = Math.max(0, baseTy - 4); wy <= Math.min(bounceState.map.height - 1, baseTy + 4); wy++) {
      bounceState.map.tiles[wy * bounceState.map.width + wallTx] = 'wall';
    }
    expect(pTile === null || pTile !== null).toBe(true);
    const wallLeftEdge = wallTx * TILE_SIZE;
    const rBoss = createEnemyByKind(9104, 'tank', wallLeftEdge - 32, bounceState.player.y, 10);
    rBoss.isRoomBoss = true;
    rBoss.isGrandBoss = true;
    rBoss.awake = true;
    rBoss.attackCooldown = 99;
    rBoss.mortarCooldown = 99;
    rBoss.dashState = 'dashing';
    rBoss.dashTimer = 0.72;
    rBoss.dashDir = { x: 1, y: 0 };
    rBoss.dashSpeed = 540;
    rBoss.dashBouncesLeft = 1;
    bounceState.enemies = [rBoss];
    bounceState.player.invulnTimer = 99;
    bounceState.player.baseAttackCooldown = 999;

    // Step until wall hit triggers bounce (dashDir.x flips negative)
    let bounced = false;
    for (let f = 0; f < 15; f++) {
      stepGame(bounceState, { x: 0, y: 0 }, 0.016);
      if ((rBoss.dashDir?.x ?? 1) < 0) {
        bounced = true;
        break;
      }
    }
    expect(bounced).toBe(true);
    expect(rBoss.dashState).toBe('dashing');
    expect(rBoss.dashBouncesLeft).toBe(0);

    // Step remaining dash duration until recovering + landing burst
    const getDashState = () => bounceState.enemies[0].dashState;
    for (let f = 0; f < 55; f++) {
      stepGame(bounceState, { x: 0, y: 0 }, 0.016);
      if (getDashState() === 'recovering') break;
    }
    expect(getDashState()).toBe('recovering');
    expect(bounceState.enemyProjectiles.length).toBeGreaterThanOrEqual(8);
    expect(bounceState.enemyProjectiles.every((ep) => !ep.pierceDefense)).toBe(true);

    // 3. Boss laser starts thin on activation and gradually widens to full width (22px)
    const laserSample = {
      id: 9105,
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      width: 22,
      damage: 20,
      elapsed: 0.5,
      windup: 0.72,
      duration: 1.12,
      hitPlayer: false,
    };
    expect(getActiveBossLaserWidth(laserSample)).toBe(0);
    laserSample.elapsed = 0.72; // just fired
    const initialActiveWidth = getActiveBossLaserWidth(laserSample);
    expect(initialActiveWidth).toBeCloseTo(22 * 0.28, 3);
    laserSample.elapsed = 0.9; // >= windup + 0.18s -> full width
    expect(getActiveBossLaserWidth(laserSample)).toBeCloseTo(22, 3);
  });
});
