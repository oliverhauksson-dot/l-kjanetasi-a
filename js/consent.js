/* Cookie consent popup.
   Loaded before the AdSense script on every page. Ads wait until the visitor picks Accept or Only necessary.
   Visitors in Europe get Google's own consent message instead (AdSense > Privacy & messaging), so this popup steps aside when that message shows. */
(function () {
  var KEY = "pa-cookies";
  var ads = (window.adsbygoogle = window.adsbygoogle || []);

  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var choice = read();
  if (choice === "no") ads.requestNonPersonalizedAds = 1;
  if (!choice) ads.pauseAdRequests = 1;

  // Any element with data-cookie-settings (on the privacy page) reopens the choice.
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-cookie-settings]")) {
      try { localStorage.removeItem(KEY); } catch (err) {}
      location.reload();
    }
  });

  if (choice) return;

  function release() { ads.pauseAdRequests = 0; }

  function showBanner() {
    var css = document.createElement("style");
    css.textContent =
      "#cookie-pop{position:fixed;inset:auto 0 0 0;z-index:2147483646;display:grid;place-items:center;padding:16px;background:rgba(10,8,16,.6)}" +
      "#cookie-pop .box{max-width:520px;width:100%;background:var(--panel,#211b31);color:var(--ink,#f4ecdc);border:2px solid var(--line,#3a3052);border-radius:6px;padding:18px;display:grid;gap:12px;font:14px/1.55 var(--body,ui-monospace,monospace);box-shadow:4px 4px 0 #000}" +
      "#cookie-pop h2{margin:0;font:12px/1.4 var(--display,monospace);color:var(--amber,#ffb347)}" +
      "#cookie-pop p{margin:0}#cookie-pop a{color:var(--cyan,#5ce1e6)}" +
      "#cookie-pop .row{display:flex;flex-wrap:wrap;gap:10px}" +
      "#cookie-pop button{font:11px/1 var(--display,monospace);border-radius:4px;padding:12px 14px;cursor:pointer;border:2px solid var(--line,#3a3052);background:transparent;color:var(--ink,#f4ecdc)}" +
      "#cookie-pop button.yes{background:var(--amber,#ffb347);border-color:var(--amber,#ffb347);color:var(--bg,#15111f)}" +
      "#cookie-pop button:focus-visible{outline:3px solid var(--cyan,#5ce1e6);outline-offset:2px}";
    document.head.appendChild(css);

    var root = location.pathname.indexOf("/games/") !== -1 ? "../" : "./";
    var pop = document.createElement("div");
    pop.id = "cookie-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Cookies");
    pop.innerHTML =
      '<div class="box"><h2>COOKIES?</h2>' +
      "<p>Pocket Arcade is free because it shows ads from Google. Ads use cookies. " +
      'Accept to allow personalised ads, or choose only necessary cookies. <a href="' + root + 'privacy.html">Privacy policy</a></p>' +
      '<div class="row"><button class="yes" type="button">ACCEPT</button><button class="no" type="button">ONLY NECESSARY</button></div></div>';
    document.body.appendChild(pop);
    pop.querySelector(".yes").focus({ preventScroll: true });

    pop.addEventListener("click", function (e) {
      var yes = e.target.closest(".yes"), no = e.target.closest(".no");
      if (!yes && !no) return;
      save(yes ? "yes" : "no");
      document.dispatchEvent(new CustomEvent("pa-cookies", { detail: yes ? "yes" : "no" })); // js/stats.js listens for this.
      if (no) ads.requestNonPersonalizedAds = 1;
      pop.remove();
      release();
    });
  }

  // Step aside only when Google's own consent message actually shows (or was already answered).
  // Google only shows it once the site is approved, so until then visitors in Europe get this popup too.
  function waitForGoogle() {
    var done = false;
    function finish(google) {
      if (done) return;
      done = true;
      if (google) release(); else showBanner();
    }
    window.__tcfapi("addEventListener", 2, function (tc, ok) {
      if (ok && tc && (tc.eventStatus === "cmpuishown" || tc.eventStatus === "useractioncomplete" ||
          (tc.eventStatus === "tcloaded" && tc.tcString))) finish(true);
    });
    setTimeout(function () { finish(false); }, 2500);
  }

  function start() {
    var tries = 0;
    (function check() {
      if (typeof window.__tcfapi === "function") {
        window.__tcfapi("ping", 2, function (p) {
          if (p && p.gdprApplies) { waitForGoogle(); } else { showBanner(); }
        });
      } else if (++tries < 15) {
        setTimeout(check, 100);
      } else {
        showBanner();
      }
    })();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
