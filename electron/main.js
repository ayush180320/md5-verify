const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 500,
    title: "MD5 Verify — Media Integrity Tool",
    backgroundColor: "#0f0f11",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,   // allows file:// Web Workers (WASM hashing)
    },
  });

  win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.setMenuBarVisibility(false);

  // Open any link that tries to open a new window in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
