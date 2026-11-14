import { describe, expect, it } from 'vitest';
import { tileCenterWorld } from '../core/dungeon';
import {
  ALL_EQUIPMENT_IDS,
  MAX_EQUIP_SLOTS,
  createEquippedItem,
  getReactiveCoilStats,
  getRicochetDiscStats,
} from './equipment';
import {
  acquireEquipment,
  createGameState,
  getOrbitBitPositions,
  getSeekerDronePositions,
  resolveEquipChoice,
  rollDropEquipmentLevel,
  stepGame,
  unlockSkillNode,
} from './engine';
import { canUnlockSkill } from './skillTree';

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

  it('[APP-MAP-01] advances to floor N+1 when player touches upstairs tile', () => {
    const state = createGameState({ seed: 2026 });
    expect(state.floor).toBe(1);
    const stairs = tileCenterWorld(state.map.stairsTile.tx, state.map.stairsTile.ty);
    state.player.x = stairs.x;
    state.player.y = stairs.y;

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.floor).toBe(2);
    expect(state.stats.floorsCleared).toBe(1);
  });

  it('[APP-CMB-01 & APP-CMB-03] auto-fires at visible enemy in range and blocks shots through walls', () => {
    const state = createGameState({ seed: 303 });
    state.pickups = [];
    state.chests = [];
    state.player.equipment = [createEquippedItem('seeker_drone')];
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
        aggroRange: 200,
        awake: false,
        hitFlash: 0,
        bitHitCooldown: 0,
      },
    ];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(1);

    const wallTx = Math.floor((state.player.x + 40) / 40);
    const wallTy = Math.floor(state.player.y / 40);
    state.map.tiles[wallTy * state.map.width + wallTx] = 'wall';
    state.projectiles = [];
    for (const eq of state.player.equipment) eq.cooldown = 0;

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
        aggroRange: 200,
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

  it('[APP-CMB-05] evolves equipment capabilities by level (bits, 360 slash, drones, chain, ricochet bounce)', () => {
    // 1. Orbit bit count & seeker drone count evolve by level
    const state = createGameState({ seed: 450 });
    state.chests = [];
    state.pickups = [];
    state.enemies = [];
    state.player.equipment = [
      createEquippedItem('orbit_shield', 3),
      createEquippedItem('seeker_drone', 2),
    ];
    expect(getOrbitBitPositions(state).length).toBe(3);
    expect(getSeekerDronePositions(state).length).toBe(2);

    // 2. Pulse blade Lv1 is directional cone, Lv3 evolves into 360 fullCircle slash
    const bladeState = createGameState({ seed: 451 });
    bladeState.chests = [];
    bladeState.pickups = [];
    bladeState.player.equipment = [createEquippedItem('pulse_blade', 1)];
    bladeState.enemies = [
      {
        id: 801,
        x: bladeState.player.x + 45,
        y: bladeState.player.y,
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
        id: 802,
        x: bladeState.player.x - 60,
        y: bladeState.player.y,
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
    stepGame(bladeState, { x: 0, y: 0 }, 1 / 60);
    expect(bladeState.enemies[0].hp).toBeLessThan(100);
    expect(bladeState.enemies[1].hp).toBe(100); // behind player not hit at Lv1

    bladeState.player.equipment[0].level = 3;
    bladeState.player.equipment[0].cooldown = 0;
    stepGame(bladeState, { x: 0, y: 0 }, 1 / 60);
    expect(bladeState.enemies[1].hp).toBeLessThan(100); // 360° hits behind at Lv3
    expect(bladeState.visualFx.some((fx) => fx.kind === 'slash' && fx.fullCircle)).toBe(true);

    // 3. Reactive coil maxTargets & ricochet disc count/bounces evolve by level
    expect(getReactiveCoilStats(1, 80, 1).maxTargets).toBe(3);
    expect(getReactiveCoilStats(3, 80, 1).maxTargets).toBe(5);
    expect(getRicochetDiscStats(1)).toMatchObject({ count: 1, maxBounces: 2 });
    expect(getRicochetDiscStats(3)).toMatchObject({ count: 2, maxBounces: 4 });

    // 4. Ricochet disc actually bounces to a second enemy off-axis
    const discState = createGameState({ seed: 452 });
    discState.chests = [];
    discState.pickups = [];
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
  });

  it('[APP-GRW-01, APP-GRW-02 & APP-GRW-05] enforces DAG prerequisites and tiered SP costs (1/2/3)', () => {
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

    // Cannot unlock Tier 2 before Tier 1 prerequisite
    expect(unlockSkillNode(state, 'arm_parallel')).toBe(false);
    expect(state.player.skillPoints).toBe(1);

    // Unlock Tier 1 (cost 1 SP)
    expect(unlockSkillNode(state, 'arm_base')).toBe(true);
    expect(state.player.skillPoints).toBe(0);

    // With only 1 SP, Tier 2 (cost 2 SP) remains locked even though prerequisite is met
    state.player.skillPoints = 1;
    expect(canUnlockSkill(new Set(state.player.unlockedSkills), state.player.skillPoints, 'arm_parallel')).toBe(false);
    expect(unlockSkillNode(state, 'arm_parallel')).toBe(false);

    // With 2 SP, Tier 2 unlocks and deducts 2 SP
    state.player.skillPoints = 2;
    expect(unlockSkillNode(state, 'arm_parallel')).toBe(true);
    expect(state.player.skillPoints).toBe(0);
    expect(getOrbitBitPositions(state).length).toBe(2);
    expect(getSeekerDronePositions(state).length).toBe(2);

    // Tier 3 requires 3 SP
    state.player.skillPoints = 2;
    expect(unlockSkillNode(state, 'arm_overclock')).toBe(false);
    state.player.skillPoints = 3;
    expect(unlockSkillNode(state, 'arm_overclock')).toBe(true);
    expect(state.player.skillPoints).toBe(0);

    // mob_magnet enhances heal orb effectiveness (+25%)
    state.player.skillPoints = 1;
    expect(unlockSkillNode(state, 'mob_magnet')).toBe(true);
    state.player.hp = 50;
    state.pickups = [{ id: 701, kind: 'heal', x: state.player.x, y: state.player.y, value: 20 }];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(75);
  });

  it('[APP-GRW-03 & APP-GRW-04] enforces 3-slot limit, auto-levels owned duplicates (including higher-Lv drops), and prompts on 4th unowned gear', () => {
    expect(MAX_EQUIP_SLOTS).toBe(3);

    const state = createGameState({ seed: 606 });
    state.player.equipment = [
      createEquippedItem('pulse_blade'),
      createEquippedItem('orbit_shield'),
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

    // Unowned 4th item triggers replace/scrap choice modal
    acquireEquipment(state, createEquippedItem('reactive_coil', 1));
    expect(state.status).toBe('equip_choice');
    expect(state.pendingEquipDrop).not.toBeNull();

    // Scrap upgrades all 3 equipped items by Lv+1
    expect(resolveEquipChoice(state, { type: 'scrap' })).toBe(true);
    expect(state.status).toBe('playing');
    expect(state.player.equipment.map((e) => e.level)).toEqual([2, 2, 6]);

    // Replace slot 0 on next unowned drop (preserving drop level)
    acquireEquipment(state, createEquippedItem('ricochet_disc', 4));
    expect(resolveEquipChoice(state, { type: 'replace', slotIndex: 0 })).toBe(true);
    expect(state.player.equipment[0].id).toBe('ricochet_disc');
    expect(state.player.equipment[0].level).toBe(4);
  });

  it('[APP-GRW-06] starts run with 0 items and guarantees an accessible 1F starter chest in Room 0', () => {
    const state = createGameState({ seed: 707 });
    expect(state.player.equipment).toEqual([]);

    const startRoom = state.map.rooms[0];
    const minX = startRoom.x * 40;
    const maxX = (startRoom.x + startRoom.w) * 40;
    const minY = startRoom.y * 40;
    const maxY = (startRoom.y + startRoom.h) * 40;

    const starterChest = state.chests.find(
      (c) => c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY
    );
    expect(starterChest).toBeDefined();

    // Walking right reaches the guaranteed starter chest and grants Lv1 equipment
    for (let i = 0; i < 15; i++) {
      stepGame(state, { x: 1, y: 0 }, 0.03);
    }
    expect(state.player.equipment.length).toBe(1);
    expect(state.player.equipment[0].level).toBe(1);
  });

  it('[APP-GRW-07] scales drop levels around player average level and equips ground equip drops on direct pickup', () => {
    expect(rollDropEquipmentLevel([], () => 0.99)).toBe(1);

    const avg4 = [createEquippedItem('pulse_blade', 3), createEquippedItem('orbit_shield', 5)];
    expect(rollDropEquipmentLevel(avg4, () => 0.1)).toBe(3);
    expect(rollDropEquipmentLevel(avg4, () => 0.4)).toBe(4);
    expect(rollDropEquipmentLevel(avg4, () => 0.7)).toBe(5);
    expect(rollDropEquipmentLevel(avg4, () => 0.95)).toBe(6);

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
});

