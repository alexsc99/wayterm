import React, { useLayoutEffect, useRef, useState } from 'react';

/** Popup menu anchored to a trigger element: viewport-clamped position, outside-click/Escape close, initial focus. */
export function useAnchoredMenu(rootContainerRef: React.RefObject<HTMLDivElement>) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8, width: 300, maxHeight: 300 });

  useLayoutEffect(() => {
    if (!menuAnchor) return;
    const positionMenu = () => {
      const rect = menuAnchor.getBoundingClientRect();
      const margin = 8;
      const width = Math.max(0, Math.min(320, window.innerWidth - margin * 2));
      const below = Math.max(0, window.innerHeight - rect.bottom - margin - 4);
      const above = Math.max(0, rect.top - margin - 4);
      const opensBelow = below >= Math.min(260, above);
      const maxHeight = Math.max(0, Math.min(420, opensBelow ? below : above));
      const contentHeight = Math.min(maxHeight, menuRef.current?.scrollHeight || maxHeight);
      setMenuPosition({
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: opensBelow ? rect.bottom + 4 : Math.max(margin, rect.top - 4 - contentHeight),
        width,
        maxHeight,
      });
    };
    positionMenu();
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuAnchor.contains(event.target as Node)) setMenuAnchor(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenuAnchor(null);
      menuAnchor.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(positionMenu) : null;
    if (rootContainerRef.current) observer?.observe(rootContainerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      observer?.disconnect();
    };
  }, [menuAnchor, rootContainerRef]);

  return { menuAnchor, setMenuAnchor, menuRef, menuPosition };
}
