import React, { useEffect, useRef, useState } from 'react';
import type { SearchAddon } from '@xterm/addon-search';
import type { TerminalInstance } from '../components/terminal/model';

interface TerminalSearchOptions {
  activeSessionIdRef: React.MutableRefObject<string | null>;
  searchAddonsRef: React.MutableRefObject<Map<string, SearchAddon>>;
  terminalInstances: React.MutableRefObject<Map<string, TerminalInstance>>;
}

/** In-terminal search (⌘F) state and navigation against the active session's SearchAddon. */
export function useTerminalSearch({ activeSessionIdRef, searchAddonsRef, terminalInstances }: TerminalSearchOptions) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchWholeWord, setMatchWholeWord] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isSearchOpenRef = useRef<boolean>(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;
  const searchQueryRef = useRef<string>(searchQuery);
  searchQueryRef.current = searchQuery;
  const caseSensitiveRef = useRef<boolean>(caseSensitive);
  caseSensitiveRef.current = caseSensitive;
  const matchWholeWordRef = useRef<boolean>(matchWholeWord);
  matchWholeWordRef.current = matchWholeWord;

  const findNext = (query?: string, cs?: boolean, ww?: boolean) => {
    const currentActiveId = activeSessionIdRef.current;
    if (!currentActiveId) return;
    const searchAddon = searchAddonsRef.current.get(currentActiveId);
    const q = query !== undefined ? query : searchQueryRef.current;
    if (!searchAddon || !q) return;

    searchAddon.findNext(q, {
      caseSensitive: cs !== undefined ? cs : caseSensitiveRef.current,
      wholeWord: ww !== undefined ? ww : matchWholeWordRef.current,
      incremental: true,
    });
  };

  const findPrevious = (query?: string, cs?: boolean, ww?: boolean) => {
    const currentActiveId = activeSessionIdRef.current;
    if (!currentActiveId) return;
    const searchAddon = searchAddonsRef.current.get(currentActiveId);
    const q = query !== undefined ? query : searchQueryRef.current;
    if (!searchAddon || !q) return;

    searchAddon.findPrevious(q, {
      caseSensitive: cs !== undefined ? cs : caseSensitiveRef.current,
      wholeWord: ww !== undefined ? ww : matchWholeWordRef.current,
    });
  };

  const openSearchOverlay = () => {
    setIsSearchOpen(true);
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  };
  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [isSearchOpen]);

  const closeSearchOverlay = () => {
    setIsSearchOpen(false);
    const currentActiveId = activeSessionIdRef.current;
    if (currentActiveId) {
      searchAddonsRef.current.get(currentActiveId)?.clearDecorations();
      terminalInstances.current.get(currentActiveId)?.term.focus();
    }
  };

  const changeQuery = (val: string) => {
    setSearchQuery(val);
    if (val) {
      findNext(val);
    } else {
      const currentActiveId = activeSessionIdRef.current;
      if (currentActiveId) {
        searchAddonsRef.current.get(currentActiveId)?.clearDecorations();
      }
    }
  };

  const clearQuery = () => {
    setSearchQuery('');
    const currentActiveId = activeSessionIdRef.current;
    if (currentActiveId) {
      searchAddonsRef.current.get(currentActiveId)?.clearDecorations();
    }
    searchInputRef.current?.focus();
  };

  const toggleCaseSensitive = () => {
    const nextCase = !caseSensitive;
    setCaseSensitive(nextCase);
    if (searchQuery) {
      findNext(searchQuery, nextCase, matchWholeWord);
    }
  };

  const toggleWholeWord = () => {
    const nextWord = !matchWholeWord;
    setMatchWholeWord(nextWord);
    if (searchQuery) {
      findNext(searchQuery, caseSensitive, nextWord);
    }
  };

  return {
    isSearchOpen,
    searchQuery,
    caseSensitive,
    matchWholeWord,
    searchInputRef,
    isSearchOpenRef,
    findNext,
    findPrevious,
    openSearchOverlay,
    closeSearchOverlay,
    changeQuery,
    clearQuery,
    toggleCaseSensitive,
    toggleWholeWord,
  };
}
