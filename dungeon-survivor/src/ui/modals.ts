import { type EquipChoice, getPlayerBaseAttackStats } from '../game/engine';
import {
  EQUIPMENT_CATALOG,
  type EquippedItem,
  getEquipmentCooldownMultiplier,
  getEquipmentDamage,
  getEquipmentEvolutionSummary,
  getOrbitShieldRadius,
  getPulseBladeStats,
  getReactiveCoilStats,
  getRicochetDiscStats,
  getScrapExpandCost,
  getSeekerDroneRange,
  MAX_EQUIP_SLOTS_CAP,
  MAX_EQUIPMENT_LEVEL,
  MAX_TARGET_RANGE,
} from '../game/equipment';
import {
  canUpgradeSkill,
  computeSkillModifiers,
  getSkillDetailedSpec,
  getSkillLevel,
  getSkillMaxLevel,
  getSkillUpgradeCost,
  SKILL_PREREQ_LEVEL,
  SKILL_TREE_NODES,
  type SkillBranch,
  type SkillNodeId,
} from '../game/skillTree';
import type { GameState } from '../game/types';
import { getSkillIcon, ICON_CLOSE, ICON_GEAR, ICON_INFO, ICON_LOCK, ICON_TREE } from './icons';

export type PauseModalTab = 'skill' | 'gear';

export interface ModalHandlers {
  onUnlockSkill: (nodeId: SkillNodeId) => void;
  onCloseSkillTree: () => void;
  onResolveEquip: (choice: EquipChoice) => void;
  activeTab?: PauseModalTab;
}

export interface ModalElements {
  skillModal: HTMLElement;
  skillSpBadge: HTMLElement;
  skillColumns: HTMLElement;
  skillTabBody?: HTMLElement;
  gearTabBody?: HTMLElement;
  tabSkillBtn?: HTMLElement;
  tabGearBtn?: HTMLElement;
  equipModal: HTMLElement;
  equipDropCard: HTMLElement;
  equipSlotList: HTMLElement;
}

const BRANCH_META: { id: SkillBranch; label: string; accent: string }[] = [
  { id: 'arms', label: '兵装・ビット', accent: '#f87171' },
  { id: 'defense', label: '迎撃・防衛', accent: '#60a5fa' },
  { id: 'mobility', label: '探索・機動', accent: '#34d399' },
];

function getBranchLabel(branch: SkillBranch): string {
  return BRANCH_META.find((b) => b.id === branch)?.label ?? branch;
}

export interface PopoverRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface PopoverLayout {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  placement: 'right' | 'left' | 'bottom' | 'top' | 'center';
}

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function placeVertically(
  anchorRect: PopoverRect,
  height: number,
  viewportHeight: number,
  margin: number,
  gap: number,
): { top: number; placement: 'bottom' | 'top' | 'center' } {
  if (anchorRect.bottom + gap + height <= viewportHeight - margin) {
    return { top: Math.round(anchorRect.bottom + gap), placement: 'bottom' };
  }
  if (anchorRect.top - gap - height >= margin) {
    return { top: Math.round(anchorRect.top - gap - height), placement: 'top' };
  }
  return { top: Math.round((viewportHeight - height) / 2), placement: 'center' };
}

