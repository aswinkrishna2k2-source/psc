// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var theme;
  try {
    theme = localStorage.getItem('psc.theme');
  } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;

  // Added from script so a slow mobile connection never blocks the first paint on font CSS.
  var fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href =
    'https://fonts.googleapis.com/css2?family=Anek+Latin:wght@400..700&family=Anek+Malayalam:wght@400..700&family=Anek+Tamil:wght@400..700&family=Anek+Kannada:wght@400..700&display=swap';
  document.head.appendChild(fonts);
})();
