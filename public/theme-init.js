// apply theme before first paint (an external file, so the CSP needs no 'unsafe-inline' for scripts)
try {
  var t = localStorage.getItem('relay-theme');
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  if (t === 'dark') document.querySelector('meta[name=theme-color]').content = '#0D0C10';
} catch (e) {}
