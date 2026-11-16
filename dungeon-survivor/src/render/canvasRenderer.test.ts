import { describe, expect, it, vi } from 'vitest';
import { createGameState } from '../game/engine';
import {
  computeNotificationLayout,
  computeTopSafeY,
  renderGame,
} from './canvasRenderer';

function createMockCtx() {
  const fillRectCalls: Array<[number, number, number, number]> = [];
  const fillTextCalls: Array<{ text: string; x: number; y: number }> = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
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
    strokeRect: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => {
      fillTextCalls.push({ text, x, y });
    }),
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fillRectCalls,
    fillTextCalls,
  };
}

describe('canvasRenderer HUD safe layout', () => {
  it('places top safe Y below measured hudBottom with margin, falling back by width', () => {
    expect(computeTopSafeY(375, 108.4)).toBe(119);
    expect(computeTopSafeY(1280, 62)).toBe(72);
    expect(computeTopSafeY(375)).toBe(104);
    expect(computeTopSafeY(1280)).toBe(74);
  });

  it('computes compact bottom notification layout on narrow screens and avoids hintTop', () => {
    const mobile = computeNotificationLayout(375, 812, 770);
    expect(mobile.isCompact).toBe(true);
    expect(mobile.boxHeight).toBe(22);
    expect(mobile.fontSize).toBe(11);
    expect(mobile.bottomAnchorY).toBe(760);

    const desktop = computeNotificationLayout(1280, 720, 680);
    expect(desktop.isCompact).toBe(false);
    expect(desktop.boxHeight).toBe(26);
    expect(desktop.fontSize).toBe(12);
    expect(desktop.bottomAnchorY).toBe(670);
  });

  it('renders floor banner below HUD and stacks up to 3 latest notifications above hint bar', () => {
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
      { hudBottom, hintTop }
    );

    const bannerText = fillTextCalls.find((c) => c.text.includes('FLOOR 1F'));
    expect(bannerText).toBeDefined();
    expect(bannerText!.y).toBeGreaterThan(hudBottom);

    const renderedTexts = fillTextCalls.map((c) => c.text);
    expect(renderedTexts).not.toContain('OLDEST');
    expect(renderedTexts).toContain('MSG_2');
    expect(renderedTexts).toContain('MSG_3');
    expect(renderedTexts).toContain('LATEST_4');

    const latestCall = fillTextCalls.find((c) => c.text === 'LATEST_4')!;
    const msg3Call = fillTextCalls.find((c) => c.text === 'MSG_3')!;
    const msg2Call = fillTextCalls.find((c) => c.text === 'MSG_2')!;

    // Latest notification is closest to the hint bar, stacking upwards
    expect(latestCall.y).toBeLessThan(hintTop);
    expect(latestCall.y).toBeGreaterThan(msg3Call.y);
    expect(msg3Call.y).toBeGreaterThan(msg2Call.y);
  });
});
