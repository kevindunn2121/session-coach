export const MAP_FILE = 'playbook-line-map.html'

export const TRANSPARENCY_FILE = 'playbook-transparency.html'

export const GUIDE_FILE = 'session-coach-guide.html'

export type SitePage = 'guide' | 'map' | 'transparency'

const PAGES: { page: SitePage; file: string; label: string }[] = [
  { page: 'guide', file: GUIDE_FILE, label: 'Guide' },
  { page: 'map', file: MAP_FILE, label: 'Line map' },
  { page: 'transparency', file: TRANSPARENCY_FILE, label: 'How it was built' },
]

/* The menu every session-coach page shares. Pages default to dark; the theme button's choice carries to the other pages. */
export const NAV_STYLE = `
.site-nav { --nav-bg: #151f29; --nav-ink: #e5ecf2; --nav-muted: #9aa9b7; --nav-rule: #2a3946; --nav-accent: #a98ae6;
  position: sticky; top: 0; z-index: 50; background: var(--nav-bg); color: var(--nav-ink); border-bottom: 1px solid var(--nav-rule);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace; font-size: 0.82rem; }
:root[data-theme="light"] .site-nav { --nav-bg: #ffffff; --nav-ink: #15212c; --nav-muted: #566573; --nav-rule: #cfd6dd; --nav-accent: #6d4fa3; }
.site-nav-in { max-width: var(--site-nav-max, 1080px); margin: 0 auto; padding: 8px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.site-nav-brand { font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--nav-muted); margin-right: auto; }
.site-nav-links { display: flex; flex-wrap: wrap; gap: 4px; }
.site-nav a, .site-nav button { color: var(--nav-ink); text-decoration: none; min-height: 36px; padding: 6px 12px; border-radius: 999px;
  display: inline-flex; align-items: center; border: 1px solid transparent; background: none; font: inherit; cursor: pointer; }
.site-nav a:hover, .site-nav button:hover { border-color: var(--nav-rule); }
.site-nav a[aria-current="page"] { border-color: var(--nav-accent); color: var(--nav-accent); font-weight: 600; }
.site-nav button { border-color: var(--nav-rule); color: var(--nav-muted); }
.site-nav a:focus-visible, .site-nav button:focus-visible { outline: 3px solid var(--nav-accent); outline-offset: 2px; }
@media (max-width: 600px) { .site-nav-brand { flex-basis: 100%; } .site-nav a, .site-nav button { padding: 6px 9px; } }
`

export const NAV_SCRIPT = `
(function () {
  var root = document.documentElement, key = 'session-coach-theme', button = document.getElementById('navTheme');
  try { var saved = localStorage.getItem(key); if (saved === 'light' || saved === 'dark') root.dataset.theme = saved; } catch (e) {}
  var label = function () { if (button) button.textContent = root.dataset.theme === 'light' ? 'Dark' : 'Light'; };
  new MutationObserver(function () {
    label();
    try { localStorage.setItem(key, root.dataset.theme); } catch (e) {}
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (button) button.addEventListener('click', function () {
    var own = document.getElementById('tg');
    if (own) own.click();
    else root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  });
  label();
})();
`

export const siteNav = (current: SitePage): string => {
  const links = PAGES.map(({ page, file, label }) => `<a href="${file}"${page === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')
  return `<nav class="site-nav" aria-label="session-coach pages"><div class="site-nav-in"><span class="site-nav-brand">session-coach</span><div class="site-nav-links">${links}</div><button type="button" class="site-nav-theme" id="navTheme" aria-label="Switch color theme">Light</button></div></nav>
<script>${NAV_SCRIPT}</script>`
}
