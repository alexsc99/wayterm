// Regenerates build/icon.png and build/icon.icns from build/icon.svg (run: npm run icon).
// Electron rasterizes the SVG with a transparent background; sips/iconutil build the macOS iconset.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZE = 1024;
const dir = __dirname;

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(dir, 'icon.svg'));
    const html = `<!doctype html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${svg.toString('base64')}" width="${SIZE}" height="${SIZE}" style="display:block"></body>`;
    const win = new BrowserWindow({
      width: SIZE,
      height: SIZE,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: { deviceScaleFactor: 1 } },
    });
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await win.webContents.executeJavaScript(
      'document.images[0].decode().then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))'
    );
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
    const png = path.join(dir, 'icon.png');
    fs.writeFileSync(png, image.toPNG());

    const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'wayterm-')) + '/icon.iconset';
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
        const px = String(size * scale);
        const out = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
        execFileSync('sips', ['-s', 'format', 'png', '-z', px, px, png, '--out', out], { stdio: 'ignore' });
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(dir, 'icon.icns')]);
    fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
    console.log('icon.png + icon.icns written');
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
