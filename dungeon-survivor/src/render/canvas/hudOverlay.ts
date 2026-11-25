import { TILE_SIZE } from '../../core/dungeon';
import { getStairsLockCount } from '../../game/engine';
import type { GameState } from '../../game/types';
import type { VirtualStickState } from '../../input/controller';
import { traceCutCornerRect } from './primitives';

export interface HudSafeInsets {
  /** Bottom Y coordinate (in CSS px) of the top HUD bar */
  hudBottom?: number;
  /** Top Y coordinate (in CSS px) of the bottom hint bar */
  hintTop?: number;
  /** When true, skips drawing the legacy in-canvas minimap */
  hideCanvasMinimap?: boolean;
  /** When true, skips drawing the legacy in-canvas notification toasts */
  hideCanvasNotifications?: boolean;
}

export interface NotificationLayout {
  isCompact: boolean;
  boxHeight: number;
  gap: number;
  fontSize: number;
  minWidth: number;
  maxWidth: number;
  bottomAnchorY: number;
}

export function computeTopSafeY(canvasWidth: number, hudBottom?: number): number {
  if (typeof hudBottom === 'number' && Number.isFinite(hudBottom) && hudBottom > 0) {
    return Math.ceil(hudBottom + 10);
  }
  return canvasWidth < 540 ? 104 : 74;
}

export function computeNotificationLayout(
  canvasWidth: number,
  canvasHeight: number,
  hintTop?: number,
): NotificationLayout {
  const isCompact = canvasWidth < 540;
  const defaultHintTop = canvasHeight - 38;
  const safeHintTop =
    typeof hintTop === 'number' && Number.isFinite(hintTop) && hintTop > 0
      ? Math.min(hintTop, canvasHeight)
      : defaultHintTop;
  const bottomAnchorY = Math.max(80, Math.floor(safeHintTop - 10));
  return {
    isCompact,
    boxHeight: isCompact ? 32 : 38,
    gap: isCompact ? 6 : 8,
    fontSize: isCompact ? 14 : 16,
    minWidth: isCompact ? 180 : 240,
    maxWidth: Math.max(120, canvasWidth - (isCompact ? 28 : 48)),
    bottomAnchorY,
  };
}

export function computeFloorBannerRect(
  canvasWidth: number,
  canvasHeight: number,
  topSafeY: number,
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(270, Math.max(180, canvasWidth - 32));
  const height = 42;
  const x = canvasWidth / 2 - width / 2;
  const y = Math.max(topSafeY, Math.round(canvasHeight / 2 - height / 2));
  return { x, y, width, height };
}

