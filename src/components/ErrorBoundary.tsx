import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  /** Shown to the user, e.g. "SFTP-Explorer". */
  area: string;
  /** panel fills its container (tabs); overlay floats above everything (modals, app root). */
  variant?: 'panel' | 'overlay';
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Contains render errors to one area so the rest of the app (and running sessions) keeps working.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary: ${this.props.area}]`, error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const card = (
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-red-500/30 bg-zinc-900 p-5 shadow-2xl text-zinc-200 select-text"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{this.props.area}: Unerwarteter Fehler</span>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Dieser Bereich wurde angehalten, damit der Rest von Wayterm weiterläuft.
        </p>
        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950 border border-zinc-800 p-2 font-mono text-[11px] text-zinc-400">
          {error.message || String(error)}
        </pre>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Lädt die Oberfläche neu und beendet dabei alle offenen Sitzungen"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Fenster neu laden
          </button>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Erneut versuchen
          </button>
        </div>
      </div>
    );

    if (this.props.variant === 'overlay') {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          {card}
        </div>
      );
    }
    return <div className="h-full w-full flex items-center justify-center p-6 bg-zinc-950">{card}</div>;
  }
}
