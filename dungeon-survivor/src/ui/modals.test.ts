import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtmlRaw from '../../index.html?raw';
import { createGameState } from '../game/engine';
import { getSkillDetailedSpec, SKILL_PREREQ_LEVEL, SKILL_TREE_NODES } from '../game/skillTree';
import { mustDefined } from '../testUtils';
import { getSkillIcon } from './icons';
import { closeOpenSkillInfoPopover, computePopoverPosition, type ModalElements, renderModals } from './modals';

type MockListener = (event: MockEvent) => void;

interface MockEvent {
  type: string;
  target: MockElement | null;
  currentTarget: MockElement | null;
  pointerType?: string;
  key?: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

class MockClassList {
  private set = new Set<string>();
  constructor(private onChange?: () => void) {}
  setFromString(value: string): void {
    this.set = new Set(value.split(/\s+/).filter(Boolean));
  }
  toString(): string {
    return Array.from(this.set).join(' ');
  }
  add(...tokens: string[]): void {
    for (const t of tokens) if (t) this.set.add(t);
    this.onChange?.();
  }
  remove(...tokens: string[]): void {
    for (const t of tokens) this.set.delete(t);
    this.onChange?.();
  }
  toggle(token: string, force?: boolean): boolean {
    const next = force !== undefined ? force : !this.set.has(token);
    if (next) this.set.add(token);
    else this.set.delete(token);
    this.onChange?.();
    return next;
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
}

function toCamel(attr: string): string {
  return attr.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

class MockElement {
  tagName: string;
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  type = '';
  disabled = false;
  title = '';
  rect = { left: 100, right: 128, top: 120, bottom: 148, width: 28, height: 28 };
  private _text = '';
  private _rawHtml = '';
  private listeners = new Map<string, MockListener[]>();
  private ownerDoc: MockDocument;
  classList: MockClassList;
  dataset: Record<string, string>;

  constructor(tagName: string, ownerDoc: MockDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDoc = ownerDoc;
    this.classList = new MockClassList();
    this.dataset = new Proxy<Record<string, string>>(
      {},
      {
        get: (_, prop: string) => this.attributes.get(`data-${toKebab(prop)}`),
        set: (_, prop: string, val: string) => {
          this.attributes.set(`data-${toKebab(prop)}`, String(val));
          return true;
        },
      },
    );
  }

  get id(): string {
    return this.attributes.get('id') ?? '';
  }
  set id(val: string) {
    if (val) this.attributes.set('id', val);
    else this.attributes.delete('id');
  }

  get className(): string {
    return this.classList.toString();
  }
  set className(val: string) {
    this.classList.setFromString(val);
  }

  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(val: string) {
    this.children = [];
    this._rawHtml = '';
    this._text = String(val ?? '');
  }

  get innerHTML(): string {
    if (this.children.length === 0) return this._rawHtml;
    return this.children.map((c) => c.innerHTML).join('');
  }
  set innerHTML(val: string) {
    this.children = [];
    this._text = '';
    this._rawHtml = String(val ?? '');
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: MockElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  contains(other: MockElement | null): boolean {
    let curr: MockElement | null = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentNode;
    }
    return false;
  }

  matchesSelector(selector: string): boolean {
    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
    }
    const attrMatch = selector.match(/^(\.[a-zA-Z0-9_-]+)?\[([^=\]]+)="([^"]*)"\]$/);
    if (attrMatch) {
      const cls = attrMatch[1];
      const attr = attrMatch[2] ?? '';
      const val = attrMatch[3] ?? '';
      if (cls && !this.classList.contains(cls.slice(1))) return false;
      return this.getAttribute(attr) === val;
    }
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1));
    }
    return this.tagName === selector.toUpperCase();
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (curr.matchesSelector(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      let currentRoots: MockElement[] = [this];
      for (const part of parts) {
        const next: MockElement[] = [];
        for (const root of currentRoots) {
          for (const match of root.querySelectorAll(part)) {
            if (!next.includes(match)) next.push(match);
          }
        }
        currentRoots = next;
      }
      return currentRoots;
    }
    const singlePart = parts[0] ?? '';
    const out: MockElement[] = [];
    const walk = (node: MockElement) => {
      for (const child of node.children) {
        if (child.matchesSelector(singlePart)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, listener: MockListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, opts: { pointerType?: string; key?: string; bubbles?: boolean } = {}): MockEvent {
    const event: MockEvent = {
      type,
      target: this,
      currentTarget: this,
      ...(opts.pointerType !== undefined ? { pointerType: opts.pointerType } : {}),
      ...(opts.key !== undefined ? { key: opts.key } : {}),
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };
    const bubbles = opts.bubbles ?? (type !== 'pointerenter' && type !== 'pointerleave');
    let curr: MockElement | null = this;
    while (curr) {
      event.currentTarget = curr;
      const list = curr.listeners.get(type) ?? [];
      for (const fn of list) {
        fn(event);
      }
      if (!bubbles || event.propagationStopped) break;
      curr = curr.parentNode;
    }
    return event;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatch('click', { bubbles: true });
  }

  focus(): void {
    this.ownerDoc.activeElement = this;
    this.dispatch('focusin', { bubbles: true });
  }

  getBoundingClientRect() {
    if (this.id === 'skillInfoPopover') {
      return { left: 0, right: 340, top: 0, bottom: 320, width: 340, height: 320 };
    }
    return this.rect;
  }

  // Convenience for dataset attribute access
  getData(prop: string): string | undefined {
    return this.dataset[toCamel(prop)];
  }
}

class MockDocument {
  activeElement: MockElement | null = null;
  body: MockElement;
  private byId = new Map<string, MockElement>();

  constructor() {
    this.body = new MockElement('body', this);
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }

  registerId(el: MockElement): void {
    if (el.id) this.byId.set(el.id, el);
  }

  getElementById(id: string): MockElement | null {
    return this.byId.get(id) ?? this.body.querySelector(`#${id}`);
  }
}

function createMockModalEls(doc: MockDocument) {
  const skillModal = doc.createElement('div');
  skillModal.id = 'skillModal';
  const scrollBody = doc.createElement('div');
  scrollBody.className = 'pause-modal-scroll';
  const skillTabBody = doc.createElement('div');
  skillTabBody.id = 'skillTabBody';
  const skillColumns = doc.createElement('div');
  skillColumns.id = 'skillColumns';
  skillTabBody.appendChild(skillColumns);
  const gearTabBody = doc.createElement('div');
  gearTabBody.id = 'gearTabBody';
  scrollBody.append(skillTabBody, gearTabBody);

  const skillSpBadge = doc.createElement('span');
  skillSpBadge.id = 'skillSpBadge';
  const tabSkillBtn = doc.createElement('button');
  tabSkillBtn.id = 'tabSkillBtn';
  const tabGearBtn = doc.createElement('button');
  tabGearBtn.id = 'tabGearBtn';

  const popover = doc.createElement('div');
  popover.id = 'skillInfoPopover';
  popover.className = 'skill-popover hidden';

  skillModal.append(skillSpBadge, tabSkillBtn, tabGearBtn, scrollBody, popover);
  doc.body.appendChild(skillModal);

  const equipModal = doc.createElement('div');
  equipModal.id = 'equipModal';
  const equipDropCard = doc.createElement('div');
  const equipSlotList = doc.createElement('div');
  equipModal.append(equipDropCard, equipSlotList);
  doc.body.appendChild(equipModal);

  const els = {
    skillModal,
    skillSpBadge,
    skillColumns,
    skillTabBody,
    gearTabBody,
    tabSkillBtn,
    tabGearBtn,
    equipModal,
    equipDropCard,
    equipSlotList,
  };

  return {
    els: els as unknown as ModalElements,
    raw: els,
    popover,
  };
}

describe('Skill Tree & Pause Modal UI (#27)', () => {
  let doc: MockDocument;
  let origDocument: unknown;
  let origWindow: unknown;
  let mockWindow: {
    innerWidth: number;
    innerHeight: number;
    addEventListener: (type: string, fn: () => void) => void;
    listeners: Map<string, Array<() => void>>;
  };

  beforeEach(() => {
    origDocument = (globalThis as Record<string, unknown>).document;
    origWindow = (globalThis as Record<string, unknown>).window;
    doc = new MockDocument();
    mockWindow = {
      innerWidth: 1280,
      innerHeight: 720,
      listeners: new Map(),
      addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
      },
    };
    (globalThis as Record<string, unknown>).document = doc;
    (globalThis as Record<string, unknown>).window = mockWindow;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as Record<string, unknown>).document = origDocument;
    (globalThis as Record<string, unknown>).window = origWindow;
  });

  it('provides concise single-line taglines, icons, and full level/SP specs for all 9 skills', () => {
    expect(SKILL_TREE_NODES).toHaveLength(9);
    for (const node of SKILL_TREE_NODES) {
      expect(node.tagline.length).toBeGreaterThan(4);
      expect(node.tagline.length).toBeLessThanOrEqual(22);
      expect(node.tagline).not.toContain('\n');
      expect(node.detailNote.length).toBeGreaterThan(10);
      expect(getSkillIcon(node.id)).toContain('<svg');
    }

    const baseSpec = getSkillDetailedSpec('arm_base', { arm_base: 2 });
    expect(baseSpec.currentLevel).toBe(2);
    expect(baseSpec.maxLevel).toBe(5);
    expect(baseSpec.totalCost).toBe(7);
    expect(baseSpec.levels.map((l) => l.cost)).toEqual([1, 1, 1, 2, 2]);
    expect(baseSpec.currentEffect).toContain('+50%');
    expect(baseSpec.requires).toBeNull();

    const parallelSpecUnmet = getSkillDetailedSpec('arm_parallel', { arm_base: 2 });
    expect(parallelSpecUnmet.currentEffect).toBe('未習得');
    expect(parallelSpecUnmet.totalCost).toBe(8);
    expect(parallelSpecUnmet.levels.map((l) => l.cost)).toEqual([1, 1, 1, 2, 3]);
    expect(parallelSpecUnmet.requires).toEqual({
      id: 'arm_base',
      name: '出力強化',
      requiredLevel: SKILL_PREREQ_LEVEL,
      currentLevel: 2,
      met: false,
    });

    const dashSpec = getSkillDetailedSpec('mob_dash', { mob_loot: 3, mob_dash: 1 });
    expect(dashSpec.maxLevel).toBe(2);
    expect(dashSpec.totalCost).toBe(5);
    expect(dashSpec.levels.map((l) => l.cost)).toEqual([2, 3]);
    expect(dashSpec.requires?.met).toBe(true);
    expect(dashSpec.currentEffect).toContain('1.30s');
  });

  it('renders simplified skill cards without verbose descriptions or duplicate gear-summary', () => {
    const state = createGameState({ seed: 42 });
    state.status = 'skill_tree';
    state.player.skillPoints = 1;
    state.player.skillLevels = { arm_base: 2 };
    const { els, raw } = createMockModalEls(doc);
    const onUnlockSkill = vi.fn();

    renderModals(state, els, {
      activeTab: 'skill',
      onUnlockSkill,
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    });

    const cards = raw.skillColumns.querySelectorAll('.tree-node');
    expect(cards).toHaveLength(9);

    // No verbose multi-line descriptions/prereqs inside cards, and no gear-summary in skill tab
    expect(raw.skillColumns.querySelectorAll('.node-desc')).toHaveLength(0);
    expect(raw.skillColumns.querySelectorAll('.node-req')).toHaveLength(0);
    expect(raw.skillTabBody.querySelector('.gear-summary')).toBeNull();

    const armBaseCard = mustDefined(
      cards.find((c) => c.dataset.nodeId === 'arm_base'),
      'armBaseCard',
    );
    expect(armBaseCard.classList.contains('available')).toBe(true);
    expect(armBaseCard.querySelector('.node-icon')?.innerHTML).toContain('<svg');
    expect(armBaseCard.querySelector('.node-title')?.textContent).toBe('出力強化');
    expect(armBaseCard.querySelector('.node-lv')?.textContent).toBe('Lv2/5');
    expect(armBaseCard.querySelector('.node-tagline')?.textContent).toBe('螺旋バースト弾数＆射程・威力UP');
    expect(armBaseCard.querySelector('.node-cost')?.textContent).toBe('-1 SP');

    // Locked prerequisite card still keeps its ⓘ info button enabled!
    const armParallelCard = mustDefined(
      cards.find((c) => c.dataset.nodeId === 'arm_parallel'),
      'armParallelCard',
    );
    expect(armParallelCard.classList.contains('locked')).toBe(true);
    expect(armParallelCard.dataset.lockReason).toBe('prereq');
    expect(armParallelCard.querySelector('.tree-node-main')?.disabled).toBe(true);
    expect(armParallelCard.querySelector('.node-cost')?.textContent).toBe('-1 SP');
    const lockedInfoBtn = mustDefined(armParallelCard.querySelector('.node-info-btn'), 'lockedInfoBtn');
    expect(lockedInfoBtn.disabled).toBe(false);

    // Clicking card action unlocks, clicking ⓘ does NOT unlock
    lockedInfoBtn.click();
    expect(onUnlockSkill).not.toHaveBeenCalled();

    mustDefined(armBaseCard.querySelector('.tree-node-main'), 'armBaseCard main button').click();
    expect(onUnlockSkill).toHaveBeenCalledTimes(1);
    expect(onUnlockSkill).toHaveBeenCalledWith('arm_base');
  });

  it('opens ⓘ popover on tap/click with full specs and toggles/closes cleanly without touch double-fire', () => {
    const state = createGameState({ seed: 7 });
    state.status = 'skill_tree';
    state.player.skillPoints = 0;
    state.player.skillLevels = { arm_base: 3, arm_parallel: 1 };
    const { els, raw, popover } = createMockModalEls(doc);

    renderModals(state, els, {
      activeTab: 'skill',
      onUnlockSkill: vi.fn(),
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    });

    expect(popover.classList.contains('hidden')).toBe(true);
    const infoBtn = mustDefined(
      raw.skillColumns.querySelector('.node-info-btn[data-info-node="arm_parallel"]'),
      'arm_parallel infoBtn',
    );

    // Simulate mobile touch sequence: pointerdown(touch) -> pointerenter(touch) -> focusin -> click
    infoBtn.dispatch('pointerdown', { pointerType: 'touch' });
    infoBtn.dispatch('pointerenter', { pointerType: 'touch' });
    infoBtn.dispatch('focusin');
    infoBtn.click();

    expect(popover.classList.contains('hidden')).toBe(false);
    expect(infoBtn.getAttribute('aria-expanded')).toBe('true');
    expect(popover.querySelector('.skill-popover-title')?.textContent).toBe('追尾レーザー展開');
    expect(popover.querySelector('.skill-popover-current-val')?.textContent).toContain('追尾レーザー2発');
    expect(popover.querySelector('.skill-popover-prereq-val')?.textContent).toContain('出力強化 Lv3+');
    expect(popover.querySelector('.skill-popover-prereq-val')?.textContent).toContain('達成済み');
    expect(popover.querySelector('.skill-popover-total-sp')?.textContent).toBe('合計 8 SP');

    const levelRows = popover.querySelectorAll('.skill-popover-level-row');
    expect(levelRows).toHaveLength(5);
    expect(levelRows[0]?.classList.contains('is-current')).toBe(true);
    expect(levelRows[1]?.classList.contains('is-next')).toBe(true);
    expect(levelRows[4]?.textContent).toContain('3 SP');

    // Second tap closes popover
    infoBtn.dispatch('pointerdown', { pointerType: 'touch' });
    infoBtn.click();
    expect(popover.classList.contains('hidden')).toBe(true);
    expect(infoBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('supports desktop mouse hover preview, click-to-pin, outside click, and Escape close', () => {
    vi.useFakeTimers();
    const state = createGameState({ seed: 9 });
    state.status = 'skill_tree';
    state.player.skillLevels = { def_sensor: 2 };
    const { els, raw, popover } = createMockModalEls(doc);

    renderModals(state, els, {
      activeTab: 'skill',
      onUnlockSkill: vi.fn(),
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    });

    const sensorInfoBtn = mustDefined(
      raw.skillColumns.querySelector('.node-info-btn[data-info-node="def_sensor"]'),
      'def_sensor infoBtn',
    );

    // Mouse hover opens unpinned preview
    sensorInfoBtn.dispatch('pointerenter', { pointerType: 'mouse' });
    expect(popover.classList.contains('hidden')).toBe(false);
    expect(popover.dataset.nodeId).toBe('def_sensor');

    // Moving mouse from button onto popover cancels scheduled close
    sensorInfoBtn.dispatch('pointerleave', { pointerType: 'mouse' });
    popover.dispatch('pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(200);
    expect(popover.classList.contains('hidden')).toBe(false);

    // Leaving popover closes unpinned preview after grace period
    popover.dispatch('pointerleave', { pointerType: 'mouse' });
    vi.advanceTimersByTime(160);
    expect(popover.classList.contains('hidden')).toBe(true);

    // Hovering then clicking transitions from unpinned -> pinned (does NOT close on click)
    sensorInfoBtn.dispatch('pointerenter', { pointerType: 'mouse' });
    sensorInfoBtn.dispatch('pointerdown', { pointerType: 'mouse' });
    sensorInfoBtn.click();
    expect(popover.classList.contains('hidden')).toBe(false);
    sensorInfoBtn.dispatch('pointerleave', { pointerType: 'mouse' });
    vi.advanceTimersByTime(200);
    expect(popover.classList.contains('hidden')).toBe(false);

    // Pressing Escape closes popover via exported handler and restores focus
    expect(closeOpenSkillInfoPopover(raw.skillModal as unknown as HTMLElement)).toBe(true);
    expect(popover.classList.contains('hidden')).toBe(true);
    expect(doc.activeElement).toBe(sensorInfoBtn);
    expect(closeOpenSkillInfoPopover(raw.skillModal as unknown as HTMLElement)).toBe(false);

    // Clicking outside closes pinned popover, and switching to gear tab closes it too
    sensorInfoBtn.click();
    expect(popover.classList.contains('hidden')).toBe(false);
    raw.skillModal.dispatch('pointerdown', { bubbles: true });
    expect(popover.classList.contains('hidden')).toBe(true);

    sensorInfoBtn.click();
    expect(popover.classList.contains('hidden')).toBe(false);
    renderModals(state, els, {
      activeTab: 'gear',
      onUnlockSkill: vi.fn(),
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    });
    expect(popover.classList.contains('hidden')).toBe(true);
  });

  it('positions popover cleanly within mobile and desktop viewports with zero clipping', () => {
    // 1. Narrow mobile (375x667) with anchor near right edge & middle
    const mobPos = computePopoverPosition(
      { left: 310, right: 336, top: 200, bottom: 226 },
      { width: 351, height: 300 },
      { width: 375, height: 667 },
    );
    expect(mobPos.left).toBe(12);
    expect(mobPos.left + Math.min(351, mobPos.maxWidth)).toBeLessThanOrEqual(375 - 12);
    expect(mobPos.top).toBe(236);
    expect(mobPos.placement).toBe('bottom');

    // 2. Very narrow mobile (320x568) near bottom edge -> flips above anchor
    const mobFlip = computePopoverPosition(
      { left: 260, right: 286, top: 430, bottom: 456 },
      { width: 296, height: 280 },
      { width: 320, height: 568 },
    );
    expect(mobFlip.left).toBe(12);
    expect(mobFlip.top).toBeGreaterThanOrEqual(12);
    expect(mobFlip.top + 280).toBeLessThanOrEqual(568 - 12);
    expect(mobFlip.placement).toBe('top');

    // 3. Short landscape phone (667x375) -> clamps height & top inside viewport
    const landscapePos = computePopoverPosition(
      { left: 560, right: 586, top: 180, bottom: 206 },
      { width: 340, height: 340 },
      { width: 667, height: 375 },
    );
    expect(landscapePos.top).toBeGreaterThanOrEqual(12);
    expect(landscapePos.left).toBeGreaterThanOrEqual(12);
    expect(landscapePos.maxHeight).toBe(351);

    // 4. Desktop (1280x720) left column -> opens right; right column -> flips left
    const deskRight = computePopoverPosition(
      { left: 410, right: 436, top: 220, bottom: 246 },
      { width: 360, height: 340 },
      { width: 1280, height: 720 },
    );
    expect(deskRight.placement).toBe('right');
    expect(deskRight.left).toBe(446);

    const deskLeftFlip = computePopoverPosition(
      { left: 1020, right: 1046, top: 520, bottom: 546 },
      { width: 360, height: 340 },
      { width: 1280, height: 720 },
    );
    expect(deskLeftFlip.placement).toBe('left');
    expect(deskLeftFlip.left).toBe(650);
    expect(deskLeftFlip.top + 340).toBeLessThanOrEqual(720 - 12);
  });

  it('removes duplicate skillGearSummary and includes skillInfoPopover in index.html, while keeping gear tab intact', () => {
    expect(indexHtmlRaw).not.toContain('skillGearSummary');
    expect(indexHtmlRaw).not.toContain('gear-summary');
    expect(indexHtmlRaw).toContain('id="skillInfoPopover"');

    const state = createGameState({ seed: 11 });
    state.status = 'skill_tree';
    state.player.skillLevels = { arm_base: 5 };
    state.player.equipment = [{ id: 'pulse_blade', level: 3, cooldown: 0 }];
    const { els, raw } = createMockModalEls(doc);

    renderModals(state, els, {
      activeTab: 'gear',
      onUnlockSkill: vi.fn(),
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    });

    expect(raw.gearTabBody.innerHTML).toContain('コアショット（メイン武器）');
    expect(raw.gearTabBody.innerHTML).toContain('パルスブレード');
    expect(raw.skillColumns.querySelector('[data-node-id="arm_base"] .node-cost')?.textContent).toBe('MAX');
  });

  it('refreshes open popover content when skill is upgraded and closes via popover close button', () => {
    const state = createGameState({ seed: 15 });
    state.status = 'skill_tree';
    state.player.skillPoints = 2;
    state.player.skillLevels = { arm_base: 1 };
    const { els, raw, popover } = createMockModalEls(doc);
    const handlers = {
      activeTab: 'skill' as const,
      onUnlockSkill: vi.fn(),
      onCloseSkillTree: vi.fn(),
      onResolveEquip: vi.fn(),
    };

    renderModals(state, els, handlers);
    const infoBtn = mustDefined(
      raw.skillColumns.querySelector('.node-info-btn[data-info-node="arm_base"]'),
      'arm_base infoBtn',
    );
    infoBtn.click();
    expect(popover.querySelector('.skill-popover-current-val')?.textContent).toContain('+25%');

    // Simulate state upgrade + re-render while popover stays open
    state.player.skillLevels = { arm_base: 2 };
    renderModals(state, els, handlers);
    expect(popover.classList.contains('hidden')).toBe(false);
    expect(popover.querySelector('.skill-popover-current-val')?.textContent).toContain('+50%');

    // Close via ✕ button inside popover
    mustDefined(popover.querySelector('.skill-popover-close'), 'skill-popover-close').click();
    expect(popover.classList.contains('hidden')).toBe(true);
    expect(doc.activeElement?.dataset.infoNode).toBe('arm_base');
  });
});
