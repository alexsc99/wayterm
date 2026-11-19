# Wayterm

SSH-, SFTP-, SCP- und Seriell-Terminal für macOS (Apple Silicon), gebaut mit Electron, React und xterm.js.

## Funktionen

- **Terminals:** lokale Shell, SSH und serielle Verbindungen in Tabs, Split-Ansicht, Suche, Befehlspalette (⌘⇧P), Snippets
- **SSH:** Passwort-, Schlüssel- und ssh-agent-Anmeldung, Jump-Host (ProxyJump), Agent-Weiterleitung, Port-Weiterleitungen (`-L`, `-R`, `-D`/SOCKS5), Host-Key-Prüfung
- **Stabilität:** Flusskontrolle bei schneller Ausgabe, automatische SSH-Wiederverbindung, Tabs nach dem Neustart wiederherstellen
- **Dateien:** SFTP-Explorer mit SCP-Fallback, Drag & Drop, Editor für Remote-Dateien
- **Schlüssel:** Verwaltung der Schlüssel in `~/.ssh` (OpenSSH und PuTTY-PPK erkennen, Schlüssel erzeugen)
- **Sitzungsprotokoll** in Dateien (optional, Einstellung im Terminal)
- Import von Hosts aus `~/.ssh/config`

Gespeicherte Passwörter werden mit dem macOS-Schlüsselbund (Electron `safeStorage`) verschlüsselt.

## Entwicklung

```sh
npm install
npm run dev        # Vite-Entwicklungsserver (Renderer)
npm run build      # tsc + vite build
npm start          # gebaute App starten
npm run lint
npm test
npm run install:app   # baut, signiert ad hoc und installiert nach /Applications/Wayterm.app
```

Die App ist ad hoc signiert und nicht notarisiert; auf anderen Macs warnt Gatekeeper beim ersten Start.

## Daten

Hosts, Host-Keys und Einstellungen liegen unter `~/Library/Application Support/putty-plus`. Der Ordner trägt noch den Namen aus der Zeit vor der Umbenennung in Wayterm. Der interne App-Name ist absichtlich festgehalten (`electron/main.ts`), weil sich daran auch der Schlüsselbund-Eintrag `putty-plus Safe Storage` orientiert, der die gespeicherten Passwörter schützt.

## Lizenz

[MIT](LICENSE)
