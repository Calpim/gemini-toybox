import { describe, expect, it, vi } from 'vitest';
import { createGameState } from '../game/engine';
import { mustDefined } from '../testUtils';
import { computeFloorBannerRect, computeNotificationLayout, computeTopSafeY, renderGame } from './canvasRenderer';
import { renderHudMinimap } from './minimapRenderer';

function createMockCtx(options: { includeGradients?: boolean } = {}) {
  const { includeGradients = true } = options;
  const fillRectCalls: Array<[number, number, number, number]> = [];
  const strokeRectCalls: Array<[number, number, number, number]> = [];
  const fillTextCalls: Array<{ text: string; x: number; y: number }> = [];
  const arcCalls: Array<[number, number, number]> = [];
  const makeGradient = () => ({ addColorStop: vi.fn() });

  const ctx: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn((x: number, y: number, r: number) => {
      arcCalls.push([x, y, r]);
    }),
    ellipse: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fillRectCalls.push([x, y, w, h]);
    }),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      strokeRectCalls.push([x, y, w, h]);
    }),
    fillText: vi.fn((text: string, x: number, y: number) => {
      fillTextCalls.push({ text, x, y });
    }),
  };

  if (includeGradients) {
    ctx.createRadialGradient = vi.fn(makeGradient);
    ctx.createLinearGradient = vi.fn(makeGradient);
  }

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    raw: ctx,
    fillRectCalls,
    strokeRectCalls,
    fillTextCalls,
    arcCalls,
  };
}

describe('canvasRenderer HUD safe layout', () => {
  it('places top safe Y below measured hudBottom with margin, falling back by width', () => {
    expect(computeTopSafeY(375, 108.4)).toBe(119);
    expect(computeTopSafeY(1280, 62)).toBe(72);
    expect(computeTopSafeY(375)).toBe(104);
    expect(computeTopSafeY(1280)).toBe(74);
  });

  it('centers floor banner vertically while respecting topSafeY', () => {
    const mobile = computeFloorBannerRect(375, 812, 118);
    expect(mobile.y).toBe(385);
    expect(mobile.width).toBe(270);

    const shortLandscape = computeFloorBannerRect(667, 200, 118);
    expect(shortLandscape.y).toBe(118);
  });

  it('computes compact bottom notification layout on narrow screens and avoids hintTop', () => {
    const mobile = computeNotificationLayout(375, 812, 770);
    expect(mobile.isCompact).toBe(true);
    expect(mobile.boxHeight).toBe(32);
    expect(mobile.fontSize).toBe(14);
    expect(mobile.bottomAnchorY).toBe(760);

    const desktop = computeNotificationLayout(1280, 720, 680);
    expect(desktop.isCompact).toBe(false);
    expect(desktop.boxHeight).toBe(38);
    expect(desktop.fontSize).toBe(16);
    expect(desktop.bottomAnchorY).toBe(670);
  });

  it('renders floor banner centered away from minimap/HUD and stacks up to 3 latest notifications above hint bar', () => {
    const state = createGameState({ seed: 101 });
    state.floorBannerTimer = 2.0;
    state.notifications = [
      { id: 1, kind: 'info', text: 'OLDEST', color: '#38bdf8', life: 1.5, maxLife: 2.0 },
      { id: 2, kind: 'info', text: 'MSG_2', color: '#38bdf8', life: 1.6, maxLife: 2.0 },
      { id: 3, kind: 'levelup', text: 'MSG_3', color: '#fde047', life: 1.7, maxLife: 2.0 },
      { id: 4, kind: 'alert', text: 'LATEST_4', color: '#f97316', life: 1.9, maxLife: 2.0 },
    ];

    const { ctx, fillTextCalls } = createMockCtx();
    const hudBottom = 106;
    const hintTop = 768;

    renderGame(
      ctx,
      375,
      812,
      state,
      { active: false, originX: 0, originY: 0, currentX: 0, currentY: 0, maxRadius: 48 },
      1.0,
      { hudBottom, hintTop },
    );

    const bannerText = mustDefined(
      fillTextCalls.find((c) => c.text.includes('FLOOR 1F')),
      'bannerText',
    );
    expect(bannerText.y).toBeGreaterThan(350);
    expect(bannerText.y).toBeLessThan(460);

    const renderedTexts = fillTextCalls.map((c) => c.text);
    expect(renderedTexts).not.toContain('OLDEST');
    expect(renderedTexts).toContain('MSG_2');
    expect(renderedTexts).toContain('MSG_3');
    expect(renderedTexts).toContain('LATEST_4');

    const latestCall = mustDefined(
      fillTextCalls.find((c) => c.text === 'LATEST_4'),
      'latestCall',
    );
    const msg3Call = mustDefined(
      fillTextCalls.find((c) => c.text === 'MSG_3'),
      'msg3Call',
    );
    const msg2Call = mustDefined(
      fillTextCalls.find((c) => c.text === 'MSG_2'),
      'msg2Call',
    );

    // Latest notification is closest to the hint bar, stacking upwards
    expect(latestCall.y).toBeLessThan(hintTop);
    expect(latestCall.y).toBeGreaterThan(msg3Call.y);
    expect(msg3Call.y).toBeGreaterThan(msg2Call.y);
  });

  it('skips legacy in-canvas minimap and notifications when hideCanvasMinimap and hideCanvasNotifications are set', () => {
    const state = createGameState({ seed: 202 });
    state.floorBannerTimer = 1.5;
    state.notifications = [{ id: 1, kind: 'alert', text: 'HIDDEN_ALERT', color: '#f97316', life: 2.0, maxLife: 2.0 }];

    const stick = { active: false, originX: 0, originY: 0, currentX: 0, currentY: 0, maxRadius: 48 };
    const hudBottom = 106;
    const hintTop = 768;

    const shown = createMockCtx();
    renderGame(shown.ctx, 375, 812, state, stick, 1.0, { hudBottom, hintTop });

    const hidden = createMockCtx();
    renderGame(hidden.ctx, 375, 812, state, stick, 1.0, {
      hudBottom,
      hintTop,
      hideCanvasMinimap: true,
      hideCanvasNotifications: true,
    });

    // Notification text is omitted when hideCanvasNotifications is true, while floor banner still renders
    expect(shown.fillTextCalls.map((c) => c.text)).toContain('HIDDEN_ALERT');
    expect(hidden.fillTextCalls.map((c) => c.text)).not.toContain('HIDDEN_ALERT');
    expect(hidden.fillTextCalls.find((c) => c.text.includes('FLOOR 1F'))).toBeDefined();

    // Legacy minimap frame rect at (canvasWidth - mapW - 16, topSafeY - 4) is omitted when hideCanvasMinimap is true
    const cell = 2; // width < 540
    const expectedMapFrameW = state.map.width * cell + 8;
    const expectedMapFrameH = state.map.height * cell + 8;
    const hasMinimapFrame = (calls: Array<[number, number, number, number]>) =>
      calls.some(([, , w, h]) => w === expectedMapFrameW && h === expectedMapFrameH);

    expect(hasMinimapFrame(shown.strokeRectCalls)).toBe(true);
    expect(hasMinimapFrame(hidden.strokeRectCalls)).toBe(false);
  });

  it('renders cyber-neon lasers, enemies, and player safely even without gradient methods on mock ctx', () => {
    const state = createGameState({ seed: 303 });
    state.projectiles.push({
      id: 999,
      kind: 'base',
      x: state.player.x + 24,
      y: state.player.y,
      vx: 400,
      vy: 0,
      radius: 6,
      damage: 20,
      life: 1,
      pierce: false,
      overclockLevel: 2,
      baseLevel: 3,
      hitEnemyIds: [],
      color: '#22d3ee',
    });

    const { ctx } = createMockCtx({ includeGradients: false });
    expect(() =>
      renderGame(
        ctx,
        375,
        812,
        state,
        { active: false, originX: 0, originY: 0, currentX: 0, currentY: 0, maxRadius: 48 },
        2.5,
        { hideCanvasMinimap: true, hideCanvasNotifications: true },
      ),
    ).not.toThrow();
  });
});

