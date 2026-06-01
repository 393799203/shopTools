import { ElectronAPI } from '@electron/remote/main'

declare global {
  interface Window {
    electronAPI: {
      getServerPort: () => Promise<number>
      openFolderDialog: () => Promise<{
        canceled: boolean
        filePaths: string[]
      }>
      getDeviceMac: () => Promise<string>
    }
  }
}

export {}