export function renderVirtualStick(ctx: CanvasRenderingContext2D, stick: VirtualStickState): void {
  if (!stick.active) return;
  const dx = stick.currentX - stick.originX;
  const dy = stick.currentY - stick.originY;
  const dist = Math.hypot(dx, dy);
  const clampedDist = Math.min(dist, stick.maxRadius);
  const kx = dist > 0 ? stick.originX + (dx / dist) * clampedDist : stick.originX;
  const ky = dist > 0 ? stick.originY + (dy / dist) * clampedDist : stick.originY;

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(stick.originX, stick.originY, stick.maxRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(34, 211, 238, 0.55)';
  ctx.beginPath();
  ctx.arc(kx, ky, 18, 0, Math.PI * 2);
  ctx.fill();
}

export function renderNotifications(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  hintTop?: number,
): void {
  if (state.notifications.length === 0) return;

  const layout = computeNotificationLayout(width, height, hintTop);
  ctx.save();
  ctx.font = `bold ${layout.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let bottomY = layout.bottomAnchorY;
  const startIdx = state.notifications.length - 1;
  const minIdx = Math.max(0, state.notifications.length - 3);

  for (let i = startIdx; i >= minIdx; i--) {
    const n = state.notifications[i];
    if (!n) continue;
    const alpha = Math.min(1, n.life * 2.5);
    const padX = layout.isCompact ? 28 : 34;
    const tw = Math.min(layout.maxWidth, Math.max(layout.minWidth, ctx.measureText(n.text).width + padX));
    const x = width / 2 - tw / 2;
    const boxY = bottomY - layout.boxHeight;
    if (boxY < 0) break;

    const radius = Math.min(10, layout.boxHeight / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = n.kind === 'alert' ? 'rgba(69, 10, 10, 0.9)' : 'rgba(15, 23, 42, 0.88)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, boxY, tw, layout.boxHeight, radius);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = n.kind === 'alert' ? 'rgba(248, 113, 113, 0.45)' : 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Left accent bar inside rounded card
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.roundRect(x + 6, boxY + 6, 3.5, layout.boxHeight - 12, 2);
      ctx.fill();
    } else {
      ctx.fillRect(x, boxY, tw, layout.boxHeight);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = n.color;
      ctx.fillRect(x + 5, boxY + 5, 3, layout.boxHeight - 10);
    }

    ctx.fillStyle = n.kind === 'alert' ? '#fed7aa' : '#f8fafc';
    ctx.fillText(n.text, width / 2 + 2, boxY + layout.boxHeight / 2 + 0.5, tw - 22);
    ctx.restore();
    bottomY -= layout.boxHeight + layout.gap;
  }
  ctx.restore();
}

export function renderFloorBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  topSafeY: number,
): void {
  if (state.floorBannerTimer <= 0) return;
  const { map } = state;
  const isBoss = map.floorType === 'boss';
  const isGuardian = map.floorType === 'guardian';
  const bannerText = isBoss
    ? `BOSS FLOOR ${state.floor}F`
    : isGuardian
      ? `GUARDIAN ${state.floor}F`
      : `FLOOR ${state.floor}F`;
  const borderColor = isBoss ? '#f43f5e' : isGuardian ? '#facc15' : '#38bdf8';
  const glowStroke = isBoss
    ? 'rgba(244, 63, 94, 0.32)'
    : isGuardian
      ? 'rgba(250, 204, 21, 0.32)'
      : 'rgba(56, 189, 248, 0.34)';
  const banner = computeFloorBannerRect(width, height, topSafeY);

  ctx.save();
  ctx.globalAlpha = Math.min(1, state.floorBannerTimer);

  traceCutCornerRect(ctx, banner.x, banner.y, banner.width, banner.height, 10);
  if (typeof ctx.createLinearGradient === 'function') {
    const grad = ctx.createLinearGradient(banner.x, banner.y, banner.x, banner.y + banner.height);
    grad.addColorStop(0, 'rgba(12, 24, 48, 0.92)');
    grad.addColorStop(1, 'rgba(5, 11, 24, 0.88)');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = 'rgba(6, 14, 30, 0.88)';
  }
  ctx.fill();

  // Soft outer neon border glow (zero shadowBlur)
  ctx.strokeStyle = glowStroke;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Crisp neon frame stroke
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Side cyber accent bars inside banner
  ctx.fillStyle = borderColor;
  ctx.fillRect(banner.x + 12, banner.y + 11, 3, banner.height - 22);
  ctx.fillRect(banner.x + banner.width - 15, banner.y + 11, 3, banner.height - 22);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(bannerText, width / 2, banner.y + 27);
  ctx.restore();
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  state: GameState,
  topSafeY: number,
): void {
  const { map, explored, player } = state;
  const stairsLocked = getStairsLockCount(state) > 0;
  const isNarrow = canvasWidth < 540;
  const cell = isNarrow ? 2 : 3;
  const mapW = map.width * cell;
  const mapH = map.height * cell;
  const ox = canvasWidth - mapW - 12;
  const oy = topSafeY;

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
      ctx.fillStyle =
        t === 'stairs'
          ? stairsLocked
            ? '#fb7185'
            : '#22d3ee'
          : t === 'fountain'
            ? state.fountainUsed
              ? '#475569'
              : '#2dd4bf'
            : 'rgba(148, 163, 184, 0.45)';
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
