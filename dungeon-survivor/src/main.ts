import { createGameState, stepGame } from './game/engine';
import type { GameState } from './game/types';
import { InputController } from './input/controller';
import { renderGame } from './render/canvasRenderer';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hpText = document.getElementById('hpText')!;
const hpFill = document.getElementById('hpFill')!;
const floorText = document.getElementById('floorText')!;
const levelText = document.getElementById('levelText')!;
const killsText = document.getElementById('killsText')!;
const gameOverModal = document.getElementById('gameOverModal')!;
const gameOverSummary = document.getElementById('gameOverSummary')!;
const retryBtn = document.getElementById('retryBtn')!;

let state: GameState = createGameState();
const controller = new InputController(canvas);

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function syncHud(): void {
  const { player, floor, stats } = state;
  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  hpFill.style.width = `${hpPct}%`;
  floorText.textContent = `${floor}F`;
  levelText.textContent = `LV ${player.level} (SP ${player.skillPoints})`;
  killsText.textContent = `KILLS ${stats.kills}`;

  if (state.status === 'gameover') {
    gameOverModal.classList.remove('hidden');
    gameOverSummary.textContent = `到達階層: ${floor}F / 撃破数: ${stats.kills} / LV: ${player.level}`;
  } else {
    gameOverModal.classList.add('hidden');
  }
}

retryBtn.addEventListener('click', () => {
  state = createGameState();
  syncHud();
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let lastTime = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  stepGame(state, controller.getMoveVector(), dt);
  renderGame(ctx, window.innerWidth, window.innerHeight, state, controller.stick, now / 1000);
  syncHud();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
