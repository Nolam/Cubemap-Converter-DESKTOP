import { app, BrowserWindow, shell, ipcMain, dialog } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let splashWindow = null;
let serverPort = 0;
let serverStarted = false;
let serverProcess = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function startServerProcess(port) {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, "..", "dist", "index.cjs");

    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
        USER_DATA_PATH: app.getPath("userData"),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    const timeout = setTimeout(() => {
      serverProcess.kill();
      reject(new Error("Server did not start in time"));
    }, 30000);

    serverProcess.on("message", (msg) => {
      if (msg && msg.type === "ready") {
        clearTimeout(timeout);
        resolve();
      }
    });

    serverProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", (code) => {
      if (!serverStarted) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "CubeMap to HDRI Converter",
    icon: path.join(__dirname, "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.session.on("will-download", (event, item) => {
    const filename = item.getFilename();
    const ext = path.extname(filename).slice(1);
    item.setSaveDialogOptions({
      defaultPath: filename,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
  });
}

ipcMain.handle("select-save-path", async (_event, defaultName, ext) => {
  const filters = ext
    ? [{ name: ext.toUpperCase(), extensions: [ext] }]
    : [{ name: "All Files", extensions: ["*"] }];
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName || "output",
    filters,
  });
  return result.canceled ? null : result.filePath;
});

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 220,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(__dirname, "..", "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (splashWindow) {
    splashWindow.focus();
  }
});

app.on("ready", async () => {
  createSplash();
  try {
    serverPort = await findFreePort();
    await startServerProcess(serverPort);
    serverStarted = true;
    createWindow();
  } catch (err) {
    console.error("Failed to start:", err);
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null && serverStarted) {
    createWindow();
  }
});
