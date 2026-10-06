// Runs before first paint (loaded as an external script so the CSP needs no inline script): applies the saved theme, default dark.
(function () {
  try {
    var t = localStorage.getItem('amx-admin-theme');
    if (t !== 'light' && t !== 'dark') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.style.colorScheme = t;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