export function computePopoverPosition(
  anchorRect: PopoverRect,
  popSize: { width: number; height: number },
  viewport: { width: number; height: number },
): PopoverLayout {
  const margin = 12;
  const gap = 10;
  const maxWidth = Math.max(220, Math.min(360, viewport.width - margin * 2));
  const maxHeight = Math.max(180, viewport.height - margin * 2);
  const width = Math.min(popSize.width > 0 ? popSize.width : maxWidth, maxWidth);
  const height = Math.min(popSize.height > 0 ? popSize.height : Math.min(340, maxHeight), maxHeight);
  const maxLeft = Math.max(margin, viewport.width - width - margin);
  const maxTop = Math.max(margin, viewport.height - height - margin);

  let left = margin;
  let top = margin;
  let placement: PopoverLayout['placement'] = 'center';

  if (viewport.width < 640) {
    left = Math.round((viewport.width - width) / 2);
    ({ top, placement } = placeVertically(anchorRect, height, viewport.height, margin, gap));
  } else if (anchorRect.right + gap + width <= viewport.width - margin) {
    left = Math.round(anchorRect.right + gap);
    top = Math.round(anchorRect.top - 12);
    placement = 'right';
  } else if (anchorRect.left - gap - width >= margin) {
    left = Math.round(anchorRect.left - gap - width);
    top = Math.round(anchorRect.top - 12);
    placement = 'left';
  } else {
    left = Math.round(anchorRect.right - width);
    ({ top, placement } = placeVertically(anchorRect, height, viewport.height, margin, gap));
  }

  return {
    left: clampNum(left, margin, maxLeft),
    top: clampNum(top, margin, maxTop),
    maxWidth,
    maxHeight,
    placement,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface PopoverController {
  popoverEl: HTMLElement;
  state: GameState | null;
  openNodeId: SkillNodeId | null;
  pinned: boolean;
  closeTimer: ReturnType<typeof setTimeout> | null;
  lastPointerDownTs: number;
  suppressNextFocusOpen: boolean;
  open: (nodeId: SkillNodeId, pin: boolean, anchorBtn?: HTMLElement | null) => void;
  close: (restoreFocus?: boolean) => void;
  scheduleClose: () => void;
  cancelClose: () => void;
  reposition: (anchorBtn?: HTMLElement | null) => void;
  refresh: () => void;
  handleFocusOut: () => void;
}

const popoverControllers = new WeakMap<HTMLElement, PopoverController>();
let activePopoverModal: HTMLElement | null = null;

function buildPopoverContent(popoverEl: HTMLElement, state: GameState, nodeId: SkillNodeId): void {
  const spec = getSkillDetailedSpec(nodeId, state.player.skillLevels);
  const isMax = spec.currentLevel >= spec.maxLevel;
  popoverEl.dataset.branch = spec.branch;
  popoverEl.dataset.nodeId = spec.id;
  popoverEl.innerHTML = '';

  const header = el('div', 'skill-popover-head');
  const titleGroup = el('div', 'skill-popover-title-group');

  const iconBox = el('span', 'skill-popover-icon');
  iconBox.setAttribute('aria-hidden', 'true');
  iconBox.innerHTML = getSkillIcon(spec.id);

  const titleText = el('div', 'skill-popover-title-text');
  const titleEl = el('h3', 'skill-popover-title', spec.name);
  titleEl.id = 'skillPopoverTitle';
  const metaEl = el(
    'div',
    'skill-popover-meta',
    `${getBranchLabel(spec.branch)} · Tier ${spec.tier} · Lv${spec.currentLevel}/${spec.maxLevel}${isMax ? ' (MAX)' : ''}`,
  );
  titleText.append(titleEl, metaEl);
  titleGroup.append(iconBox, titleText);

  const closeBtn = el('button', 'skill-popover-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '詳細を閉じる');
  closeBtn.title = '閉じる (ESC)';
  closeBtn.innerHTML = ICON_CLOSE;

  header.append(titleGroup, closeBtn);
  popoverEl.appendChild(header);

  const currentBox = el('div', 'skill-popover-current');
  const currentLabel = el('span', 'skill-popover-section-label', '現在の効果');
  const currentVal = el('div', 'skill-popover-current-val', spec.currentEffect);
  currentBox.append(currentLabel, currentVal);
  popoverEl.appendChild(currentBox);

  const detailDesc = el('p', 'skill-popover-desc', spec.detailNote);
  popoverEl.appendChild(detailDesc);

  const prereqRow = el('div', 'skill-popover-prereq');
  const prereqLabel = el('span', 'skill-popover-section-label', '前提条件');
  const prereqBadge = el('span', 'skill-popover-prereq-val');
  if (spec.requires === null) {
    prereqBadge.classList.add('is-met');
    prereqBadge.textContent = 'なし（基本ノード）';
  } else {
    prereqBadge.classList.add(spec.requires.met ? 'is-met' : 'is-unmet');
    const statusText = spec.requires.met
      ? `達成済み (現在 Lv${spec.requires.currentLevel})`
      : `未達成 (現在 Lv${spec.requires.currentLevel}/${spec.requires.requiredLevel})`;
    prereqBadge.textContent = `${spec.requires.name} Lv${spec.requires.requiredLevel}+ · ${statusText}`;
  }
  prereqRow.append(prereqLabel, prereqBadge);
  popoverEl.appendChild(prereqRow);

  const breakdownSection = el('div', 'skill-popover-levels');
  const breakdownHead = el('div', 'skill-popover-levels-head');
  breakdownHead.append(
    el('span', 'skill-popover-section-label', 'レベル別効果 ＆ SPコスト'),
    el('span', 'skill-popover-total-sp', `合計 ${spec.totalCost} SP`),
  );
  breakdownSection.appendChild(breakdownHead);

  const list = el('div', 'skill-popover-level-list');
  for (const row of spec.levels) {
    const isCurrent = row.level === spec.currentLevel;
    const isNext = !isMax && row.level === spec.currentLevel + 1;
    const isReached = row.level <= spec.currentLevel;
    const item = el(
      'div',
      `skill-popover-level-row${isCurrent ? ' is-current' : ''}${isNext ? ' is-next' : ''}${isReached ? ' is-reached' : ''}`,
    );
    const lvCol = el('span', 'skill-popover-lv-tag', `Lv${row.level}`);
    const costCol = el('span', 'skill-popover-sp-tag', `${row.cost} SP`);
    const summaryCol = el('span', 'skill-popover-lv-summary', row.summary);
    item.append(lvCol, costCol, summaryCol);
    list.appendChild(item);
  }
  breakdownSection.appendChild(list);
  popoverEl.appendChild(breakdownSection);
}

function getOrCreatePopoverController(skillModal: HTMLElement): PopoverController {
  const existing = popoverControllers.get(skillModal);
  if (existing) return existing;

  let popoverEl = skillModal.querySelector('#skillInfoPopover') as HTMLElement | null;
  if (!popoverEl) {
    popoverEl = el('div', 'skill-popover hidden');
    popoverEl.id = 'skillInfoPopover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-modal', 'false');
    popoverEl.setAttribute('aria-labelledby', 'skillPopoverTitle');
    skillModal.appendChild(popoverEl);
  }

  const syncExpandedAttrs = (activeId: SkillNodeId | null): void => {
    const btns = skillModal.querySelectorAll('.node-info-btn');
    btns.forEach((btn) => {
      const elBtn = btn as HTMLElement;
      const isMatch = activeId !== null && elBtn.dataset.infoNode === activeId;
      elBtn.setAttribute('aria-expanded', String(isMatch));
      elBtn.closest('.tree-node')?.classList.toggle('is-info-open', isMatch);
    });
  };

  const findAnchorBtn = (nodeId: SkillNodeId): HTMLElement | null => {
    const btns = skillModal.querySelectorAll('.node-info-btn');
    for (const btn of Array.from(btns)) {
      if ((btn as HTMLElement).dataset.infoNode === nodeId) {
        return btn as HTMLElement;
      }
    }
    return null;
  };

  const ctrl: PopoverController = {
    popoverEl,
    state: null,
    openNodeId: null,
    pinned: false,
    closeTimer: null,
    lastPointerDownTs: 0,
    suppressNextFocusOpen: false,
    cancelClose() {
      if (ctrl.closeTimer !== null) {
        clearTimeout(ctrl.closeTimer);
        ctrl.closeTimer = null;
      }
    },
    scheduleClose() {
      ctrl.cancelClose();
      ctrl.closeTimer = setTimeout(() => {
        ctrl.closeTimer = null;
        if (!ctrl.pinned) {
          ctrl.close(false);
        }
      }, 140);
    },
    reposition(anchorBtn?: HTMLElement | null) {
      if (!ctrl.openNodeId) return;
      const anchor = anchorBtn ?? findAnchorBtn(ctrl.openNodeId);
      if (!anchor) return;
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
      const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
      const anchorRect = anchor.getBoundingClientRect();
      const popRect = popoverEl.getBoundingClientRect();
      const layout = computePopoverPosition(
        anchorRect,
        { width: popRect.width, height: popRect.height },
        { width: vw, height: vh },
      );
      popoverEl.style.left = `${layout.left}px`;
      popoverEl.style.top = `${layout.top}px`;
      popoverEl.style.maxWidth = `${layout.maxWidth}px`;
      popoverEl.style.maxHeight = `${layout.maxHeight}px`;
      popoverEl.dataset.placement = layout.placement;
    },
    open(nodeId, pin, anchorBtn) {
      ctrl.cancelClose();
      if (!ctrl.state) return;
      ctrl.openNodeId = nodeId;
      if (pin) {
        ctrl.pinned = true;
      }
      buildPopoverContent(popoverEl, ctrl.state, nodeId);
      popoverEl.classList.remove('hidden');
      syncExpandedAttrs(nodeId);
      activePopoverModal = skillModal;
      ctrl.reposition(anchorBtn);
    },
    close(restoreFocus = false) {
      ctrl.cancelClose();
      const prevNodeId = ctrl.openNodeId;
      ctrl.openNodeId = null;
      ctrl.pinned = false;
      popoverEl.classList.add('hidden');
      syncExpandedAttrs(null);
      if (activePopoverModal === skillModal) {
        activePopoverModal = null;
      }
      if (restoreFocus && prevNodeId) {
        ctrl.suppressNextFocusOpen = true;
        findAnchorBtn(prevNodeId)?.focus();
        ctrl.suppressNextFocusOpen = false;
      }
    },
    refresh() {
      if (!ctrl.openNodeId || !ctrl.state) return;
      buildPopoverContent(popoverEl, ctrl.state, ctrl.openNodeId);
      popoverEl.classList.remove('hidden');
      syncExpandedAttrs(ctrl.openNodeId);
      ctrl.reposition();
    },
    handleFocusOut() {
      if (ctrl.pinned || !ctrl.openNodeId) return;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (!active) {
        ctrl.close(false);
        return;
      }
      const inPopover = popoverEl.contains(active);
      const isInfoBtn =
        typeof (active as HTMLElement).closest === 'function' &&
        Boolean((active as HTMLElement).closest('.node-info-btn')) &&
        skillModal.contains(active);
      if (!inPopover && !isInfoBtn) {
        ctrl.close(false);
      }
    },
  };

  skillModal.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest?.('.node-info-btn')) {
      ctrl.lastPointerDownTs = Date.now();
      return;
    }
    if (popoverEl.contains(target)) {
      return;
    }
    if (ctrl.openNodeId !== null) {
      ctrl.close(false);
    }
  });

  skillModal.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const infoBtn = target.closest?.('.node-info-btn') as HTMLElement | null;
    if (infoBtn && skillModal.contains(infoBtn)) {
      e.stopPropagation();
      const nodeId = infoBtn.dataset.infoNode as SkillNodeId | undefined;
      if (!nodeId) return;
      if (ctrl.openNodeId === nodeId && ctrl.pinned) {
        ctrl.close(false);
      } else {
        ctrl.open(nodeId, true, infoBtn);
      }
      return;
    }
    const closeBtn = target.closest?.('.skill-popover-close') as HTMLElement | null;
    if (closeBtn && popoverEl.contains(closeBtn)) {
      e.stopPropagation();
      ctrl.close(true);
    }
  });

  popoverEl.addEventListener('pointerenter', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse') {
      ctrl.cancelClose();
    }
  });
  popoverEl.addEventListener('pointerleave', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse' && !ctrl.pinned) {
      ctrl.scheduleClose();
    }
  });
  popoverEl.addEventListener('focusout', () => {
    setTimeout(() => ctrl.handleFocusOut(), 0);
  });
  skillModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ctrl.openNodeId) {
      e.preventDefault();
      e.stopPropagation();
      ctrl.close(true);
    }
  });

  const scrollBody = skillModal.querySelector('.pause-modal-scroll');
  scrollBody?.addEventListener(
    'scroll',
    () => {
      if (!ctrl.openNodeId) return;
      if (ctrl.pinned) {
        ctrl.reposition();
      } else {
        ctrl.close(false);
      }
    },
    { passive: true },
  );

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      if (ctrl.openNodeId) {
        ctrl.reposition();
      }
    });
  }

  popoverControllers.set(skillModal, ctrl);
  return ctrl;
}

