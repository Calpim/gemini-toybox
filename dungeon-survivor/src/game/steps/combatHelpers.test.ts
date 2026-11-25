import { describe, expect, it } from 'vitest';
import { type DungeonMap, type TileType, tileCenterWorld } from '../../core/dungeon';
import { createGameState } from '../engine';
import { createEnemyByKind } from '../spawn';
import { triggerChainLightning } from './combatHelpers';

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
});
