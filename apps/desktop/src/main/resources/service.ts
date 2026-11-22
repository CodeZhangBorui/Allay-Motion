// 主进程的资源栈服务（docs/03-assets.md 3.2–3.5、01-product-architecture.md 1.8 的 resources 命名空间）。
// 持有各层、按设置组装资源栈、算 resourceStamp，栈一变就通知渲染进程。不依赖 Electron：对话框由调用方传入。
import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import {
  buildStack,
  compareVersionsDesc,
  deriveSoundName,
  fnv1a64,
  formatToString,
  knownResourceFormat,
  mergeLangTables,
  packCompat,
  parseLangJson,
  releasesForFormat,
  soundCategory,
  vanillaBase,
  vanillaLayerId,
  versionType,
  type LangTable,
  type PackFormat,
  type PackFormatRange,
  type VanillaSource,
  computeResourceStamp,
  expandSoundEvent,
  layersWith,
  listMerged,
  mergeSoundDefinitions,
  parseFontJson,
  parseResourceId,
  parseSoundsJson,
  readResource,
  resolveFontProviders,
  SOUND_EVENTS,
  soundNameToPaths,
  soundsJsonPath,
  textureIdToPath,
  textureMetaPath,
  type ResourceLayer,
  type ResourceStackSettings,
  type SoundDefinitions,
  type UnihexOverride,
  type UnihexTables,
} from '@allay/assets';
import type {
  AddPackResult,
  BrokenPack,
  ChooseGameDirResult,
  DownloadErrorKind,
  DownloadResult,
  DownloadState,
  FontProvidersResult,
  LayerInfo,
  ResourceState,
  ImportSoundsResult,
  LocalPackFolderInfo,
  RemoteVersionsResult,
  SoundFileState,
  SoundFilesResult,
  SoundLibrary,
  SoundLibraryEvent,
  SoundVariantInfo,
  VanillaSourceArg,
  VanillaSourceProblem,
  VanillaState,
  VersionCatalog,
  VersionEntry,
} from '../../shared/resources';
import type { Logger } from '../logger';
import type { SettingsStore } from '../settings-store';
import { chooseVanillaSource, DownloadError, type CachedVanilla, type VanillaDownloader } from './download';
import { DownloadTracker } from './download-progress';
import { IMPORTED_LAYER_ID, importedRoot, importSoundFiles, readImportedNames, removeImportedSound } from './imported-sounds';
import { BUILTIN_LAYER_ID, openBuiltinLayer, openFolderPack, openZipPack, type ClosableLayer } from './layers';
import { discoverLocalPackFolders } from './local-packs';
import { loadUnihexTables, UnihexCache } from './fonts';
import { importZipPack, packZipPath } from './pack-import';
import {
  candidateGameDirs,
  detectMinecraft,
  findLatestRelease,
  checkClientJar,
  knownJarProblem,
  listVersions,
  NotClientJarError,
  openVanillaLayer,
  VANILLA_LAYER_ID,
  type CandidateEnv,
  type VanillaInstall,
  type VanillaLayerExtras,
} from './vanilla';
import { ZipRejectedError } from './zip';

export interface ResourceServiceOptions {
  userDataDir: string;
  /** 内置层的目录（v1 没有自制素材，通常不存在，见 decisions.md M2a） */
  builtinDir: string;
  settings: SettingsStore;
  log: Logger;
  gameEnv: CandidateEnv;
  downloader: VanillaDownloader;
  onChanged(state: ResourceState): void;
  /**
   * 下载原版资源时一并取回哪些音效事件。不给时只取基础表 SOUND_EVENTS；应用里给的是
   * “基础表 ∪ 内置模板 manifest 里的默认音效和预设音效”（shared/template-sounds.ts）。
   * 只决定同一次用户触发的下载里取哪些对象：不新增联网的时机，对象仍只经 download.ts 从白名单主机取。
   */
  prefetchSounds?(): Promise<readonly string[]> | readonly string[];
}

/** 资源索引里中文语言文件的键（虚拟路径是 assets/ 加上它） */
const ZH_LANG_KEY = 'minecraft/lang/zh_cn.json';
const LANG_PATHS = { 'zh-CN': `assets/${ZH_LANG_KEY}`, en: 'assets/minecraft/lang/en_us.json' } as const;

/** 下载进度最多每 100 ms 通知一次 */
const PROGRESS_INTERVAL_MS = 100;

