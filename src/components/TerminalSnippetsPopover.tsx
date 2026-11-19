import React, { useState } from 'react';
import { Play, Plus, Search, Trash2, X } from 'lucide-react';
import { CommandSnippet } from '../types';

interface TerminalSnippetsPopoverProps {
  snippets: CommandSnippet[];
  onRunSnippet: (snippet: CommandSnippet) => void;
  onAddSnippet: (snippet: Omit<CommandSnippet, 'id'>) => void;
  onDeleteSnippet: (id: string) => void;
  onClose: () => void;
}

export const TerminalSnippetsPopover: React.FC<TerminalSnippetsPopoverProps> = ({
  snippets,
  onRunSnippet,
  onAddSnippet,
  onDeleteSnippet,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [command, setCommand] = useState('');
  const [category, setCategory] = useState('Allgemein');
  const [sendEnter, setSendEnter] = useState(true);

  const filtered = snippets.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q)
    );
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !command.trim()) return;
    onAddSnippet({
      title: title.trim(),
      command: command.trim(),
      category: category.trim() || 'Allgemein',
      sendEnter,
    });
    setTitle('');
    setCommand('');
    setIsAdding(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Command Snippets"
      className="absolute top-12 right-12 z-50 w-96 bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl p-3 text-xs text-zinc-200 flex flex-col max-h-[75vh]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
        <span className="font-semibold text-zinc-100">Schnellbefehle (Snippets)</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsAdding((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 border border-blue-500/30 transition-colors"
            title="Neuen Schnellbefehl anlegen"
          >
            <Plus className="w-3 h-3" />
            <span>Neu</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            title="Schließen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isAdding && (
        <form onSubmit={handleCreate} className="mb-2.5 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg space-y-2">
          <input
            type="text"
            placeholder="Titel (z. B. Nginx Logs)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-blue-500"
            autoFocus
          />
          <textarea
            placeholder="Befehl (z. B. tail -f /var/log/nginx/error.log)"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            rows={2}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-100 outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              placeholder="Kategorie"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-28 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEnter}
                onChange={(e) => setSendEnter(e.target.checked)}
                className="accent-blue-500"
              />
              Direkt ausführen (↵)
            </label>
            <button
              type="submit"
              className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
            >
              Speichern
            </button>
          </div>
        </form>
      )}

      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Snippets durchsuchen …"
          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
        />
      </div>

      <div className="overflow-y-auto space-y-1.5 pr-0.5">
        {filtered.length === 0 ? (
          <div className="text-center text-zinc-500 py-6">Keine Snippets gefunden</div>
        ) : (
          filtered.map((snippet) => (
            <div
              key={snippet.id}
              className="group flex items-center justify-between gap-2 p-2 rounded-lg bg-zinc-950/70 hover:bg-zinc-800/80 border border-zinc-800/80 transition-colors"
            >
              <button
                type="button"
                onClick={() => onRunSnippet(snippet)}
                className="flex-1 min-w-0 text-left cursor-pointer"
                title={snippet.sendEnter ? 'Klicken zum Ausführen' : 'Klicken zum Einfügen'}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-zinc-100 truncate">{snippet.title}</span>
                  {snippet.category && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 shrink-0">
                      {snippet.category}
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-zinc-400 truncate mt-0.5">
                  {snippet.command}
                </div>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onRunSnippet(snippet)}
                  className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/15"
                  title={snippet.sendEnter ? 'Ausführen' : 'Einfügen'}
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSnippet(snippet.id)}
                  className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Löschen"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
