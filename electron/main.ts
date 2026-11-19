import { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, clipboard } from 'electron';
import path from 'path';
import fs from 'fs';
import { SSHService } from './services/SSHService';
import { SFTPService } from './services/SFTPService';
import { KeyService } from './services/KeyService';
import { HostStore } from './services/HostStore';
import { LocalFileService } from './services/LocalFileService';
import { LocalTerminalService } from './services/LocalTerminalService';
import { sessionLog, DEFAULT_LOG_DIRECTORY } from './services/SessionLogService';
import { SerialService } from './services/SerialService';
import { HostKeyVerifier } from './services/HostKeyVerifier';

let win: BrowserWindow | null = null;
let hostStore: HostStore;
let sshService: SSHService;
let sftpService: SFTPService;
let localTerminalService: LocalTerminalService;
let serialService: SerialService;
function resolvePreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, 'preload.mjs'),
    path.join(__dirname, 'preload.cjs')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, 'preload.js');
}

function createMenu() {
  const isMac = process.platform === 'darwin';
  const template: any[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Vollständig neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklertools ein/ausblenden' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Normalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbildmodus' }
      ]
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Minimieren' },
        { role: 'zoom', label: 'Zoomen' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front', label: 'Alle nach vorne bringen' }
            ]
          : [{ role: 'close', label: 'Schließen' }])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

let saveStateTimeout: NodeJS.Timeout | null = null;

function loadWindowState(): WindowBounds {
  const defaultBounds: WindowBounds = { width: 1280, height: 840 };
  try {
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    if (!fs.existsSync(stateFile)) {
      return defaultBounds;
    }
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return defaultBounds;
    }

    const width = typeof parsed.width === 'number' && parsed.width >= 960 ? parsed.width : defaultBounds.width;
    const height = typeof parsed.height === 'number' && parsed.height >= 600 ? parsed.height : defaultBounds.height;

    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      const savedBounds = { x: parsed.x, y: parsed.y, width, height };
      const display = screen.getDisplayMatching(savedBounds);

      // Validate that the window is positioned within visible screen space
      const isVisible =
        savedBounds.x + 100 > display.bounds.x &&
        savedBounds.x < display.bounds.x + display.bounds.width - 100 &&
        savedBounds.y >= display.bounds.y &&
        savedBounds.y < display.bounds.y + display.bounds.height - 50;

      if (isVisible) {
        return { width, height, x: parsed.x, y: parsed.y };
      }
    }

    return { width, height };
  } catch (err) {
    console.error('Failed to load window state:', err);
    return defaultBounds;
  }
}

