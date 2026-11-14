import {
  closeSkillTree,
  createGameState,
  openSkillTree,
  resolveEquipChoice,
  stepGame,
  unlockSkillNode,
} from './game/engine';
import { MAX_EQUIP_SLOTS } from './game/equipment';
import { SKILL_TREE_NODES, canUnlockSkill } from './game/skillTree';
import type { GameState } from './game/types';
import { InputController } from './input/controller';
import { renderGame } from './render/canvasRenderer';
import { renderModals } from './ui/modals';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hpText = document.getElementById('hpText')!;
const hpFill = document.getElementById('hpFill')!;
const floorText = document.getElementById('floorText')!;
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

function getModalKey(): string {
  return `${state.status}:${state.player.skillPoints}:${state.player.unlockedSkills.join(',')}:${state.player.equipment
    .map((e) => `${e.id}${e.level}`)
    .join(',')}:${state.pendingEquipDrop?.item.id ?? ''}`;
}

function syncUi(forceModals = false): void {
  const { player, floor, stats } = state;
  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  hpFill.style.width = `${hpPct}%`;
  floorText.textContent = `${floor}F`;
  skillBtn.textContent = `🌳 LV${player.level} (SP ${player.skillPoints})`;
  const unlockedSet = new Set(player.unlockedSkills);
  const canUnlockAny = SKILL_TREE_NODES.some((n) =>
    canUnlockSkill(unlockedSet, player.skillPoints, n.id)
  );
  skillBtn.classList.toggle('has-sp', canUnlockAny);
  gearCountText.textContent = `GEAR ${player.equipment.length}/${MAX_EQUIP_SLOTS}`;
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

skillBtn.addEventListener('click', () => {
  if (state.status === 'playing') {
    openSkillTree(state);
  } else if (state.status === 'skill_tree') {
    closeSkillTree(state);
  }
  syncUi(true);
});

closeSkillBtn.addEventListener('click', () => {
  closeSkillTree(state);
  syncUi(true);
});

scrapEquipBtn.addEventListener('click', () => {
  resolveEquipChoice(state, { type: 'scrap' });
  syncUi(true);
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'k') {
    if (state.status === 'playing') openSkillTree(state);
    else if (state.status === 'skill_tree') closeSkillTree(state);
    syncUi(true);
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
  renderGame(ctx, window.innerWidth, window.innerHeight, state, controller.stick, now / 1000);
  syncUi();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
