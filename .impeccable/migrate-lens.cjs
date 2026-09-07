const fs = require('fs');
const path = require('path');
const root = process.cwd();
const targets = fs.readdirSync('frontend/src/components/vane').filter(f => f.endsWith('.tsx')).map(f => `frontend/src/components/vane/${f}`);
targets.push('frontend/src/components/SettingsModal.tsx', 'frontend/src/components/CommandPalette.tsx');
const palette = {
  '#07090e': 'canvas', '#0c1017': 'canvas', '#0d1117': 'canvas',
  '#111620': 'panel', '#121620': 'panel', '#141a24': 'surface',
  '#121824': 'surface', '#161b22': 'panel', '#161f2e': 'hover',
  '#21262d': 'line', '#30363d': 'line-strong',
  '#2dd4bf': 'accent', '#38bdf8': 'accent',
};
for (const file of targets) {
  let src = fs.readFileSync(file, 'utf8');
  for (const [hex, token] of Object.entries(palette)) src = src.replaceAll(`[${hex}]`, token);
  // Brand accents are monochrome. Status colors (success, warning, error) keep their meaning.
  src = src.replace(/\b(sky|blue|cyan|teal|purple|violet)-(200|300|400|500|600)\b/g, 'accent');
  src = src.replace(/bg-accent(\/[0-9]+)? text-white/g, 'bg-accent$1 text-on-accent');
  src = src.replaceAll('bg-line ', 'bg-surface ').replaceAll('hover:bg-line ', 'hover:bg-hover ');
  src = src.replace(/\bshadow-(xl|2xl|lg)\b/g, '').replace(/\bshadow-black\/\d+\b/g, '');
  src = src.replaceAll('backdrop-blur-md', '');
  fs.writeFileSync(path.join(root, file), src);
}

function update(file, fn) { fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8'))); }
update('frontend/src/components/SettingsModal.tsx', s => s
  .replace('className="w-full max-w-4xl h-[620px]', 'role="dialog" aria-modal="true" aria-label={isArabic ? "إعدادات LENS" : "LENS settings"} className="settings-dialog w-full max-w-4xl h-[620px]')
  .replace('className="flex-1 flex overflow-hidden"', 'className="settings-body flex-1 flex overflow-hidden"')
  .replace('className="w-60 bg-canvas border-r', 'className="settings-navigation w-56 bg-canvas border-s')
  .replace('className="space-y-1"', 'className="settings-navigation-items space-y-1"')
  .replace('className="p-3 border-t', 'className="settings-brand-footer p-3 border-t')
  .replace('className="flex-1 flex flex-col bg-canvas', 'className="settings-content flex-1 flex flex-col bg-canvas')
  .replace('onClick={onClose}\n', 'onClick={onClose}\n                aria-label={isArabic ? "إغلاق الإعدادات" : "Close settings"}\n')
  .replace('onClick={onClose}\r\n', 'onClick={onClose}\n                aria-label={isArabic ? "إغلاق الإعدادات" : "Close settings"}\n')
  .replaceAll('Deep Research AI', 'LENS'));
update('frontend/src/components/vane/DiscoverView.tsx', s => s
  .replace(/bg-gradient-to-br from-white\/\[0\.04\] via-white\/\[0\.02\] to-transparent hover:from-white\/\[0\.07\] hover:to-white\/\[0\.02\]/g, 'bg-panel hover:bg-surface')
  .replace(/<div className="absolute top-0 right-0 w-64 h-64[^\n]+\/>/g, ''));
update('frontend/index.html', s => s.replace('/vite.svg', './lens.svg').replace('Deep Research AI | الباحث العميق الذكي', 'LENS — Research, in focus').replace(/<body className=[^>]+>|<body class="[^"]+">/, '<body>'));
update('frontend/electron/main.ts', s => s.replace("title: 'Deep Research AI - Autonomous Agent'", "title: 'LENS — Research, in focus'"));
update('frontend/electron/engine/discover.ts', s => s.replaceAll('كاشف ديب ريسيرش', 'LENS').replaceAll('Kashif Deep Research', 'LENS'));
update('frontend/package.json', s => s.replace('"productName": "Deep Research AI"', '"productName": "LENS"').replace('"shortcutName": "Deep Research AI"', '"shortcutName": "LENS"').replace('Autonomous Deep Research AI Desktop Engine', 'LENS — Research, in focus').replace('Deep Research AI Team', 'LENS Team'));
update('frontend/src/i18n/translations.ts', s => s.replace('app_title: "الباحث العميق الذكي"', 'app_title: "LENS"').replace('app_title: "Deep Research AI"', 'app_title: "LENS"'));