describe('minimapRenderer renderHudMinimap', () => {
  it('renders radar background, grid lines, explored floor tiles, and player core dot', () => {
    const state = createGameState({ seed: 404 });
    // Reveal the stairs tile and add an awake enemy right next to the player so markers render
    const stairsIdx = state.map.stairsTile.ty * state.map.width + state.map.stairsTile.tx;
    state.explored[stairsIdx] = 1;
    state.enemies.push({
      id: 500,
      kind: 'tank',
      x: state.player.x + 20,
      y: state.player.y,
      radius: 16,
      speed: 60,
      hp: 100,
      maxHp: 100,
      damage: 10,
      aggroRange: 200,
      awake: true,
      hitFlash: 0,
      bitHitCooldown: 0,
      isRoomBoss: true,
    });

    const { ctx, raw, fillRectCalls, arcCalls } = createMockCtx();
    renderHudMinimap(ctx, 96, 96, state, 1.25);

    // Background fill covers the entire HUD minimap canvas
    expect(fillRectCalls[0]).toEqual([0, 0, 96, 96]);
    // Radar grid lines drawn with moveTo/lineTo
    expect(raw.moveTo).toHaveBeenCalled();
    expect(raw.lineTo).toHaveBeenCalled();
    // Radial glow centered on player created
    expect(raw.createRadialGradient).toHaveBeenCalledTimes(1);
    // Explored tiles rendered (>1 fillRect) and circular markers (stairs, boss, player halo/core) drawn
    expect(fillRectCalls.length).toBeGreaterThan(10);
    expect(arcCalls.length).toBeGreaterThanOrEqual(4);
  });

  it('handles minimal mock ctx without gradients and ignores zero-sized canvases safely', () => {
    const state = createGameState({ seed: 505 });
    const minimal = createMockCtx({ includeGradients: false });

    expect(() => renderHudMinimap(minimal.ctx, 88, 88, state, 0.5)).not.toThrow();
    expect(minimal.fillRectCalls.length).toBeGreaterThan(1);

    const zero = createMockCtx();
    renderHudMinimap(zero.ctx, 0, 88, state, 0.5);
    expect(zero.fillRectCalls.length).toBe(0);
  });
});