export function closeOpenSkillInfoPopover(skillModal?: HTMLElement): boolean {
  const targetModal = skillModal ?? activePopoverModal;
  if (!targetModal) return false;
  const ctrl = popoverControllers.get(targetModal);
  if (!ctrl || !ctrl.openNodeId) return false;
  ctrl.close(true);
  return true;
}

function getEquipmentNumericChips(eq: EquippedItem, state: GameState): string[] {
  const def = EQUIPMENT_CATALOG[eq.id];
  const mods = computeSkillModifiers(state.player.skillLevels);
  const dmg = Math.round(getEquipmentDamage(eq, 1));
  const cdMult = getEquipmentCooldownMultiplier(eq.level);

  if (eq.id === 'orbit_shield') {
    const r = Math.round(getOrbitShieldRadius(eq.level, mods.rangeMult));
    return [`威力 ${dmg}`, `半径 ${r}px`];
  }
  const cdSec = (def.baseCooldown * cdMult).toFixed(2);
  let actualRange = def.baseRange * mods.rangeMult;
  if (eq.id === 'pulse_blade') {
    actualRange = getPulseBladeStats(eq.level, def.baseRange, mods.rangeMult).range;
  } else if (eq.id === 'seeker_drone') {
    actualRange = getSeekerDroneRange(eq.level, def.baseRange, mods.rangeMult);
  } else if (eq.id === 'reactive_coil') {
    actualRange = getReactiveCoilStats(eq.level, def.baseRange, mods.rangeMult).range;
  } else if (eq.id === 'ricochet_disc') {
    actualRange = getRicochetDiscStats(eq.level, mods.rangeMult).range;
  }
  const cappedRange = Math.round(Math.min(MAX_TARGET_RANGE, actualRange));
  return [`威力 ${dmg}`, `${cdSec}s`, `射程 ${cappedRange}px`];
}

