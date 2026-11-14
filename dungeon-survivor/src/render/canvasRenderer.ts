import { TILE_SIZE, getTile, tileCenterWorld } from '../core/dungeon';
import { getOrbitBitPositions, getSeekerDronePositions } from '../game/engine';
import { EQUIPMENT_CATALOG } from '../game/equipment';
import { computeSkillModifiers } from '../game/skillTree';
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
  const mods = computeSkillModifiers(new Set(player.unlockedSkills));

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

  // 2. Treasure chests
  for (const chest of state.chests) {
    ctx.save();
    ctx.translate(chest.x, chest.y);
    if (chest.opened) {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-11, -8, 22, 16);
      ctx.strokeStyle = '#94a3b8';
      ctx.strokeRect(-11, -8, 22, 16);
    } else {
      const glow = 0.75 + 0.25 * Math.sin(nowSec * 5);
      ctx.fillStyle = `rgba(251, 191, 36, ${0.2 * glow})`;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();

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

  // 3. Deployed turrets
  for (const turret of state.turrets) {
    const lifeRatio = Math.max(0, turret.life / turret.maxLife);
    ctx.save();
    ctx.translate(turret.x, turret.y);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lifeRatio);
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef3c7';
    ctx.beginPath();
    ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Pickups
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

  // 5. Intercept range rings & Aegis ready indicator
  const droneEquip = player.equipment.find((e) => e.id === 'seeker_drone');
  if (droneEquip) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(player.x, player.y, EQUIPMENT_CATALOG.seeker_drone.baseRange * mods.rangeMult, 0, Math.PI * 2);
    ctx.stroke();
  }

  const bits = getOrbitBitPositions(state);
  if (bits.length > 0) {
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.orbitRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const bit of bits) {
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ede9fe';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Hovering Seeker Drones
  for (const drone of getSeekerDronePositions(state)) {
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(drone.x, drone.y - 6);
    ctx.lineTo(drone.x + 6, drone.y + 4);
    ctx.lineTo(drone.x - 6, drone.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 6. Visual FX (Slash / Lightning / Pulse)
  for (const fx of state.visualFx) {
    const alpha = Math.max(0, fx.life / fx.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx.kind === 'slash' && fx.radius !== undefined && fx.angle !== undefined) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * 0.8, fx.angle - 1.05, fx.angle + 1.05);
      ctx.stroke();
    } else if (fx.kind === 'pulse' && fx.radius !== undefined) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, fx.radius * (1 - alpha * 0.4), 0, Math.PI * 2);
      ctx.stroke();
    } else if (fx.kind === 'lightning' && fx.points && fx.points.length >= 2) {
      ctx.strokeStyle = fx.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(fx.points[0].x, fx.points[0].y);
      for (let idx = 1; idx < fx.points.length; idx++) {
        ctx.lineTo(fx.points[idx].x, fx.points[idx].y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. Enemies
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

  // 8. Projectiles
  for (const proj of state.projectiles) {
    ctx.fillStyle = proj.color;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const ep of state.enemyProjectiles) {
    ctx.fillStyle = '#fb7185';
    ctx.beginPath();
    ctx.arc(ep.x, ep.y, ep.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 9. Player & Aegis ready aura
  if (mods.hasAegisParry && player.aegisCooldown <= 0) {
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

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

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(6, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 10. Floating damage / pickup texts
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  for (const ft of state.floatingTexts) {
    ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  // 11. Mini-map (top-right, responsive for smartphone portrait)
  renderMinimap(ctx, width, state);

  // 12. Virtual joystick indicator (if active)
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

  // 13. Floor entry banner
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

  // Unopened chests within explored tiles
  ctx.fillStyle = '#fbbf24';
  for (const chest of state.chests) {
    if (chest.opened) continue;
    const ctxTx = Math.floor(chest.x / TILE_SIZE);
    const ctxTy = Math.floor(chest.y / TILE_SIZE);
    if (explored[ctxTy * map.width + ctxTx]) {
      ctx.fillRect(ox + ctxTx * cell, oy + ctxTy * cell, cell + 1, cell + 1);
    }
  }

  const ptx = Math.floor(player.x / TILE_SIZE);
  const pty = Math.floor(player.y / TILE_SIZE);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(ox + ptx * cell - 1, oy + pty * cell - 1, cell + 2, cell + 2);
  ctx.restore();
}
