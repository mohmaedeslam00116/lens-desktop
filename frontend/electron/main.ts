import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { startEmbeddedServer, stopEmbeddedServer } from './engine/server';
import { ReportExportService } from './engine/reportExport';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
const BACKEND_PORT = 8000;

async function startBackendEngine() {
  try {
    console.log(`[Electron Main] Initializing native Vane embedded engine on port ${BACKEND_PORT}...`);
    const reportExportService: ReportExportService = {
      renderPdf: async (html) => {
        const exportWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        try {
          await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
          return await exportWindow.webContents.printToPDF({
            pageSize: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
          });
        } finally {
          if (!exportWindow.isDestroyed()) exportWindow.destroy();
        }
      },
    };
    await startEmbeddedServer(BACKEND_PORT, { reportExportService });
    console.log(`[Electron Main] Native Vane research engine active on http://127.0.0.1:${BACKEND_PORT}`);
  } catch (err) {
    console.error('[Electron Main] Failed to start native embedded engine:', err);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#0c0d0e',
    title: 'LENS — Research, in focus',
    icon: path.join(__dirname, '..', 'dist', 'lens.png'),
    frame: true,
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.setAlwaysOnTop(true);
    mainWindow?.focus();
    mainWindow?.setAlwaysOnTop(false);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Electron Main] Renderer process loaded successfully.');
    mainWindow?.show();
    mainWindow?.setAlwaysOnTop(true);
    mainWindow?.focus();
    mainWindow?.setAlwaysOnTop(false);
  });

  mainWindow.webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron Main] Failed to load ${validatedURL}: [${errorCode}] ${errorDescription}`);
  });

  // Handle external link clicks (open citations in default system browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (isDev && process.env.ELECTRON_DEV === '1') {
    mainWindow.loadURL('http://localhost:5173');
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('open-external', (_, url: string) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

// IPC Handlers for secure storage
ipcMain.handle('secure-store-set', async (_, key: string, value: string) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'secure_config.json');
    let data: Record<string, string> = {};
    if (fs.existsSync(configPath)) {
      data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      data[key] = encrypted.toString('base64');
    } else {
      data[key] = Buffer.from(value).toString('base64');
    }

    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error in secure-store-set:', err);
    return false;
  }
});

ipcMain.handle('secure-store-get', async (_, key: string) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'secure_config.json');
    if (!fs.existsSync(configPath)) return null;
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!data[key]) return null;

    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(data[key], 'base64');
      return safeStorage.decryptString(buffer);
    } else {
      return Buffer.from(data[key], 'base64').toString('utf8');
    }
  } catch (err) {
    console.error('Error in secure-store-get:', err);
    return null;
  }
});

// App Lifecycle
app.whenReady().then(async () => {
  await startBackendEngine();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  stopEmbeddedServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
