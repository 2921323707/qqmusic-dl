const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld(
  'qqdlDesktopLyrics',
  Object.freeze({
    open: (state) => ipcRenderer.invoke('desktop-lyrics:open', state),
    update: (state) => ipcRenderer.send('desktop-lyrics:update', state),
    close: () => ipcRenderer.invoke('desktop-lyrics:close'),
    onClosed: (callback) => subscribe('desktop-lyrics:closed', callback),
    onSeek: (callback) => subscribe('desktop-lyrics:seek', callback),
  }),
);

contextBridge.exposeInMainWorld(
  'qqdlDesktopSettings',
  Object.freeze({
    chooseDownloadDirectory: (currentPath) =>
      ipcRenderer.invoke('settings:choose-download-directory', currentPath),
  }),
);
