const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  getDeviceMac: () => ipcRenderer.invoke('get-device-mac')
})
