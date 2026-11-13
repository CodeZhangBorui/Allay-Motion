// 主进程的资源层（docs/03-assets.md 3.2–3.5）。不依赖 Electron 和 IPC，M2b 接线时从这里取。
export { MAX_ENTRY_BYTES, openZip, ZipRejectedError, type ZipArchive } from './zip';
export { scanDirectory, type DirectoryIndex } from './directory';
export { BUILTIN_LAYER_ID, openBuiltinLayer, openFolderPack, openZipPack, type ClosableLayer } from './layers';
export { importZipPack, packZipPath, PACKS_DIR, type ImportedZipPack } from './pack-import';
export {
  candidateGameDirs,
  detectMinecraft,
  findLatestRelease,
  openVanillaLayer,
  VANILLA_LAYER_ID,
  type CandidateEnv,
  type VanillaInstall,
  type VanillaLayerOptions,
} from './vanilla';
export {
  checkMojangUrl,
  chooseVanillaSource,
  createVanillaDownloader,
  DEFAULT_LIMITS,
  DownloadError,
  MOJANG_HOSTS,
  VERSION_MANIFEST_URL,
  type CachedVanilla,
  type DownloadLimits,
  type DownloadProgress,
  type DownloaderOptions,
  type VanillaChoice,
  type VanillaDownloader,
  type VanillaPreference,
} from './download';
