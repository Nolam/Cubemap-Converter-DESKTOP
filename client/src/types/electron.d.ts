declare const __APP_VERSION__: string;

interface ElectronAPI {
  selectSavePath: (defaultName: string, ext: string) => Promise<string | null>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
