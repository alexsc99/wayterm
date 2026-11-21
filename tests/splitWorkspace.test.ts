import { describe, expect, it } from 'vitest';
import type { Pane, SplitLayout, Workspace } from '../src/components/terminal/model';
import {
  INITIAL_WORKSPACE,
  assignSessionToPane,
  changeLayout,
  focusPane,
  reconcileWorkspace,
  selectSession,
  swapPanes,
  visibleSessionIds,
} from '../src/components/terminal/workspace';

const split = (first: string | null, second: string | null, focused: Pane = 0, layout: SplitLayout = 'columns'): Workspace => ({
  layout,
  panes: [first, second],
  focused,
});

const before = (ids: string[], active: string | null) => ({ ids: new Set(ids), active });

describe('reconcileWorkspace in single layout', () => {
  it('shows the active session', () => {
    const next = reconcileWorkspace(INITIAL_WORKSPACE, before([], null), ['a', 'b'], 'b');
    expect(next).toEqual({ layout: 'single', panes: ['b', null], focused: 0 });
  });

  it('falls back to the first session when the active one is unknown', () => {
    expect(reconcileWorkspace(INITIAL_WORKSPACE, before([], null), ['a', 'b'], 'gone').panes).toEqual(['a', null]);
    expect(reconcileWorkspace(INITIAL_WORKSPACE, before([], null), ['a', 'b'], null).panes).toEqual(['a', null]);
  });

  it('empties the pane when no session is left', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(reconcileWorkspace(current, before(['a'], 'a'), [], null)).toEqual(INITIAL_WORKSPACE);
  });

  it('returns the same reference when nothing changed', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    // A rename or connect flag produces a new sessions array with the same ids.
    expect(reconcileWorkspace(current, before(['a', 'b'], 'a'), ['a', 'b'], 'a')).toBe(current);
    // A session added in the background does not replace the shown one.
    expect(reconcileWorkspace(current, before(['a', 'b'], 'a'), ['a', 'b', 'c'], 'a')).toBe(current);
    expect(reconcileWorkspace(INITIAL_WORKSPACE, before([], null), [], null)).toBe(INITIAL_WORKSPACE);
  });
});

describe('reconcileWorkspace in split layout', () => {
  it('keeps the split and refills the pane when a visible session closes', () => {
    const current = split('a', 'b');
    const next = reconcileWorkspace(current, before(['a', 'b', 'c'], 'a'), ['b', 'c'], 'b');
    expect(next).toEqual({ layout: 'columns', panes: ['c', 'b'], focused: 1 });
  });

  it('refills with the active session when it is hidden', () => {
    const current = split('a', 'b', 1);
    const next = reconcileWorkspace(current, before(['a', 'b', 'c', 'd'], 'b'), ['a', 'c', 'd'], 'c');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
  });

  it('refills with the last hidden session when the active one is already visible', () => {
    const current = split('a', 'b', 0);
    const next = reconcileWorkspace(current, before(['a', 'b', 'c', 'd'], 'a'), ['a', 'c', 'd'], 'a');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'd'], focused: 0 });
  });

  it('refills both panes when both visible sessions close', () => {
    const current = split('a', 'b', 0, 'rows');
    const next = reconcileWorkspace(current, before(['a', 'b', 'c', 'd'], 'a'), ['c', 'd'], 'c');
    expect(next).toEqual({ layout: 'rows', panes: ['c', 'd'], focused: 0 });
  });

  it('collapses to single when only one session remains', () => {
    const current = split('a', 'b', 1);
    const next = reconcileWorkspace(current, before(['a', 'b'], 'b'), ['a'], 'a');
    expect(next).toEqual({ layout: 'single', panes: ['a', null], focused: 0 });
  });

  it('collapses to an empty single view when the last sessions close', () => {
    const next = reconcileWorkspace(split('a', null), before(['a'], 'a'), [], null);
    expect(next).toEqual(INITIAL_WORKSPACE);
  });

  it('keeps a split with one session and an empty pane', () => {
    const current = split('a', null);
    expect(reconcileWorkspace(current, before(['a'], 'a'), ['a'], 'a')).toBe(current);
  });

  it('places a new session into the empty pane and focuses it', () => {
    const current = split('a', null, 0);
    const next = reconcileWorkspace(current, before(['a'], 'a'), ['a', 'b'], 'b');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'b'], focused: 1 });

    const emptyFirst = reconcileWorkspace(split(null, 'a', 1), before(['a'], 'a'), ['a', 'b'], 'b');
    expect(emptyFirst).toEqual({ layout: 'columns', panes: ['b', 'a'], focused: 0 });
  });

  it('replaces the focused pane with a new session when both panes are taken', () => {
    const current = split('a', 'b', 1);
    const next = reconcileWorkspace(current, before(['a', 'b'], 'b'), ['a', 'b', 'c'], 'c');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
  });

  it('prefers the active one of several new sessions, else the last one', () => {
    const current = split('a', 'b', 0);
    expect(reconcileWorkspace(current, before(['a', 'b'], 'a'), ['a', 'b', 'c', 'd'], 'c').panes).toEqual(['c', 'b']);
    expect(reconcileWorkspace(current, before(['a', 'b'], 'a'), ['a', 'b', 'c', 'd'], 'a').panes).toEqual(['d', 'b']);
  });

  it('puts a newly active hidden session into the focused pane', () => {
    const current = split('a', 'b', 1);
    const next = reconcileWorkspace(current, before(['a', 'b', 'c'], 'b'), ['a', 'b', 'c'], 'c');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
  });

  it('only moves the focus when the newly active session is visible', () => {
    const current = split('a', 'b', 0);
    const next = reconcileWorkspace(current, before(['a', 'b', 'c'], 'a'), ['a', 'b', 'c'], 'b');
    expect(next).toEqual({ layout: 'columns', panes: ['a', 'b'], focused: 1 });
  });

  it('returns the same reference when neither sessions nor the active session changed', () => {
    const current = split('a', 'b', 1);
    expect(reconcileWorkspace(current, before(['a', 'b', 'c'], 'b'), ['a', 'b', 'c'], 'b')).toBe(current);
    // Closing a hidden session does not touch the panes.
    expect(reconcileWorkspace(current, before(['a', 'b', 'c'], 'b'), ['a', 'b'], 'b')).toBe(current);
  });

  it('ignores an active session that does not exist', () => {
    const current = split('a', 'b', 0);
    expect(reconcileWorkspace(current, before(['a', 'b'], 'a'), ['a', 'b'], 'gone')).toBe(current);
  });
});

