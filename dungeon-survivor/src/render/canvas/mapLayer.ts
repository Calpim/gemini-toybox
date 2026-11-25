import { type DungeonMap, TILE_SIZE, getTile, tileCenterWorld } from '../../core/dungeon';
import { EQUIPMENT_CATALOG } from '../../game/equipment';
import type { GameState } from '../../game/types';
import { drawGlowSprite, drawWallTile } from '../sprites';

function drawWallEdgesAndNotches(
  ctx: CanvasRenderingContext2D,
  map: DungeonMap,
  tx: number,
  ty: number,
  px: number,
  py: number,
): void {
  const openTop = getTile(map, tx, ty - 1) !== 'wall';
  const openBottom = getTile(map, tx, ty + 1) !== 'wall';
  const openLeft = getTile(map, tx - 1, ty) !== 'wall';
  const openRight = getTile(map, tx + 1, ty) !== 'wall';

  const glowDepth = 6;
  const rimWidth = 2;

  // Floor-facing cyan neon rim highlights + subtle inward cyan sheen
  if (openTop) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py, TILE_SIZE, glowDepth);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py, TILE_SIZE, rimWidth);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py, TILE_SIZE, 1);
  }
  if (openBottom) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py + TILE_SIZE - glowDepth, TILE_SIZE, glowDepth);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py + TILE_SIZE - rimWidth, TILE_SIZE, rimWidth);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py + TILE_SIZE - 1, TILE_SIZE, 1);
  }
  if (openLeft) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px, py, glowDepth, TILE_SIZE);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px, py, rimWidth, TILE_SIZE);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px, py, 1, TILE_SIZE);
  }
  if (openRight) {
    ctx.fillStyle = 'rgba(34, 211, 238, 0.16)';
    ctx.fillRect(px + TILE_SIZE - glowDepth, py, glowDepth, TILE_SIZE);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.72)';
    ctx.fillRect(px + TILE_SIZE - rimWidth, py, rimWidth, TILE_SIZE);
    ctx.fillStyle = 'rgba(165, 243, 252, 0.8)';
    ctx.fillRect(px + TILE_SIZE - 1, py, 1, TILE_SIZE);
  }

  // Convex corner accent caps (doorway / pillar edges where two open sides meet)
  const cap = 4;
  ctx.fillStyle = 'rgba(165, 243, 252, 0.92)';
  if (openTop && openLeft) ctx.fillRect(px, py, cap, cap);
  if (openTop && openRight) ctx.fillRect(px + TILE_SIZE - cap, py, cap, cap);
  if (openBottom && openLeft) ctx.fillRect(px, py + TILE_SIZE - cap, cap, cap);
  if (openBottom && openRight) ctx.fillRect(px + TILE_SIZE - cap, py + TILE_SIZE - cap, cap, cap);

  // Concave chamber corner accent notches (diagonal neighbor is open floor while orthogonal neighbors are walls)
  const notch = 7;
  const drawOuterCornerSlash = (x1: number, y1: number, x2: number, y2: number, ix: number, iy: number) => {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(165, 243, 252, 0.85)';
    ctx.fillRect(ix, iy, 2.5, 2.5);
  };

  if (!openBottom && !openRight && getTile(map, tx + 1, ty + 1) !== 'wall') {
    drawOuterCornerSlash(px + 2, py + notch, px + notch, py + 2, px + TILE_SIZE - 2.5, py + TILE_SIZE - 2.5);
  }
  if (!openBottom && !openLeft && getTile(map, tx - 1, ty + 1) !== 'wall') {
    drawOuterCornerSlash(px + TILE_SIZE - notch, py + 2, px + TILE_SIZE - 2, py + notch, px, py + TILE_SIZE - 2.5);
  }
  if (!openTop && !openRight && getTile(map, tx + 1, ty - 1) !== 'wall') {
    drawOuterCornerSlash(px + 2, py + TILE_SIZE - notch, px + notch, py + TILE_SIZE - 2, px + TILE_SIZE - 2.5, py);
  }
  if (!openTop && !openLeft && getTile(map, tx - 1, ty - 1) !== 'wall') {
    drawOuterCornerSlash(
      px + TILE_SIZE - notch,
      py + TILE_SIZE - 2,
      px + TILE_SIZE - 2,
      py + TILE_SIZE - notch,
      px,
      py,
    );
  }
}

