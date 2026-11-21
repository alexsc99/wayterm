import type { Pane, PaneSessions, SplitLayout, Workspace } from './model';

/**
 * Pure state transitions of the split workspace. Every function returns the
 * SAME object when nothing changes, and a session id never occupies both panes.
 */

export const INITIAL_WORKSPACE: Workspace = { layout: 'single', panes: [null, null], focused: 0 };

const otherPane = (pane: Pane): Pane => (pane === 0 ? 1 : 0);

/** Returns `current` unless layout, panes or focus actually differ. */
function update(current: Workspace, layout: SplitLayout, first: string | null, second: string | null, focused: Pane): Workspace {
  if (current.layout === layout && current.panes[0] === first && current.panes[1] === second && current.focused === focused) return current;
  return { layout, panes: [first, second], focused };
}

function withPane(panes: PaneSessions, pane: Pane, id: string | null): PaneSessions {
  return pane === 0 ? [id, panes[1]] : [panes[0], id];
}

/** Session for a pane that lost its own: the active one if hidden, else the last hidden one. */
function pickHiddenSession(panes: PaneSessions, sessionIds: readonly string[], active: string | null): string | null {
  if (active !== null && !panes.includes(active)) return active;
  for (let index = sessionIds.length - 1; index >= 0; index -= 1) {
    if (!panes.includes(sessionIds[index])) return sessionIds[index];
  }
  return null;
}

/** Aligns the workspace with the session list and the app-level active session. */
export function reconcileWorkspace(
  current: Workspace,
  previous: { ids: ReadonlySet<string>; active: string | null },
  sessionIds: readonly string[],
  active: string | null,
): Workspace {
  const known = new Set(sessionIds);
  const validActive = active !== null && known.has(active) ? active : null;

  if (current.layout === 'single') {
    return update(current, 'single', validActive ?? sessionIds[0] ?? null, null, 0);
  }

  let panes = current.panes;
  let focused = current.focused;

  // (1) Closed sessions: refill their panes, or leave the split when nothing is left to compare.
  const isGone = (id: string | null) => id !== null && !known.has(id);
  if (isGone(panes[0]) || isGone(panes[1])) {
    if (sessionIds.length <= 1) return update(current, 'single', sessionIds[0] ?? null, null, 0);
    const refilled: PaneSessions = [isGone(panes[0]) ? null : panes[0], isGone(panes[1]) ? null : panes[1]];
    if (isGone(panes[0])) refilled[0] = pickHiddenSession(refilled, sessionIds, validActive);
    if (isGone(panes[1])) refilled[1] = pickHiddenSession(refilled, sessionIds, validActive);
    panes = refilled;
  }

  const added = sessionIds.filter((id) => !previous.ids.has(id));
  if (added.length > 0) {
    // (2) New session: fill an empty pane before replacing the focused one.
    const selected = validActive !== null && added.includes(validActive) ? validActive : added[added.length - 1];
    const shownIn = panes.indexOf(selected);
    if (shownIn >= 0) {
      focused = shownIn as Pane;
    } else {
      focused = panes[0] === null ? 0 : panes[1] === null ? 1 : focused;
      panes = withPane(panes, focused, selected);
    }
  } else if (validActive !== null && validActive !== previous.active) {
    // (3) Active session changed elsewhere (command palette, keyboard, close).
    const shownIn = panes.indexOf(validActive);
    if (shownIn >= 0) focused = shownIn as Pane;
    else panes = withPane(panes, focused, validActive);
  }

  return update(current, current.layout, panes[0], panes[1], focused);
}

/** Tab click: show the session, preferring the pane that already displays it. */
export function selectSession(current: Workspace, id: string): Workspace {
  if (current.layout === 'single') return update(current, 'single', id, null, 0);
  const shownIn = current.panes.indexOf(id);
  if (shownIn >= 0) return focusPane(current, shownIn as Pane);
  const panes = withPane(current.panes, current.focused, id);
  return update(current, current.layout, panes[0], panes[1], current.focused);
}

/** Pane chooser: put the session into exactly this pane; a session shown in the other pane swaps over. */
export function assignSessionToPane(current: Workspace, pane: Pane, id: string): Workspace {
  if (current.layout === 'single') return update(current, 'single', id, null, 0);
  const other = otherPane(pane);
  const displaced = current.panes[other] === id ? current.panes[pane] : current.panes[other];
  const panes = withPane(withPane(current.panes, pane, id), other, displaced);
  return update(current, current.layout, panes[0], panes[1], pane);
}

/** Moves the focus; an empty pane may be focused so the next session lands there. */
export function focusPane(current: Workspace, pane: Pane): Workspace {
  if (current.layout === 'single') return current;
  return update(current, current.layout, current.panes[0], current.panes[1], pane);
}

/** Exchanges both panes; the focus stays with the session that had it. */
export function swapPanes(current: Workspace): Workspace {
  if (current.layout === 'single' || current.panes[0] === current.panes[1]) return current;
  return update(current, current.layout, current.panes[1], current.panes[0], otherPane(current.focused));
}

export function changeLayout(current: Workspace, layout: SplitLayout, sessionIds: readonly string[]): Workspace {
  if (layout === current.layout) return current;
  if (layout === 'single') {
    return update(current, 'single', current.panes[current.focused] ?? current.panes[otherPane(current.focused)], null, 0);
  }
  if (current.layout !== 'single') return update(current, layout, current.panes[0], current.panes[1], current.focused);
  const first = current.panes[0];
  let second: string | null = null;
  for (let index = sessionIds.length - 1; index >= 0 && second === null; index -= 1) {
    if (sessionIds[index] !== first) second = sessionIds[index];
  }
  return update(current, layout, first, second, 0);
}

/** Sessions that are on screen: pane 0 in single layout, both panes in a split. */
export function visibleSessionIds(workspace: Workspace): string[] {
  const candidates: readonly (string | null)[] = workspace.layout === 'single' ? [workspace.panes[0]] : workspace.panes;
  return candidates.filter((id): id is string => id !== null);
}
