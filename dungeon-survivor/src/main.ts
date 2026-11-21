import './styles/theme.css';
import { SoundManager } from './audio/soundManager';
import {
  closeSkillTree,
  createGameState,
  formatPlayTime,
  resolveEquipChoice,
  startGame,
  stepGame,
  toggleSkillTree,
  unlockSkillNode,
} from './game/engine';
import { SKILL_TREE_NODES, canUnlockSkill } from './game/skillTree';
import type { GameState } from './game/types';
import { InputController } from './input/controller';
import { renderGame, type HudSafeInsets } from './render/canvasRenderer';
import { renderHudMinimap } from './render/minimapRenderer';
import {
  ICON_ALERT,
  ICON_BOSS,
  ICON_CLOSE,
  ICON_GEAR,
  ICON_PAUSE,
  ICON_SPARK,
  ICON_TREE,
  ICON_VOLUME_OFF,
  ICON_VOLUME_ON,
} from './ui/icons';
import { renderModals } from './ui/modals';

const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const minimapCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement | null;
const minimapCtx = minimapCanvas?.getContext('2d') ?? null;

const hudEl = document.querySelector('.hud') as HTMLElement | null;
const bottomConsoleEl = document.querySelector('.cockpit-console') as HTMLElement | null;
const hpBar = document.getElementById('hpBar')!;
const hpText = document.getElementById('hpText')!;
const hpFill = document.getElementById('hpFill')!;
const expText = document.getElementById('expText')!;
const expFill = document.getElementById('expFill')!;
const floorText = document.getElementById('floorText')!;
const playTimeText = document.getElementById('playTimeText')!;
const muteBtn = document.getElementById('muteBtn')!;
const skillBtn = document.getElementById('skillBtn')!;
const gearBtn = document.getElementById('gearBtn')!;
const bottomPauseLeftBtn = document.getElementById('bottomPauseLeftBtn');
const bottomSkillBadge = document.getElementById('bottomSkillBadge');
const bottomSkillSub = document.getElementById('bottomSkillSub');
const bottomGearBtn = document.getElementById('bottomGearBtn');
const bottomGearSub = document.getElementById('bottomGearSub');
const killsText = document.getElementById('killsText')!;
const notificationStack = document.getElementById('notificationStack')!;
const skillModalHeading = document.getElementById('skillModalHeading');
const startModal = document.getElementById('startModal')!;
const startBtn = document.getElementById('startBtn')!;
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
const closeSkillTopBtn = document.getElementById('closeSkillTopBtn')!;
const scrapEquipBtn = document.getElementById('scrapEquipBtn')!;

// Initialize static SVG icons
closeSkillTopBtn.innerHTML = ICON_CLOSE;
if (skillModalHeading) {
  skillModalHeading.innerHTML = `<span style="color:#fb923c;display:inline-flex">${ICON_PAUSE}</span><span>ポーズ /</span><span style="color:#34d399;display:inline-flex">${ICON_TREE}</span><span>スキルツリー</span>`;
}

let state: GameState = createGameState({ initialStatus: 'title' });
const controller = new InputController(canvas);
const soundManager = new SoundManager();
let lastRenderedModalKey = '';
let lastRenderedNotificationKey = '';
let lastRenderedGameOverKey = '';
let lastSkillBtnText = '';
let lastGearBtnText = '';
const safeInsets: HudSafeInsets = {
  hideCanvasMinimap: true,
  hideCanvasNotifications: true,
};

function syncMuteBtn(): void {
  const muted = soundManager.isMuted();
  muteBtn.innerHTML = `${muted ? ICON_VOLUME_OFF : ICON_VOLUME_ON}<span>${muted ? 'OFF' : 'ON'}</span>`;
  muteBtn.classList.toggle('is-muted', muted);
  muteBtn.title = muted ? 'サウンド OFF（タップでON）' : 'サウンド ON（タップでOFF）';
}
syncMuteBtn();

const unlockAudioOnce = (): void => {
  soundManager.unlock();
};
window.addEventListener('pointerdown', unlockAudioOnce, { passive: true });
window.addEventListener('keydown', unlockAudioOnce, { passive: true });

