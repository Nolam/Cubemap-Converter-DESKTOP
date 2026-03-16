import { app, BrowserWindow, dialog, shell } from "electron";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let serverPort = 0;
let serverStarted = false;

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

function waitForServer(port, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        resolve();
      });
      req.on("error", () => {
        if (attempts >= maxAttempts) {
          reject(new Error("Server did not start in time"));
        } else {
          setTimeout(check, 500);
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts >= maxAttempts) {
          reject(new Error("Server did not start in time"));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

async function startServer() {
  serverPort = await findFreePort();

  process.env.PORT = String(serverPort);
  process.env.NODE_ENV = "production";
  process.env.USER_DATA_PATH = app.getPath("userData");

  const serverPath = path.join(__dirname, "..", "dist", "index.cjs");
  await import(pathToFileURL(serverPath).href);

  await waitForServer(serverPort);
  serverStarted = true;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "CubeMap to HDRI Converter",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

app.on("ready", async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error("Failed to start:", err);
    app.quit();
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
