// Alerts on a closed app (Web Push). The phone or computer registers with Apple, Google, Mozilla or Microsoft
// using the public key of the team's Apps Script (apps-script/notifications.js), and its address is kept in
// abonnements/<id> with a secret token. The script then sends an empty alert; sw.js fetches the text with that token.
(function (root) {
  const CACHE = "presta-alertes";
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
  const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  const sameKey = (sub, b64) => { try { return hex(sub.options.applicationServerKey) === hex(keyBytes(b64)); } catch { return false; } };
  function deviceName() {
    const ua = navigator.userAgent;
    return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "PC Windows" : /Mac/.test(ua) ? "Mac" : "Navigateur";
  }
  function token() {
    let t = "";
    try { t = localStorage.getItem("suivi.alertes.jeton") || ""; } catch {}
    if (!/^[a-f0-9]{32}$/.test(t)) {
      t = hex(crypto.getRandomValues(new Uint8Array(16)));
      try { localStorage.setItem("suivi.alertes.jeton", t); } catch {}
    }
    return t;
  }

  // store: SuiviStore ; account: {role, prestataireId} ; email. listen(fn) is called whenever the state changes.
  function create({ store, account, email }) {
    let settings = null;
    let state = "loading";
    const listeners = new Set();
    const set = (s) => { state = s; listeners.forEach((fn) => fn(s)); };

    // "off": no alert script yet · "install": iPhone, must be added to the home screen first · "unsupported"
    // "blocked": refused in the phone settings · "ask": can be turned on · "on": alerts arrive on this device
    async function refresh({ silent = true } = {}) {
      if (!settings?.url || !settings?.cle) return set("off");
      if (!supported()) return set(isIos() && !installed() ? "install" : "unsupported");
      if (Notification.permission === "denied") return set("blocked");
      if (Notification.permission !== "granted") return set("ask");
      try { await subscribe(); set("on"); }
      catch { set(silent ? "ask" : "error"); }
    }
    async function subscribe() {
      const reg = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, settings.cle)) { await sub.unsubscribe().catch(() => {}); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(settings.cle) });
      const jeton = token();
      const id = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint))).slice(0, 40);
      const saved = `${id}|${jeton}|${email}|${settings.cle}|${new Date().toISOString().slice(0, 7)}`; // re-saved each month
      let known = "";
      try { known = localStorage.getItem("suivi.alertes.ok") || ""; } catch {}
      // What sw.js needs to fetch the text of an alert.
      const cache = await caches.open(CACHE);
      await cache.put("./__alertes", new Response(JSON.stringify({ url: settings.url, jeton })));
      if (known === saved) return false;
      const now = new Date().toISOString();
      await store.saveDevice(id, {
        email, role: account.role, ...(account.role === "prestataire" ? { prestataireId: account.prestataireId } : {}),
        endpoint: sub.endpoint, jeton, appareil: deviceName(), createdAt: now, updatedAt: now,
      });
      try { localStorage.setItem("suivi.alertes.ok", saved); } catch {}
      return true;
    }
    // Button "Activer les alertes": asks the permission, registers, and asks the script for a test alert.
    async function activate() {
      if (!settings?.url) return set("off");
      const answer = await Notification.requestPermission();
      if (answer !== "granted") return set(answer === "denied" ? "blocked" : "ask");
      try {
        await subscribe();
        set("on");
        fetch(settings.url + "?action=test&jeton=" + token(), { mode: "no-cors" }).catch(() => {});
      } catch { set("error"); }
    }
    // After a save: the script looks at once instead of at its next 5-minute round.
    let timer = null;
    function ping() {
      if (!settings?.url) return;
      clearTimeout(timer);
      timer = setTimeout(() => fetch(settings.url + "?action=verifier", { mode: "no-cors" }).catch(() => {}), 1500);
    }
    async function load() {
      settings = await store.getAlertSettings();
      await refresh();
    }
    // A tap on an alert while the app is open: go to the right page.
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "ouvrir" && typeof e.data.hash === "string") location.hash = e.data.hash;
    });
    store.onChange(ping);
    load();
    return { activate, ping, reload: load, listen: (fn) => listeners.add(fn), get state() { return state; }, get settings() { return settings; } };
  }

  // What to show for each state (provider card and team button share the words).
  const TEXTS = {
    install: "Sur iPhone : touche Partager puis « Sur l'écran d'accueil », puis ouvre l'appli depuis son icône pour activer les alertes.",
    unsupported: "Ce navigateur ne reçoit pas les alertes. Ouvre l'appli avec Chrome, Safari ou Edge.",
    blocked: "Alertes bloquées sur cet appareil : Réglages du téléphone › Notifications › Presta, puis « Autoriser ».",
    error: "L'activation n'a pas marché. Vérifie ta connexion et réessaie.",
  };
  root.SuiviAlertes = { create, TEXTS };
})(typeof self !== "undefined" ? self : this);
