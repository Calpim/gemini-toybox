import { getSkillDetailedSpec, type SkillNodeId } from '../../game/skillTree';
import type { GameState } from '../../game/types';
import { getSkillIcon, ICON_CLOSE } from '../icons';
import { el, getBranchLabel } from './types';

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

export interface PopoverController {
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

export function getOrCreatePopoverController(skillModal: HTMLElement): PopoverController {
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
  if (!ctrl?.openNodeId) return false;
  ctrl.close(true);
  return true;
}
