const { app, BrowserWindow, dialog, shell } = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_PORT = 5173;
const MAX_PORT = 5199;

let mainWindow = null;
let serverHandle = null;

function getAppRoot() {
  return path.resolve(__dirname, "..");
}

function copyDefaultConfig() {
  const sourceDir = path.join(getAppRoot(), "config");
  const targetDir = path.join(app.getPath("userData"), "config");

  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(sourceDir)) return;

  for (const fileName of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(targetDir, fileName);
    if (!fs.statSync(sourcePath).isFile() || fs.existsSync(targetPath)) continue;
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}

async function findPort() {
  for (let port = DEFAULT_PORT; port <= MAX_PORT; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`Không còn port trống trong khoảng ${DEFAULT_PORT}-${MAX_PORT}.`);
}

async function startLocalServer() {
  const appRoot = getAppRoot();
  const port = await findPort();

  process.env.FF_TOOLS_APP_ROOT = appRoot;
  process.env.FF_TOOLS_DATA_DIR = app.getPath("userData");
  process.env.PORT = String(port);

  copyDefaultConfig();

  const serverModule = require(path.join(appRoot, "dist", "server", "src", "server.js"));
  return serverModule.startServer(port);
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: "#11151d",
    title: "FF Tools Overlay",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  void mainWindow.loadURL(`http://localhost:${port}/control`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    serverHandle = await startLocalServer();
    createWindow(serverHandle.port);
  } catch (error) {
    dialog.showErrorBox("FF Tools Overlay", error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) createWindow(serverHandle.port);
  });
});

app.on("before-quit", () => {
  if (serverHandle) void serverHandle.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
