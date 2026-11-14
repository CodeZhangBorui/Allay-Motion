// 在页面画出来之前定下主题和语言，免得先闪一下深色再变浅色（逻辑与 src/site/prefs.ts 相同）。
(function () {
  var root = document.documentElement;
  var theme = null;
  var lang = null;
  try {
    theme = localStorage.getItem('allay-site-theme');
    lang = localStorage.getItem('allay-site-language');
  } catch {
    /* 读不到就跟随系统 */
  }
  if (theme !== 'dark' && theme !== 'light') theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  if (lang !== 'zh-CN' && lang !== 'en') lang = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh-CN' : 'en';
  root.setAttribute('data-theme', theme);
  root.setAttribute('lang', lang);
  root.setAttribute('data-reduced-motion', String(window.matchMedia('(prefers-reduced-motion: reduce)').matches));
})();
