/* Google Analytics 4: counts visits, and which games get played.
   Put the site's measurement ID (it starts with G-) below. While it is still the placeholder, nothing is loaded or sent.
   Visitors in the EEA, UK and Switzerland start with analytics cookies off until they agree in the cookie message;
   GA then only gets anonymous, cookie-free pings from them. Everyone else is counted normally. */
(() => {
  const GA_ID = 'G-XXXXXXXXXX';
  window.track = () => {};
  if (GA_ID === 'G-XXXXXXXXXX') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  const ASK_FIRST = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB', 'CH'];
  const denied = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
  gtag('consent', 'default', Object.assign({ region: ASK_FIRST, wait_for_update: 500 }, denied));
  gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  gtag('js', new Date());
  gtag('config', GA_ID);

  window.track = (name, params) => gtag('event', name, params || {});

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
})();
