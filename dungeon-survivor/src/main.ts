import {
  closeSkillTree,
  createGameState,
  resolveEquipChoice,
  stepGame,
  toggleSkillTree,
  unlockSkillNode,
} from './game/engine';
import { SKILL_TREE_NODES, canUnlockSkill } from './game/skillTree';
import type { GameState } from './game/types';
import { InputController } from './input/controller';
import { renderGame } from './render/canvasRenderer';
import { renderModals } from './ui/modals';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hudEl = document.querySelector('.hud') as HTMLElement | null;
const hintEl = document.querySelector('.hint') as HTMLElement | null;
const hpText = document.getElementById('hpText')!;
const hpFill = document.getElementById('hpFill')!;
const expText = document.getElementById('expText')!;
const expFill = document.getElementById('expFill')!;
const floorText = document.getElementById('floorText')!;
const pauseBtn = document.getElementById('pauseBtn')!;
const skillBtn = document.getElementById('skillBtn')!;
const gearCountText = document.getElementById('gearCountText')!;
const killsText = document.getElementById('killsText')!;
const gameOverModal = document.getElementById('gameOverModal')!;
const gameOverSummary = document.getElementById('gameOverSummary')!;
const retryBtn = document.getElementById('retryBtn')!;

const modalEls = {
  skillModal: document.getElementById('skillModal')!,
  skillSpBadge: document.getElementById('skillSpBadge')!,
  skillColumns: document.getElementById('skillColumns')!,
  skillGearSummary: document.getElementById('skillGearSummary')!,
  equipModal: document.getElementById('equipModal')!,
  equipDropCard: document.getElementById('equipDropCard')!,
  equipSlotList: document.getElementById('equipSlotList')!,
};

const closeSkillBtn = document.getElementById('closeSkillBtn')!;
const scrapEquipBtn = document.getElementById('scrapEquipBtn')!;

let state: GameState = createGameState();
const controller = new InputController(canvas);
let lastRenderedModalKey = '';
const safeInsets: { hudBottom?: number; hintTop?: number } = {};

function updateSafeInsets(): void {
  if (hudEl) safeInsets.hudBottom = hudEl.getBoundingClientRect().bottom;
  if (hintEl) safeInsets.hintTop = hintEl.getBoundingClientRect().top;
}

if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(updateSafeInsets);
  if (hudEl) observer.observe(hudEl);
  if (hintEl) observer.observe(hintEl);
}

function resizeCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateSafeInsets();
}

function getModalKey(): string {
  const skillsKey = SKILL_TREE_NODES.map((n) => state.player.skillLevels[n.id] ?? 0).join(',');
  return `${state.status}:${state.player.level}:${state.player.skillPoints}:${state.player.spentSkillPoints}:${state.player.maxEquipSlots}:${state.player.scrapExpandProgress}:${skillsKey}:${state.player.equipment
    .map((e) => `${e.id}${e.level}`)
    .join(',')}:${state.pendingEquipDrop?.item.id ?? ''}`;
}

function syncUi(forceModals = false): void {
  const { player, floor, stats } = state;
  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  const expPct = Math.max(0, Math.min(100, (player.exp / Math.max(1, player.expToNext)) * 100));
  hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  hpFill.style.width = `${hpPct}%`;
  expText.textContent = `EXP ${player.exp}/${player.expToNext}`;
  expFill.style.width = `${expPct}%`;
  floorText.textContent = `${floor}F`;
  skillBtn.textContent = `🌳 LV${player.level} (SP ${player.skillPoints})`;
  const canUnlockAny = SKILL_TREE_NODES.some((n) =>
    canUnlockSkill(player.skillLevels, player.skillPoints, n.id)
  );
  skillBtn.classList.toggle('has-sp', canUnlockAny);
  pauseBtn.classList.toggle('has-sp', state.status === 'skill_tree');
  gearCountText.textContent = `GEAR ${player.equipment.length}/${player.maxEquipSlots}`;
  killsText.textContent = `KILLS ${stats.kills}`;

  if (state.status === 'gameover') {
    gameOverModal.classList.remove('hidden');
    gameOverSummary.textContent = `到達階層: ${floor}F / 撃破数: ${stats.kills} / LV: ${player.level}`;
  } else {
    gameOverModal.classList.add('hidden');
  }

  const key = getModalKey();
  if (forceModals || key !== lastRenderedModalKey) {
    lastRenderedModalKey = key;
    renderModals(state, modalEls, {
      onUnlockSkill: (nodeId) => {
        unlockSkillNode(state, nodeId);
        syncUi(true);
      },
      onCloseSkillTree: () => {
        closeSkillTree(state);
        syncUi(true);
      },
      onResolveEquip: (choice) => {
        resolveEquipChoice(state, choice);
        syncUi(true);
      },
    });
  }
}

pauseBtn.addEventListener('click', () => {
  toggleSkillTree(state);
  syncUi(true);
});

skillBtn.addEventListener('click', () => {
  toggleSkillTree(state);
  syncUi(true);
});

closeSkillBtn.addEventListener('click', () => {
  closeSkillTree(state);
  syncUi(true);
});

scrapEquipBtn.addEventListener('click', () => {
  resolveEquipChoice(state, { type: 'scrap_expand' });
  syncUi(true);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key.toLowerCase() === 'k') {
    if (state.status === 'playing' || state.status === 'skill_tree') {
      if (e.key === 'Escape') e.preventDefault();
      toggleSkillTree(state);
      syncUi(true);
    }
  }
});

retryBtn.addEventListener('click', () => {
  state = createGameState();
  syncUi(true);
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let lastTime = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  stepGame(state, controller.getMoveVector(), dt);
  renderGame(ctx, window.innerWidth, window.innerHeight, state, controller.stick, now / 1000, safeInsets);
  syncUi();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
