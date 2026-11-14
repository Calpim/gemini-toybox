import { describe, expect, it } from 'vitest';
import { TILE_SIZE, tileCenterWorld } from '../core/dungeon';
import {
  ALL_EQUIPMENT_IDS,
  MAX_EQUIP_SLOTS,
  MAX_TARGET_RANGE,
  createEquippedItem,
  getReactiveCoilStats,
  getRicochetDiscStats,
} from './equipment';
import {
  acquireEquipment,
  createGameState,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getSeekerDronePositions,
  resolveEquipChoice,
  rollDropEquipmentLevel,
  stepGame,
  upgradeSkillNode,
} from './engine';
import { MAX_SKILL_LEVEL, SKILL_PREREQ_LEVEL, canUpgradeSkill } from './skillTree';

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
    bladeState.player.baseAttackCooldown = 999;
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
    expect(getReactiveCoilStats(1, 74, 1).maxTargets).toBe(3);
    expect(getReactiveCoilStats(3, 74, 1).maxTargets).toBe(5);
    expect(getRicochetDiscStats(1)).toMatchObject({ count: 1, maxBounces: 2 });
    expect(getRicochetDiscStats(3)).toMatchObject({ count: 2, maxBounces: 4 });

    // 4. Ricochet disc actually bounces to a second enemy off-axis
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
  });

  it('[APP-CMB-06] scales player intrinsic Core Shot by spent SP and skills, NOT by player.level alone', () => {
    const state = createGameState({ seed: 460 });
    state.chests = [];
    state.pickups = [];
    expect(state.player.equipment).toEqual([]);

    const initialStats = getPlayerBaseAttackStats(state.player);
    expect(initialStats).toMatchObject({ damage: 12, shotCount: 1, range: 140, spentSp: 0 });

    // Raising player.level alone without spending SP does NOT alter Core Shot
    state.player.level = 5;
    expect(getPlayerBaseAttackStats(state.player)).toEqual(initialStats);

    // Spending 3 SP (arm_base Lv3) strengthens damage, range, cooldown, and unlocks 2-way shot
    state.player.skillPoints = 3;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    expect(state.player.spentSkillPoints).toBe(3);

    const skilledStats = getPlayerBaseAttackStats(state.player);
    expect(skilledStats.spentSp).toBe(3);
    expect(skilledStats.damage).toBeGreaterThan(initialStats.damage);
    expect(skilledStats.range).toBeGreaterThan(initialStats.range);
    expect(skilledStats.cooldown).toBeLessThan(initialStats.cooldown);
    expect(skilledStats.shotCount).toBe(2);

    // Fires 2 base shots simultaneously at a visible enemy with 0 equipment
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

  it('[APP-GRW-01, APP-GRW-02 & APP-GRW-05] enforces Lv1-5 per-skill scaling, Lv3+ prerequisites, and tiered SP costs (1/2/3)', () => {
    expect(MAX_SKILL_LEVEL).toBe(5);
    expect(SKILL_PREREQ_LEVEL).toBe(3);

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

    // Cannot unlock Tier 2 before Tier 1 reaches Lv3
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv1
    state.player.skillPoints = 5;
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv2
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);

    // Reaching Tier 1 Lv3 unlocks Tier 2 (cost 2 SP)
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv3
    expect(state.player.skillLevels.arm_base).toBe(3);

    state.player.skillPoints = 1;
    expect(canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, 'arm_parallel')).toBe(false);
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(false);

    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // arm_parallel Lv1
    expect(state.player.skillPoints).toBe(0);
    expect(getOrbitBitPositions(state).length).toBe(2);
    expect(getSeekerDronePositions(state).length).toBe(2);

    // Tier 1 caps at MAX_SKILL_LEVEL = 5
    state.player.skillPoints = 5;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv4
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv5
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // capped at Lv5

    // Tier 3 requires Tier 2 Lv3 and 3 SP per level
    state.player.skillPoints = 4;
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // Lv2
    expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true); // Lv3
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(false);
    state.player.skillPoints = 3;
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true); // Lv1

    // mob_magnet scales heal orb effectiveness per level (+12%/Lv)
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true); // Lv1 (+12%)
    state.player.hp = 50;
    state.pickups = [{ id: 701, kind: 'heal', x: state.player.x, y: state.player.y, value: 20 }];
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.hp).toBe(72);

    expect(upgradeSkillNode(state, 'mob_magnet')).toBe(true); // Lv2 (+24%)
    state.player.hp = 50;
    state.pickups = [{ id: 702, kind: 'heal', x: state.player.x, y: state.player.y, value: 20 }];
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
});

