import { getStairsLockCount } from '../game/engine';
import { computeSkillModifiers } from '../game/skillTree';
import type { GameState } from '../game/types';
import type { VirtualStickState } from '../input/controller';
import {
  renderBossLasers,
  renderFloatingTexts,
  renderMortarZones,
  renderProjectiles,
  renderVisualFxAndParticles,
} from './canvas/effectsLayer';
import { renderEnemies, renderPlayerAndAura, renderPlayerSupportGear } from './canvas/entitiesLayer';
import { renderFogOverlay } from './canvas/fogLayer';
import {
  type HudSafeInsets,
  type NotificationLayout,
  computeFloorBannerRect,
  computeNotificationLayout,
  computeTopSafeY,
  renderFloorBanner,
  renderMinimap,
  renderNotifications,
  renderVirtualStick,
} from './canvas/hudOverlay';
import { renderMapTilesAndInteractables } from './canvas/mapLayer';

export {
  type HudSafeInsets,
  type NotificationLayout,
  computeFloorBannerRect,
  computeNotificationLayout,
  computeTopSafeY,
};

export const TARGET_VIEW_WORLD_WIDTH = 840; // ~21 tiles across on desktop/web

export function computeCameraZoom(viewportWidth: number, viewportHeight: number): number {
  const widthZoom = Math.max(0.72, viewportWidth / TARGET_VIEW_WORLD_WIDTH);
  const heightMaxZoom = Math.max(0.72, viewportHeight / 480);
  return Math.min(2.4, widthZoom, heightMaxZoom);
}

export function renderGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  stick: VirtualStickState,
  nowSec: number,
  insets: HudSafeInsets = {},
): void {
  const { player } = state;
  const mods = computeSkillModifiers(player.skillLevels);
  const stairsLockCount = getStairsLockCount(state);
  const topSafeY = computeTopSafeY(width, insets.hudBottom);

  ctx.fillStyle = '#040711';
  ctx.fillRect(0, 0, width, height);

  const zoom = computeCameraZoom(width, height);
  const viewW = width / zoom;
  const viewH = height / zoom;
  let camX = player.x - viewW / 2;
  let camY = player.y - viewH / 2;
  if ((state.shakeTimer ?? 0) > 0 && (state.shakeIntensity ?? 0) > 0) {
    const amp = (state.shakeIntensity ?? 0) * Math.min(1, (state.shakeTimer ?? 0) * 6);
    camX += Math.sin(nowSec * 97) * amp;
    camY += Math.cos(nowSec * 113) * amp;
  }

  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // 1-3. Visible tiles, chests, and pickups
  renderMapTilesAndInteractables({ ctx, state, camX, camY, viewW, viewH, stairsLockCount, nowSec });

  // 5. Intercept range rings, Orbit Bits & Seeker Drones
  renderPlayerSupportGear(ctx, state, mods);

  // 5.5. Tank parabolic mortar landing telegraphs & airborne shells
  renderMortarZones(ctx, state);

  // 5.6. Grand Boss wall-reflecting laser beams (telegraph -> additive-blended high-energy beam)
  renderBossLasers(ctx, state);

  // 6 & 6.5. Visual FX and additive particles
  renderVisualFxAndParticles(ctx, state);

  // 7. Enemies (rendered when inside player's vision, or glowing ambush runners summoned by scout)
  renderEnemies(ctx, state, nowSec);

  // 8. Projectiles (additive bloom for beams and energy shots)
  renderProjectiles(ctx, state, nowSec);

  // 9. Player & Aegis ready aura
  renderPlayerAndAura(ctx, state, mods, nowSec);

  // 10. Floating damage / pickup texts
  renderFloatingTexts(ctx, state);

  ctx.restore();

  // 10.5. Fog of War overlay (corridor circular light vs lit room)
  renderFogOverlay(ctx, width, height, zoom, camX, camY, state);

  // 11. Legacy in-canvas Mini-map (skipped when HUD renders dedicated minimap canvas)
  if (!insets.hideCanvasMinimap) {
    renderMinimap(ctx, width, state, topSafeY);
  }

  // 12. Virtual joystick indicator (if active)
  renderVirtualStick(ctx, stick);

  // 13. Legacy in-canvas Toast Notifications (skipped when HUD renders DOM notifications)
  if (!insets.hideCanvasNotifications) {
    renderNotifications(ctx, width, height, state, insets.hintTop);
  }

  // 14. Sleek sci-fi cut-corner Floor Entry Banner
  renderFloorBanner(ctx, width, height, state, topSafeY);
}
