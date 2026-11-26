import { describe, expect, it } from 'vitest';
import { createEnemyByKind, createGameState, stepGame, upgradeSkillNode } from '../game/engine';
import { createEquippedItem } from '../game/equipment';
import type { GameState } from '../game/types';
import type { VirtualStickState } from '../input/controller';
import { renderGame } from './canvasRenderer';

interface RecordedGradient {
  kind: 'linear' | 'radial';
  args: number[];
  stops: Array<[number, string]>;
}

interface RecordedDrawOp {
  op: string;
  args: unknown[];
  state?: {
    fillStyle: unknown;
    strokeStyle: unknown;
    globalAlpha: number;
    globalCompositeOperation: string;
    lineWidth: number;
    font: string;
    shadowColor: string;
    shadowBlur: number;
  };
}

/**
 * Normalizes floating-point numbers to 2 decimal places (tolerance: ±0.01)
 * so minor platform/engine precision differences do not cause flaky diffs.
 */
function roundNum(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite numeric argument passed to Canvas2D API: ${value}`);
  }
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeArg(arg: unknown): unknown {
  if (typeof arg === 'number') return roundNum(arg);
  if (Array.isArray(arg)) return arg.map(normalizeArg);
  if (arg && typeof arg === 'object' && '__gradient' in arg) {
    const g = (arg as { __gradient: RecordedGradient }).__gradient;
    return { kind: g.kind, args: g.args, stops: g.stops };
  }
  return arg;
}

function createRecordingCtx() {
  const ops: RecordedDrawOp[] = [];
  let saveDepth = 0;
  let minSaveDepth = 0;

  const styleState = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetY: 0,
  };

  const stateStack: Array<typeof styleState> = [];

  const captureStyle = () => ({
    fillStyle: normalizeArg(styleState.fillStyle),
    strokeStyle: normalizeArg(styleState.strokeStyle),
    globalAlpha: roundNum(styleState.globalAlpha),
    globalCompositeOperation: styleState.globalCompositeOperation,
    lineWidth: roundNum(styleState.lineWidth),
    font: styleState.font,
    shadowColor: styleState.shadowColor,
    shadowBlur: roundNum(styleState.shadowBlur),
  });

  const makeGradient = (kind: 'linear' | 'radial', args: number[]) => {
    const rec: RecordedGradient = { kind, args: args.map(roundNum), stops: [] };
    return {
      __gradient: rec,
      addColorStop(offset: number, color: string) {
        rec.stops.push([roundNum(offset), color]);
      },
    };
  };

  const recordDraw = (op: string, args: unknown[]) => {
    ops.push({ op, args: args.map(normalizeArg), state: captureStyle() });
  };

  const recordCmd = (op: string, args: unknown[]) => {
    ops.push({ op, args: args.map(normalizeArg) });
  };

  const ctx: Record<string, unknown> = {
    get fillStyle() {
      return styleState.fillStyle;
    },
    set fillStyle(v: unknown) {
      styleState.fillStyle = v;
    },
    get strokeStyle() {
      return styleState.strokeStyle;
    },
    set strokeStyle(v: unknown) {
      styleState.strokeStyle = v;
    },
    get lineWidth() {
      return styleState.lineWidth;
    },
    set lineWidth(v: number) {
      styleState.lineWidth = v;
    },
    get lineCap() {
      return styleState.lineCap;
    },
    set lineCap(v: string) {
      styleState.lineCap = v;
    },
    get lineJoin() {
      return styleState.lineJoin;
    },
    set lineJoin(v: string) {
      styleState.lineJoin = v;
    },
    get font() {
      return styleState.font;
    },
    set font(v: string) {
      styleState.font = v;
    },
    get textAlign() {
      return styleState.textAlign;
    },
    set textAlign(v: string) {
      styleState.textAlign = v;
    },
    get textBaseline() {
      return styleState.textBaseline;
    },
    set textBaseline(v: string) {
      styleState.textBaseline = v;
    },
    get globalAlpha() {
      return styleState.globalAlpha;
    },
    set globalAlpha(v: number) {
      styleState.globalAlpha = v;
    },
    get globalCompositeOperation() {
      return styleState.globalCompositeOperation;
    },
    set globalCompositeOperation(v: string) {
      styleState.globalCompositeOperation = v;
    },
    get shadowColor() {
      return styleState.shadowColor;
    },
    set shadowColor(v: string) {
      styleState.shadowColor = v;
    },
    get shadowBlur() {
      return styleState.shadowBlur;
    },
    set shadowBlur(v: number) {
      styleState.shadowBlur = v;
    },
    get shadowOffsetY() {
      return styleState.shadowOffsetY;
    },
    set shadowOffsetY(v: number) {
      styleState.shadowOffsetY = v;
    },
    save() {
      saveDepth += 1;
      stateStack.push({ ...styleState });
      recordCmd('save', []);
    },
    restore() {
      saveDepth -= 1;
      if (saveDepth < minSaveDepth) minSaveDepth = saveDepth;
      const prev = stateStack.pop();
      if (prev) Object.assign(styleState, prev);
      recordCmd('restore', []);
    },
    scale(x: number, y: number) {
      recordCmd('scale', [x, y]);
    },
    translate(x: number, y: number) {
      recordCmd('translate', [x, y]);
    },
    rotate(angle: number) {
      recordCmd('rotate', [angle]);
    },
    beginPath() {
      recordCmd('beginPath', []);
    },
    closePath() {
      recordCmd('closePath', []);
    },
    moveTo(x: number, y: number) {
      recordCmd('moveTo', [x, y]);
    },
    lineTo(x: number, y: number) {
      recordCmd('lineTo', [x, y]);
    },
    arc(x: number, y: number, r: number, start: number, end: number, ccw?: boolean) {
      recordCmd('arc', ccw ? [x, y, r, start, end, ccw] : [x, y, r, start, end]);
    },
    ellipse(x: number, y: number, rx: number, ry: number, rot: number, start: number, end: number) {
      recordCmd('ellipse', [x, y, rx, ry, rot, start, end]);
    },
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
      recordCmd('quadraticCurveTo', [cpx, cpy, x, y]);
    },
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
      recordCmd('bezierCurveTo', [cp1x, cp1y, cp2x, cp2y, x, y]);
    },
    rect(x: number, y: number, w: number, h: number) {
      recordCmd('rect', [x, y, w, h]);
    },
    roundRect(x: number, y: number, w: number, h: number, r: number | number[]) {
      recordCmd('roundRect', [x, y, w, h, r]);
    },
    clip() {
      recordCmd('clip', []);
    },
    setLineDash(segments: number[]) {
      recordCmd('setLineDash', [segments]);
    },
    fill() {
      recordDraw('fill', []);
    },
    stroke() {
      recordDraw('stroke', []);
    },
    fillRect(x: number, y: number, w: number, h: number) {
      recordDraw('fillRect', [x, y, w, h]);
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      recordDraw('strokeRect', [x, y, w, h]);
    },
    fillText(text: string, x: number, y: number) {
      recordDraw('fillText', [text, x, y]);
    },
    strokeText(text: string, x: number, y: number) {
      recordDraw('strokeText', [text, x, y]);
    },
    drawImage(_img: unknown, ...rest: number[]) {
      recordDraw('drawImage', rest);
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      return makeGradient('linear', [x0, y0, x1, y1]);
    },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
      return makeGradient('radial', [x0, y0, r0, x1, y1, r1]);
    },
  };

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    ops,
    getSaveBalance: () => ({ saveDepth, minSaveDepth }),
  };
}

/**
 * Builds a deterministic representative scene covering map tiles, player + support gear,
 * enemies, projectiles, visual FX, particles, floating texts, fog of war, and HUD overlays.
 */
function buildRepresentativeScene(): GameState {
  const state = createGameState({ seed: 20261126 });
  state.status = 'playing';
  state.player.skillPoints = 4;
  upgradeSkillNode(state, 'arm_base');
  upgradeSkillNode(state, 'def_aegis');
  state.player.equipment = [createEquippedItem('seeker_drone', 3), createEquippedItem('orbit_shield', 2)];

  const px = state.player.x;
  const py = state.player.y;

  // Populate representative enemies around player within visible range
  const normal = createEnemyByKind(101, 'normal', px + 72, py - 18, 3);
  const shooter = createEnemyByKind(102, 'shooter', px - 84, py + 36, 3);
  const tank = createEnemyByKind(103, 'tank', px + 110, py + 64, 3);
  state.enemies = [normal, shooter, tank];

  // Add representative projectiles (player + enemy pierceDefense)
  state.projectiles.push({
    id: 1001,
    kind: 'base',
    x: px + 32,
    y: py - 8,
    vx: 260,
    vy: -60,
    radius: 5,
    damage: 18,
    color: '#38bdf8',
    life: 0.6,
    pierce: false,
    hitEnemyIds: [],
  });
  state.enemyProjectiles.push({
    id: 1002,
    x: px - 42,
    y: py + 18,
    vx: 140,
    vy: -55,
    radius: 5,
    damage: 10,
    color: '#f97316',
    life: 0.8,
    pierceDefense: true,
  });

  // Add visual FX, particles, floating texts, and HUD elements
  state.visualFx.push({
    kind: 'pulse',
    x: px + 40,
    y: py,
    radius: 36,
    color: '#22d3ee',
    life: 0.25,
    maxLife: 0.4,
  });
  state.particles = state.particles ?? [];
  state.particles.push({
    x: px + 50,
    y: py - 12,
    vx: 30,
    vy: -20,
    radius: 3,
    color: '#facc15',
    life: 0.3,
    maxLife: 0.5,
  });
  state.floatingTexts.push({
    x: px + 72,
    y: py - 32,
    text: '24',
    color: '#fef08a',
    life: 0.4,
    maxLife: 0.6,
  });
  state.floorBannerTimer = 1.2;
  state.notifications = [{ id: 2001, text: '3F 進行中', color: '#38bdf8', kind: 'info', life: 2.0, maxLife: 3.0 }];

  // Advance 1 deterministic tick so fog-of-war visibility and support gear positions are populated
  stepGame(state, { x: 0, y: 0 }, 1 / 60);
  return state;
}

describe('Canvas rendering regression tests', () => {
  it('matches deterministic draw command snapshot for PC viewport (1280x720)', () => {
    const state = buildRepresentativeScene();
    const stick: VirtualStickState = { active: false, originX: 0, originY: 0, currentX: 0, currentY: 0, maxRadius: 48 };
    const { ctx, ops, getSaveBalance } = createRecordingCtx();

    renderGame(ctx, 1280, 720, state, stick, 12.5, {
      hudBottom: 56,
      hintTop: 680,
      hideCanvasMinimap: false,
      hideCanvasNotifications: false,
    });

    const { saveDepth, minSaveDepth } = getSaveBalance();
    expect(saveDepth).toBe(0);
    expect(minSaveDepth).toBeGreaterThanOrEqual(0);
    expect(ops.length).toBeGreaterThan(100);
    expect(ops).toMatchSnapshot();
  });

  it('matches deterministic draw command snapshot for Mobile viewport (390x844) with virtual stick', () => {
    const state = buildRepresentativeScene();
    const stick: VirtualStickState = {
      active: true,
      originX: 96,
      originY: 690,
      currentX: 132,
      currentY: 668,
      maxRadius: 48,
    };
    const { ctx, ops, getSaveBalance } = createRecordingCtx();

    renderGame(ctx, 390, 844, state, stick, 12.5, {
      hudBottom: 72,
      hintTop: 740,
      hideCanvasMinimap: false,
      hideCanvasNotifications: false,
    });

    const { saveDepth, minSaveDepth } = getSaveBalance();
    expect(saveDepth).toBe(0);
    expect(minSaveDepth).toBeGreaterThanOrEqual(0);
    expect(ops.length).toBeGreaterThan(100);
    expect(ops).toMatchSnapshot();
  });
});
