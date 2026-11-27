import { hasLineOfSight } from '../core/collision';
import { type DungeonMap, findRoomAtTile, isTileInRoom, TILE_SIZE } from '../core/dungeon';
import type { EnemyState, GameState } from './types';

export const CORRIDOR_VISION_RADIUS = 210;

export function isPointInPlayerVision(
  map: DungeonMap,
  px: number,
  py: number,
  wx: number,
  wy: number,
  corridorRadius = CORRIDOR_VISION_RADIUS,
): boolean {
  const ptx = Math.floor(px / TILE_SIZE);
  const pty = Math.floor(py / TILE_SIZE);
  const activeRoom = findRoomAtTile(map, ptx, pty);
  if (activeRoom) {
    const wtx = Math.floor(wx / TILE_SIZE);
    const wty = Math.floor(wy / TILE_SIZE);
    if (isTileInRoom(activeRoom, wtx, wty, 1)) {
      return true;
    }
  }
  const dist = Math.hypot(wx - px, wy - py);
  return dist <= corridorRadius && hasLineOfSight(px, py, wx, wy, map);
}

/**
 * プレイヤーの視界内にいる敵かどうかを判定する。
 * 描画レイヤー (renderEnemies) と自動攻撃ターゲティングで共通利用する。
 */
export function isEnemyVisibleToPlayer(
  state: GameState,
  enemy: EnemyState,
  corridorRadius = CORRIDOR_VISION_RADIUS,
): boolean {
  return (
    Boolean(enemy.isAmbush) ||
    isPointInPlayerVision(state.map, state.player.x, state.player.y, enemy.x, enemy.y, corridorRadius)
  );
}
