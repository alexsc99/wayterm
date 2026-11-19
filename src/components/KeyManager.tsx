import React, { useState } from 'react';
import { SSHKeyFile } from '../types';
import {
  Key,
  Plus,
  Copy,
  Check,
  FolderOpen,
  Trash2,
  ShieldCheck,
  Lock,
  X,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
interface KeyManagerProps {
  keys: SSHKeyFile[];
  onRefresh: () => void;
  onGenerateKey: (options: {
    name: string;
    type: 'ed25519' | 'rsa';
    comment?: string;
    passphrase?: string;
  }) => Promise<void>;
  onDeleteKey: (keyPath: string) => Promise<void>;
  onOpenFinder: (filePath?: string) => void;
}

export const KeyManager: React.FC<KeyManagerProps> = ({
  keys,
  onRefresh,
  onGenerateKey,
  onDeleteKey,
  onOpenFinder,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingKeyPath, setDeletingKeyPath] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'ed25519' | 'rsa'>('ed25519');
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCopyPublic = (key: SSHKeyFile) => {
    if (!key.publicKey) return;
    navigator.clipboard.writeText(key.publicKey);
    setCopiedKey(key.path);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const openModal = () => {
    setName('');
    setComment('');
    setPassphrase('');
    setType('ed25519');
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setModalError('Bitte gib einen Namen für die Schlüsseldatei an.');
      return;
    }
    setModalError(null);
    setIsSubmitting(true);
    try {
      await onGenerateKey({
        name: name.trim(),
        type,
        comment: comment.trim() || undefined,
        passphrase: passphrase.trim() || undefined,
      });
      setIsModalOpen(false);
      setName('');
      setComment('');
      setPassphrase('');
      setStatusBanner(`Schlüssel "${name.trim()}" erfolgreich erstellt.`);
      setTimeout(() => setStatusBanner(null), 4000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setModalError(`Fehler beim Erstellen des Schlüssels: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-blue-400" />
            SSH-Schlüsselverwaltung (~/.ssh)
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Alle privaten und öffentlichen Schlüssel werden direkt im Standardverzeichnis{' '}
            <code className="text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
              ~/.ssh
            </code>{' '}
            verwaltet und sind sofort im gesamten Mac-System verfügbar.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onOpenFinder()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium transition-colors"
            title="~/.ssh im Finder öffnen"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>In Finder öffnen</span>
          </button>
          <button
            onClick={openModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Neuen Schlüssel erzeugen</span>
          </button>
        </div>
      </div>

      {/* Status / Error Banners */}
      {statusBanner && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button type="button" onClick={() => setStatusBanner(null)} className="text-emerald-400 hover:text-emerald-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {errorBanner && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button type="button" onClick={() => setErrorBanner(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* Keys List */}
      {keys.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl">
          <Key className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-zinc-300">Keine SSH-Schlüssel in ~/.ssh gefunden</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1 mb-4">
            Erstelle einen neuen modernen Ed25519-Schlüssel mit einem Klick.
          </p>
          <button
            onClick={openModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Jetzt Schlüssel generieren
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {keys.map((k) => (
            <div
              key={k.path}
              className="bg-zinc-900/70 border border-zinc-800/80 rounded-xl p-4 flex items-center justify-between hover:border-zinc-700 transition-colors"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-zinc-100">{k.name}</span>
                    {k.type?.toLowerCase() === 'ppk' ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        PuTTY PPK
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {k.type}
                      </span>
                    )}
                    {k.isEncrypted && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        <Lock className="w-3 h-3" />
                        Passphrase
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-2 font-mono">
                    <span className="text-zinc-500">{k.path}</span>
                    {k.fingerprint && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-400">{k.fingerprint}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {k.hasPublic && (
                  <button
                    onClick={() => handleCopyPublic(k)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
                    title="Öffentlichen Schlüssel (authorized_keys Format) in die Zwischenablage kopieren"
                  >
                    {copiedKey === k.path ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Kopiert!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Public Key kopieren</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => onOpenFinder(k.path)}
                  className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="In Finder zeigen"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
                {deletingKeyPath === k.path ? (
                  <div className="flex items-center gap-1.5 bg-red-950/40 border border-red-500/30 px-2 py-1 rounded-lg">
                    <span className="text-xs text-red-300 font-medium">Löschen?</span>
                    <button
                      onClick={async () => {
                        try {
                          await onDeleteKey(k.path);
                          setDeletingKeyPath(null);
                          setStatusBanner(`Schlüssel "${k.name}" wurde gelöscht.`);
                          setTimeout(() => setStatusBanner(null), 4000);
                        } catch (err: unknown) {
                          const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
                          setErrorBanner(`Fehler beim Löschen des Schlüssels: ${message}`);
                          setDeletingKeyPath(null);
                        }
                      }}
                      className="px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white text-[11px] font-medium rounded transition-colors"
                    >
                      Ja
                    </button>
                    <button
                      onClick={() => setDeletingKeyPath(null)}
                      className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] rounded transition-colors"
                    >
                      Nein
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingKeyPath(k.path)}
                    className="p-1.5 hover:bg-red-500/10 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                    title="Schlüssel löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generate Key Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-400" />
                Neuen SSH-Schlüssel erzeugen
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-zinc-400 hover:text-zinc-200 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {modalError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{modalError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalError(null)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Dateiname (wird in ~/.ssh/ gespeichert)
                </label>
                <input
                  type="text"
                  required
                  placeholder="z.B. id_ed25519_hetzner"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Schlüssel-Algorithmus
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('ed25519')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      type === 'ed25519'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Ed25519 (Modern & Schnell)
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('rsa')}
                    className={`py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      type === 'rsa'
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    RSA (4096-bit, Kompatibel)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Kommentar / E-Mail (optional)
                </label>
                <input
                  type="text"
                  placeholder="z.B. user@macbook"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Passphrase (optional, für zusätzlichen Schutz)
                </label>
                <input
                  type="password"
                  placeholder="Leer lassen für schlüsselfreien Login"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Wird erzeugt...' : 'Schlüssel anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
