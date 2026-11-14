import { describe, expect, it } from 'vitest';
import { tileCenterWorld } from '../core/dungeon';
import { MAX_EQUIP_SLOTS, createEquippedItem } from './equipment';
import {
  acquireEquipment,
  createGameState,
  getOrbitBitPositions,
  getSeekerDronePositions,
  resolveEquipChoice,
  stepGame,
  unlockSkillNode,
} from './engine';

describe('Game simulation engine (Phase 1 & Phase 2-A)', () => {
  it('[APP-MAP-03] does not regenerate HP over time and heals only on recovery orb pickup', () => {
    const state = createGameState({ seed: 100 });
    state.enemies = [];
    state.pickups = [];
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

  it('[APP-CMB-02] runs all 5 equipment categories in parallel (blade, orbit, drone, turret, coil)', () => {
    const state = createGameState({ seed: 404 });
    state.pickups = [];
    state.chests = [];
    state.player.equipment = [
      createEquippedItem('pulse_blade'),
      createEquippedItem('orbit_shield'),
      createEquippedItem('seeker_drone'),
      createEquippedItem('auto_turret'),
      createEquippedItem('reactive_coil'),
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
    // pulse_blade (22) + reactive_coil (18) hit immediately, seeker_drone fired projectile, auto_turret deployed
    expect(state.enemies[0].hp).toBeLessThan(200);
    expect(state.projectiles.length).toBeGreaterThanOrEqual(1);
    expect(state.turrets.length).toBe(1);
    expect(state.visualFx.some((fx) => fx.kind === 'slash')).toBe(true);
    expect(state.visualFx.some((fx) => fx.kind === 'lightning')).toBe(true);
  });

  it('[APP-GRW-01 & APP-GRW-02] enforces DAG skill tree prerequisites and applies bit/overclock upgrades', () => {
    const state = createGameState({ seed: 505 });
    state.enemies = [];
    state.pickups = [
      { id: 700, kind: 'exp', x: state.player.x, y: state.player.y, value: 30 },
    ];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.level).toBe(2);
    expect(state.player.skillPoints).toBe(1);

    // Cannot unlock tier 2 before tier 1 prerequisite
    expect(unlockSkillNode(state, 'arm_parallel')).toBe(false);
    expect(state.player.skillPoints).toBe(1);

    // Unlock arm_base then give 2 more SP for arm_parallel and arm_overclock
    expect(unlockSkillNode(state, 'arm_base')).toBe(true);
    state.player.skillPoints = 2;
    expect(unlockSkillNode(state, 'arm_parallel')).toBe(true);
    expect(getOrbitBitPositions(state).length).toBe(2);
    expect(getSeekerDronePositions(state).length).toBe(2);

    expect(unlockSkillNode(state, 'arm_overclock')).toBe(true);
    expect(state.player.skillPoints).toBe(0);
  });

  it('[APP-GRW-03] pauses for replace or scrap choice when 6th equipment is acquired at 5/5 slots', () => {
    const state = createGameState({ seed: 606 });
    state.player.equipment = [
      createEquippedItem('pulse_blade'),
      createEquippedItem('orbit_shield'),
      createEquippedItem('seeker_drone'),
      createEquippedItem('auto_turret'),
      createEquippedItem('reactive_coil'),
    ];
    expect(state.player.equipment.length).toBe(MAX_EQUIP_SLOTS);

    acquireEquipment(state, createEquippedItem('pulse_blade', 2));
    expect(state.status).toBe('equip_choice');
    expect(state.pendingEquipDrop).not.toBeNull();

    // Scrap upgrades all 5 equipped items by Lv+1
    expect(resolveEquipChoice(state, { type: 'scrap' })).toBe(true);
    expect(state.status).toBe('playing');
    expect(state.player.equipment.every((e) => e.level === 2)).toBe(true);

    // Replace slot 0 on next 6th drop
    acquireEquipment(state, createEquippedItem('seeker_drone', 3));
    expect(resolveEquipChoice(state, { type: 'replace', slotIndex: 0 })).toBe(true);
    expect(state.player.equipment[0].id).toBe('seeker_drone');
    expect(state.player.equipment[0].level).toBe(3);
  });
});