function renderGearTabContent(container: HTMLElement, state: GameState): void {
  const { player } = state;
  const isMaxSlots = player.maxEquipSlots >= MAX_EQUIP_SLOTS_CAP;
  const expandCost = getScrapExpandCost(player.maxEquipSlots);
  const progress = isMaxSlots
    ? 100
    : Math.min(100, Math.round((player.scrapExpandProgress / Math.max(1, expandCost)) * 100));
  const remaining = Math.max(0, expandCost - player.scrapExpandProgress);

  const scrapTitleRight = isMaxSlots
    ? `枠 ${player.maxEquipSlots} / ${MAX_EQUIP_SLOTS_CAP}（最大拡張済み）`
    : `枠 ${player.maxEquipSlots} / ${MAX_EQUIP_SLOTS_CAP}（蓄積 ${player.scrapExpandProgress} / ${expandCost}）`;

  const scrapHint = isMaxSlots
    ? `装備枠は最大（${MAX_EQUIP_SLOTS_CAP}枠）に到達しています。満杯時や+2Lv以上の重複ドロップ時は既存装備のLv+1や入れ替えに活用できます。`
    : `満杯状態や+2Lv以上の重複ドロップ時に「枠拡張へ蓄積」を選ぶと、あと <strong>${remaining}回</strong> で装備枠が +1 されます（他装備Lv+1や入れ替えも選択可能）。`;

  const baseStats = getPlayerBaseAttackStats(player);
  const ocLv = getSkillLevel(player.skillLevels, 'arm_overclock');
  const mainBadge = ocLv > 0 ? `レーザー化 Lv${ocLv}` : `メイン武器`;
  const homingLabel = baseStats.homingShots > 0 ? ` + 誘導${baseStats.homingShots}発` : '';
  const pierceChip = baseStats.pierce ? `<span class="stat-chip" style="color:#67e8f9">貫通</span>` : '';

  const subCards: string[] = [];
  for (let i = 0; i < player.maxEquipSlots; i++) {
    const eq = player.equipment[i];
    if (eq) {
      const def = EQUIPMENT_CATALOG[eq.id];
      const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
      const lvLabel =
        eq.level >= MAX_EQUIPMENT_LEVEL
          ? `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} MAX`
          : `Lv${eq.level}/${MAX_EQUIPMENT_LEVEL}`;
      const chipsHtml = getEquipmentNumericChips(eq, state)
        .map((c) => `<span class="stat-chip">${c}</span>`)
        .join('');
      subCards.push(`
        <div class="sub-gear-card" style="--card-accent:${def.color}88">
          <div class="gear-cat" style="color:${def.color}">${def.category}</div>
          <div class="gear-card-head">
            <span class="gear-name">${def.name}</span>
            <span class="gear-lv" style="color:${def.color}">${lvLabel}</span>
          </div>
          <div class="gear-evo">進化: ${evo}</div>
          <div class="gear-stats">${chipsHtml}</div>
        </div>
      `);
    } else {
      subCards.push(`
        <div class="sub-gear-card empty">
          <div>
            <div class="gear-cat">SLOT ${i + 1} / ${player.maxEquipSlots}</div>
            <div style="font-size:13.5px;font-weight:700;color:#94a3b8">EMPTY SLOT</div>
            <div style="font-size:11px">宝箱やボスドロップで自動装着</div>
          </div>
          <span class="gear-lv">空き枠</span>
        </div>
      `);
    }
  }

  container.innerHTML = `
    <div class="scrap-panel">
      <div class="scrap-top">
        <span class="scrap-title">スクラップ＆ビルド（枠拡張進捗）</span>
        <span class="scrap-count">${scrapTitleRight}</span>
      </div>
      <div class="scrap-bar-track"><div class="scrap-bar-fill" style="width:${progress}%"></div></div>
      <div class="scrap-hint">${scrapHint}</div>
    </div>

    <div class="gear-section-kicker">MAIN WEAPON（常時装備）</div>
    <div class="main-weapon-card">
      <div class="gear-card-head">
        <span class="gear-name" style="color:#6ee7b7">コアショット（メイン武器）</span>
        <span class="gear-lv" style="color:#34d399;border-color:rgba(52,211,153,0.5)">${mainBadge}</span>
      </div>
      <div class="gear-stats">
        <span class="stat-chip">威力 ${baseStats.damage}</span>
        <span class="stat-chip">${baseStats.shotCount}発${homingLabel}</span>
        <span class="stat-chip">${baseStats.cooldown.toFixed(2)}s</span>
        <span class="stat-chip">射程 ${baseStats.range}px</span>
        ${pierceChip}
      </div>
    </div>

    <div class="gear-section-kicker">SUB EQUIPMENT SLOTS（${player.equipment.length} / ${player.maxEquipSlots} 装着中）</div>
    <div class="gear-grid">${subCards.join('')}</div>
  `;
}