describe('selectSession', () => {
  it('replaces the only pane in single layout', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(selectSession(current, 'b')).toEqual({ layout: 'single', panes: ['b', null], focused: 0 });
    expect(selectSession(current, 'a')).toBe(current);
  });

  it('focuses the pane that already shows the session', () => {
    const current = split('a', 'b', 0);
    expect(selectSession(current, 'b')).toEqual({ layout: 'columns', panes: ['a', 'b'], focused: 1 });
    expect(selectSession(current, 'a')).toBe(current);
  });

  it('replaces the focused pane with a hidden session', () => {
    expect(selectSession(split('a', 'b', 1), 'c')).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
    expect(selectSession(split('a', null, 1), 'c')).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
  });
});

describe('assignSessionToPane', () => {
  it('swaps both panes when the session is shown in the other pane', () => {
    const current = split('a', 'b', 0);
    expect(assignSessionToPane(current, 0, 'b')).toEqual({ layout: 'columns', panes: ['b', 'a'], focused: 0 });
    expect(assignSessionToPane(current, 1, 'a')).toEqual({ layout: 'columns', panes: ['b', 'a'], focused: 1 });
  });

  it('moves the session into an empty pane and leaves the other one empty', () => {
    expect(assignSessionToPane(split('a', null, 0), 1, 'a')).toEqual({ layout: 'columns', panes: [null, 'a'], focused: 1 });
  });

  it('sets a hidden session and focuses the pane', () => {
    expect(assignSessionToPane(split('a', 'b', 0), 1, 'c')).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 1 });
  });

  it('returns the same reference when the pane already shows the session and is focused', () => {
    const current = split('a', 'b', 1);
    expect(assignSessionToPane(current, 1, 'b')).toBe(current);
    expect(assignSessionToPane(current, 0, 'a')).toEqual({ layout: 'columns', panes: ['a', 'b'], focused: 0 });
  });

  it('always targets pane 0 in single layout', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(assignSessionToPane(current, 1, 'b')).toEqual({ layout: 'single', panes: ['b', null], focused: 0 });
  });
});

describe('focusPane and swapPanes', () => {
  it('focuses a pane, including an empty one', () => {
    const current = split('a', null, 0);
    expect(focusPane(current, 1)).toEqual({ layout: 'columns', panes: ['a', null], focused: 1 });
    expect(focusPane(current, 0)).toBe(current);
  });

  it('does nothing in single layout', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(focusPane(current, 1)).toBe(current);
    expect(swapPanes(current)).toBe(current);
  });

  it('swaps the sessions and keeps the focus on the same session', () => {
    expect(swapPanes(split('a', 'b', 0))).toEqual({ layout: 'columns', panes: ['b', 'a'], focused: 1 });
    expect(swapPanes(split('a', null, 1, 'rows'))).toEqual({ layout: 'rows', panes: [null, 'a'], focused: 0 });
  });

  it('keeps two empty panes untouched', () => {
    const current = split(null, null, 1);
    expect(swapPanes(current)).toBe(current);
  });
});

