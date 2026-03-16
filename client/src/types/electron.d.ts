interface ElectronAPI {
  selectSavePath: (defaultName: string, ext: string) => Promise<string | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
