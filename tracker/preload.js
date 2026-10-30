const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  login: (id, password, remember) => ipcRenderer.invoke('login', { id, password, remember }),
  logout: () => ipcRenderer.invoke('logout'),
  checkIn: () => ipcRenderer.invoke('checkin'),
  checkOut: () => ipcRenderer.invoke('checkout'),
  setBreak: on => ipcRenderer.invoke('break', on),
  startProject: (project, note) => ipcRenderer.invoke('project-start', { project, note }),
  stopProject: () => ipcRenderer.invoke('project-stop'),
  state: () => ipcRenderer.invoke('state'),
  permissions: () => ipcRenderer.invoke('permissions'),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s))
});
