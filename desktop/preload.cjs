const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response.ok) throw new Error(response.error);
  return response.value;
};
contextBridge.exposeInMainWorld('port', {
  state: () => invoke('app:state'), choose: kind => invoke('input:choose', kind),
  analyze: id => invoke('analysis:start', id), extract: (id, entry) => invoke('analysis:extract', id, entry),
  report: id => invoke('report:get', id), decompile: (id, artifact) => invoke('analysis:decompile', id, artifact),
  functions: (id, artifact) => invoke('analysis:functions', id, artifact),
  export: id => invoke('report:export', id), folder: id => invoke('report:folder', id),
  runCode: id => invoke('code:run', id), exportCode: id => invoke('code:export', id),
  coverage: id => invoke('code:coverage', id), exportFolder: id => invoke('code:folder', id),
  chooseTool: key => invoke('tools:choose', key), installTools: () => invoke('tools:install'),
  limit: number => invoke('tools:limit', number), cancel: () => invoke('task:cancel'), help: key => invoke('help:open', key),
  onProgress: callback => { const listener = (_, value) => callback(value); ipcRenderer.on('task:progress', listener); return () => ipcRenderer.removeListener('task:progress', listener); },
  onFinished: callback => { const listener = () => callback(); ipcRenderer.on('task:finished', listener); return () => ipcRenderer.removeListener('task:finished', listener); },
});
