import React, { useState, useEffect } from 'react';
import {
  Cable,
  RefreshCw,
  X,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Trash2,
  Check,
  AlertCircle,
  Cpu,
} from 'lucide-react';
import {
  SerialConfig,
  SerialPortInfo,
  SerialProfile,
  SerialDataBits,
  SerialStopBits,
  SerialParity,
  SerialFlowControl,
} from '../types';

interface SerialConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: SerialConfig, label?: string) => void;
}

const COMMON_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const STORAGE_KEY_PROFILES = 'putty_serial_profiles';
const STORAGE_KEY_LAST_CONFIG = 'putty_serial_last_config';

export const SerialConnectModal: React.FC<SerialConnectModalProps> = ({
  isOpen,
  onClose,
  onConnect,
}) => {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [isLoadingPorts, setIsLoadingPorts] = useState(false);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [customPort, setCustomPort] = useState<string>('');
  const [isManualPort, setIsManualPort] = useState(false);

  // Serial config
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [customBaud, setCustomBaud] = useState<string>('');
  const [isCustomBaud, setIsCustomBaud] = useState(false);
  const [dataBits, setDataBits] = useState<SerialDataBits>(8);
  const [stopBits, setStopBits] = useState<SerialStopBits>(1);
  const [parity, setParity] = useState<SerialParity>('none');
  const [flowControl, setFlowControl] = useState<SerialFlowControl>('none');

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedProfiles, setSavedProfiles] = useState<SerialProfile[]>([]);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNameInput, setProfileNameInput] = useState('');

  // Load saved profiles and last config from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (stored) {
        setSavedProfiles(JSON.parse(stored));
      }
      const last = localStorage.getItem(STORAGE_KEY_LAST_CONFIG);
      if (last) {
        const parsed = JSON.parse(last);
        if (parsed.baudRate) setBaudRate(parsed.baudRate);
        if (parsed.dataBits) setDataBits(parsed.dataBits);
        if (parsed.stopBits) setStopBits(parsed.stopBits);
        if (parsed.parity) setParity(parsed.parity);
        if (parsed.flowControl) setFlowControl(parsed.flowControl);
      }
    } catch {
      // Ignore localStorage parse errors
    }
  }, []);

  // Fetch available ports when modal opens
  useEffect(() => {
    if (isOpen) {
      scanPorts();
      setErrorMessage(null);
    }
  }, [isOpen]);

  const scanPorts = async () => {
    if (!window.electronAPI?.listSerialPorts) return;
    setIsLoadingPorts(true);
    setErrorMessage(null);
    try {
      const list = await window.electronAPI.listSerialPorts();
      setPorts(list);

      // Auto-select first USB serial device if available, otherwise first port
      const usbDevice = list.find(
        (p) =>
          p.path.includes('usb') ||
          p.path.includes('SLAB') ||
          p.friendlyName?.startsWith('🔌')
      );
      if (usbDevice) {
        setSelectedPort(usbDevice.path);
        setIsManualPort(false);
      } else if (list.length > 0 && !selectedPort) {
        setSelectedPort(list[0].path);
        setIsManualPort(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Ports konnten nicht ermittelt werden: ${msg}`);
    } finally {
      setIsLoadingPorts(false);
    }
  };

  const handleSelectBaud = (rate: number) => {
    setBaudRate(rate);
    setIsCustomBaud(false);
    setCustomBaud('');
  };

  const handleCustomBaudChange = (val: string) => {
    setCustomBaud(val);
    const parsed = parseInt(val, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      setBaudRate(parsed);
    }
  };

  const handleSaveProfile = () => {
    if (!profileNameInput.trim()) return;
    const finalPort = isManualPort ? customPort.trim() : selectedPort;
    const newProfile: SerialProfile = {
      id: `profile_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: profileNameInput.trim(),
      path: finalPort,
      baudRate,
      dataBits,
      stopBits,
      parity,
      flowControl,
      createdAt: Date.now(),
    };
    const updated = [newProfile, ...savedProfiles];
    setSavedProfiles(updated);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(updated));
    } catch {
      // Ignore
    }
    setProfileNameInput('');
    setIsSavingProfile(false);
  };

  const handleDeleteProfile = (id: string) => {
    const updated = savedProfiles.filter((p) => p.id !== id);
    setSavedProfiles(updated);
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(updated));
    } catch {
      // Ignore
    }
  };

  const handleApplyProfile = (profile: SerialProfile) => {
    if (profile.path) {
      const match = ports.find((p) => p.path === profile.path);
      if (match) {
        setSelectedPort(profile.path);
        setIsManualPort(false);
      } else {
        setCustomPort(profile.path);
        setIsManualPort(true);
      }
    }
    setBaudRate(profile.baudRate);
    if (!COMMON_BAUD_RATES.includes(profile.baudRate)) {
      setIsCustomBaud(true);
      setCustomBaud(String(profile.baudRate));
    } else {
      setIsCustomBaud(false);
    }
    setDataBits(profile.dataBits);
    setStopBits(profile.stopBits);
    setParity(profile.parity);
    setFlowControl(profile.flowControl);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalPath = isManualPort ? customPort.trim() : selectedPort.trim();
    if (!finalPath) {
      setErrorMessage('Bitte wähle ein serielles Gerät oder gib einen Gerätepfad an.');
      return;
    }

    const config: SerialConfig = {
      path: finalPath,
      baudRate,
      dataBits,
      stopBits,
      parity,
      flowControl,
    };

    // Save as last config
    try {
      localStorage.setItem(STORAGE_KEY_LAST_CONFIG, JSON.stringify(config));
    } catch {
      // Ignore
    }

    const activePortInfo = ports.find((p) => p.path === finalPath);
    const friendlyShort =
      activePortInfo?.friendlyName?.replace(/^🔌\s*/, '') ||
      finalPath.split('/').pop() ||
      'Serial';

    onConnect(config, friendlyShort);
    onClose();
  };

  if (!isOpen) return null;

  const currentPortInfo = ports.find((p) => p.path === selectedPort);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Cable className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Serielle Verbindung herstellen
              </h3>
              <p className="text-[11px] text-zinc-400">
                Direkter Zugriff auf USB-Serial-Adapter, Konsolenkabel & Embedded Devices
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl flex items-start gap-2.5 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Saved Profiles Bar */}
          {savedProfiles.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                <Bookmark className="w-3 h-3 text-amber-400" />
                <span>Gespeicherte Profile:</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {savedProfiles.map((prof) => (
                  <div
                    key={prof.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-xs text-zinc-200 hover:bg-zinc-750 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleApplyProfile(prof)}
                      className="hover:text-amber-400 text-left font-medium"
                      title={`${prof.path} @ ${prof.baudRate}`}
                    >
                      {prof.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteProfile(prof.id)}
                      className="text-zinc-500 hover:text-red-400 p-0.5"
                      title="Profil löschen"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Port Selection */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">
                Serieller Port / Schnittstelle
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsManualPort(!isManualPort)}
                  className="text-[11px] text-zinc-400 hover:text-amber-400 transition-colors"
                >
                  {isManualPort ? 'Geräteliste wählen' : 'Manuell eingeben'}
                </button>
                <button
                  type="button"
                  onClick={scanPorts}
                  disabled={isLoadingPorts}
                  className="flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                  title="Ports neu einlesen"
                >
                  <RefreshCw
                    className={`w-3 h-3 ${isLoadingPorts ? 'animate-spin' : ''}`}
                  />
                  <span>Scan</span>
                </button>
              </div>
            </div>

            {isManualPort ? (
              <input
                type="text"
                value={customPort}
                onChange={(e) => setCustomPort(e.target.value)}
                placeholder="/dev/cu.usbserial-10 oder COM1"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 font-mono"
              />
            ) : ports.length === 0 ? (
              <div className="p-3 bg-zinc-950/60 border border-dashed border-zinc-800 rounded-xl text-center text-xs text-zinc-500">
                {isLoadingPorts
                  ? 'Suche nach seriellen Geräten...'
                  : 'Keine seriellen Geräte gefunden. Schließe dein USB-Kabel an und klicke auf Scan.'}
              </div>
            ) : (
              <select
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono cursor-pointer"
              >
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.friendlyName || p.path}
                  </option>
                ))}
              </select>
            )}

            {/* Device Info Badge */}
            {!isManualPort && currentPortInfo && (
              <div className="p-2.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl flex items-center justify-between text-[11px] text-zinc-400">
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="font-mono text-zinc-300 truncate max-w-[280px]">
                    {currentPortInfo.path}
                  </span>
                </div>
                {currentPortInfo.manufacturer && (
                  <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px]">
                    {currentPortInfo.manufacturer}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Baud Rate Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300">
                Baudrate (Baud)
              </label>
              <span className="text-[11px] font-mono text-amber-400">
                {baudRate} bps
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {COMMON_BAUD_RATES.map((rate) => {
                const isSelected = !isCustomBaud && baudRate === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => handleSelectBaud(rate)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-mono transition-colors border ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {rate}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCustomBaud(!isCustomBaud)}
                className={`text-[11px] transition-colors ${
                  isCustomBaud
                    ? 'text-amber-400 font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Eigene Baudrate festlegen...
              </button>
              {isCustomBaud && (
                <input
                  type="number"
                  value={customBaud}
                  onChange={(e) => handleCustomBaudChange(e.target.value)}
                  placeholder="z. B. 1500000"
                  className="flex-1 px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500"
                />
              )}
            </div>
          </div>

          {/* Advanced Accordion */}
          <div className="border border-zinc-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full px-3.5 py-2.5 bg-zinc-950/40 flex items-center justify-between text-xs font-medium text-zinc-300 hover:bg-zinc-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                <span>Erweiterte Parameter (8N1, Flow-Control)</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <span className="font-mono text-[11px]">
                  {dataBits}
                  {parity === 'none' ? 'N' : parity[0].toUpperCase()}
                  {stopBits} &bull; {flowControl}
                </span>
                {showAdvanced ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </div>
            </button>

            {showAdvanced && (
              <div className="p-3.5 bg-zinc-950/80 space-y-3 border-t border-zinc-800 text-xs">
                {/* Data Bits */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Data Bits
                    </label>
                    <select
                      value={dataBits}
                      onChange={(e) =>
                        setDataBits(parseInt(e.target.value, 10) as SerialDataBits)
                      }
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value={8}>8 (Standard)</option>
                      <option value={7}>7</option>
                      <option value={6}>6</option>
                      <option value={5}>5</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Stop Bits
                    </label>
                    <select
                      value={stopBits}
                      onChange={(e) =>
                        setStopBits(parseFloat(e.target.value) as SerialStopBits)
                      }
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value={1}>1 (Standard)</option>
                      <option value={1.5}>1.5</option>
                      <option value={2}>2</option>
                    </select>
                  </div>
                </div>

                {/* Parity & Flow Control */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Parität
                    </label>
                    <select
                      value={parity}
                      onChange={(e) => setParity(e.target.value as SerialParity)}
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value="none">Keine (None, Standard)</option>
                      <option value="even">Gerade (Even)</option>
                      <option value="odd">Ungerade (Odd)</option>
                      <option value="mark">Mark</option>
                      <option value="space">Space</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Flusssteuerung
                    </label>
                    <select
                      value={flowControl}
                      onChange={(e) =>
                        setFlowControl(e.target.value as SerialFlowControl)
                      }
                      className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-700/80 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500 font-mono"
                    >
                      <option value="none">Keine (None, Standard)</option>
                      <option value="rtscts">RTS / CTS (Hardware)</option>
                      <option value="xonxoff">XON / XOFF (Software)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save Profile Option */}
          <div className="pt-1">
            {isSavingProfile ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={profileNameInput}
                  onChange={(e) => setProfileNameInput(e.target.value)}
                  placeholder="Profilname, z. B. Cisco Switch 9600"
                  className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Speichern</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsSavingProfile(false)}
                  className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsSavingProfile(true)}
                className="text-[11px] text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition-colors"
              >
                <Bookmark className="w-3 h-3" />
                <span>Als Profil für spätere Verbindung speichern...</span>
              </button>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors flex items-center gap-2 shadow-sm shadow-amber-600/20"
            >
              <Cable className="w-3.5 h-3.5" />
              <span>Verbinden</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
