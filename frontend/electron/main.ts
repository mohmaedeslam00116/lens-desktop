import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { startEmbeddedServer, stopEmbeddedServer } from './engine/server';
import { ReportExportService } from './engine/reportExport';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
/** Preferred engine port; a foreign listener can force an ephemeral fallback. */
const PREFERRED_ENGINE_PORT = 8000;

interface EngineEndpoint {
  port: number | null;
  baseUrl: string | null;
  wsBaseUrl: string | null;
  status: 'ready' | 'failed';
  error: string | null;
}

let engineEndpoint: EngineEndpoint = {
  port: null,
  baseUrl: null,
  wsBaseUrl: null,
  status: 'failed',
  error: 'Embedded engine has not started yet.',
};

function describeEngineFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message || 'Unknown engine startup failure';
}

/**
 * Binds the embedded research engine.
 *
 * The preferred port is only a preference: another process may hold it, and the
 * previous behaviour of assuming "a previous instance is active" meant LENS
 * silently talked to whatever answered there. Instead the engine retries on an
 * ephemeral port and the resolved endpoint is what the renderer is told to use.
 * If no port can be bound, the failure is reported rather than hidden, so the
 * UI can say the engine is offline instead of failing on the first search.
 */
async function startBackendEngine(): Promise<void> {
  try {
    console.log(`[Electron Main] Initializing embedded LENS engine on port ${PREFERRED_ENGINE_PORT}...`);
    const { port } = await startEmbeddedServer(PREFERRED_ENGINE_PORT, { reportExportService: createReportExportService() });
    engineEndpoint = {
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      status: 'ready',
      error: null,
    };
  } catch (preferredPortError) {
    const code = (preferredPortError as NodeJS.ErrnoException)?.code;
    if (code !== 'EADDRINUSE') {
      engineEndpoint = {
        port: null,
        baseUrl: null,
        wsBaseUrl: null,
        status: 'failed',
        error: describeEngineFailure(preferredPortError),
      };
      console.error('[Electron Main] Embedded engine failed to start:', preferredPortError);
      return;
    }

    console.warn(
      `[Electron Main] Port ${PREFERRED_ENGINE_PORT} is held by another process; binding an ephemeral port instead.`
    );
    try {
      const { port } = await startEmbeddedServer(0, { reportExportService: createReportExportService() });
      engineEndpoint = {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        wsBaseUrl: `ws://127.0.0.1:${port}`,
        status: 'ready',
        error: null,
      };
    } catch (fallbackError) {
      engineEndpoint = {
        port: null,
        baseUrl: null,
        wsBaseUrl: null,
        status: 'failed',
        error: describeEngineFailure(fallbackError),
      };
      console.error('[Electron Main] Embedded engine failed to start on any port:', fallbackError);
    }
  }

  if (engineEndpoint.status === 'ready') {
    console.log(`[Electron Main] LENS research engine active on ${engineEndpoint.baseUrl}`);
  }
}

/** PDF rendering runs in a hidden window so exports never disturb the workspace. */
function createReportExportService(): ReportExportService {
  return {
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
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // A failed load used to leave the operator staring at an empty frame.
    mainWindow.loadURL(renderLoadFailurePage(validatedURL, errorCode, errorDescription));
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

/**
 * Bilingual recovery page shown when the interface bundle cannot be loaded, so a
 * packaging failure is visible instead of presenting a blank window.
 */
function renderLoadFailurePage(url: string, code: number, description: string): string {
  const escape = (value: string) =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>LENS — could not open the workspace</title>
<style>
  html,body{margin:0;height:100%;background:#0c0d0e;color:#ededeb;
    font-family:Inter,'Segoe UI',system-ui,sans-serif}
  main{max-width:44rem;margin:0 auto;padding:5rem 2rem}
  h1{font-size:1.4rem;margin:0 0 .75rem;font-weight:600}
  p{margin:.4rem 0;line-height:1.6;color:#959590}
  code{font-family:ui-monospace,Consolas,monospace;color:#ededeb}
  hr{border:0;border-top:1px solid #26262a;margin:2rem 0}
</style></head>
<body><main>
  <h1>LENS could not open the workspace</h1>
  <p>The interface bundle reported <code>[${code}] ${escape(description)}</code> for <code>${escape(url)}</code>.</p>
  <p>Reinstall LENS, or run the packaged smoke test to confirm the build is intact.</p>
  <hr />
  <div dir="rtl" lang="ar">
    <h1>تعذّر على LENS فتح مساحة العمل</h1>
    <p>أبلغت واجهة التطبيق عن الخطأ <code>[${code}] ${escape(description)}</code> عند تحميل <code>${escape(url)}</code>.</p>
    <p>أعد تثبيت LENS، أو أعد تشغيل اختبار الحزمة للتأكد من سلامة البناء.</p>
  </div>
</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

app.on('second-instance', () => {
  // A second launch is a request to surface the running workspace, never a
  // second engine: a duplicate would fight for the preferred port.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// The preload bridge reads this synchronously while the renderer boots, so the
// workspace knows which port the engine actually bound before its first call.
ipcMain.on('engine-endpoint', (event) => {
  event.returnValue = engineEndpoint;
});

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
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // Another LENS already owns the engine and the window; this launch exits so a
  // double click on the icon can never produce a second, port-starved engine.
  app.quit();
} else {
  app.whenReady().then(async () => {
    await startBackendEngine();

    if (engineEndpoint.status === 'failed') {
      const message = engineEndpoint.error || 'Unknown engine startup failure';
      console.error(`[Electron Main] Workspace starting without a research engine: ${message}`);
      dialog.showMessageBox({
        type: 'error',
        title: 'LENS — research engine unavailable',
        message: 'The LENS research engine could not start, so research requests will fail.',
        detail: `${message}\n\nClose other LENS windows, then restart LENS.\n\n`
          + 'تعذّر تشغيل محرك البحث في LENS، لذا ستفشل طلبات البحث. أغلق نوافذ LENS الأخرى ثم أعد التشغيل.',
      }).catch(() => { /* the workspace still opens and reports the offline state */ });
    }

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('will-quit', () => {
  stopEmbeddedServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
