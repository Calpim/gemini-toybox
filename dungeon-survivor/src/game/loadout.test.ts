import { describe, expect, it } from 'vitest';
import { tileCenterWorld } from '../core/dungeon';
import { mustAt, mustDefined } from '../testUtils';
import {
  acquireEquipment,
  createGameState,
  getLevelUpSkillPoints,
  getOrbitBitPositions,
  getPlayerBaseAttackStats,
  getSeekerDronePositions,
  resolveEquipChoice,
  rollDropEquipmentLevel,
  stepGame,
  upgradeSkillNode,
} from './engine';
import {
  ALL_EQUIPMENT_IDS,
  createEquippedItem,
  getScrapExpandCost,
  MAX_EQUIP_SLOTS,
  MAX_EQUIP_SLOTS_CAP,
  MAX_EQUIPMENT_LEVEL,
} from './equipment';
import {
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillUpgradeCost,
  MAX_SKILL_LEVEL,
  SKILL_PREREQ_LEVEL,
} from './skillTree';

describe('Equipment, loadout, and growth simulation', () => {
  it('[APP-GRW-01, APP-GRW-02 & APP-GRW-05] enforces Tier-based SP costs (Tier1:7, Tier2:8, Tier3:5 = 20SP), Lv4-5 breakthroughs, Lv3+ prereqs (incl. magnet->loot->dash), and level-up notifications', () => {
    expect(MAX_SKILL_LEVEL).toBe(5);
    expect(SKILL_PREREQ_LEVEL).toBe(3);
    expect([0, 1, 2, 3, 4, 5].map((lv) => getSkillUpgradeCost(lv, 'arm_base'))).toEqual([1, 1, 1, 2, 2, Infinity]);
    expect([0, 1, 2, 3, 4, 5].map((lv) => getSkillUpgradeCost(lv, 'arm_parallel'))).toEqual([1, 1, 1, 2, 3, Infinity]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'arm_overclock'))).toEqual([2, 3, Infinity]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'def_aegis'))).toEqual([2, 3, Infinity]);
    expect([0, 1, 2].map((lv) => getSkillUpgradeCost(lv, 'mob_dash'))).toEqual([2, 3, Infinity]);

    const state = createGameState({ seed: 505 });
    expect(state.player.skillPoints).toBe(1);
    state.enemies = [];
    state.chests = [];
    state.player.equipment = [createEquippedItem('orbit_shield'), createEquippedItem('seeker_drone')];
    state.pickups = [{ id: 700, kind: 'exp', x: state.player.x, y: state.player.y, value: 30 }];

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.player.level).toBe(2);
    expect(state.player.skillPoints).toBe(2);
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

    // Tier 1: Lv4 requires 2 SP, Lv5 requires 2 SP (total 7 SP)
    state.player.skillPoints = 1;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(false); // needs 2 SP for Tier1 Lv4
    state.player.skillPoints = 2;
    expect(upgradeSkillNode(state, 'arm_base')).toBe(true); // Lv4 (cost 2)
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
    expect(getPlayerBaseAttackStats(state.player).shotCount).toBe(8);
    expect(getPlayerBaseAttackStats(state.player).homingShots).toBe(2);
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

  it('[APP-GRW-03 & APP-GRW-04] enforces initial 2-slot limit, auto-levels <=Lv duplicates, opens modal for higher-Lv duplicates without duplication, prompts on 3rd unowned gear, and expands via Scrap & Build', () => {
    expect(MAX_EQUIP_SLOTS).toBe(2);

    const state = createGameState({ seed: 606 });
    expect(state.player.maxEquipSlots).toBe(2);
    state.player.equipment = [createEquippedItem('pulse_blade'), createEquippedItem('seeker_drone')];
    expect(state.player.equipment.length).toBe(MAX_EQUIP_SLOTS);

    // Same-or-lower level duplicate item auto-levels up without opening modal
    acquireEquipment(state, createEquippedItem('seeker_drone', 1));
    expect(state.status).toBe('playing');
    expect(state.pendingEquipDrop).toBeNull();
    expect(state.player.equipment.find((e) => e.id === 'seeker_drone')?.level).toBe(2);

    // Higher-level duplicate drop opens equip_choice modal instead of auto-overwriting
    acquireEquipment(state, createEquippedItem('seeker_drone', 5));
    expect(state.status).toBe('equip_choice');
    expect(state.pendingEquipDrop?.item).toMatchObject({ id: 'seeker_drone', level: 5 });
    // Replacing a different slot is blocked so the same equipment cannot be equipped twice
    expect(resolveEquipChoice(state, { type: 'replace', slotIndex: 0 })).toBe(false);
    expect(state.status).toBe('equip_choice');
    // Replacing the matching slot upgrades it cleanly
    expect(resolveEquipChoice(state, { type: 'replace', slotIndex: 1 })).toBe(true);
    expect(state.status).toBe('playing');
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
    expect(state.player.equipment[0]?.id).toBe('ricochet_disc');
    expect(state.player.equipment[0]?.level).toBe(4);

    // Scrap & Build: progressive 1 / 2 / 3 cost unlocks slots 2->3 (1), 3->4 (2), 4->5 (3); mob_loot Lv4 discounts by 1 (min 1)
    expect(getScrapExpandCost(2)).toBe(1);
    expect(getScrapExpandCost(3)).toBe(2);
    expect(getScrapExpandCost(4)).toBe(3);
    expect(getScrapExpandCost(3, 1)).toBe(1);
    expect(getScrapExpandCost(4, 1)).toBe(2);

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

    const startRoom = mustAt(state.map.rooms, 0, 'state.map.rooms');
    const minX = startRoom.x * 40;
    const maxX = (startRoom.x + startRoom.w) * 40;
    const minY = startRoom.y * 40;
    const maxY = (startRoom.y + startRoom.h) * 40;

    const chestInStartRoom = state.chests.find((c) => c.x >= minX && c.x <= maxX && c.y >= minY && c.y <= maxY);
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
    mustAt(state.pickups, 0, 'state.pickups').x = state.player.x;
    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.pickups.length).toBe(0);
    expect(state.player.equipment).toHaveLength(1);
    expect(state.player.equipment[0]).toMatchObject({ id: 'ricochet_disc', level: 4 });
  });

  it('[INV-09 / APP-GRW-04] enforces MAX_EQUIPMENT_LEVEL=8 cap, auto-expands slots on Lv8 duplicates when maxEquipSlots < 5, and grants overflow bonus at cap', () => {
    expect(MAX_EQUIPMENT_LEVEL).toBe(8);
    const state = createGameState({ seed: 940 });

    // Lv8 duplicate pickup auto-allocates into slot expansion when maxEquipSlots < MAX_EQUIP_SLOTS_CAP
    state.player.maxEquipSlots = 2;
    state.player.scrapExpandProgress = 0;
    state.player.equipment = [createEquippedItem('pulse_blade', 8), createEquippedItem('orbit_shield', 5)];
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
    expect(state.player.equipment[0]?.level).toBe(8);
    expect(state.player.hp).toBe(70);
    expect(state.stats.totalExp).toBe(expBefore + 25);

    // scrap_upgrade rejects Lv8 slot
    mustAt(state.player.equipment, 0, 'state.player.equipment').level = 7;
    acquireEquipment(state, createEquippedItem('pulse_blade', 1));
    expect(state.player.equipment[0]?.level).toBe(8);

    state.player.maxEquipSlots = 2;
    state.player.equipment = [createEquippedItem('pulse_blade', 8), createEquippedItem('orbit_shield', 5)];
    acquireEquipment(state, createEquippedItem('seeker_drone', 1));
    expect(state.status).toBe('equip_choice');
    expect(resolveEquipChoice(state, { type: 'scrap_upgrade', slotIndex: 0 })).toBe(false);
    expect(state.status).toBe('equip_choice');
    expect(resolveEquipChoice(state, { type: 'scrap_upgrade', slotIndex: 1 })).toBe(true);
    expect(state.player.equipment[1]?.level).toBe(6);
  });

  it('[APP-GRW-07 & APP-GRW-02] improves drop quality with mob_loot and triggers tactical step + temporary speed boost on projectile hit', () => {
    const minLv2 = [createEquippedItem('pulse_blade', 2), createEquippedItem('orbit_shield', 6)];
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

    // mob_dash triggers charge-based no-damage evasion + invuln extension + speed boost without forced movement
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
    expect(dashState.player.hp).toBe(100);
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

    // Consume 2nd charge after invuln expires (still no damage), then take damage + 1.0s base invuln when out of charges
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
    expect(dashState.player.hp).toBe(100);
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
    expect(dashState.player.hp).toBe(90);
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

  it('[APP-GRW-02 & APP-GRW-05] uses 2-stage SP curve (1SP <=Lv10, 2SP >=Lv11) reaching 20SP at Lv15 and 40SP at Lv25, and applies 2-tier arm_overclock scaling', () => {
    // 1. Verify getLevelUpSkillPoints & actual level-up transitions from Lv1 -> Lv10 -> Lv15 -> Lv25
    for (let lv = 2; lv <= 10; lv++) {
      expect(getLevelUpSkillPoints(lv)).toBe(1);
    }
    for (let lv = 11; lv <= 25; lv++) {
      expect(getLevelUpSkillPoints(lv)).toBe(2);
    }

    const progState = createGameState({ seed: 2020 });
    progState.enemies = [];
    progState.chests = [];
    expect(progState.player.level).toBe(1);
    expect(progState.player.skillPoints).toBe(1);

    const stepOneLevelUp = () => {
      progState.pickups = [
        {
          id: progState.nextEntityId++,
          kind: 'exp',
          x: progState.player.x,
          y: progState.player.y,
          value: progState.player.expToNext,
        },
      ];
      stepGame(progState, { x: 0, y: 0 }, 1 / 60);
    };

    while (progState.player.level < 10) stepOneLevelUp();
    expect(progState.player.level).toBe(10);
    expect(progState.player.skillPoints).toBe(10);

    while (progState.player.level < 15) stepOneLevelUp();
    expect(progState.player.level).toBe(15);
    expect(progState.player.skillPoints).toBe(20);

    while (progState.player.level < 25) stepOneLevelUp();
    expect(progState.player.level).toBe(25);
    expect(progState.player.skillPoints).toBe(40);

    // 2. Completing an entire branch costs 20 SP (Tier1: 7 + Tier2: 8 + Tier3: 5)
    const state = createGameState({ seed: 2020 });
    state.player.level = 15;
    state.player.skillPoints = 20;

    for (let i = 0; i < 5; i++) expect(upgradeSkillNode(state, 'arm_base')).toBe(true);
    for (let i = 0; i < 5; i++) expect(upgradeSkillNode(state, 'arm_parallel')).toBe(true);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true);
    const lv1Stats = getPlayerBaseAttackStats(state.player);
    expect(lv1Stats.cooldown).toBeCloseTo(0.58 * 0.84, 4); // -16%
    expect(lv1Stats.speed).toBe(460 + 100);
    expect(lv1Stats.pierce).toBe(true);
    expect(lv1Stats.shotCount).toBe(8);
    expect(lv1Stats.centerLaserDamage).toBeGreaterThan(0);

    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(true);
    expect(state.player.skillPoints).toBe(0);
    expect(state.player.spentSkillPoints).toBe(20);
    expect(upgradeSkillNode(state, 'arm_overclock')).toBe(false); // Tier 3 capped at Lv2

    const lv2Stats = getPlayerBaseAttackStats(state.player);
    expect(lv2Stats.cooldown).toBeCloseTo(0.58 * 0.68, 4); // -32%
    expect(lv2Stats.speed).toBe(460 + 200);
    expect(lv2Stats.pierce).toBe(true);
    expect(lv2Stats.shotCount).toBe(8);
    expect(lv2Stats.centerLaserDamage).toBeGreaterThan(lv1Stats.centerLaserDamage);
  });

  it('handles higher-level duplicate equipment choices across empty/full slots and safely exits ricochet_disc loop on wall contact', () => {
    // 1. Higher-level duplicate opens equip_choice even with an empty slot
    const emptySlotState = createGameState({ seed: 2023 });
    emptySlotState.player.maxEquipSlots = 3;
    emptySlotState.player.equipment = [createEquippedItem('pulse_blade', 1)];
    acquireEquipment(emptySlotState, createEquippedItem('pulse_blade', 4));
    expect(emptySlotState.status).toBe('equip_choice');
    expect(emptySlotState.pendingEquipDrop?.item).toMatchObject({ id: 'pulse_blade', level: 4 });
    expect(resolveEquipChoice(emptySlotState, { type: 'replace', slotIndex: 0 })).toBe(true);
    expect(emptySlotState.player.equipment).toHaveLength(1);
    expect(emptySlotState.player.equipment[0]).toMatchObject({ id: 'pulse_blade', level: 4 });

    // 2. Same/lower-level duplicate auto-upgrades, while higher-Lv duplicate allows other-slot scrap_upgrade & scrap_expand
    const fullSlotState = createGameState({ seed: 2024 });
    fullSlotState.player.maxEquipSlots = 2;
    fullSlotState.player.equipment = [createEquippedItem('pulse_blade', 2), createEquippedItem('seeker_drone', 2)];
    // Lower/equal level duplicate -> auto Lv+1
    acquireEquipment(fullSlotState, createEquippedItem('pulse_blade', 2));
    expect(fullSlotState.status).toBe('playing');
    expect(fullSlotState.player.equipment[0]?.level).toBe(3);

    // +1 level duplicate item also auto-levels up without opening modal
    acquireEquipment(fullSlotState, createEquippedItem('pulse_blade', 4));
    expect(fullSlotState.status).toBe('playing');
    expect(fullSlotState.player.equipment[0]?.level).toBe(4);

    // +2 or higher level duplicate -> modal, blocks replacing other slot, allows scrap_upgrade on other slot
    acquireEquipment(fullSlotState, createEquippedItem('pulse_blade', 6));
    expect(fullSlotState.status).toBe('equip_choice');
    expect(resolveEquipChoice(fullSlotState, { type: 'replace', slotIndex: 1 })).toBe(false);
    expect(fullSlotState.status).toBe('equip_choice');
    expect(resolveEquipChoice(fullSlotState, { type: 'scrap_upgrade', slotIndex: 1 })).toBe(true);
    expect(fullSlotState.status).toBe('playing');
    expect(fullSlotState.player.equipment[0]?.level).toBe(4);
    expect(fullSlotState.player.equipment[1]?.level).toBe(3);

    // Higher-level duplicate also allows scrap_expand
    acquireEquipment(fullSlotState, createEquippedItem('pulse_blade', 6));
    expect(fullSlotState.status).toBe('equip_choice');
    expect(resolveEquipChoice(fullSlotState, { type: 'scrap_expand' })).toBe(true);
    expect(fullSlotState.status).toBe('playing');
    expect(fullSlotState.player.maxEquipSlots).toBe(3);

    // 3. Ricochet disc loop prefers wall-free side when one side is walled, and safely exits loop without sticking when walled on both sides
    const preferClearState = createGameState({ seed: 20251 });
    preferClearState.chests = [];
    preferClearState.pickups = [];
    preferClearState.player.baseAttackCooldown = 999;
    preferClearState.map.tiles.fill('floor');
    const cPtx = 5;
    const cPty = 5;
    const cCenter = tileCenterWorld(cPtx, cPty);
    preferClearState.player.x = cCenter.x;
    preferClearState.player.y = cCenter.y;
    for (let tx = cPtx - 1; tx <= cPtx + 3; tx++) {
      preferClearState.map.tiles[(cPty + 1) * preferClearState.map.width + tx] = 'wall';
    }
    preferClearState.player.equipment = [createEquippedItem('ricochet_disc', 1)];
    preferClearState.enemies = [
      {
        id: 9959,
        x: cCenter.x + 55,
        y: cCenter.y,
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
      stepGame(preferClearState, { x: 0, y: 0 }, 1 / 60);
    }
    const clearSideDisc = mustDefined(
      preferClearState.projectiles.find((p) => p.kind === 'disc' && p.loopTargetEnemyId === 9959),
      'clearSideDisc',
    );
    expect(mustDefined(clearSideDisc.loopCenterY, 'clearSideDisc.loopCenterY')).toBeLessThan(cCenter.y);
    expect(clearSideDisc.loopDir).toBe(-1);

    // When both loop sides collide with walls, loop cancels cleanly and disc keeps moving without sticking
    const wallDiscState = createGameState({ seed: 2025 });
    wallDiscState.chests = [];
    wallDiscState.pickups = [];
    wallDiscState.player.baseAttackCooldown = 999;
    wallDiscState.map.tiles.fill('floor');

    const ptx = 4;
    const pty = 4;
    const pCenter = tileCenterWorld(ptx, pty);
    wallDiscState.player.x = pCenter.x;
    wallDiscState.player.y = pCenter.y;
    // Narrow 1-tile corridor around enemy at tile (5, 4) so any 32px loop touches wall tiles
    wallDiscState.map.tiles[(pty - 1) * wallDiscState.map.width + (ptx + 1)] = 'wall';
    wallDiscState.map.tiles[(pty + 1) * wallDiscState.map.width + (ptx + 1)] = 'wall';
    wallDiscState.map.tiles[pty * wallDiscState.map.width + (ptx + 2)] = 'wall';
    wallDiscState.map.tiles[(pty - 1) * wallDiscState.map.width + ptx] = 'wall';
    wallDiscState.map.tiles[(pty + 1) * wallDiscState.map.width + ptx] = 'wall';

    wallDiscState.player.equipment = [createEquippedItem('ricochet_disc', 1)];
    const enemyCenter = tileCenterWorld(ptx + 1, pty);
    wallDiscState.enemies = [
      {
        id: 9960,
        x: enemyCenter.x,
        y: enemyCenter.y,
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

    let sawLoopStart = false;
    let exitedLoopOnWall = false;
    let lastPosAfterExit: { x: number; y: number } | null = null;
    let movedAfterExit = false;

    for (let f = 0; f < 30; f++) {
      stepGame(wallDiscState, { x: 0, y: 0 }, 1 / 60);
      mustAt(wallDiscState.player.equipment, 0, 'wallDiscState.player.equipment').cooldown = 5;
      const disc = wallDiscState.projectiles.find((p) => p.kind === 'disc');
      if (!disc) break;
      if (disc.loopCenterX !== undefined) {
        if (!sawLoopStart) {
          sawLoopStart = true;
          // Move enemy out of the narrow corridor after hit so post-exit flight distance is clearly observed
          mustAt(wallDiscState.enemies, 0, 'wallDiscState.enemies').x = pCenter.x - 100;
        }
      } else if (sawLoopStart) {
        exitedLoopOnWall = true;
        if (lastPosAfterExit) {
          if (Math.hypot(disc.x - lastPosAfterExit.x, disc.y - lastPosAfterExit.y) > 0.5) {
            movedAfterExit = true;
          }
        }
        lastPosAfterExit = { x: disc.x, y: disc.y };
      }
    }

    expect(sawLoopStart).toBe(true);
    expect(exitedLoopOnWall).toBe(true);
    expect(movedAfterExit).toBe(true);
  });
});
