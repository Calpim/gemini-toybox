import { findRoomAtTile, TILE_SIZE } from '../core/dungeon';
import { getStairsLockCount, isPointInPlayerVision } from '../game/engine';
import type { GameState } from '../game/types';
import { drawGlowSprite } from './sprites';

/**
 * Renders the dedicated futuristic radar-grid HUD minimap into a standalone canvas.
 */
export function renderHudMinimap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  nowSec: number,
): void {
  if (width <= 0 || height <= 0) return;

  const { map, explored, player } = state;
  const stairsLocked = getStairsLockCount(state) > 0;

  ctx.save();

  // 1. Deep dark navy radar background
  ctx.fillStyle = '#040a16';
  ctx.fillRect(0, 0, width, height);

  // 2. Fine cyan radar grid lines
  const gridStep = Math.max(8, Math.round(Math.min(width, height) / 8));
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = gridStep; gx < width; gx += gridStep) {
    const x = Math.floor(gx) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let gy = gridStep; gy < height; gy += gridStep) {
    const y = Math.floor(gy) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // 3. Fit explored dungeon (with comfortable minimum span & padding) cleanly into width x height
  const pTileX = player.x / TILE_SIZE;
  const pTileY = player.y / TILE_SIZE;
  let minTx = Math.floor(pTileX);
  let maxTx = Math.floor(pTileX);
  let minTy = Math.floor(pTileY);
  let maxTy = Math.floor(pTileY);
  let hasExploredFloor = false;

  for (let ty = 0; ty < map.height; ty++) {
    const rowOff = ty * map.width;
    for (let tx = 0; tx < map.width; tx++) {
      const idx = rowOff + tx;
      if (!explored[idx] || map.tiles[idx] === 'wall') continue;
      if (!hasExploredFloor) {
        minTx = tx;
        maxTx = tx;
        minTy = ty;
        maxTy = ty;
        hasExploredFloor = true;
      } else {
        if (tx < minTx) minTx = tx;
        if (tx > maxTx) maxTx = tx;
        if (ty < minTy) minTy = ty;
        if (ty > maxTy) maxTy = ty;
      }
    }
  }

  // Ensure player tile is always included in bounds
  minTx = Math.min(minTx, Math.floor(pTileX));
  maxTx = Math.max(maxTx, Math.floor(pTileX));
  minTy = Math.min(minTy, Math.floor(pTileY));
  maxTy = Math.max(maxTy, Math.floor(pTileY));

  const marginTiles = 2;
  const minSpan = Math.min(Math.max(map.width, map.height), 18);
  const rawSpanX = maxTx - minTx + 1 + marginTiles * 2;
  const rawSpanY = maxTy - minTy + 1 + marginTiles * 2;
  const viewSpanX = Math.min(map.width, Math.max(minSpan, rawSpanX));
  const viewSpanY = Math.min(map.height, Math.max(minSpan, rawSpanY));

  const centerX = (minTx + maxTx + 1) / 2;
  const centerY = (minTy + maxTy + 1) / 2;
  const viewMinX = Math.max(0, Math.min(map.width - viewSpanX, centerX - viewSpanX / 2));
  const viewMinY = Math.max(0, Math.min(map.height - viewSpanY, centerY - viewSpanY / 2));

  const pad = 5;
  const usableW = Math.max(8, width - pad * 2);
  const usableH = Math.max(8, height - pad * 2);
  const cell = Math.min(usableW / Math.max(1, viewSpanX), usableH / Math.max(1, viewSpanY));
  const ox = (width - viewSpanX * cell) / 2;
  const oy = (height - viewSpanY * cell) / 2;

  const toScreenX = (tileX: number) => ox + (tileX - viewMinX) * cell;
  const toScreenY = (tileY: number) => oy + (tileY - viewMinY) * cell;

  const px = toScreenX(pTileX);
  const py = toScreenY(pTileY);

  // 4. Subtle radial cyan glow centered on player's minimap position
  const radarGlowR = Math.min(width, height) * 0.44;
  if (typeof ctx.createRadialGradient === 'function') {
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radarGlowR);
    grad.addColorStop(0, 'rgba(34, 211, 238, 0.28)');
    grad.addColorStop(0.45, 'rgba(14, 165, 233, 0.11)');
    grad.addColorStop(1, 'rgba(4, 10, 22, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else {
    drawGlowSprite(ctx, 'cyan', px, py, radarGlowR, 0.35, false);
  }

  // 5. Explored floor tiles (corridors vs slightly brighter rooms) & special tiles
  const drawSize = Math.max(1, cell + 0.35);
  let stairsScreen: { x: number; y: number } | null = null;
  let fountainScreen: { x: number; y: number } | null = null;

  for (let ty = 0; ty < map.height; ty++) {
    const rowOff = ty * map.width;
    for (let tx = 0; tx < map.width; tx++) {
      const idx = rowOff + tx;
      if (!explored[idx]) continue;
      const tile = map.tiles[idx];
      if (tile === 'wall') continue;

      const sx = toScreenX(tx);
      const sy = toScreenY(ty);
      const inRoom = findRoomAtTile(map, tx, ty) !== null;

      ctx.fillStyle = inRoom ? 'rgba(125, 211, 252, 0.34)' : 'rgba(125, 211, 252, 0.22)';
      ctx.fillRect(sx, sy, drawSize, drawSize);

      if (tile === 'stairs') {
        stairsScreen = { x: sx + cell / 2, y: sy + cell / 2 };
      } else if (tile === 'fountain') {
        fountainScreen = { x: sx + cell / 2, y: sy + cell / 2 };
      }
    }
  }

  // Crisp subtle borders around explored rooms
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
  ctx.lineWidth = 1;
  for (const room of map.rooms) {
    let roomExplored = false;
    for (let ry = room.y; ry < room.y + room.h && !roomExplored; ry++) {
      for (let rx = room.x; rx < room.x + room.w; rx++) {
        if (explored[ry * map.width + rx]) {
          roomExplored = true;
          break;
        }
      }
    }
    if (!roomExplored) continue;
    ctx.strokeRect(
      toScreenX(room.x) + 0.5,
      toScreenY(room.y) + 0.5,
      Math.max(2, room.w * cell - 1),
      Math.max(2, room.h * cell - 1),
    );
  }

  // 6. Fountain marker (teal when unused, muted slate when used)
  if (fountainScreen) {
    const r = Math.max(2, cell * 0.52);
    ctx.fillStyle = state.fountainUsed ? '#475569' : '#2dd4bf';
    ctx.beginPath();
    ctx.arc(fountainScreen.x, fountainScreen.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Stairs marker (cyan when open, rose when locked)
  if (stairsScreen) {
    const r = Math.max(2.2, cell * 0.58);
    drawGlowSprite(ctx, stairsLocked ? 'rose' : 'cyan', stairsScreen.x, stairsScreen.y, r * 2.6, 0.6, true);
    ctx.fillStyle = stairsLocked ? '#fb7185' : '#22d3ee';
    ctx.beginPath();
    ctx.arc(stairsScreen.x, stairsScreen.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = stairsLocked ? '#ffe4e6' : '#ecfeff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 8. Unopened chests within explored tiles (amber)
  ctx.fillStyle = '#fbbf24';
  const chestSize = Math.max(2.4, cell * 0.85);
  for (const chest of state.chests) {
    if (chest.opened) continue;
    const ctxTx = Math.floor(chest.x / TILE_SIZE);
    const ctxTy = Math.floor(chest.y / TILE_SIZE);
    if (ctxTx >= 0 && ctxTy >= 0 && ctxTx < map.width && ctxTy < map.height && explored[ctxTy * map.width + ctxTx]) {
      const cx = toScreenX(chest.x / TILE_SIZE);
      const cy = toScreenY(chest.y / TILE_SIZE);
      ctx.fillRect(cx - chestSize / 2, cy - chestSize / 2, chestSize, chestSize);
    }
  }

  // 9. Awake bosses/enemies currently in vision (subtle red dots)
  for (const enemy of state.enemies) {
    const visible = enemy.isAmbush || (enemy.awake && isPointInPlayerVision(map, player.x, player.y, enemy.x, enemy.y));
    if (!visible) continue;

    const ex = toScreenX(enemy.x / TILE_SIZE);
    const ey = toScreenY(enemy.y / TILE_SIZE);
    const isBoss = Boolean(enemy.isGrandBoss || enemy.isRoomBoss);
    const er = isBoss ? Math.max(2.2, cell * 0.52) : Math.max(1.3, cell * 0.32);

    ctx.fillStyle = isBoss ? '#f43f5e' : 'rgba(251, 113, 133, 0.82)';
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
  }

  // 10. Player bright glowing cyan core dot with subtle pulse halo
  const pulse = 0.65 + 0.35 * Math.sin(nowSec * 5);
  const coreR = Math.max(2.3, cell * 0.56);

  drawGlowSprite(ctx, 'cyan', px, py, coreR * 3.8, 0.65 * pulse, true);

  ctx.strokeStyle = `rgba(103, 232, 249, ${0.5 * pulse})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(px, py, coreR + 2 + pulse * 1.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(px, py, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ecfeff';
  ctx.beginPath();
  ctx.arc(px, py, coreR * 0.52, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}