function resizeMinimap(): void {
  if (!minimapCanvas || !minimapCtx) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const w = Math.max(64, Math.round(rect.width || 96));
  const h = Math.max(64, Math.round(rect.height || 96));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (minimapCanvas.width !== Math.floor(w * dpr) || minimapCanvas.height !== Math.floor(h * dpr)) {
    minimapCanvas.width = Math.floor(w * dpr);
    minimapCanvas.height = Math.floor(h * dpr);
    minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function updateSafeInsets(): void {
  if (hudEl) safeInsets.hudBottom = hudEl.getBoundingClientRect().bottom;
  if (bottomConsoleEl) safeInsets.hintTop = bottomConsoleEl.getBoundingClientRect().top;
  resizeMinimap();
}

if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(updateSafeInsets);
  if (hudEl) observer.observe(hudEl);
  if (bottomConsoleEl) observer.observe(bottomConsoleEl);
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

function syncNotifications(): void {
  const visible = state.notifications.slice(-2);
  const key = visible.map((n) => `${n.id}:${n.kind}:${n.text}`).join('|');
  if (key === lastRenderedNotificationKey) {
    Array.from(notificationStack.children).forEach((el, idx) => {
      const n = visible[idx];
      if (n) {
        (el as HTMLElement).style.opacity = String(Math.max(0, Math.min(1, n.life * 2.5)));
      }
    });
    return;
  }
  lastRenderedNotificationKey = key;

  notificationStack.replaceChildren(
    ...visible.map((n) => {
      const toast = document.createElement('div');
      const isBossLike = n.text.includes('ボス') || n.text.includes('増援') || n.text.includes('ガーディアン');
      const variant =
        n.kind === 'alert'
          ? 'toast-alert'
          : n.kind === 'levelup'
          ? 'toast-levelup'
          : 'toast-info';
      toast.className = `cyber-toast ${variant}`;
      toast.style.opacity = String(Math.max(0, Math.min(1, n.life * 2.5)));
      const iconHtml =
        n.kind === 'alert' ? ICON_ALERT : isBossLike ? ICON_BOSS : ICON_SPARK;
      toast.innerHTML = `<span class="toast-icon">${iconHtml}</span><span></span>`;
      const textSpan = toast.lastElementChild as HTMLElement;
      textSpan.textContent = n.text.replace(/^[⚠️⚠👾🎉📦✨⚡🛡🔥💥\s]+/u, '');
      return toast;
    })
  );
}

function syncUi(forceModals = false): void {
  const { player, floor, stats } = state;
  const hpPct = Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100));
  const expPct = Math.max(0, Math.min(100, (player.exp / Math.max(1, player.expToNext)) * 100));
  hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  hpFill.style.width = `${hpPct}%`;
  hpBar.classList.toggle('is-low', hpPct <= 30);

  expText.textContent = `EXP ${player.exp} / ${player.expToNext}`;
  expFill.style.width = `${expPct}%`;
  floorText.textContent = `${floor}F`;
  playTimeText.textContent = formatPlayTime(stats.elapsedPlayTime ?? 0);

  const skillLabel = `LV${player.level} (SP ${player.skillPoints})`;
  if (skillLabel !== lastSkillBtnText) {
    lastSkillBtnText = skillLabel;
    skillBtn.innerHTML = `${ICON_TREE}<span>${skillLabel}</span>`;
  }

  const gearLabel = `GEAR ${player.equipment.length}/${player.maxEquipSlots}`;
  if (gearLabel !== lastGearBtnText) {
    lastGearBtnText = gearLabel;
    gearBtn.innerHTML = `${ICON_GEAR}<span>${gearLabel}</span>`;
  }

  const canUnlockAny = SKILL_TREE_NODES.some((n) =>
    canUnlockSkill(player.skillLevels, player.skillPoints, n.id)
  );
  skillBtn.classList.toggle('has-sp', canUnlockAny);
  bottomPauseLeftBtn?.classList.toggle('has-sp', canUnlockAny);
  bottomSkillBadge?.classList.toggle('hidden', !canUnlockAny);
  if (bottomSkillSub) bottomSkillSub.textContent = `SP ${player.skillPoints}`;
  if (bottomGearSub) bottomGearSub.textContent = `${player.equipment.length} / ${player.maxEquipSlots}`;

  killsText.textContent = `${stats.kills}`;

  syncNotifications();
  startModal.classList.toggle('hidden', state.status !== 'title');

  if (state.status === 'gameover') {
    gameOverModal.classList.remove('hidden');
    const goKey = `${floor}:${stats.clearTime10F ?? ''}:${player.level}:${Math.floor(stats.elapsedPlayTime ?? 0)}:${stats.kills}`;
    if (forceModals || goKey !== lastRenderedGameOverKey) {
      lastRenderedGameOverKey = goKey;
      const clear10fText =
        stats.clearTime10F !== undefined ? formatPlayTime(stats.clearTime10F) : '--:--';
      const rows: Array<{ label: string; value: string; muted?: boolean; highlight?: boolean }> = [
        { label: '最終フロア', value: `${floor}F` },
        { label: '10Fクリア時間', value: clear10fText, muted: stats.clearTime10F === undefined },
        { label: '最終レベル', value: `LV ${player.level}` },
        { label: 'プレイ時間', value: formatPlayTime(stats.elapsedPlayTime ?? 0), highlight: true },
        { label: '撃破数', value: `${stats.kills}` },
      ];
      gameOverSummary.replaceChildren(
        ...rows.map(({ label, value, muted, highlight }) => {
          const row = document.createElement('div');
          row.className = `result-row${muted ? ' is-muted' : ''}${highlight ? ' is-highlight' : ''}`;
          const l = document.createElement('span');
          l.className = 'result-label';
          l.textContent = label;
          const v = document.createElement('span');
          v.className = 'result-value';
          v.textContent = value;
          row.append(l, v);
          return row;
        })
      );
    }
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

const handleTogglePause = (): void => {
  toggleSkillTree(state);
  syncUi(true);
};

const handleOpenGear = (): void => {
  const wasPlaying = state.status === 'playing';
  toggleSkillTree(state);
  syncUi(true);
  if (wasPlaying) {
    modalEls.skillGearSummary.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
};

startBtn.addEventListener('click', () => {
  soundManager.unlock();
  startGame(state);
  syncUi(true);
});

muteBtn.addEventListener('click', () => {
  soundManager.toggleMute();
  syncMuteBtn();
});

skillBtn.addEventListener('click', handleTogglePause);
bottomPauseLeftBtn?.addEventListener('click', handleTogglePause);
gearBtn.addEventListener('click', handleOpenGear);
bottomGearBtn?.addEventListener('click', handleOpenGear);

closeSkillBtn.addEventListener('click', () => {
  closeSkillTree(state);
  syncUi(true);
});

closeSkillTopBtn.addEventListener('click', () => {
  closeSkillTree(state);
  syncUi(true);
});

scrapEquipBtn.addEventListener('click', () => {
  resolveEquipChoice(state, { type: 'scrap_expand' });
  syncUi(true);
});

window.addEventListener('keydown', (e) => {
  if (state.status === 'title' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    startGame(state);
    syncUi(true);
    return;
  }
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
  lastRenderedGameOverKey = '';
  syncUi(true);
});

// Expose lightweight debug hook for automated visual inspection / Playwright screenshots
(window as unknown as Record<string, unknown>).__DS_DEBUG__ = {
  getState: () => state,
  syncUi: () => syncUi(true),
};

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let lastTime = performance.now();
function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  stepGame(state, controller.getMoveVector(), dt);
  soundManager.playBatch(state.soundEvents);
  renderGame(ctx, window.innerWidth, window.innerHeight, state, controller.stick, now / 1000, safeInsets);

  if (minimapCanvas && minimapCtx) {
    const rect = minimapCanvas.getBoundingClientRect();
    const mw = Math.max(64, Math.round(rect.width || 96));
    const mh = Math.max(64, Math.round(rect.height || 96));
    renderHudMinimap(minimapCtx, mw, mh, state, now / 1000);
  }

  syncUi();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
