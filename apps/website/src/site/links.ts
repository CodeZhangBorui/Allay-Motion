// 官网上的外部链接：只有 GitHub。下载也指向仓库本身（不写不存在的安装包地址和版本号）。
export const REPO_URL = 'https://github.com/Mystic-Stars/Allay-Motion';
export const LICENSE_NAME = 'GPL-3.0';

export interface Developer {
  name: string;
  url?: string;
}

export const DEVELOPERS: readonly Developer[] = [
  { name: 'Mystic-Stars', url: 'https://github.com/Mystic-Stars' },
  { name: '风花叶', url: 'https://github.com/khiqwq' },
  { name: 'Claude' },
];

/** 页内各节的锚点 */
export const SECTION = {
  try: 'try',
  templates: 'templates',
  features: 'features',
  workflow: 'workflow',
  open: 'open-source',
} as const;
