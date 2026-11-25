import { resolveCircleGridCollision } from '../../core/collision';
import { type DungeonMap, findRoomAtTile, TILE_SIZE, tileCenterWorld } from '../../core/dungeon';
import { pushNotification } from '../effects';
import { createEquippedItem, type EquipmentId, type EquippedItem } from '../equipment';
import type { GameState, Vec2 } from '../types';

export interface PlayerStepDeps {
  getStairsLockCount: (state: GameState) => number;
  advanceToNextFloor: (state: GameState) => void;
  pickChestDrop: (state: GameState, chestId: number) => { id: EquipmentId; level: number };
  acquireEquipment: (state: GameState, droppedItem: EquippedItem) => void;
}

export function revealAroundPlayer(map: DungeonMap, explored: Uint8Array, px: number, py: number): void {
  const ptx = Math.floor(px / TILE_SIZE);
  const pty = Math.floor(py / TILE_SIZE);
  const room = findRoomAtTile(map, ptx, pty);

  if (room) {
    const minY = Math.max(0, room.y - 1);
    const maxY = Math.min(map.height - 1, room.y + room.h);
    const minX = Math.max(0, room.x - 1);
    const maxX = Math.min(map.width - 1, room.x + room.w);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        explored[ty * map.width + tx] = 1;
      }
    }
  }

  // Corridor vision radius (~4.7 tiles) also smoothly connects doorways when inside a room
  const radiusTiles = room ? 3 : 5;
  const r2 = room ? 9 : 22;
  const minY = Math.max(0, pty - radiusTiles);
  const maxY = Math.min(map.height - 1, pty + radiusTiles);
  const minX = Math.max(0, ptx - radiusTiles);
  const maxX = Math.min(map.width - 1, ptx + radiusTiles);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const dx = tx - ptx;
      const dy = ty - pty;
      if (dx * dx + dy * dy <= r2) {
        explored[ty * map.width + tx] = 1;
      }
    }
  }
}

export function stepPlayerAndInteractables(
  state: GameState,
  rawInput: Vec2,
  clampedDt: number,
  deps: PlayerStepDeps,
): boolean {
  const { player, map } = state;

  // 1. Player movement & smooth wall collision (APP-MAP-02)
  const prevPlayerX = player.x;
  const prevPlayerY = player.y;
  const activeSpeedBonus = (player.tacticalSpeedTimer ?? 0) > 0 ? (player.tacticalSpeedBonus ?? 0) : 0;
  const moveSpeed = player.baseSpeed * (1 + activeSpeedBonus);
  const inputMag = Math.hypot(rawInput.x, rawInput.y);
  if (inputMag > 1e-4) {
    const scale = inputMag > 1 ? 1 / inputMag : 1;
    const vx = rawInput.x * scale * moveSpeed;
    const vy = rawInput.y * scale * moveSpeed;
    const resolved = resolveCircleGridCollision(
      player.x + vx * clampedDt,
      player.y + vy * clampedDt,
      player.radius,
      map,
    );
    player.x = resolved.x;
    player.y = resolved.y;
    player.facingAngle = Math.atan2(vy, vx);
    revealAroundPlayer(map, state.explored, player.x, player.y);
  }
  const actualVx = (player.x - prevPlayerX) / clampedDt;
  const actualVy = (player.y - prevPlayerY) / clampedDt;
  const velAlpha = 1 - Math.exp(-clampedDt * 10);
  player.velX = (player.velX ?? 0) + (actualVx - (player.velX ?? 0)) * velAlpha;
  player.velY = (player.velY ?? 0) + (actualVy - (player.velY ?? 0)) * velAlpha;

  // 2. Fountain check (Boss floor safe anteroom 100% heal once)
  if (map.fountainTile && !state.fountainUsed) {
    const fountainPos = tileCenterWorld(map.fountainTile.tx, map.fountainTile.ty);
    if (Math.hypot(player.x - fountainPos.x, player.y - fountainPos.y) <= TILE_SIZE * 0.65) {
      player.hp = player.maxHp;
      state.fountainUsed = true;
      state.floatingTexts.push({
        x: player.x,
        y: player.y - 24,
        text: 'FOUNTAIN 100% HP!',
        color: '#2dd4bf',
        life: 1.4,
        maxLife: 1.4,
      });
      state.visualFx.push({
        kind: 'pulse',
        x: fountainPos.x,
        y: fountainPos.y,
        radius: 76,
        color: '#2dd4bf',
        life: 0.55,
        maxLife: 0.55,
      });
      pushNotification(state, 'info', '⛲ 回復の泉でHPが全回復した！', '#2dd4bf', 2.8);
    }
  }

  // 2.5. Stairs check -> unlockable only after defeating mid-boss/grand boss (APP-MAP-01)
  const stairsPos = tileCenterWorld(map.stairsTile.tx, map.stairsTile.ty);
  if (Math.hypot(player.x - stairsPos.x, player.y - stairsPos.y) <= TILE_SIZE * 0.52) {
    const lockCount = deps.getStairsLockCount(state);
    if (lockCount <= 0) {
      deps.advanceToNextFloor(state);
      return true;
    }
    if ((state.stairsNoticeCooldown ?? 0) <= 0) {
      pushNotification(state, 'alert', `🔒 階段は封印中！ボス（残り${lockCount}体）を倒せ！`, '#f43f5e', 2.4);
      state.stairsNoticeCooldown = 2.0;
    }
  }

  // 3. Chest check -> acquire/upgrade equipment or trigger slot choice modal (APP-GRW-03/04/07)
  for (const chest of state.chests) {
    if (!chest.opened && Math.hypot(player.x - chest.x, player.y - chest.y) <= player.radius + 16) {
      chest.opened = true;
      state.stats.chestsOpened += 1;
      const drop = deps.pickChestDrop(state, chest.id);
      deps.acquireEquipment(state, createEquippedItem(drop.id, drop.level));
      if (state.status !== 'playing') return true;
    }
  }

  return false;
}
