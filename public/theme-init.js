// Applies the saved theme before first paint. ThemeToggle only adds the "dark" class from a React
// effect, i.e. after the page has already painted white, so dark-mode users saw a light flash on
// every reload. Same key/value as ThemeToggle.
//
// This is a separate same-origin file (loaded synchronously from <head>) rather than an inline
// <script> because vercel.json's Content-Security-Policy is `script-src 'self'`, which blocks
// inline scripts.
try {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.classList.add('dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#090e1b');
  }
} catch (e) {}