export function renderModals(state: GameState, els: ModalElements, handlers: ModalHandlers): void {
  const ctrl = getOrCreatePopoverController(els.skillModal);
  ctrl.state = state;

  // 1. Pause Modal (Skill Tree / Gear & Scrap-Build Tabs)
  if (state.status === 'skill_tree') {
    const activeTab: PauseModalTab = handlers.activeTab ?? 'skill';
    els.skillModal.classList.remove('hidden');
    els.skillSpBadge.textContent = `所持 SP: ${state.player.skillPoints} (使用済 ${state.player.spentSkillPoints})`;

    if (els.tabSkillBtn) {
      els.tabSkillBtn.innerHTML = `${ICON_TREE}<span>スキル</span><span class="tab-badge">SP ${state.player.skillPoints}</span>`;
      els.tabSkillBtn.classList.toggle('active-skill', activeTab === 'skill');
      els.tabSkillBtn.setAttribute('aria-selected', String(activeTab === 'skill'));
    }
    if (els.tabGearBtn) {
      els.tabGearBtn.innerHTML = `${ICON_GEAR}<span>装備・ギア</span><span class="tab-badge tab-badge-gear">${state.player.equipment.length} / ${state.player.maxEquipSlots}</span>`;
      els.tabGearBtn.classList.toggle('active-gear', activeTab === 'gear');
      els.tabGearBtn.setAttribute('aria-selected', String(activeTab === 'gear'));
    }
    if (els.skillTabBody && els.gearTabBody) {
      els.skillTabBody.classList.toggle('hidden', activeTab !== 'skill');
      els.gearTabBody.classList.toggle('hidden', activeTab !== 'gear');
      if (activeTab === 'gear') {
        renderGearTabContent(els.gearTabBody, state);
      }
    }

    if (activeTab !== 'skill') {
      ctrl.close(false);
    }

    els.skillColumns.innerHTML = '';
    for (const branch of BRANCH_META) {
      const col = el('div', 'tree-col');

      const heading = el('div', 'tree-col-head');
      heading.style.color = branch.accent;
      const dot = el('span', 'branch-dot');
      dot.style.background = branch.accent;
      dot.style.color = branch.accent;
      const headingLabel = el('span', undefined, branch.label);
      heading.append(dot, headingLabel);
      col.appendChild(heading);

      const nodes = SKILL_TREE_NODES.filter((n) => n.branch === branch.id).sort((a, b) => a.tier - b.tier);
      nodes.forEach((node, idx) => {
        if (idx > 0) {
          col.appendChild(el('div', 'tree-arrow', `↓ 前提 Lv${SKILL_PREREQ_LEVEL}+`));
        }

        const currLv = getSkillLevel(state.player.skillLevels, node.id);
        const maxLv = getSkillMaxLevel(node.id);
        const isMax = currLv >= maxLv;
        const nextCost = getSkillUpgradeCost(currLv, node.id);
        const isAvailable = canUpgradeSkill(state.player.skillLevels, state.player.skillPoints, node.id);
        const prereqMet =
          node.requires === null || getSkillLevel(state.player.skillLevels, node.requires) >= SKILL_PREREQ_LEVEL;

        const cardState = isMax ? 'unlocked' : isAvailable ? 'available' : currLv > 0 ? 'unlocked' : 'locked';
        const card = el('div', `tree-node ${cardState}`);
        card.dataset.branch = node.branch;
        card.dataset.tier = String(node.tier);
        card.dataset.nodeId = node.id;
        if (!isMax && !isAvailable) {
          card.dataset.lockReason = prereqMet ? 'sp' : 'prereq';
        }

        const actionBtn = el('button', 'tree-node-main');
        actionBtn.type = 'button';
        actionBtn.disabled = !isAvailable;
        actionBtn.setAttribute(
          'aria-label',
          isMax ? `${node.name} Lv${currLv}/${maxLv} MAX` : `${node.name} Lv${currLv}/${maxLv} (-${nextCost} SP)`,
        );

        const headRow = el('div', 'node-head');
        const iconSpan = el('span', 'node-icon');
        iconSpan.setAttribute('aria-hidden', 'true');
        iconSpan.innerHTML = getSkillIcon(node.id);
        const titleEl = el('span', 'node-title', node.name);
        headRow.append(iconSpan, titleEl);

        const taglineEl = el('div', 'node-tagline', node.tagline);

        const footRow = el('div', 'node-foot');
        const lvGroup = el('span', 'node-lv-group');
        lvGroup.appendChild(el('span', 'node-lv', `Lv${currLv}/${maxLv}`));
        const pips = el('span', 'node-pips');
        pips.setAttribute('aria-hidden', 'true');
        for (let lv = 1; lv <= maxLv; lv++) {
          pips.appendChild(el('span', `node-pip${lv <= currLv ? ' is-filled' : ''}`));
        }
        lvGroup.appendChild(pips);

        const costBadge = el('span', 'node-cost');
        if (isMax) {
          costBadge.textContent = 'MAX';
        } else if (isAvailable) {
          costBadge.textContent = `-${nextCost} SP`;
        } else {
          const lockIcon = el('span', 'node-lock-icon');
          lockIcon.setAttribute('aria-hidden', 'true');
          lockIcon.innerHTML = ICON_LOCK;
          costBadge.append(lockIcon, el('span', undefined, `-${nextCost} SP`));
        }

        footRow.append(lvGroup, costBadge);
        actionBtn.append(headRow, taglineEl, footRow);

        if (isAvailable) {
          actionBtn.addEventListener('click', () => handlers.onUnlockSkill(node.id));
        }

        const infoBtn = el('button', 'node-info-btn');
        infoBtn.type = 'button';
        infoBtn.dataset.infoNode = node.id;
        infoBtn.setAttribute('aria-label', `${node.name}の詳細情報`);
        infoBtn.setAttribute('aria-haspopup', 'dialog');
        infoBtn.setAttribute('aria-expanded', String(ctrl.openNodeId === node.id));
        infoBtn.setAttribute('aria-controls', 'skillInfoPopover');
        infoBtn.title = `${node.name}の詳細`;
        infoBtn.innerHTML = ICON_INFO;

        infoBtn.addEventListener('pointerenter', (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && !ctrl.pinned) {
            ctrl.open(node.id, false, infoBtn);
          }
        });
        infoBtn.addEventListener('pointerleave', (e) => {
          if ((e as PointerEvent).pointerType === 'mouse' && !ctrl.pinned) {
            ctrl.scheduleClose();
          }
        });
        infoBtn.addEventListener('focusin', () => {
          if (ctrl.suppressNextFocusOpen) {
            ctrl.suppressNextFocusOpen = false;
            return;
          }
          if (Date.now() - ctrl.lastPointerDownTs < 400) return;
          if (!ctrl.pinned) {
            ctrl.open(node.id, false, infoBtn);
          }
        });
        infoBtn.addEventListener('focusout', () => {
          setTimeout(() => ctrl.handleFocusOut(), 0);
        });

        card.append(actionBtn, infoBtn);
        col.appendChild(card);
      });

      els.skillColumns.appendChild(col);
    }

    if (activeTab === 'skill' && ctrl.openNodeId) {
      ctrl.refresh();
    }
  } else {
    ctrl.close(false);
    els.skillModal.classList.add('hidden');
  }

  // 2. Equipment Choice Modal (when slots === maxEquipSlots or +2Lv+ higher duplicate drop)
  if (state.status === 'equip_choice' && state.pendingEquipDrop) {
    els.equipModal.classList.remove('hidden');
    const dropItem = state.pendingEquipDrop.item;
    const dropDef = EQUIPMENT_CATALOG[dropItem.id];
    const dropEvo = getEquipmentEvolutionSummary(dropItem.id, dropItem.level);
    const existingItem = state.player.equipment.find((eq) => eq.id === dropItem.id);
    const isDuplicateDrop = existingItem !== undefined;
    const existingLv = existingItem ? existingItem.level : 0;
    const levelDiff = dropItem.level - existingLv;

    const titleEl = document.getElementById('equipModalTitle');
    if (titleEl) {
      titleEl.textContent = isDuplicateDrop
        ? `⚡ 高Lv重複ドロップ（+${levelDiff}Lv）`
        : `装備スロット満杯（${state.player.equipment.length}/${state.player.maxEquipSlots}）`;
    }
    const reasonEl = document.getElementById('equipModalReason');
    if (reasonEl) {
      reasonEl.classList.toggle('dup', isDuplicateDrop);
      reasonEl.textContent = isDuplicateDrop
        ? `所持中の「${dropDef.name} Lv${existingLv}」より +${levelDiff}Lv 高い装備が出現！一気に入れ替えるか、他装備の強化・枠拡張に回せます。`
        : '装備枠がいっぱいのため、既存装備と入れ替えるか、スクラップにして他装備のLv+1・枠拡張に活用できます。';
    }
    const subLabelEl = document.getElementById('equipModalSubLabel');
    if (subLabelEl) {
      subLabelEl.textContent = isDuplicateDrop
        ? 'または同装備と入れ替え／他装備をLv+1で強化：'
        : 'または既存スロットと入れ替え／スクラップで1個強化：';
    }
    const scrapExpandBtn = document.getElementById('scrapEquipBtn') as HTMLButtonElement | null;
    if (scrapExpandBtn) {
      const canExpand = state.player.maxEquipSlots < MAX_EQUIP_SLOTS_CAP;
      const expandCost = getScrapExpandCost(state.player.maxEquipSlots);
      scrapExpandBtn.disabled = !canExpand;
      scrapExpandBtn.textContent = canExpand
        ? `スクラップ＆ビルド：枠拡張へ蓄積（${state.player.scrapExpandProgress}/${expandCost}）→ ${expandCost}回で枠+1`
        : `装備枠は最大（${MAX_EQUIP_SLOTS_CAP}/${MAX_EQUIP_SLOTS_CAP}）`;
    }

    els.equipDropCard.innerHTML = `
      <div class="drop-badge" style="color:${dropDef.color}">${dropDef.category}</div>
      <div class="drop-name">${dropDef.name} Lv${dropItem.level} <span style="font-size:12px;color:#fbbf24;">[${dropEvo}]</span></div>
      <div class="drop-desc">${dropDef.description}</div>
    `;

    els.equipSlotList.innerHTML = '';
    state.player.equipment.forEach((eq, idx) => {
      const def = EQUIPMENT_CATALOG[eq.id];
      const evo = getEquipmentEvolutionSummary(eq.id, eq.level);
      const isMaxLv = eq.level >= MAX_EQUIPMENT_LEVEL;
      const isSameEquipment = eq.id === dropItem.id;
      const row = document.createElement('div');
      row.className = isDuplicateDrop && isSameEquipment ? 'slot-btn dup-match' : 'slot-btn';
      const matchTag =
        isDuplicateDrop && isSameEquipment ? `<span class="slot-match-tag">所持中・入替で+${levelDiff}Lv</span>` : '';
      row.innerHTML = `
        <span><strong>枠${idx + 1}/${state.player.maxEquipSlots}</strong> ${def.name} Lv${eq.level}/${MAX_EQUIPMENT_LEVEL} <small style="color:#94a3b8">(${evo})</small>${matchTag}</span>
      `;
      const actions = document.createElement('span');
      actions.style.display = 'inline-flex';
      actions.style.gap = '6px';

      const replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'slot-action';
      if (isDuplicateDrop && !isSameEquipment) {
        replaceBtn.disabled = true;
        replaceBtn.textContent = '重複不可';
      } else {
        replaceBtn.textContent = isDuplicateDrop ? `入れ替える (Lv${eq.level}→Lv${dropItem.level})` : '入れ替える';
        replaceBtn.addEventListener('click', () => handlers.onResolveEquip({ type: 'replace', slotIndex: idx }));
      }

      const upgradeBtn = document.createElement('button');
      upgradeBtn.type = 'button';
      upgradeBtn.className = 'slot-action upgrade';
      if (isMaxLv) {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = `MAX (Lv${MAX_EQUIPMENT_LEVEL})`;
      } else if (isDuplicateDrop && isSameEquipment) {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = '入替で強化';
      } else {
        upgradeBtn.textContent = `Lv+1 (${eq.level}→${eq.level + 1})`;
        upgradeBtn.addEventListener('click', () => handlers.onResolveEquip({ type: 'scrap_upgrade', slotIndex: idx }));
      }

      actions.appendChild(replaceBtn);
      actions.appendChild(upgradeBtn);
      row.appendChild(actions);
      els.equipSlotList.appendChild(row);
    });
  } else {
    els.equipModal.classList.add('hidden');
  }
}