describe('changeLayout', () => {
  it('returns the same reference for the current layout', () => {
    const current = split('a', 'b', 1, 'rows');
    expect(changeLayout(current, 'rows', ['a', 'b'])).toBe(current);
    expect(changeLayout(INITIAL_WORKSPACE, 'single', [])).toBe(INITIAL_WORKSPACE);
  });

  it('opens the split with another session in the second pane', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(changeLayout(current, 'columns', ['a', 'b', 'c'])).toEqual({ layout: 'columns', panes: ['a', 'c'], focused: 0 });
    const lastShown: Workspace = { layout: 'single', panes: ['c', null], focused: 0 };
    expect(changeLayout(lastShown, 'rows', ['a', 'b', 'c'])).toEqual({ layout: 'rows', panes: ['c', 'b'], focused: 0 });
  });

  it('opens the split with an empty second pane when there is no other session', () => {
    const current: Workspace = { layout: 'single', panes: ['a', null], focused: 0 };
    expect(changeLayout(current, 'columns', ['a'])).toEqual({ layout: 'columns', panes: ['a', null], focused: 0 });
    expect(changeLayout(INITIAL_WORKSPACE, 'columns', [])).toEqual({ layout: 'columns', panes: [null, null], focused: 0 });
  });

  it('keeps the focused pane session when leaving the split', () => {
    expect(changeLayout(split('a', 'b', 1), 'single', ['a', 'b'])).toEqual({ layout: 'single', panes: ['b', null], focused: 0 });
    expect(changeLayout(split('a', 'b', 0), 'single', ['a', 'b'])).toEqual({ layout: 'single', panes: ['a', null], focused: 0 });
  });

  it('keeps the other session when the focused pane is empty', () => {
    expect(changeLayout(split('a', null, 1), 'single', ['a'])).toEqual({ layout: 'single', panes: ['a', null], focused: 0 });
  });

  it('only changes the orientation between columns and rows', () => {
    expect(changeLayout(split('a', 'b', 1, 'columns'), 'rows', ['a', 'b'])).toEqual({ layout: 'rows', panes: ['a', 'b'], focused: 1 });
  });
});

describe('visibleSessionIds', () => {
  it('lists pane 0 in single layout and both panes in a split', () => {
    expect(visibleSessionIds({ layout: 'single', panes: ['a', 'b'], focused: 0 })).toEqual(['a']);
    expect(visibleSessionIds(INITIAL_WORKSPACE)).toEqual([]);
    expect(visibleSessionIds(split('a', 'b'))).toEqual(['a', 'b']);
    expect(visibleSessionIds(split(null, 'b'))).toEqual(['b']);
  });
});

describe('invariants', () => {
  it('never shows a session in both panes and only shows existing sessions', () => {
    // Deterministic pseudo-random walk over all operations.
    let seed = 20240607;
    const random = (bound: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % bound;
    };
    const layouts: SplitLayout[] = ['single', 'columns', 'rows'];
    let sessions = ['s0', 's1'];
    let active: string | null = 's0';
    let counter = 2;
    let workspace = reconcileWorkspace(INITIAL_WORKSPACE, before([], null), sessions, active);

    for (let step = 0; step < 4000; step += 1) {
      const previous = before(sessions, active);
      const pick = () => sessions[random(sessions.length)];
      switch (random(8)) {
        case 0:
          if (sessions.length < 6) {
            sessions = [...sessions, `s${counter}`];
            active = `s${counter}`;
            counter += 1;
          }
          break;
        case 1:
          if (sessions.length > 0) {
            const closed = pick();
            sessions = sessions.filter((id) => id !== closed);
            if (active === closed) active = sessions.length > 0 ? pick() : null;
          }
          break;
        case 2:
          if (sessions.length > 0) active = pick();
          break;
        case 3:
          if (sessions.length > 0) workspace = selectSession(workspace, pick());
          break;
        case 4:
          if (sessions.length > 0) workspace = assignSessionToPane(workspace, random(2) as Pane, pick());
          break;
        case 5:
          workspace = focusPane(workspace, random(2) as Pane);
          break;
        case 6:
          workspace = swapPanes(workspace);
          break;
        default:
          workspace = changeLayout(workspace, layouts[random(3)], sessions);
      }
      workspace = reconcileWorkspace(workspace, previous, sessions, active);
      // The hook reports the focused session back as the active one.
      active = workspace.panes[workspace.focused] ?? active;

      const [first, second] = workspace.panes;
      if (first !== null) expect(second).not.toBe(first);
      for (const id of visibleSessionIds(workspace)) expect(sessions).toContain(id);
      if (workspace.layout === 'single') {
        expect(second).toBeNull();
        expect(workspace.focused).toBe(0);
        expect(first === null).toBe(sessions.length === 0);
      }
      // Reconciling a settled state again is a no-op.
      expect(reconcileWorkspace(workspace, before(sessions, active), sessions, active)).toBe(workspace);
    }
  });
});