function drawFloorStardust(
  ctx: CanvasRenderingContext2D,
  map: DungeonMap,
  tx: number,
  ty: number,
  px: number,
  py: number,
  nowSec: number,
): void {
  const nearWall =
    getTile(map, tx - 1, ty) === 'wall' ||
    getTile(map, tx + 1, ty) === 'wall' ||
    getTile(map, tx, ty - 1) === 'wall' ||
    getTile(map, tx, ty + 1) === 'wall';

  const seed = Math.imul(tx + 31, 374761393) ^ Math.imul(ty + 17, 668265263);
  const h = (seed ^ (seed >>> 13)) >>> 0;
  const threshold = nearWall ? 0.7 : 0.22;
  if ((h & 0xff) / 255 > threshold) return;

  const count = nearWall && ((h >>> 8) & 1) === 1 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const sh = Math.imul(h ^ (i * 2246822519), 3266489917) >>> 0;
    const fx = ((sh & 0xff) / 255) * (TILE_SIZE - 6) + 3;
    const fy = (((sh >>> 8) & 0xff) / 255) * (TILE_SIZE - 6) + 3;
    const phase = (((sh >>> 16) & 0xff) / 255) * Math.PI * 2;
    const speed = 1.1 + (((sh >>> 24) & 0x0f) / 15) * 1.4;

    const driftX = Math.sin(nowSec * speed * 0.7 + phase) * 2.2;
    const driftY = Math.cos(nowSec * speed + phase) * 2.6;
    const twinkle = 0.16 + 0.52 * (0.5 + 0.5 * Math.sin(nowSec * (speed + 0.8) + phase * 1.7));
    const size = ((sh >>> 28) & 3) === 0 ? 2 : 1.35;
    const isBright = ((sh >>> 30) & 1) === 1;

    ctx.fillStyle = isBright
      ? `rgba(224, 242, 254, ${(twinkle * 0.85).toFixed(3)})`
      : `rgba(56, 189, 248, ${twinkle.toFixed(3)})`;
    ctx.fillRect(px + fx + driftX, py + fy + driftY, size, size);
  }
}

export interface RenderMapTilesParams {
  ctx: CanvasRenderingContext2D;
  state: GameState;
  camX: number;
  camY: number;
  viewW: number;
  viewH: number;
  stairsLockCount: number;
  nowSec: number;
}