function flushWindowState(targetWin: BrowserWindow | null) {
  clearTimeout(saveStateTimeout!);
  saveStateTimeout = null;
  if (!targetWin || targetWin.isDestroyed()) return;
  try {
    if (!targetWin.isMinimized()) {
      const bounds = targetWin.getBounds();
      const stateFile = path.join(app.getPath('userData'), 'window-state.json');
      fs.writeFileSync(stateFile, JSON.stringify(bounds, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to save window state:', err);
  }
}

function saveWindowState(targetWin: BrowserWindow) {
  clearTimeout(saveStateTimeout!);
  saveStateTimeout = setTimeout(() => {
    flushWindowState(targetWin);
  }, 300);
}

const RENDERER_CRASH_LIMIT = 3;
const RENDERER_CRASH_WINDOW_MS = 60_000;
const rendererCrashTimes: number[] = [];
const MAX_LOG_BYTES = 1024 * 1024;

// Errors are logged instead of crashing or showing Electron's default error dialog;
// ssh2/serialport can emit stray errors after a session has already been cleaned up.
function logMainError(scope: string, error: unknown): void {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[${scope}]`, detail);
  try {
    const logFile = path.join(app.getPath('logs'), 'main.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
      fs.renameSync(logFile, `${logFile}.1`);
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${scope}] ${detail}\n`, 'utf8');
  } catch {
    // Logging must never throw
  }
}

function createWindow() {
  const preloadPath = resolvePreloadPath();
  const savedState = loadWindowState();

  win = new BrowserWindow({
    title: 'PuTTY+',
    show: false,
    width: savedState.width,
    height: savedState.height,
    ...(typeof savedState.x === 'number' && typeof savedState.y === 'number'
      ? { x: savedState.x, y: savedState.y }
      : {}),
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Flow control waits for xterm to acknowledge output; throttled timers in a
      // hidden/minimized window would otherwise stall running remote commands.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    win?.show();
  });

  win.on('resize', () => {
    if (win) saveWindowState(win);
  });

  win.on('move', () => {
    if (win) saveWindowState(win);
  });

  const webContents = win.webContents;

  // Reload or navigation discards all renderer state; shells and connections would be orphaned.
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      teardownTerminalSessions();
    }
  });

  webContents.on('render-process-gone', (_event, details) => {
    logMainError('render-process-gone', `${details.reason} (exitCode ${details.exitCode})`);
    if (details.reason === 'clean-exit') return;
    teardownTerminalSessions();
    const target = win;
    if (!target || target.isDestroyed()) return;

    const now = Date.now();
    while (rendererCrashTimes.length > 0 && now - rendererCrashTimes[0] > RENDERER_CRASH_WINDOW_MS) {
      rendererCrashTimes.shift();
    }
    rendererCrashTimes.push(now);
    if (rendererCrashTimes.length < RENDERER_CRASH_LIMIT) {
      // A synchronous reload inside this event produced a second gone event; defer it.
      setTimeout(() => {
        if (!target.isDestroyed()) target.reload();
      }, 250);
      return;
    }

    void dialog
      .showMessageBox(target, {
        type: 'error',
        message: 'Die Oberfläche von PuTTY+ ist wiederholt abgestürzt.',
        detail: `Grund: ${details.reason}. Details stehen in ${path.join(app.getPath('logs'), 'main.log')}.`,
        buttons: ['Neu laden', 'Beenden'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0 && !target.isDestroyed()) {
          rendererCrashTimes.length = 0;
          target.reload();
        } else {
          app.quit();
        }
      });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('close', () => {
    flushWindowState(win);
  });

  win.on('closed', () => {
    teardownTerminalSessions();
    win = null;
  });
}

function registerIpcHandlers() {
  // Hosts
  ipcMain.handle('hosts:get', () => hostStore.getHosts());
  ipcMain.handle('hosts:migrate', (_, hosts) => hostStore.migrateHosts(hosts));
  ipcMain.handle('hosts:save', (_, host) => hostStore.saveHost(host));
  ipcMain.handle('hosts:delete', (_, id) => hostStore.deleteHost(id));
  ipcMain.handle('hosts:importSshConfig', () => hostStore.getSSHConfigHosts());

  // Keys from ~/.ssh
  ipcMain.handle('keys:list', () => KeyService.listKeys());
  ipcMain.handle('keys:generate', (_, options) => KeyService.generateKey(options));
  ipcMain.handle('keys:delete', (_, path) => KeyService.deleteKey(path));
  ipcMain.handle('keys:openInFinder', (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      shell.openPath(KeyService.getSshDirPath());
    }
    return true;
  });

  // Local Terminal (PTY / zsh on macOS)
  ipcMain.handle('pty:connect', (event, { sessionId, cols, rows }) => {
    return localTerminalService.spawn(sessionId, cols, rows, event.sender);
  });
  ipcMain.on('pty:write', (_, { sessionId, data }) => {
    localTerminalService.write(sessionId, data);
  });
  ipcMain.on('pty:resize', (_, { sessionId, cols, rows }) => {
    localTerminalService.resize(sessionId, cols, rows);
  });
  ipcMain.handle('pty:disconnect', (_, { sessionId }) => {
    localTerminalService.kill(sessionId);
  });

  // SSH Terminal
  ipcMain.handle('ssh:connect', async (event, { sessionId, host, cols, rows }) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) throw new Error('Hauptfenster nicht verfügbar');
    return await sshService.connect(sessionId, host, cols, rows, targetWin);
  });
  ipcMain.on('ssh:write', (_, { sessionId, data }) => {
    sshService.write(sessionId, data);
  });
  ipcMain.on('ssh:resize', (_, { sessionId, cols, rows }) => {
    sshService.resize(sessionId, cols, rows);
  });
  ipcMain.handle('ssh:disconnect', (_, { sessionId }) => {
    sshService.disconnect(sessionId);
  });

  // Serial Terminal
  ipcMain.handle('serial:list', () => serialService.listPorts());
  ipcMain.handle('serial:connect', async (event, { sessionId, config }) => {
    return await serialService.connect(sessionId, config, event.sender);
  });
  ipcMain.on('serial:write', (_, { sessionId, data }) => {
    serialService.write(sessionId, data);
  });
  ipcMain.handle('serial:disconnect', (_, { sessionId }) => {
    serialService.disconnect(sessionId);
  });

  // Flow control acknowledgements; session IDs are unique across all terminal types.
  ipcMain.on('terminal:ack', (_, { sessionId, amount }) => {
    if (typeof sessionId !== 'string' || typeof amount !== 'number' || !(amount > 0)) return;
    localTerminalService.ack(sessionId, amount);
    sshService.ack(sessionId, amount);
    serialService.ack(sessionId, amount);
  });

  // Session logging configuration (pushed by the renderer from the terminal settings)
  ipcMain.on('sessionlog:configure', (_, config) => {
    sessionLog.configure({ enabled: config?.enabled === true, directory: String(config?.directory ?? '') });
  });
  ipcMain.handle('sessionlog:defaultDirectory', () => DEFAULT_LOG_DIRECTORY);
  // SFTP
  ipcMain.handle('sftp:list', async (_, { host, remotePath }) => {
    return await sftpService.listDirectory(host, remotePath);
  });
  ipcMain.handle('sftp:upload', async (event, { host, localPath, remotePath, transferId }) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) throw new Error('Hauptfenster nicht verfügbar');
    return await sftpService.uploadFile(host, localPath, remotePath, transferId, targetWin);
  });
  ipcMain.handle('sftp:download', async (event, { host, remotePath, localPath, transferId }) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) throw new Error('Hauptfenster nicht verfügbar');
    return await sftpService.downloadFile(host, remotePath, localPath, transferId, targetWin);
  });
  ipcMain.handle('sftp:mkdir', async (_, { host, remotePath }) => {
    return await sftpService.createDirectory(host, remotePath);
  });
  ipcMain.handle('sftp:deleteFile', async (_, { host, remotePath }) => {
    return await sftpService.deleteFile(host, remotePath);
  });
  ipcMain.handle('sftp:deleteDir', async (_, { host, remotePath }) => {
    return await sftpService.deleteDirectory(host, remotePath);
  });
  ipcMain.handle('sftp:rename', async (_, { host, oldPath, newPath }) => {
    return await sftpService.renameFile(host, oldPath, newPath);
  });
  ipcMain.handle('sftp:readFile', async (_, { host, remotePath }) => {
    return await sftpService.readRemoteFile(host, remotePath);
  });
  ipcMain.handle('sftp:writeFile', async (_, { host, remotePath, content }) => {
    return await sftpService.writeRemoteFile(host, remotePath, content);
  });
  ipcMain.handle('sftp:protocolMode', async (_, { host }) => {
    return sftpService.getHostProtocolMode(host);
  });
  ipcMain.handle('scp:execute', async (event, options) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) throw new Error('Hauptfenster nicht verfügbar');
    return await sftpService.executeSCPTransfer(options, targetWin);
  });
  ipcMain.handle('transfer:cancel', async (_, { transferId }) => {
    return sftpService.cancelTransfer(transferId);
  });

  // Local Files
  ipcMain.handle('local:home', () => LocalFileService.getHomePath());
  ipcMain.handle('local:list', (_, dirPath) => LocalFileService.listDirectory(dirPath));

  // System Info
  ipcMain.handle('system:info', () => ({
    platform: process.platform,
    arch: process.arch,
  }));
  // File Picker Dialogs. Since Electron 43 macOS no longer remembers the last folder and
  // dialogs without defaultPath open in Downloads, so the last used folder is tracked here.
  let lastDialogDirectory = app.getPath('home');
  ipcMain.handle('dialog:openFile', async (event, options) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) return null;
    const res = await dialog.showOpenDialog(targetWin, {
      properties: ['openFile'],
      defaultPath: lastDialogDirectory,
      ...options,
    });
    if (res.canceled) return null;
    lastDialogDirectory = path.dirname(res.filePaths[0]);
    return res.filePaths[0];
  });
  ipcMain.handle('dialog:openDirectory', async (event, options) => {
    const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
    if (!targetWin) return null;
    const res = await dialog.showOpenDialog(targetWin, {
      properties: ['openDirectory'],
      defaultPath: lastDialogDirectory,
      ...options,
    });
    if (res.canceled) return null;
    lastDialogDirectory = res.filePaths[0];
    return res.filePaths[0];
  });

  // Clipboard (PuTTY Copy-on-Select & Right-Click Paste)
  ipcMain.handle('clipboard:read', () => clipboard.readText());
  // clipboard.writeText returns a Promise since Electron 44
  ipcMain.handle('clipboard:write', async (_, text: string) => {
    if (typeof text === 'string') {
      await clipboard.writeText(text);
    }
  });

  // Save Text File (e.g. Terminal Log Export)
  ipcMain.handle(
    'dialog:saveTextFile',
    async (event, options: { defaultName: string; content: string; title?: string }) => {
      const targetWin = BrowserWindow.fromWebContents(event.sender) || win;
      if (!targetWin) return { saved: false };
      const res = await dialog.showSaveDialog(targetWin, {
        title: options?.title || 'Terminal-Verlauf speichern',
        defaultPath: path.join(lastDialogDirectory, options?.defaultName || 'terminal.log'),
        filters: [
          { name: 'Log-Dateien', extensions: ['log', 'txt'] },
          { name: 'Alle Dateien', extensions: ['*'] },
        ],
      });
      if (res.canceled || !res.filePath) {
        return { saved: false };
      }
      await fs.promises.writeFile(res.filePath, options?.content ?? '', 'utf8');
      lastDialogDirectory = path.dirname(res.filePath);
      return { saved: true, filePath: res.filePath };
    }
  );

  // Open External URL safely (only http/https)
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      await shell.openExternal(parsed.toString());
      return true;
    } catch {
      return false;
    }
  });
}

