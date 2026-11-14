import { describe, expect, it } from 'vitest';
import { tileCenterWorld } from '../core/dungeon';
import { createGameState, stepGame } from './engine';

describe('Game simulation engine (APP-MAP-01 / APP-MAP-03 / APP-CMB-01 / APP-CMB-03)', () => {
  it('[APP-MAP-03] does not regenerate HP over time and heals only on recovery orb pickup', () => {
    const state = createGameState({ seed: 100 });
    state.enemies = [];
    state.pickups = [];
    state.player.hp = 60;
    expect(state.player.autoRegenPerSec).toBe(0);

    // Simulate 10 seconds with zero pickups
    for (let i = 0; i < 300; i++) {
      stepGame(state, { x: 0, y: 0 }, 1 / 30);
    }
    expect(state.player.hp).toBe(60);

    // Place a recovery orb right on the player
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

    // Place a wall directly between player and enemy and reset cooldown
    const wallTx = Math.floor((state.player.x + 40) / 40);
    const wallTy = Math.floor(state.player.y / 40);
    state.map.tiles[wallTy * state.map.width + wallTx] = 'wall';
    state.projectiles = [];
    state.player.blasterCooldown = 0;

    stepGame(state, { x: 0, y: 0 }, 1 / 60);
    expect(state.projectiles.length).toBe(0);
  });
});
