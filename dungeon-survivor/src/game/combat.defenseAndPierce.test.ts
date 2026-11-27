import { describe, expect, it } from 'vitest';
import { tileCenterWorld } from '../core/dungeon';
import { mustAt } from '../testUtils';
import { createEnemyByKind, createGameState, getOrbitBitPositions, stepGame } from './engine';
import { createEquippedItem } from './equipment';

describe('Defense, parry, and pierceDefense combat simulation', () => {
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
    const pShot = mustAt(piercingShots, 0, 'piercingShots');
    pShot.x = pierceState.player.x + 40;
    pShot.y = pierceState.player.y;
    pShot.vx = -50;
    pShot.vy = 0;
    mustAt(pierceState.player.equipment, 0, 'pierceState.player.equipment').cooldown = 0;
    stepGame(pierceState, { x: 0, y: 0 }, 0.016);
    expect(pierceState.enemyProjectiles.some((ep) => ep.id === pShot.id)).toBe(true);
    expect(pierceState.projectiles.some((p) => p.kind === 'reflected')).toBe(false);

    // 4. Awakened tank fires mortar in the same room even when a wall blocks LOS, and awakened shooter keeps firing within 380px
    const losBlockedState = createGameState({ seed: 984, startFloor: 2 });
    losBlockedState.chests = [];
    losBlockedState.pickups = [];
    losBlockedState.player.baseAttackCooldown = 999;
    const room = mustAt(losBlockedState.map.rooms, 0, 'losBlockedState.map.rooms');
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

  it('[BUG-30] skips pierceDefense shots in pulse_blade/orbit_shield and bypasses def_aegis parry for pierceDefense, mortar, and bossLaser', () => {
    // 1. pulse_blade must NOT trigger idle slash FX/sound/CD when only pierceDefense projectiles are in range
    const bladeState = createGameState({ seed: 3001 });
    bladeState.chests = [];
    bladeState.pickups = [];
    bladeState.enemies = [];
    bladeState.map.tiles.fill('floor');
    bladeState.player.baseAttackCooldown = 999;
    bladeState.player.equipment = [createEquippedItem('pulse_blade', 3)];
    mustAt(bladeState.player.equipment, 0, 'bladeState.player.equipment').cooldown = 0;
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
    expect(bladeState.player.equipment[0]?.cooldown).toBe(0);
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
    const firstBit = mustAt(bits, 0, 'bits');
    shieldState.enemyProjectiles = [
      {
        id: 8802,
        x: firstBit.x,
        y: firstBit.y,
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
        x: firstBit.x,
        y: firstBit.y,
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
