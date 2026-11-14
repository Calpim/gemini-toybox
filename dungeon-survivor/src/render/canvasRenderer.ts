import { TILE_SIZE, getTile, tileCenterWorld } from '../core/dungeon';
import { getOrbitBitPositions } from '../game/engine';
import type { GameState } from '../game/types';
import type { VirtualStickState } from '../input/controller';

export function renderGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  stick: VirtualStickState,
  nowSec: number
): void {
  const { map, player } = state;

  ctx.fillStyle = '#050811';
  ctx.fillRect(0, 0, width, height);

  const camX = player.x - width / 2;
  const camY = player.y - height / 2;

  ctx.save();
  ctx.translate(-camX, -camY);

  // 1. Visible tile culling & dungeon floor/walls
  const minTx = Math.max(0, Math.floor(camX / TILE_SIZE) - 1);
  const maxTx = Math.min(map.width - 1, Math.ceil((camX + width) / TILE_SIZE) + 1);
  const minTy = Math.max(0, Math.floor(camY / TILE_SIZE) - 1);
  const maxTy = Math.min(map.height - 1, Math.ceil((camY + height) / TILE_SIZE) + 1);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const tile = getTile(map, tx, ty);
      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;

      if (tile === 'wall') {
        ctx.fillStyle = '#141d31';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#1e2b45';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 8);
      } else {
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#0b101d' : '#0d1323';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.18)';
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

        if (tile === 'stairs') {
          const pulse = 0.7 + 0.3 * Math.sin(nowSec * 4.5);
          const center = tileCenterWorld(tx, ty);
          ctx.save();
          ctx.fillStyle = `rgba(34, 211, 238, ${0.18 * pulse})`;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * 0.48, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2;
          for (let s = -1; s <= 1; s++) {
            const y = center.y + s * 6;
            ctx.beginPath();
            ctx.moveTo(center.x - 10 + s * 3, y);
            ctx.lineTo(center.x + 10, y);
            ctx.stroke();
          }
          ctx.fillStyle = '#a5f3fc';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('NEXT ▲', center.x, center.y - 16);
          ctx.restore();
        }
      }
    }
  }

  // 2. Pickups
  for (const p of state.pickups) {
    if (p.kind === 'heal') {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ecfdf5';
      ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3);
      ctx.fillRect(p.x - 1.5, p.y - 4, 3, 8);
    } else {
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

  // 3. Auto-intercept range & orbit ring
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.blasterRange, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.orbitRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Orbit Shield Bits
  for (const bit of getOrbitBitPositions(state)) {
    ctx.fillStyle = '#a78bfa';
    ctx.beginPath();
    ctx.arc(bit.x, bit.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ede9fe';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 5. Enemies
  for (const enemy of state.enemies) {
    ctx.fillStyle = enemy.hitFlash > 0 ? '#ffffff' : enemy.awake ? '#f43f5e' : '#9f1239';
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = enemy.awake ? '#fda4af' : '#4c0519';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (enemy.hp < enemy.maxHp) {
      const bw = 26;
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw, 4);
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(enemy.x - bw / 2, enemy.y - enemy.radius - 9, bw * ratio, 4);
    }
  }

  // 6. Projectiles
  for (const proj of state.projectiles) {
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Player
  const blink = player.invulnTimer > 0 && Math.floor(nowSec * 20) % 2 === 0;
  if (!blink) {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.facingAngle);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Direction visor
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(6, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 8. Floating damage / pickup texts
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  for (const ft of state.floatingTexts) {
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // 9. Mini-map (top-right)
  renderMinimap(ctx, width, state);

  // 10. Virtual joystick indicator (if active)
  if (stick.active) {
    const dx = stick.currentX - stick.originX;
    const dy = stick.currentY - stick.originY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, stick.maxRadius);
    const kx = dist > 0 ? stick.originX + (dx / dist) * clampedDist : stick.originX;
    const ky = dist > 0 ? stick.originY + (dy / dist) * clampedDist : stick.originY;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.originX, stick.originY, stick.maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.beginPath();
    ctx.arc(kx, ky, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // 11. Floor entry banner
  if (state.floorBannerTimer > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, state.floorBannerTimer);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(width / 2 - 120, 74, 240, 42);
    ctx.strokeStyle = '#38bdf8';
    ctx.strokeRect(width / 2 - 120, 74, 240, 42);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`FLOOR ${state.floor}F`, width / 2, 101);
    ctx.restore();
  }
}

function renderMinimap(ctx: CanvasRenderingContext2D, canvasWidth: number, state: GameState): void {
  const { map, explored, player } = state;
  const isNarrow = canvasWidth < 540;
  const cell = isNarrow ? 2 : 3;
  const mapW = map.width * cell;
  const mapH = map.height * cell;
  const ox = canvasWidth - mapW - 12;
  const oy = isNarrow ? 94 : 64;

  ctx.save();
  ctx.fillStyle = 'rgba(7, 11, 20, 0.78)';
  ctx.fillRect(ox - 4, oy - 4, mapW + 8, mapH + 8);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
  ctx.strokeRect(ox - 4, oy - 4, mapW + 8, mapH + 8);

  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const idx = ty * map.width + tx;
      if (!explored[idx]) continue;
      const t = map.tiles[idx];
      if (t === 'wall') continue;
      ctx.fillStyle = t === 'stairs' ? '#22d3ee' : 'rgba(148, 163, 184, 0.45)';
      ctx.fillRect(ox + tx * cell, oy + ty * cell, cell, cell);
    }
  }

  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(ox + ptx * cell - 1, oy + pty * cell - 1, cell + 2, cell + 2);
  ctx.restore();
}
