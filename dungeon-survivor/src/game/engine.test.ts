import { describe, expect, it } from 'vitest';
import { findRoomAtTile, TILE_SIZE, tileCenterWorld } from '../core/dungeon';
import { computeCameraZoom } from '../render/canvasRenderer';
import { mustAt, mustDefined } from '../testUtils';
import {
  advanceToNextFloor,
  CORRIDOR_VISION_RADIUS,
  createEnemyByKind,
  createGameState,
  formatPlayTime,
  getStairsLockCount,
  isPointInPlayerVision,
  pickEnemyKindForFloor,
  startGame,
  stepGame,
  toggleSkillTree,
} from './engine';
import { createEquippedItem, MAX_TARGET_RANGE } from './equipment';

describe('Game simulation engine (core loop, floor progression, and vision)', () => {
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

  it('[APP-MAP-01 & INV-04] keeps normal floor stairs unlocked, spawns Guardian mid-boss every 3/6/9F to lock stairs, and drops higher-level gear on defeat', () => {
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
    mustDefined(roomBoss, 'roomBoss').hp = 0;
    const firstRoom = mustAt(state.map.rooms, 0, 'state.map.rooms');
    state.player.x = firstRoom.cx * TILE_SIZE;
    state.player.y = firstRoom.cy * TILE_SIZE;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(getStairsLockCount(state)).toBe(0);
    expect(state.notifications.some((n) => n.text.includes('封印が解けた'))).toBe(true);
    const bossDrop = mustDefined(
      state.pickups.find((p) => p.kind === 'equip'),
      'bossDrop',
    );
    expect(bossDrop.itemLevel).toBeGreaterThanOrEqual(4);

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

    const enemy = mustAt(state.enemies, 0, 'state.enemies');
    // Should have navigated around the wall (past tx=4 wall center) toward the player
    expect(enemy.x).toBeLessThan(4 * TILE_SIZE);
    expect(Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y)).toBeLessThan(45);
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
      const r = findRoomAtTile(state.map, Math.floor(spawned.x / TILE_SIZE), Math.floor(spawned.y / TILE_SIZE));
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
    const room0 = mustAt(state.map.rooms, 0, 'state.map.rooms');
    // Corner inside room 0 is visible when player stands in room 0
    const roomCorner = tileCenterWorld(room0.x, room0.y);
    expect(isPointInPlayerVision(state.map, state.player.x, state.player.y, roomCorner.x, roomCorner.y)).toBe(true);

    // When in a corridor (isolated non-room floor), vision is limited to CORRIDOR_VISION_RADIUS (210px)
    const testMap = {
      ...state.map,
      rooms: [],
      tiles: new Array(state.map.width * state.map.height).fill('floor' as const),
    };
    expect(isPointInPlayerVision(testMap, 200, 200, 200 + CORRIDOR_VISION_RADIUS - 10, 200)).toBe(true);
    expect(isPointInPlayerVision(testMap, 200, 200, 200 + CORRIDOR_VISION_RADIUS + 20, 200)).toBe(false);
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
});
