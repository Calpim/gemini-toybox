import type { SkillNodeId } from '../game/skillTree';

// Clean unified sci-fi SVG icons for HUD, notifications, and modals

export const ICON_PAUSE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4.5" height="16" rx="1.4"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.4"/></svg>`;

export const ICON_TREE = `<svg class="ui-icon ui-icon-tree" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5.5" r="2.5" fill="currentColor" fill-opacity="0.35"/><circle cx="6.5" cy="14" r="2.2" fill="currentColor" fill-opacity="0.35"/><circle cx="17.5" cy="14" r="2.2" fill="currentColor" fill-opacity="0.35"/><path d="M12 8v4m0 0-4 1.2M12 12l4 1.2M12 12v7M9 19h6"/></svg>`;

export const ICON_VOLUME_ON = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.22"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.8a9 9 0 0 1 0 12.4"/></svg>`;

export const ICON_VOLUME_OFF = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.18"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;

export const ICON_LOCK = `<svg class="ui-icon ui-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" fill-opacity="0.2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

export const ICON_ALERT = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="currentColor" fill-opacity="0.28"/><line x1="12" y1="9" x2="12" y2="13.5"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg>`;

export const ICON_BOSS = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3Z" fill="currentColor" fill-opacity="0.25"/><circle cx="9.5" cy="11.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11.5" r="1.3" fill="currentColor" stroke="none"/><path d="M9 15.5h6"/></svg>`;

export const ICON_SPARK = `<svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2 14.6 9.4 22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z"/></svg>`;

export const ICON_CLOSE = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;

export const ICON_GEAR = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3Z" fill="currentColor" fill-opacity="0.22"/><path d="M12 12 4.5 7.5M12 12l7.5-4.5M12 12v9"/></svg>`;

export const ICON_INFO = `<svg class="ui-icon ui-icon-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="currentColor" fill-opacity="0.14"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;

export const SKILL_NODE_ICONS: Record<SkillNodeId, string> = {
  arm_base: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 19.5 8.5 16.8 19.5 7.2 19.5 4.5 8.5" fill="currentColor" fill-opacity="0.2"/><path d="M12 7.5v8.5M8.5 11.5 12 7.5l3.5 4"/></svg>`,
  arm_parallel: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 19V5M12 19V5M18 19V5"/><path d="m4 8 2-3 2 3M10 8l2-3 2 3M16 8l2-3 2 3"/></svg>`,
  arm_overclock: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z" fill="currentColor" fill-opacity="0.26"/></svg>`,
  def_sensor: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3.5 2.5"/><circle cx="12" cy="12" r="4.2" fill="currentColor" fill-opacity="0.18"/><path d="M12 12 17.5 6.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>`,
  def_pulse: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" fill-opacity="0.35"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4"/></svg>`,
  def_aegis: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 4.5 6v5.8c0 4.6 3.2 8.4 7.5 9.6 4.3-1.2 7.5-5 7.5-9.6V6L12 2.8Z" fill="currentColor" fill-opacity="0.22"/><path d="M9 12.2 11.2 14.4 15.5 9.8"/></svg>`,
  mob_magnet: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5v6.5a6 6 0 0 0 12 0V5"/><path d="M6 5h3v6.5a3 3 0 0 0 6 0V5h3" fill="currentColor" fill-opacity="0.18"/><path d="M6 8.5h3M15 8.5h3"/></svg>`,
  mob_loot: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6.5 4.5 17.5 4.5 21 9.5 12 20 3 9.5" fill="currentColor" fill-opacity="0.2"/><path d="M3 9.5h18M8.5 4.5 12 9.5l3.5-5M12 9.5V20"/></svg>`,
  mob_dash: `<svg class="ui-icon ui-icon-skill" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 17 5.5-5-5.5-5"/><path d="m11 17 5.5-5L11 7"/><path d="M17.5 17V7" stroke-opacity="0.7"/></svg>`,
};

export function getSkillIcon(nodeId: SkillNodeId): string {
  return SKILL_NODE_ICONS[nodeId];
}
