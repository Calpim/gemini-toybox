import { describe, expect, it } from 'vitest';
import { type DungeonMap, TILE_SIZE, type TileType, tileCenterWorld } from '../../core/dungeon';
import { CORRIDOR_VISION_RADIUS, createGameState } from '../engine';
import { createEnemyByKind } from '../spawn';
import { findNearestVisibleEnemy, triggerChainLightning } from './combatHelpers';

const SIZE = 7;
const DAMAGE = 10;

/** 7x7 の全床マップ。wallRow を渡すとその行(ty)を横一列の壁にする。 */
function createTestMap(wallRow?: number): DungeonMap {
  const tiles: TileType[] = new Array(SIZE * SIZE).fill('floor');
  if (wallRow !== undefined) {
    for (let tx = 0; tx < SIZE; tx++) tiles[wallRow * SIZE + tx] = 'wall';
  }
  return {
    width: SIZE,
    height: SIZE,
    tiles,
    rooms: [],
    startTile: { tx: 0, ty: 0 },
    stairsTile: { tx: SIZE - 1, ty: SIZE - 1 },
    floorType: 'normal',
    floor: 1,
    seed: 1,
  };
}

/** 同じ列(tx=3)に、起点→1体目(ty=1)→2体目(ty=5)と縦に並べた状態を作る。 */
function createVerticalLineState(wallRow?: number) {
  const state = createGameState({ seed: 1 });
  state.map = createTestMap(wallRow);
  const source = tileCenterWorld(3, 0);
  state.player.x = source.x;
  state.player.y = source.y;
  const firstPos = tileCenterWorld(3, 1);
  const secondPos = tileCenterWorld(3, 5);
  const first = createEnemyByKind(1, 'normal', firstPos.x, firstPos.y, 1);
  const second = createEnemyByKind(2, 'normal', secondPos.x, secondPos.y, 1);
  state.enemies = [first, second];
  return { state, source, first, second };
}

describe('triggerChainLightning', () => {
  it('chains to the next enemy when nothing blocks the line of sight', () => {
    const { state, source, first, second } = createVerticalLineState();
    const firstHp = first.hp;
    const secondHp = second.hp;

    expect(triggerChainLightning(state, source.x, source.y, 200, DAMAGE)).toBe(true);

    expect(first.hp).toBe(firstHp - DAMAGE);
    expect(second.hp).toBe(secondHp - DAMAGE * 0.8);
  });

  it('does not chain through a wall between the current and next target (candidate.y regression)', () => {
    // 1体目(ty=1)と2体目(ty=5)の間、ty=3 に壁。2体は同じ x なので、
    // LOS の終点 y を curr.y にしてしまうバグがあると壁を無視して連鎖してしまう。
    const { state, source, first, second } = createVerticalLineState(3);
    const firstHp = first.hp;
    const secondHp = second.hp;

    expect(triggerChainLightning(state, source.x, source.y, 200, DAMAGE)).toBe(true);

    expect(first.hp).toBe(firstHp - DAMAGE);
    expect(second.hp).toBe(secondHp);
  });

  it('does not chain to an enemy outside player vision in a corridor', () => {
    const state = createGameState({ seed: 1 });
    const wideWidth = 12;
    state.map = {
      width: wideWidth,
      height: SIZE,
      tiles: new Array(wideWidth * SIZE).fill('floor'),
      rooms: [],
      startTile: { tx: 0, ty: 0 },
      stairsTile: { tx: wideWidth - 1, ty: SIZE - 1 },
      floorType: 'normal',
      floor: 1,
      seed: 1,
    };
    const source = tileCenterWorld(1, 3);
    state.player.x = source.x;
    state.player.y = source.y;
    const first = createEnemyByKind(1, 'normal', source.x + 120, source.y, 1);
    const outOfVision = createEnemyByKind(2, 'normal', source.x + CORRIDOR_VISION_RADIUS + 40, source.y, 1);
    state.enemies = [first, outOfVision];
    const firstHp = first.hp;
    const outOfVisionHp = outOfVision.hp;

    expect(triggerChainLightning(state, source.x, source.y, 180, DAMAGE)).toBe(true);

    expect(first.hp).toBe(firstHp - DAMAGE);
    expect(outOfVision.hp).toBe(outOfVisionHp);
  });
});

describe('findNearestVisibleEnemy vision filtering', () => {
  function createCorridorState(enemyDist: number, isAmbush = false) {
    const width = 14;
    const state = createGameState({ seed: 1 });
    state.map = {
      width,
      height: SIZE,
      tiles: new Array(width * SIZE).fill('floor'),
      rooms: [],
      startTile: { tx: 0, ty: 0 },
      stairsTile: { tx: width - 1, ty: SIZE - 1 },
      floorType: 'normal',
      floor: 1,
      seed: 1,
    };
    const origin = tileCenterWorld(1, 3);
    state.player.x = origin.x;
    state.player.y = origin.y;
    const enemy = createEnemyByKind(1, 'normal', origin.x + enemyDist, origin.y, 1);
    enemy.isAmbush = isAmbush;
    state.enemies = [enemy];
    return { state, origin, enemy };
  }

  it('[INV-06] ignores enemies beyond CORRIDOR_VISION_RADIUS in a corridor even when allowExceedMaxRange is true', () => {
    const { state, origin } = createCorridorState(CORRIDOR_VISION_RADIUS + 40);
    expect(findNearestVisibleEnemy(origin.x, origin.y, 400, state, [], true)).toBeNull();
  });

  it('targets enemies beyond CORRIDOR_VISION_RADIUS when player and enemy are in the same room', () => {
    const { state, origin, enemy } = createCorridorState(CORRIDOR_VISION_RADIUS + 40);
    const enemyTileX = Math.floor(enemy.x / TILE_SIZE);
    state.map.rooms = [{ id: 0, x: 1, y: 1, w: enemyTileX + 1, h: 5, cx: 4, cy: 3 }];

    expect(findNearestVisibleEnemy(origin.x, origin.y, 400, state, [], true)).toBe(enemy);
  });

  it('targets ambush enemies even beyond CORRIDOR_VISION_RADIUS when line of sight is clear', () => {
    const { state, origin, enemy } = createCorridorState(CORRIDOR_VISION_RADIUS + 40, true);
    expect(findNearestVisibleEnemy(origin.x, origin.y, 400, state, [], true)).toBe(enemy);
  });
});
