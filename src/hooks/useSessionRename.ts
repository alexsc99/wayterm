import { useEffect, useRef, useState } from 'react';
import type { SSHSession } from '../types';

/** Inline tab rename state: draft value, validation and input focus. */
export function useSessionRename(sessions: SSHSession[], onRenameSession: (id: string, title: string) => void) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = (session: SSHSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
    setRenameError(false);
  };

  const changeRenameValue = (value: string) => {
    setRenameValue(value);
    setRenameError(false);
  };

  const commitRename = () => {
    const title = renameValue.trim();
    if (!title) {
      setRenameError(true);
      renameInputRef.current?.focus();
      return;
    }
    if (renamingId) onRenameSession(renamingId, title);
    setRenamingId(null);
  };

  const cancelRename = () => setRenamingId(null);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (renamingId && !sessions.some((session) => session.id === renamingId)) setRenamingId(null);
  }, [sessions, renamingId]);

  return {
    renamingId,
    renameValue,
    renameError,
    renameInputRef,
    startRename,
    changeRenameValue,
    commitRename,
    cancelRename,
  };
}