export function renderMapTilesAndInteractables({
  ctx,
  state,
  camX,
  camY,
  viewW,
  viewH,
  stairsLockCount,
  nowSec,
}: RenderMapTilesParams): void {
  const { map, explored } = state;

  // 1. Visible tile culling & explored dungeon floor/walls
  const minTx = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
  const maxTx = Math.min(map.width - 1, Math.ceil((camX + viewW) / TILE_SIZE) + 1);
  const minTy = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
  const maxTy = Math.min(map.height - 1, Math.ceil((camY + viewH) / TILE_SIZE) + 1);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!explored[ty * map.width + tx]) continue;
      const tile = getTile(map, tx, ty);
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;

      if (tile === 'wall') {
        drawWallTile(ctx, px, py, TILE_SIZE);
        drawWallEdgesAndNotches(ctx, map, tx, ty, px, py);
      } else {
        // Deep navy checkerboard floor with subtle cyan-tinted grid hairline
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#080e1d' : '#0c1529';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

        // Deterministic floating cyan/white stardust particles
        drawFloorStardust(ctx, map, tx, ty, px, py, nowSec);

        if (tile === 'stairs') {
          const pulse = 0.7 + 0.3 * Math.sin(nowSec * 4.5);
          const center = tileCenterWorld(tx, ty);
          const locked = stairsLockCount > 0;
          drawGlowSprite(ctx, locked ? 'rose' : 'cyan', center.x, center.y, TILE_SIZE * 0.95, 0.45 * pulse, true);
          ctx.save();
          ctx.fillStyle = locked ? `rgba(244, 63, 94, ${0.22 * pulse})` : `rgba(34, 211, 238, ${0.2 * pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * 0.48, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = locked ? '#fb7185' : '#22d3ee';
          ctx.lineWidth = 2;
          for (let s = -1; s <= 1; s++) {
            const y = center.y + s * 6;
            ctx.beginPath();
            ctx.moveTo(center.x - 10 + s * 3, y);
            ctx.lineTo(center.x + 10, y);
            ctx.stroke();
          }
          if (locked) {
            ctx.strokeStyle = 'rgba(251, 113, 133, 0.85)';
            ctx.beginPath();
            ctx.arc(center.x, center.y, TILE_SIZE * 0.46, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.fillStyle = locked ? '#fecdd3' : '#a5f3fc';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(locked ? `LOCKED (${stairsLockCount})` : 'NEXT ▲', center.x, center.y - 16);
          ctx.restore();
        } else if (tile === 'fountain') {
          const center = tileCenterWorld(tx, ty);
          const used = Boolean(state.fountainUsed);
          const pulse = 0.72 + 0.28 * Math.sin(nowSec * 4);
          if (!used) {
            drawGlowSprite(ctx, 'emerald', center.x, center.y, TILE_SIZE * 0.9, 0.42 * pulse, true);
          }
          ctx.save();
          ctx.fillStyle = used ? 'rgba(51, 65, 85, 0.35)' : `rgba(45, 212, 191, ${0.26 * pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * 0.46, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = used ? '#64748b' : '#2dd4bf';
          ctx.lineWidth = 2;
          ctx.stroke();
          if (!used) {
            ctx.fillStyle = '#99f6e4';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('FOUNTAIN', center.x, center.y - 16);
          }
          ctx.restore();
        }
      }
    }
  }

  // 2. Treasure chests (only on explored tiles)
  for (const chest of state.chests) {
    const cx = Math.floor(chest.x / TILE_SIZE);
    const cy = Math.floor(chest.y / TILE_SIZE);
    if (!explored[cy * map.width + cx]) continue;

    if (!chest.opened) {
      const glow = 0.75 + 0.25 * Math.sin(nowSec * 5);
      drawGlowSprite(ctx, 'amber', chest.x, chest.y, 26, 0.42 * glow, true);
    }

    ctx.save();
    ctx.translate(chest.x, chest.y);
    if (chest.opened) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-11, -8, 22, 16);
    } else {
      ctx.fillStyle = '#b45309';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(-11, -8, 22, 6);
      ctx.fillRect(-3, -2, 6, 5);
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-11, -8, 22, 16);
    }
    ctx.restore();
  }

  // 3. Pickups (only on explored tiles)
  for (const p of state.pickups) {
    const ptx = Math.floor(p.x / TILE_SIZE);
    const pty = Math.floor(p.y / TILE_SIZE);
    if (!explored[pty * map.width + ptx]) continue;

    if (p.kind === 'heal') {
      drawGlowSprite(ctx, 'emerald', p.x, p.y, 17, 0.42, true);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ecfdf5';
      ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3);
      ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
    } else if (p.kind === 'equip' && p.equipmentId) {
      const def = EQUIPMENT_CATALOG[p.equipmentId];
      const pulse = 0.7 + 0.3 * Math.sin(nowSec * 6);
      drawGlowSprite(ctx, 'amber', p.x, p.y, 22, 0.5 * pulse, true);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Lv${p.itemLevel ?? 1}`, 0, -12);
      ctx.restore();
    } else {
      drawGlowSprite(ctx, 'cyan', p.x, p.y, 12, 0.35, true);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 6);
      ctx.lineTo(p.x + 5, p.y);
      ctx.lineTo(p.x, p.y + 6);
      ctx.lineTo(p.x - 5, p.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}
