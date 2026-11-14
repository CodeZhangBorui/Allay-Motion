import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// “关于 → 第三方许可”的完整清单（docs/09-compliance.md 9.7–9.9，docs/08-milestones.md M8）。
// 数据是 scripts/third-party.ts 生成并提交的 third-party-licenses.json（单元测试核对它没过期），
// 惰性加载成单独的块，不拖慢启动。同样的内容随安装包附带一份纯文本 THIRD_PARTY_NOTICES.txt。

/** Minecraft 使用准则（9.3：导出的视频里出现 Minecraft 素材时，由用户自己参照）。只显示，不打开浏览器（应用不联网） */
export const GUIDELINES_URL = 'https://www.minecraft.net/usage-guidelines';

/** 商业授权的联系方式（用户决定，2026-11-14）：只写仓库的 Issues，不写任何邮箱。同样只显示、不打开浏览器 */
export const ISSUES_URL = 'https://github.com/Mystic-Stars/Allay-Motion/issues';

interface Entry {
  name: string;
  version: string;
  license: string;
  kind: 'npm' | 'build' | 'runtime' | 'binary' | 'font';
  author: string | null;
  homepage: string | null;
  text: string | null;
  seeFile: string | null;
}

interface ThirdPartyData {
  ffmpeg: { version: string; commit: string; buildRepo: string; buildTag: string; asset: string; sha256: string };
  /** macOS 版随包的 FFmpeg（本项目从官方源码编译，scripts/ffmpeg-macos.ts） */
  ffmpegMacos: { version: string; buildScript: string; sources: { name: string; version: string; url: string; sha256: string }[] };
  entries: Entry[];
}

export function ThirdPartyList() {
  const { t } = useTranslation();
  const [data, setData] = useState<ThirdPartyData | null>(null);
  useEffect(() => {
    let alive = true;
    void import('./third-party-licenses.json').then((m) => {
      if (alive) setData(m.default as ThirdPartyData);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return <p className="text-xs text-fg-subtle">{t('settings.thirdPartyLoading')}</p>;
  const { ffmpeg, ffmpegMacos } = data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-muted select-text" data-testid="about-ffmpeg-source">
        {t('settings.ffmpegSource', { version: ffmpeg.version, repo: ffmpeg.buildRepo, tag: ffmpeg.buildTag, asset: ffmpeg.asset, commit: ffmpeg.commit })}
      </p>
      <p className="text-xs break-all text-fg-muted select-text" data-testid="about-ffmpeg-source-macos">
        {t('settings.ffmpegSourceMacos', {
          version: ffmpegMacos.version,
          script: ffmpegMacos.buildScript,
          sources: ffmpegMacos.sources.map((s) => `${s.name} ${s.version} ${s.url} (SHA-256 ${s.sha256})`).join('; '),
        })}
      </p>
      <p className="text-xs text-fg-muted">{t('settings.noticesFile')}</p>
      <h4 className="text-xs font-semibold text-fg-subtle">{t('settings.thirdPartyAll', { count: data.entries.length })}</h4>
      <ul className="flex flex-col text-xs" data-testid="about-third-party-list">
        {data.entries.map((e) => (
          <li key={`${e.name}@${e.version}`} className="border-b border-divider last:border-b-0">
            <details>
              <summary className="flex cursor-default items-baseline gap-2 py-1">
                <span className="font-medium">{e.name}</span>
                <span className="num text-fg-subtle">{e.version}</span>
                <span className="ml-auto text-fg-muted">{e.license}</span>
              </summary>
              <div className="flex flex-col gap-1 pb-2 text-fg-muted select-text">
                {e.author && <span>{e.author}</span>}
                {e.homepage && <span className="break-all">{e.homepage}</span>}
                {e.seeFile && <span>{t('settings.licenseInFile', { file: e.seeFile })}</span>}
                {e.text ? (
                  <pre className="max-h-48 overflow-auto rounded-sm bg-surface-1 p-2 text-[11px] whitespace-pre-wrap">{e.text}</pre>
                ) : (
                  !e.seeFile && <span>{t('settings.noLicenseFile', { license: e.license })}</span>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
