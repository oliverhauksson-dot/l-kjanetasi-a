/* Google Analytics 4: counts visits, and which games get played.
   Put the site's measurement ID (it starts with G-) below. While it is still the placeholder, nothing is loaded or sent.
   No analytics cookies are set until the visitor accepts cookies: in our own popup (js/consent.js), or in Google's
   consent message for the EEA, UK and Switzerland. Until then GA only gets anonymous, cookie-free pings. */
(() => {
  const GA_ID = 'G-XXXXXXXXXX';
  window.track = () => {};
  if (GA_ID === 'G-XXXXXXXXXX') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  const ASK_FIRST = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  const consent = (yes) => {
    const v = yes ? 'granted' : 'denied';
    return { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v };
  };
  let choice = null;
  try { choice = localStorage.getItem('pa-cookies'); } catch (e) {}
  gtag('consent', 'default', Object.assign({ region: ASK_FIRST, wait_for_update: 500 }, consent(false)));
  gtag('consent', 'default', consent(choice === 'yes'));
  document.addEventListener('pa-cookies', (e) => gtag('consent', 'update', consent(e.detail === 'yes')));
  gtag('js', new Date());
  gtag('config', GA_ID);

  window.track = (name, params) => gtag('event', name, params || {});

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
})();
