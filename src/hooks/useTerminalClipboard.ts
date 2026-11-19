import { useEffect, useRef, useState } from 'react';

/** Clipboard access via Electron (browser fallback) plus the PuTTY-style "copied" badge. */
export function useTerminalClipboard() {
  const [copiedBadgeVisible, setCopiedBadgeVisible] = useState(false);
  const copiedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyTextToClipboard = async (text: string, showBadge = true) => {
    if (!text) return;
    try {
      if (window.electronAPI?.writeClipboard) {
        await window.electronAPI.writeClipboard(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      if (showBadge) {
        setCopiedBadgeVisible(true);
        if (copiedBadgeTimerRef.current) {
          clearTimeout(copiedBadgeTimerRef.current);
        }
        copiedBadgeTimerRef.current = setTimeout(() => {
          setCopiedBadgeVisible(false);
          copiedBadgeTimerRef.current = null;
        }, 1200);
      }
    } catch {
      // Ignore clipboard write errors
    }
  };

  const readTextFromClipboard = async (): Promise<string> => {
    try {
      if (window.electronAPI?.readClipboard) {
        return await window.electronAPI.readClipboard();
      }
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  };

  useEffect(() => {
    return () => {
      if (copiedBadgeTimerRef.current !== null) {
        clearTimeout(copiedBadgeTimerRef.current);
        copiedBadgeTimerRef.current = null;
      }
    };
  }, []);

  return { copiedBadgeVisible, copyTextToClipboard, readTextFromClipboard };
}