// Apple Silicon & GPU Performance Flags
if (app?.commandLine) {
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}
function teardownTerminalSessions() {
  try {
    localTerminalService?.killAll();
  } catch (err) {
    logMainError('teardown local terminals', err);
  }
  try {
    sshService?.disconnectAll();
  } catch (err) {
    logMainError('teardown ssh', err);
  }
  try {
    serialService?.disconnectAll();
  } catch (err) {
    logMainError('teardown serial', err);
  }
}

function teardownServices() {
  teardownTerminalSessions();
  try {
    sftpService?.closeAll();
  } catch (err) {
    logMainError('teardown sftp', err);
  }
}
if (app) {
  process.on('uncaughtException', (err) => logMainError('uncaughtException', err));
  process.on('unhandledRejection', (reason) => logMainError('unhandledRejection', reason));
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') {
      logMainError('child-process-gone', `${details.type} ${details.reason} (exitCode ${details.exitCode})`);
    }
  });

  app.whenReady().then(() => {
    createMenu();
    hostStore = new HostStore();
    const hostKeyVerifier = new HostKeyVerifier(() => win);
    const resolveHosts = () => hostStore.getHosts();
    sshService = new SSHService(hostKeyVerifier, resolveHosts);
    sftpService = new SFTPService(hostKeyVerifier, resolveHosts);
    localTerminalService = new LocalTerminalService();
    serialService = new SerialService();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    if (process.env.SMOKE_TEST) {
      setTimeout(() => {
        console.log('SMOKE_TEST: Startup and initialization succeeded');
        app.quit();
      }, 1500);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    flushWindowState(win);
    teardownServices();
  });

  app.on('will-quit', () => {
    teardownServices();
  });
}