function downloadErrorKind(error: unknown): DownloadErrorKind {
  if (error instanceof DownloadError) {
    if (error.code === 'hash' || error.code === 'size' || error.code === 'bad-data') return 'verify';
    if (error.code === 'aborted') return 'unknown';
    return 'network';
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'disk';
  return 'unknown';
}

function sameInstall(a: VanillaInstall | null | undefined, b: VanillaInstall | null | undefined): boolean {
  return a?.jarPath === b?.jarPath && a?.versionId === b?.versionId;
}

type VanillaLayer = ClosableLayer & VanillaLayerExtras;

/** 原版来源的层 id 都以 vanilla 开头（旧的单一原版层是 vanilla，新的是 vanilla:local:… / vanilla:dl:…） */
function isVanillaId(id: string): boolean {
  return id === VANILLA_LAYER_ID || id.startsWith('vanilla:');
}

const samePath = (a: string, b: string) => (process.platform === 'win32' ? resolvePath(a).toLowerCase() === resolvePath(b).toLowerCase() : resolvePath(a) === resolvePath(b));

function formatRangeText(r: PackFormatRange | null | undefined): { min: string; max: string } | null {
  if (!r) return null;
  const max = r.max.minor === Number.MAX_SAFE_INTEGER ? formatToString({ major: r.max.major, minor: 0 }) : formatToString(r.max);
  return { min: formatToString(r.min), max };
}

export class ResourceService {
  private builtin: ClosableLayer | null = null;
  /** 打开的原版来源：设置里的来源 id → 层和它对应的安装（2026-11 反馈：多个原版来源共存） */
  private readonly vanillaLayers = new Map<string, { layer: VanillaLayer; install: VanillaInstall }>();
  /** 本机探测到的最新正式版（首次发现的对话框、“使用本机的 Minecraft”按钮用） */
  private local: VanillaInstall | null = null;
  /** 本机候选游戏目录里所有带 jar 的版本 */
  private localVersions: VanillaInstall[] = [];
  private cached: CachedVanilla | null = null;
  private cachedList: CachedVanilla[] = [];
  private vanillaProblem: VanillaState['problem'] = null;
  private missingSources: VanillaState['missingSources'] = [];
  /** 本次运行里从 Mojang 版本清单取到的版本（用户点了“获取版本列表”之后才有） */
  private remoteVersions: { latest: string; versions: { id: string; type: string; releaseTime: string }[] } | null = null;
  /** 导入的音效（资源栈最上面一层，空的时候不放进栈） */
  private imported: ClosableLayer | null = null;
  /** 上一次探测到的本机资源包路径：addLocalPack 只接受这里面的 */
  private discoveredPackPaths = new Set<string>();
  private readonly packs = new Map<string, ClosableLayer>();
  private broken: BrokenPack[] = [];
  private stack: ResourceLayer[] = [];
  private stamp = '';
  private detecting = true;
  private download: DownloadState = { status: 'idle' };
  private downloadAbort: AbortController | null = null;
  private lastProgress = 0;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  /** 改栈的操作串行执行，避免交错 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ResourceServiceOptions) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private get settings(): ResourceStackSettings {
    return this.opts.settings.resources;
  }

  private async saveSettings(next: ResourceStackSettings): Promise<void> {
    await this.opts.settings.updateResources(next);
  }

  /** 启动：先打开内置层和资源包（不需要探测），再在后台离线探测原版层（3.4） */
  private opened: Promise<void> | null = null;

  /** 内置层和资源包已经打开（state() 才有意义） */
  whenOpened(): Promise<void> {
    return this.opened ?? Promise.resolve();
  }

  async init(): Promise<void> {
    this.opened = this.serial(async () => {
      this.builtin = await openBuiltinLayer(this.opts.builtinDir);
      await this.openPacks();
      await this.openImported();
      this.rebuild();
    });
    await this.opened;
    void this.serial(async () => {
      await this.detectVanilla();
      this.detecting = false;
      this.rebuild();
    });
  }

  // ---- 状态 ----

  /** 生效的原版基底的格式号：jar 里的 version.json，读不到时查对照表 */
  private baseFormat(): { layer: ResourceLayer; format: PackFormat | null } | null {
    const base = vanillaBase(this.stack);
    if (!base) return null;
    const v = this.vanillaLayers.get(base.id)?.layer.vanilla;
    return { layer: base, format: v?.resourceFormat ?? knownResourceFormat(base.name) };
  }

  state(): ResourceState {
    const base = this.baseFormat();
    const baseKind = base ? (base.layer.id.startsWith('vanilla:dl:') ? 'cached' : 'local') : null;
    const vanilla: VanillaState = {
      consent: this.settings.vanilla.consent,
      enabled: this.settings.vanillaSources.length > 0 ? this.settings.vanillaSources.some((v) => v.enabled) : this.settings.vanilla.enabled,
      local: this.local ? { versionId: this.local.versionId, gameDir: this.local.gameDir, ...(this.local.gameVersion ? { gameVersion: this.local.gameVersion } : {}) } : null,
      cached: this.cached ? { versionId: this.cached.versionId } : null,
      active: baseKind,
      problem: this.vanillaProblem,
      baseId: base?.layer.id ?? null,
      baseVersion: base?.layer.name ?? null,
      missingSources: [...this.missingSources],
    };
    const layers: LayerInfo[] = this.stack.map((l) => {
      const info: LayerInfo = { id: l.id, kind: l.kind, name: l.name, enabled: l.enabled, legacyFormat: l.legacyFormat === true, warnings: [...(l.warnings ?? [])].slice(0, 20) };
      if (l.description !== undefined) info.description = l.description;
      if (l.packFormat !== undefined) info.packFormat = l.packFormat;
      if (l.icon) info.icon = l.icon;
      if (l.kind === 'vanilla') {
        const v = this.vanillaLayers.get(l.id)?.layer.vanilla;
        info.source = l.id.startsWith('vanilla:dl:') ? 'downloaded' : 'local';
        // versionId 是来源的标识（本机的是目录名），name 是真实的游戏版本
        info.versionId = v?.versionId ?? l.name;
        info.base = base?.layer.id === l.id;
        if (v) {
          if (info.source === 'local') info.gameDir = v.gameDir;
          if (v.gameVersion) info.gameVersion = v.gameVersion;
          info.hasAssetIndex = v.hasAssetIndex;
        }
        const fmt = v?.resourceFormat ?? knownResourceFormat(l.name);
        if (fmt) info.resourceFormat = formatToString(fmt);
      }
      if (l.kind === 'pack') {
        if (l.id === IMPORTED_LAYER_ID) info.source = 'imported';
        else {
          const entry = this.settings.packs.find((p) => p.id === l.id);
          info.source = entry?.source.kind ?? 'zip';
          if (entry && entry.source.kind !== 'zip') info.path = entry.source.path;
          const formats = this.packs.get(l.id)?.formats ?? null;
          info.formats = formatRangeText(formats);
          info.madeFor = formats ? releasesForFormat(formats.min) : null;
          info.compat = packCompat(formats, base?.format ?? null);
        }
      }
      if (l.kind === 'builtin') info.empty = l.revision === 'empty' || l.list('').length === 0;
      return info;
    });
    const hasAssets = this.stack.some((l) => l.kind !== 'builtin' && l.id !== IMPORTED_LAYER_ID && l.enabled) || layers.some((l) => l.kind === 'builtin' && !l.empty);
    return { stamp: this.stamp, layers, brokenPacks: [...this.broken], vanilla, download: this.download, detecting: this.detecting, hasAssets };
  }

  get resourceStamp(): string {
    return this.stamp;
  }

  private emit(): void {
    this.opts.onChanged(this.state());
  }

  private rebuild(): void {
    if (!this.builtin) return;
    const vanilla = new Map<string, ResourceLayer>([...this.vanillaLayers].map(([id, v]) => [id, v.layer]));
    const stack = buildStack(this.builtin, vanilla, this.packs, this.settings);
    // 导入的音效在最上面（命名空间 allay_user 是自有的，放哪一层都不会覆盖别人的文件）
    if (this.imported && this.imported.list('assets/').length > 0) stack.push(this.imported);
    this.stack = stack;
    this.stamp = computeResourceStamp(this.stack);
    this.emit();
  }

  // ---- 原版层（可以有多个，2026-11 反馈）----

  /** 本机候选游戏目录：用户手动选过的、官方启动器的默认目录、已登记的本机原版来源所在的目录 */
  private gameDirs(): string[] {
    const dirs = candidateGameDirs(this.opts.gameEnv, this.settings.vanilla.dir);
    for (const v of this.settings.vanillaSources) {
      if (v.source.kind !== 'local') continue;
      const dir = v.source.gameDir;
      if (!dirs.some((d) => samePath(d, dir))) dirs.push(dir);
    }
    return dirs;
  }

  /** 离线：探测本机游戏和下载缓存，按设置打开各个原版来源（不联网） */
  private async detectVanilla(): Promise<void> {
    this.local = await detectMinecraft(this.opts.gameEnv, this.settings.vanilla.dir).catch((error: unknown) => {
      this.opts.log.warn('resources', 'minecraft detection failed', { error });
      return null;
    });
    const all: VanillaInstall[] = [];
    for (const dir of this.gameDirs()) all.push(...(await listVersions(dir).catch(() => [])));
    this.localVersions = all;
    this.cachedList = await this.opts.downloader.listCached().catch(() => []);
    this.cached = this.cachedList[0] ?? null;
    this.opts.log.info('resources', 'vanilla sources', { local: this.local?.versionId ?? null, localVersions: all.length, cached: this.cachedList.map((c) => c.versionId) });
    await this.migrateVanilla();
    await this.applyVanilla();
  }

  /**
   * 旧设置只有“同意 + 开关”，原版层在本机和下载缓存里二选一（chooseVanillaSource）。同意过、还没有来源列表时，
   * 按旧规则选出来的那一个登记成第一条来源，开关沿用旧的；之后就按列表走。
   */
  private async migrateVanilla(): Promise<void> {
    const st = this.settings;
    if (st.vanilla.consent !== true || st.vanillaSources.length > 0) return;
    const choice = chooseVanillaSource(this.local, this.cached);
    if (!choice.install) return;
    const source: VanillaSource =
      choice.status === 'cached' ? { kind: 'downloaded', versionId: choice.install.versionId } : { kind: 'local', gameDir: choice.install.gameDir, versionId: choice.install.versionId };
    await this.saveSettings({ ...st, vanillaSources: [{ id: vanillaLayerId(source), source, enabled: st.vanilla.enabled }] });
  }

  private findInstall(source: VanillaSource): VanillaInstall | null {
    if (source.kind === 'downloaded') return this.cachedList.find((c) => c.versionId === source.versionId) ?? null;
    return this.localVersions.find((v) => v.versionId === source.versionId && samePath(v.gameDir, source.gameDir)) ?? null;
  }

  /**
   * 按设置里的来源列表打开、关闭原版层（3.4：用不了的静默退回）。用不了的来源各自记进 missingSources，带原因：
   * 找不到（missing）、jar 打不开（unreadable，另外记 jar-unreadable）、jar 不是完整的原版客户端（not-client）
   */
  private async applyVanilla(): Promise<void> {
    const wanted = new Map(this.settings.vanillaSources.map((v) => [v.id, v]));
    for (const [id, open] of this.vanillaLayers) {
      const entry = wanted.get(id);
      if (!entry || !sameInstall(this.findInstall(entry.source), open.install)) {
        open.layer.close();
        this.vanillaLayers.delete(id);
      }
    }
    this.vanillaProblem = null;
    this.missingSources = [];
    for (const entry of this.settings.vanillaSources) {
      if (this.vanillaLayers.has(entry.id)) continue;
      const install = this.findInstall(entry.source);
      const unusable = (problem: VanillaSourceProblem) =>
        this.missingSources.push({ id: entry.id, versionId: entry.source.versionId, kind: entry.source.kind, ...(entry.source.kind === 'local' ? { gameDir: entry.source.gameDir } : {}), problem });
      if (!install) {
        unusable('missing');
        continue;
      }
      try {
        // 下载缓存的原版层不传 fetchObject：读到还没取回的对象只是空，不联网（decisions.md M2b、M6b）
        const layer = await openVanillaLayer(install, { id: entry.id });
        this.vanillaLayers.set(entry.id, { layer, install });
      } catch (error) {
        if (error instanceof NotClientJarError) {
          this.opts.log.warn('resources', 'vanilla jar is not a full client', { jar: install.jarPath });
          unusable('not-client');
        } else {
          this.opts.log.warn('resources', 'vanilla jar unreadable', { jar: install.jarPath, error });
          unusable('unreadable');
          this.vanillaProblem = 'jar-unreadable';
        }
      }
    }
    // 同意过、登记过来源，却一个都打不开（游戏被移动或卸载）：提示一次（3.4）；全是 jar 不完整的，单独说
    const consented = this.settings.vanilla.consent === true;
    if (!this.vanillaProblem && consented && this.settings.vanillaSources.length > 0 && this.vanillaLayers.size === 0) {
      this.vanillaProblem = this.missingSources.length > 0 && this.missingSources.every((m) => m.problem === 'not-client') ? 'not-client' : 'missing';
    }
    if (!this.vanillaProblem && consented && this.settings.vanillaSources.length === 0 && this.settings.vanilla.enabled && !this.local && !this.cached) this.vanillaProblem = 'missing';
  }

  detectMinecraft(): Promise<ResourceState> {
    return this.serial(async () => {
      await this.detectVanilla();
      this.rebuild();
      return this.state();
    });
  }

  /** 把一个来源加到原版层的最上面（成为新的基底）；已经登记过就移到最上面并打开 */
  private async putVanillaOnTop(source: VanillaSource, dir?: string): Promise<void> {
    const id = vanillaLayerId(source);
    const rest = this.settings.vanillaSources.filter((v) => v.id !== id);
    await this.saveSettings({
      ...this.settings,
      vanilla: { ...this.settings.vanilla, consent: true, enabled: true, ...(dir ? { dir } : {}) },
      vanillaSources: [...rest, { id, source, enabled: true }],
    });
  }

  setVanilla(patch: { consent?: boolean; enabled?: boolean }): Promise<ResourceState> {
    return this.serial(async () => {
      let next: ResourceStackSettings = { ...this.settings, vanilla: { ...this.settings.vanilla, ...patch } };
      const enabled = patch.enabled;
      if (enabled !== undefined) next = { ...next, vanillaSources: next.vanillaSources.map((v) => ({ ...v, enabled })) };
      // 不同意：撤掉全部原版来源（与旧行为一致：资源栈里不再有原版层）
      if (patch.consent === false) next = { ...next, vanillaSources: [] };
      await this.saveSettings(next);
      // 同意（首次发现的对话框、“使用本机的 Minecraft …”）：还没有任何原版来源时，按旧规则在本机和下载缓存里取较新的那个
      if (patch.consent === true && this.settings.vanillaSources.length === 0) {
        const choice = chooseVanillaSource(this.local, this.cached);
        if (choice.install) {
          const v = choice.install;
          await this.putVanillaOnTop(choice.status === 'cached' ? { kind: 'downloaded', versionId: v.versionId } : { kind: 'local', gameDir: v.gameDir, versionId: v.versionId });
        }
      }
      await this.applyVanilla();
      this.rebuild();
      return this.state();
    });
  }

  /** 用户在主进程的对话框里选了一个游戏目录：其中最新的正式版加到最上面 */
  useGameDir(dir: string): Promise<ChooseGameDirResult> {
    return this.serial(async () => {
      const install = await findLatestRelease(dir);
      if (!install) return { ok: false, error: 'no-release' } as const;
      this.local = install;
      this.localVersions = [...this.localVersions.filter((v) => !samePath(v.gameDir, dir)), ...(await listVersions(dir))];
      await this.putVanillaOnTop({ kind: 'local', gameDir: dir, versionId: install.versionId }, dir);
      await this.applyVanilla();
      this.rebuild();
      return { ok: true } as const;
    });
  }

  /**
   * 从版本列表里加一个原版来源（本机的或已下载的）；不在探测结果里的不加。
   * jar 不是完整的原版客户端、或者打不开的也不加：版本列表上这一行会标出原因（versions() 的 problem）
   */
  addVanillaSource(arg: VanillaSourceArg): Promise<ResourceState> {
    return this.serial(async () => {
      const source: VanillaSource = arg.kind === 'local' ? { kind: 'local', gameDir: arg.gameDir, versionId: arg.versionId } : { kind: 'downloaded', versionId: arg.versionId };
      const install = this.findInstall(source);
      if (!install) return this.state();
      const jar = await checkClientJar(install.jarPath);
      if (jar !== 'client') {
        this.opts.log.warn('resources', 'vanilla jar not usable, not added', { jar: install.jarPath, check: jar });
        return this.state();
      }
      await this.putVanillaOnTop(source);
      await this.applyVanilla();
      this.rebuild();
      return this.state();
    });
  }

  private registered(layerId: string): string | null {
    return this.settings.vanillaSources.some((s) => s.id === layerId) ? layerId : null;
  }

  /** 版本检索（3.12）：本机、已下载、（取过的话）Mojang 版本清单，各自新的在前。离线 */
  versions(): VersionCatalog {
    const local: VersionEntry[] = this.localVersions
      .map((v) => {
        const problem = knownJarProblem(v.jarPath);
        return {
          versionId: v.versionId,
          ...(v.gameVersion ? { gameVersion: v.gameVersion } : {}),
          type: versionType(v.type ?? 'release'),
          releaseTime: v.releaseTime,
          gameDir: v.gameDir,
          layerId: this.registered(vanillaLayerId({ kind: 'local', gameDir: v.gameDir, versionId: v.versionId })),
          ...(problem ? { problem } : {}),
        };
      })
      .sort(compareVersionsDesc);
    const downloaded: VersionEntry[] = this.cachedList
      .map((v) => ({ versionId: v.versionId, type: versionType(v.type ?? 'release'), releaseTime: v.releaseTime, layerId: this.registered(vanillaLayerId({ kind: 'downloaded', versionId: v.versionId })) }))
      .sort(compareVersionsDesc);
    const remote = this.remoteVersions
      ? {
          latest: this.remoteVersions.latest,
          versions: this.remoteVersions.versions
            .map((v) => ({ versionId: v.id, type: versionType(v.type), releaseTime: v.releaseTime, layerId: this.registered(vanillaLayerId({ kind: 'downloaded', versionId: v.id })) }))
            .sort(compareVersionsDesc),
        }
      : null;
    return { local, downloaded, remote };
  }

  /** 联网（用户点了“获取版本列表”）：只取 Mojang 版本清单，不下载游戏文件（沿用 M2a 下载例外的边界） */
  async fetchRemoteVersions(): Promise<RemoteVersionsResult> {
    try {
      this.remoteVersions = await this.opts.downloader.listRemoteVersions();
      return { ok: true, catalog: this.versions() };
    } catch (error) {
      const kind = downloadErrorKind(error);
      this.opts.log.warn('resources', 'version manifest failed', { kind, error });
      return { ok: false, error: kind };
    }
  }

  /**
   * 联网：只在用户点了“下载原版资源”之后调用（decisions.md M2a 的联网例外）。
   * 进度按五个阶段和字节数上报（DownloadTracker，docs/decisions.md 界面增强）：取版本清单 → 下载客户端 jar →
   * 提取资源（资源索引、读 jar 的条目目录）→ 取常用音效 → 建立资源栈。失败、取消时记下停在哪一步，重试从头再走一遍
   * （已下载且校验通过的文件不重复下载）。
   */
  async downloadVanilla(versionId?: string): Promise<DownloadResult> {
    if (this.downloadAbort) return { ok: false, error: 'busy' };
    const abort = new AbortController();
    this.downloadAbort = abort;
    const tracker = new DownloadTracker();
    const publish = (force: boolean) => {
      this.download = { status: 'running', progress: tracker.snapshot() };
      const now = Date.now();
      if (force || now - this.lastProgress >= PROGRESS_INTERVAL_MS) {
        this.lastProgress = now;
        this.emit();
      } else {
        // 节流掉的这一次在间隔结束时补发，免得下载停住时界面停在旧的进度上
        this.progressTimer ??= setTimeout(() => {
          this.progressTimer = null;
          this.lastProgress = Date.now();
          if (this.download.status === 'running') {
            this.download = { status: 'running', progress: tracker.snapshot() };
            this.emit();
          }
        }, PROGRESS_INTERVAL_MS);
      }
    };
    const onProgress = (p: unknown) => {
      const before = tracker.stage;
      if (!tracker.event(p)) {
        this.opts.log.warn('resources', 'malformed download progress ignored', { progress: p });
        return;
      }
      publish(tracker.stage !== before);
    };
    const step = (stage: Parameters<DownloadTracker['enter']>[0], activity: Parameters<DownloadTracker['enter']>[1]) => {
      tracker.enter(stage, activity);
      publish(true);
    };
    publish(true);
    try {
      const cached = await this.opts.downloader.downloadLatest({ signal: abort.signal, onProgress, ...(versionId ? { versionId } : {}) });
      // 提取资源：读 jar 的条目目录（jar 整体保留、不解包），打不开的 jar 在这里就报出来
      step('extract', 'scan');
      const probe = await openVanillaLayer(cached);
      probe.close();
      if (abort.signal.aborted) throw new DownloadError('已取消', 'aborted');
      // 同一次下载里取回音效事件用到的对象（decisions.md M6b）：之后不再按需联网
      step('sounds', 'sounds-list');
      // 中文语言文件一并取回：音效的中文名从它的字幕推出（2026-11 反馈）
      const soundIds = await this.prefetchSoundIds();
      const sounds = await this.opts.downloader.fetchSoundObjects(cached, soundIds, { signal: abort.signal, onProgress, extraKeys: [ZH_LANG_KEY] });
      this.opts.log.info('resources', 'vanilla downloaded', { version: cached.versionId, soundEvents: soundIds.length, soundObjects: sounds.fetched, soundsMissing: sounds.missing.slice(0, 20) });
      step('finalize', 'stack');
      await this.serial(async () => {
        this.cachedList = [cached, ...this.cachedList.filter((c) => c.versionId !== cached.versionId)].sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime));
        this.cached = this.cachedList[0] ?? cached;
        // 下载的这一版加到原版层最上面，成为新的基底；之前的来源都留着（2026-11 反馈）
        await this.putVanillaOnTop({ kind: 'downloaded', versionId: cached.versionId });
        await this.applyVanilla();
        tracker.complete();
        this.download = { status: 'done', progress: tracker.snapshot() };
        this.rebuild();
      });
      return { ok: true };
    } catch (error) {
      if (abort.signal.aborted) {
        this.opts.log.info('resources', 'vanilla download canceled', { stage: tracker.stage });
        tracker.stop('canceled');
        this.download = { status: 'canceled', progress: tracker.snapshot() };
        this.emit();
        return { canceled: true };
      }
      const kind = downloadErrorKind(error);
      this.opts.log.warn('resources', 'vanilla download failed', { kind, stage: tracker.stage, error });
      tracker.stop('failed');
      this.download = { status: 'failed', error: kind, progress: tracker.snapshot() };
      this.emit();
      return { ok: false, error: kind };
    } finally {
      this.downloadAbort = null;
      if (this.progressTimer) clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
  }

  cancelDownload(): void {
    this.downloadAbort?.abort();
  }

  // ---- 资源包 ----

  private async openPacks(): Promise<void> {
    for (const l of this.packs.values()) l.close();
    this.packs.clear();
    this.broken = [];
    for (const p of this.settings.packs) {
      try {
        const layer = await this.openPack(p.id, p.name, p.source);
        this.packs.set(p.id, layer);
      } catch (error) {
        const problem: BrokenPack['problem'] = error instanceof ZipRejectedError ? 'rejected' : (error as { code?: string }).code === 'ENOENT' ? 'missing' : 'unreadable';
        this.opts.log.warn('resources', 'pack unavailable', { id: p.id, problem });
        this.broken.push({ id: p.id, name: p.name, problem });
      }
    }
  }

  private async openPack(id: string, name: string, source: ResourceStackSettings['packs'][number]['source']): Promise<ClosableLayer> {
    if (source.kind === 'zip') {
      const file = packZipPath(this.opts.userDataDir, source.file);
      if (!file) throw new ZipRejectedError('bad pack file name');
      return openZipPack(file, id, name);
    }
    if (source.kind === 'linked') return openZipPack(source.path, id, name);
    const layer = await openFolderPack(source.path, id);
    return { ...layer, name };
  }

  // ---- 本机 Minecraft 的资源包文件夹（2026-11 反馈）----

  /** 离线：探测本机启动器的 resourcepacks 文件夹，带每个包和原版基底的匹配 */
  async localPacks(): Promise<LocalPackFolderInfo[]> {
    await this.whenOpened();
    const folders = await discoverLocalPackFolders(this.opts.gameEnv, this.gameDirs());
    const base = this.baseFormat()?.format ?? null;
    const paths = new Set<string>();
    const out = folders.map((f) => ({
      ...f,
      packs: f.packs.map((p) => {
        paths.add(resolvePath(p.path));
        return {
          name: p.name,
          path: p.path,
          kind: p.kind,
          ...(p.description ? { description: p.description } : {}),
          formats: formatRangeText(p.formats),
          madeFor: p.formats ? releasesForFormat(p.formats.min) : null,
          compat: packCompat(p.formats, base),
          added: this.settings.packs.some((e) => e.source.kind !== 'zip' && samePath(e.source.path, p.path)),
        };
      }),
    }));
    this.discoveredPackPaths = paths;
    return out;
  }

  /** 把探测到的本机资源包加进资源栈：文件夹按文件夹包，zip 原地只读引用（不复制）。不在上次探测结果里的拒绝 */
  addLocalPack(path: string): Promise<AddPackResult> {
    return this.serial(async () => {
      const abs = resolvePath(path);
      if (!this.discoveredPackPaths.has(abs)) return { ok: false, error: 'unsupported' } as const;
      const existing = this.settings.packs.find((e) => e.source.kind !== 'zip' && samePath(e.source.path, abs));
      if (existing) return { ok: true, id: existing.id, warnings: [] } as const;
      const st = await stat(abs).catch(() => null);
      if (!st) return { ok: false, error: 'unreadable' } as const;
      const isZip = st.isFile() && extname(abs).toLowerCase() === '.zip';
      if (!isZip && !st.isDirectory()) return { ok: false, error: 'unsupported' } as const;
      const id = isZip ? `linked:${fnv1a64(abs.toLowerCase())}` : `folder:${randomUUID()}`;
      const name = basename(abs).replace(/\.zip$/i, '');
      let layer: ClosableLayer;
      try {
        layer = isZip ? await openZipPack(abs, id, name) : { ...(await openFolderPack(abs, id)), name };
      } catch (error) {
        if (error instanceof ZipRejectedError) return { ok: false, error: 'rejected', detail: error.message.slice(0, 200) } as const;
        return { ok: false, error: 'unreadable' } as const;
      }
      this.packs.set(id, layer);
      const entry: ResourceStackSettings['packs'][number] = { id, name, source: isZip ? { kind: 'linked', path: abs } : { kind: 'folder', path: abs }, enabled: true };
      await this.saveSettings({ ...this.settings, packs: [...this.settings.packs, entry] });
      this.rebuild();
      return { ok: true, id, warnings: [...(layer.warnings ?? [])].slice(0, 20) } as const;
    });
  }

  // ---- 导入的音效（2026-11 反馈）----

  private importedNames: Record<string, string> = {};

  private async openImported(): Promise<void> {
    this.imported?.close();
    this.imported = null;
    const root = importedRoot(this.opts.userDataDir);
    if (!(await stat(root).catch(() => null))?.isDirectory()) return;
    try {
      this.imported = { ...(await openFolderPack(root, IMPORTED_LAYER_ID)), name: 'imported' };
      this.importedNames = await readImportedNames(root);
    } catch (error) {
      this.opts.log.warn('resources', 'imported sounds unreadable', { error });
    }
  }

  /** 导入音效文件（路径来自主进程的文件对话框） */
  importSounds(paths: readonly string[]): Promise<ImportSoundsResult> {
    return this.serial(async () => {
      const { ids, skipped } = await importSoundFiles(importedRoot(this.opts.userDataDir), paths);
      if (ids.length === 0) return { ok: false, error: 'unsupported' } as const;
      await this.openImported();
      this.rebuild();
      return { ok: true, ids, skipped } as const;
    });
  }

  removeImportedSound(eventId: string): Promise<ResourceState> {
    return this.serial(async () => {
      if (await removeImportedSound(importedRoot(this.opts.userDataDir), eventId)) {
        await this.openImported();
        this.rebuild();
      }
      return this.state();
    });
  }

  /** 添加 zip 或文件夹形式的资源包（路径来自主进程的对话框或拖放） */
  addPackFromPath(path: string): Promise<AddPackResult> {
    return this.serial(async () => {
      const st = await stat(path).catch(() => null);
      if (!st) return { ok: false, error: 'unreadable' } as const;
      let entry: ResourceStackSettings['packs'][number];
      let layer: ClosableLayer;
      if (st.isDirectory()) {
        const id = `folder:${randomUUID()}`;
        const name = basename(path);
        try {
          layer = await openFolderPack(path, id);
        } catch (error) {
          this.opts.log.warn('resources', 'folder pack unreadable', { error });
          return { ok: false, error: 'unreadable' } as const;
        }
        layer = { ...layer, name };
        entry = { id, name, source: { kind: 'folder', path }, enabled: true };
      } else if (st.isFile() && extname(path).toLowerCase() === '.zip') {
        let imported;
        try {
          imported = await importZipPack(path, this.opts.userDataDir);
        } catch (error) {
          if (error instanceof ZipRejectedError) {
            this.opts.log.warn('resources', 'zip pack rejected', { reason: error.message });
            return { ok: false, error: 'rejected', detail: error.message.slice(0, 200) } as const;
          }
          this.opts.log.warn('resources', 'zip pack unreadable', { error });
          return { ok: false, error: 'unreadable' } as const;
        }
        const id = `zip:${imported.sha256.slice(0, 16)}`;
        const existing = this.settings.packs.find((p) => p.id === id);
        if (existing) return { ok: true, id, warnings: [] } as const;
        const name = basename(path).replace(/\.zip$/i, '');
        layer = await openZipPack(imported.path, id, name);
        entry = { id, name, source: { kind: 'zip', file: imported.file }, enabled: true };
      } else {
        return { ok: false, error: 'unsupported' } as const;
      }
      this.packs.set(entry.id, layer);
      // 新包放在最上面
      await this.saveSettings({ ...this.settings, packs: [...this.settings.packs, entry] });
      this.rebuild();
      return { ok: true, id: entry.id, warnings: [...(layer.warnings ?? [])].slice(0, 20) } as const;
    });
  }

  removeLayer(id: string): Promise<ResourceState> {
    return this.serial(async () => {
      if (isVanillaId(id)) {
        // 旧的 id（vanilla）撤掉全部；新的只撤这一个，撤完了就当作不再使用原版素材
        const rest = id === VANILLA_LAYER_ID ? [] : this.settings.vanillaSources.filter((v) => v.id !== id);
        await this.saveSettings({ ...this.settings, vanilla: { ...this.settings.vanilla, consent: rest.length > 0 ? this.settings.vanilla.consent : false }, vanillaSources: rest });
        await this.applyVanilla();
      } else {
        const entry = this.settings.packs.find((p) => p.id === id);
        if (!entry) return this.state();
        this.packs.get(id)?.close();
        this.packs.delete(id);
        this.broken = this.broken.filter((b) => b.id !== id);
        const packs = this.settings.packs.filter((p) => p.id !== id);
        await this.saveSettings({ ...this.settings, packs });
        // 应用数据目录里的 zip 副本没人用了就删掉
        if (entry.source.kind === 'zip' && !packs.some((p) => p.source.kind === 'zip' && p.source.file === (entry.source as { file: string }).file)) {
          const file = packZipPath(this.opts.userDataDir, entry.source.file);
          if (file) await rm(file, { force: true }).catch(() => undefined);
        }
      }
      this.rebuild();
      return this.state();
    });
  }

  /**
   * 新顺序（从下往上）。资源包和原版来源各排各的（原版层整体在资源包之下）：列表里的资源包 id 决定资源包的顺序，
   * 原版来源的 id 决定原版层之间的顺序；没列出的保持原来的相对顺序放在各自的最上面。
   */
  reorder(idsBottomToTop: readonly string[]): Promise<ResourceState> {
    return this.serial(async () => {
      const rank = new Map(idsBottomToTop.map((id, i) => [id, i]));
      const order = <T extends { id: string }>(list: readonly T[]) => [...list.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!), ...list.filter((p) => !rank.has(p.id))];
      await this.saveSettings({ ...this.settings, packs: order(this.settings.packs), vanillaSources: order(this.settings.vanillaSources) });
      await this.applyVanilla();
      this.rebuild();
      return this.state();
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<ResourceState> {
    if (id === VANILLA_LAYER_ID) return this.setVanilla({ enabled });
    return this.serial(async () => {
      if (id === BUILTIN_LAYER_ID) return this.state();
      await this.saveSettings({
        ...this.settings,
        packs: this.settings.packs.map((p) => (p.id === id ? { ...p, enabled } : p)),
        vanillaSources: this.settings.vanillaSources.map((v) => (v.id === id ? { ...v, enabled } : v)),
      });
      this.rebuild();
      return this.state();
    });
  }

  /** 窗口重新获得焦点时重扫文件夹形式的资源包（3.5）；内容有变化才通知 */
  rescanFolders(): Promise<void> {
    return this.serial(async () => {
      let changed = false;
      for (const p of this.settings.packs) {
        if (p.source.kind === 'linked') {
          // 原地引用的 zip：大小或修改时间变了才重新打开
          const old = this.packs.get(p.id);
          const st = await stat(p.source.path).catch(() => null);
          const rev = st ? `${st.size}:${Math.round(st.mtimeMs)}` : null;
          if (rev === (old?.revision ?? null)) continue;
          old?.close();
          this.packs.delete(p.id);
          this.broken = this.broken.filter((b) => b.id !== p.id);
          try {
            this.packs.set(p.id, await this.openPack(p.id, p.name, p.source));
          } catch {
            this.broken.push({ id: p.id, name: p.name, problem: st ? 'unreadable' : 'missing' });
          }
          changed = true;
          continue;
        }
        if (p.source.kind !== 'folder') continue;
        const old = this.packs.get(p.id);
        try {
          const layer = { ...(await openFolderPack(p.source.path, p.id)), name: p.name };
          if (!old || old.revision !== layer.revision) {
            this.packs.set(p.id, layer);
            this.broken = this.broken.filter((b) => b.id !== p.id);
            changed = true;
          }
        } catch {
          if (old) {
            this.packs.delete(p.id);
            this.broken = [...this.broken.filter((b) => b.id !== p.id), { id: p.id, name: p.name, problem: 'missing' }];
            changed = true;
          }
        }
      }
      if (changed) this.rebuild();
    });
  }

  // ---- 读取（渲染进程经 IPC 调用；路径已经过 isSafeRelativePath 校验） ----

  async read(path: string): Promise<Uint8Array | null> {
    return (await readResource(this.stack, path))?.data ?? null;
  }

  /** 贴图 PNG 和与它来自同一层的 .mcmeta（游戏的规则：元数据跟着胜出的那张图走） */
  async readTexture(id: string): Promise<{ png: Uint8Array; mcmeta: string | null } | null> {
    const path = textureIdToPath(id);
    if (!path) return null;
    const stack = this.stack;
    for (let i = stack.length - 1; i >= 0; i--) {
      const layer = stack[i];
      if (!layer?.enabled || !layer.has(path)) continue;
      const png = await layer.read(path).catch(() => null);
      if (!png) continue;
      const metaPath = textureMetaPath(path);
      const meta = layer.has(metaPath) ? await layer.read(metaPath).catch(() => null) : null;
      return { png, mcmeta: meta && meta.byteLength <= 65_536 ? new TextDecoder().decode(meta) : null };
    }
    return null;
  }

  list(prefix: string): string[] {
    return listMerged(this.stack, prefix).slice(0, 10_000);
  }

  /** 资源栈里的字体定义（3.9）：各层合并、展开 reference；没有任何层提供时为 null */
  async fontProviders(fontId: string): Promise<FontProvidersResult | null> {
    const stack = this.stack;
    let found = false;
    const { providers, skipped } = await resolveFontProviders(fontId, async (path) => {
      const layers = layersWith(stack, path);
      if (layers.length === 0) return null;
      found = true;
      const out = [];
      for (const layer of layers) {
        const bytes = await layer.read(path).catch(() => null);
        if (bytes && bytes.byteLength <= 4 * 1024 * 1024) out.push(parseFontJson(new TextDecoder().decode(bytes)));
      }
      return out;
    });
    if (!found) return null;
    return {
      providers: providers.map((p) =>
        p.type === 'bitmap'
          ? { type: 'bitmap', file: p.file, ascent: p.ascent, height: p.height, rows: p.rows }
          : p.type === 'unihex'
            ? { type: 'unihex', file: p.file, overrides: p.overrides }
            : { type: 'space', advances: [...p.advances.entries()] },
      ),
      skipped,
    };
  }

  /** unihex 提供器的字形表（fonts.ts）：从资源栈读 zip、解析 .hex，按 stamp 缓存 */
  private readonly unihex = new UnihexCache();
  unihexTables(file: string, overrides: readonly UnihexOverride[]): Promise<UnihexTables | null> {
    return this.unihex.get(this.stamp, file, overrides, () => loadUnihexTables((path) => this.read(path), file, overrides));
  }

  /** 合并后的 sounds.json，按 (stamp, 命名空间) 缓存；另记原版层自己定义了哪些事件（判断“被资源包改过”用） */
  private soundDefs: { stamp: string; byNamespace: Map<string, Promise<{ defs: SoundDefinitions; vanillaIds: Set<string> }>> } = { stamp: '', byNamespace: new Map() };

  private soundDefinitionsWithOrigin(namespace: string): Promise<{ defs: SoundDefinitions; vanillaIds: Set<string> }> {
    if (this.soundDefs.stamp !== this.stamp) this.soundDefs = { stamp: this.stamp, byNamespace: new Map() };
    let p = this.soundDefs.byNamespace.get(namespace);
    if (!p) {
      const stack = this.stack;
      p = (async () => {
        const path = soundsJsonPath(namespace);
        // layersWith 从上到下；合并要从下往上（3.8、decisions.md M2a）
        const sources = [];
        const vanillaIds = new Set<string>();
        for (const layer of layersWith(stack, path).reverse()) {
          const bytes = await layer.read(path).catch(() => null);
          if (!bytes || bytes.byteLength > 4 * 1024 * 1024) continue;
          const parsed = parseSoundsJson(new TextDecoder().decode(bytes), namespace);
          if (layer.kind === 'vanilla') for (const id of parsed.events.keys()) vanillaIds.add(id);
          sources.push({ kind: layer.kind, parsed, layerId: layer.id });
        }
        return { defs: mergeSoundDefinitions(sources), vanillaIds };
      })();
      this.soundDefs.byNamespace.set(namespace, p);
    }
    return p;
  }

  private async soundDefinitions(namespace: string): Promise<SoundDefinitions> {
    return (await this.soundDefinitionsWithOrigin(namespace)).defs;
  }

  /**
   * 音效事件的全部变体（02-engine.md 2.10、03-assets.md 3.8）：资源栈各层的 sounds.json 合并后展开 event 引用。
   * 资源栈里没有这个事件时为 null。不联网：下载缓存的原版层只读已经取回的对象（decisions.md M6b）。
   */
  async soundVariants(eventId: string): Promise<SoundVariantInfo[] | null> {
    const parsed = parseResourceId(eventId);
    if (!parsed) return null;
    const id = `${parsed.namespace}:${parsed.path}`;
    const defs = await this.soundDefinitions(parsed.namespace);
    if (!defs.has(id)) return null;
    const clamp = (v: number) => Math.min(16, Math.max(0, v));
    return expandSoundEvent(defs, id)
      .slice(0, 1024)
      .map((v) => ({ file: v.file, volume: clamp(v.volume), pitch: clamp(v.pitch), weight: Math.min(1_000_000, v.weight), attenuation: Math.min(1024, Math.max(1, v.attenuationDistance)) }));
  }

  /** 下载缓存的原版层里的对象可以按需取（用户试听、选中、导出前确认时）；本机游戏的原版层不按需联网 */
  private fetchableLayer(layer: ResourceLayer): boolean {
    return layer.kind === 'vanilla' && layer.id.startsWith('vanilla:dl:');
  }

  /** 音效名在资源栈里的状态和胜出的层；按 .ogg、.wav 的顺序找 */
  private async soundFileState(file: string): Promise<{ state: SoundFileState; layer?: ResourceLayer; remote?: { hash: string; size: number } }> {
    for (const path of soundNameToPaths(file)) {
      const layer = layersWith(this.stack, path)[0];
      if (!layer) continue;
      const remote = (await (layer as ClosableLayer).remoteObject?.(path)) ?? null;
      if (!remote) return { state: 'local', layer };
      return this.fetchableLayer(layer) ? { state: 'remote', layer, remote } : { state: 'missing', layer };
    }
    return { state: 'missing' };
  }

  /** 语言文件（资源栈各层合并，上层覆盖下层），按 stamp 缓存。下载缓存里还没取回的中文语言文件读不到，不联网 */
  private langCache: { stamp: string; tables: Map<string, Promise<LangTable>> } = { stamp: '', tables: new Map() };

  private lang(locale: keyof typeof LANG_PATHS): Promise<LangTable> {
    if (this.langCache.stamp !== this.stamp) this.langCache = { stamp: this.stamp, tables: new Map() };
    let p = this.langCache.tables.get(locale);
    if (!p) {
      const stack = this.stack;
      p = (async () => {
        const tables: LangTable[] = [];
        for (const layer of layersWith(stack, LANG_PATHS[locale]).reverse()) {
          const bytes = await layer.read(LANG_PATHS[locale]).catch(() => null);
          if (bytes && bytes.byteLength <= 8 * 1024 * 1024) tables.push(parseLangJson(new TextDecoder().decode(bytes)));
        }
        return mergeLangTables(tables);
      })();
      this.langCache.tables.set(locale, p);
    }
    return p;
  }

  /** 下载缓存的原版层里中文语言文件还没取回时取回它（只在用户试听、选中音效时随音效一起取，2026-11 反馈） */
  private async fetchZhLang(): Promise<boolean> {
    const layer = layersWith(this.stack, LANG_PATHS['zh-CN'])[0] as ClosableLayer | undefined;
    if (!layer || !this.fetchableLayer(layer)) return false;
    const remote = await layer.remoteObject?.(LANG_PATHS['zh-CN']);
    if (!remote) return false;
    await this.opts.downloader.fetchObject(remote.hash, remote.size);
    return true;
  }

  private library: Promise<SoundLibrary> | null = null;

  /**
   * 音效选择器的库（decisions.md M6b、2026-11 反馈）：资源栈里每个命名空间的 sounds.json 合并后的全部事件，
   * 带可用状态、来源（原版 / 资源包改过 / 资源包新增 / 导入）、分类和两种语言的显示名。
   * 按 stamp 缓存；按需取回音效对象后重算。没有任何素材层时为空。
   */
  soundLibrary(): Promise<SoundLibrary> {
    const stamp = this.stamp;
    if (this.library) {
      const cached = this.library;
      return cached.then((l) => (l.stamp === stamp ? l : ((this.library = null), this.soundLibrary())));
    }
    const stack = this.stack;
    this.library = (async () => {
      const namespaces = new Set<string>();
      for (const layer of stack) {
        if (!layer.enabled) continue;
        for (const p of layer.list('assets/')) {
          const m = /^assets\/([^/]+)\/sounds\.json$/.exec(p);
          if (m) namespaces.add(m[1]!);
        }
      }
      const [zh, en] = await Promise.all([this.lang('zh-CN'), this.lang('en')]);
      const names = new Map(stack.map((l) => [l.id, l.name]));
      const events: SoundLibraryEvent[] = [];
      const fileStates = new Map<string, { state: SoundFileState; layer?: ResourceLayer }>();
      for (const ns of [...namespaces].sort()) {
        const { defs, vanillaIds } = await this.soundDefinitionsWithOrigin(ns);
        for (const id of [...defs.keys()].sort()) {
          const def = defs.get(id)!;
          const variants = expandSoundEvent(defs, id);
          const states: SoundFileState[] = [];
          const filePacks = new Set<string>();
          for (const v of variants) {
            let s = fileStates.get(v.file);
            if (!s) {
              const r = await this.soundFileState(v.file);
              s = { state: r.state, ...(r.layer ? { layer: r.layer } : {}) };
              fileStates.set(v.file, s);
            }
            states.push(s.state);
            if (s.layer?.kind === 'pack' && s.layer.id !== IMPORTED_LAYER_ID) filePacks.add(s.layer.id);
          }
          const state: SoundFileState = states.length === 0 || states.every((s) => s === 'missing') ? 'missing' : states.includes('remote') ? 'remote' : 'local';
          const definers = def.definedBy.filter((l) => l !== IMPORTED_LAYER_ID && !isVanillaId(l) && l !== BUILTIN_LAYER_ID);
          const packIds = [...new Set([...definers, ...filePacks])];
          // 名字：最上面的在前
          const packNames = stack
            .filter((l) => packIds.includes(l.id))
            .reverse()
            .map((l) => names.get(l.id) ?? l.id);
          const origin: SoundLibraryEvent['origin'] = def.definedBy.includes(IMPORTED_LAYER_ID)
            ? 'imported'
            : vanillaIds.has(id)
              ? packIds.length > 0
                ? 'overridden'
                : 'vanilla'
              : packIds.length > 0
                ? 'added'
                : 'vanilla';
          const ev: SoundLibraryEvent = { id, state, origin, category: soundCategory(id, variants[0]?.file) };
          if (packNames.length > 0 && (origin === 'overridden' || origin === 'added')) ev.packs = packNames;
          if (origin === 'imported') {
            const slug = id.slice(id.lastIndexOf('.') + 1);
            const file = this.importedNames[slug];
            if (file) ev.names = { 'zh-CN': file, en: file };
          } else {
            const zhName = deriveSoundName(id, def.subtitle, zh, 'zh-CN');
            const enName = deriveSoundName(id, def.subtitle, en, 'en');
            if (zhName || enName) ev.names = { ...(zhName ? { 'zh-CN': zhName } : {}), ...(enName ? { en: enName } : {}) };
          }
          events.push(ev);
        }
      }
      return { stamp, events, lang: { 'zh-CN': zh.size > 0, en: en.size > 0 } };
    })();
    this.library.catch(() => (this.library = null));
    return this.library;
  }

  /**
   * 音效文件的状态；fetch 为真时先把 remote 的取回来（联网，只经 fetchObject：白名单、sha1 和大小校验不变）。
   * 只在用户试听、选中某个音效，或在导出前确认取回时由渲染进程调用；不做后台批量下载（decisions.md M6b）。
   * 取的时候顺带取回还没取的中文语言文件（一个对象，同一主机、同样校验），让音效名能显示中文。
   */
  /** 下载时一并取回的音效事件：基础表总在里面；调用方给的清单取不到（抛错、不是字符串数组）时退回基础表，不让下载失败 */
  private async prefetchSoundIds(): Promise<readonly string[]> {
    if (!this.opts.prefetchSounds) return SOUND_EVENTS;
    try {
      const extra = await this.opts.prefetchSounds();
      const out = new Set<string>(SOUND_EVENTS);
      for (const id of extra) if (typeof id === 'string') out.add(id);
      return [...out];
    } catch (error) {
      this.opts.log.warn('resources', 'prefetch sound list failed; using the base list', { error });
      return SOUND_EVENTS;
    }
  }

  async soundFiles(files: readonly string[], fetch: boolean): Promise<SoundFilesResult> {
    const states: Record<string, SoundFileState> = {};
    let failed: DownloadErrorKind | null = null;
    let fetched = false;
    for (const file of new Set(files)) {
      const s = await this.soundFileState(file);
      if (s.state === 'remote' && fetch && s.remote && !failed) {
        try {
          await this.opts.downloader.fetchObject(s.remote.hash, s.remote.size);
          states[file] = 'local';
          fetched = true;
          continue;
        } catch (e) {
          failed = downloadErrorKind(e);
          this.opts.log.warn('resources', 'sound object fetch failed', { file, kind: failed });
        }
      }
      states[file] = s.state;
    }
    if (fetch && !failed) {
      try {
        if (await this.fetchZhLang()) {
          fetched = true;
          this.langCache = { stamp: '', tables: new Map() };
        }
      } catch (e) {
        this.opts.log.warn('resources', 'zh_cn lang fetch failed', { kind: downloadErrorKind(e) });
      }
    }
    if (fetched) {
      this.library = null;
      this.opts.log.info('resources', 'sound objects fetched on demand', { count: Object.values(states).filter((s) => s === 'local').length });
    }
    return failed ? { ok: false, error: failed, states } : { ok: true, states };
  }

  close(): void {
    this.cancelDownload();
    this.builtin?.close();
    for (const v of this.vanillaLayers.values()) v.layer.close();
    this.imported?.close();
    for (const l of this.packs.values()) l.close();
  }
}
