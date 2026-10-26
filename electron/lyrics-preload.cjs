const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld(
  'qqdlDesktopOverlay',
  Object.freeze({
    ready: () => ipcRenderer.send('desktop-lyrics:ready'),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {};

      const listener = (_event, state) => callback(state);
      ipcRenderer.on('desktop-lyrics:state', listener);
      return () => ipcRenderer.removeListener('desktop-lyrics:state', listener);
    },
    seek: (seconds) => ipcRenderer.send('desktop-lyrics:seek', seconds),
    close: () => ipcRenderer.send('desktop-lyrics:request-close'),
  }),
);
