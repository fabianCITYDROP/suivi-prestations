// Stand-alone hosting (GitHub Pages): gives the page the same `window.claude.use(...)` services
// it has inside claude.ai, backed by Firebase. The Firestore compat API (doc, collection,
// onSnapshot, set, update, delete) is the one store.js already speaks.
(function () {
  const config = window.SUIVI_FIREBASE_CONFIG;
  if (!config || !config.apiKey || !window.firebase) return;
  firebase.initializeApp(config);
  const auth = firebase.auth();

  // One shared team account: the page asks for the password once, then the browser remembers it.
  function signedIn() {
    return new Promise((resolve) => {
      const stop = auth.onAuthStateChanged((user) => {
        if (user) { stop(); resolve(user); return; }
        showLogin();
      });
    });
  }
  function showLogin() {
    if (document.getElementById("login")) return;
    const box = document.createElement("div");
    box.id = "login";
    box.innerHTML = `<form class="panel login-card">
        <h2>Suivi prestations</h2>
        <p class="hint">Entre le mot de passe de l'équipe. Il est demandé une seule fois sur cet ordinateur.</p>
        <label class="field"><span>Mot de passe</span><input type="password" autocomplete="current-password" required></label>
        <p class="login-error" hidden>Mot de passe incorrect.</p>
        <button class="primary big" type="submit">Ouvrir</button>
      </form>`;
    document.body.append(box);
    box.querySelector("input").focus();
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const password = box.querySelector("input").value;
      try {
        await auth.signInWithEmailAndPassword(config.teamEmail, password);
        box.remove();
      } catch { box.querySelector(".login-error").hidden = false; }
    });
  }

  const ready = signedIn();
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
  window.claude = {
    async use(name) {
      await ready;
      if (name === "db") return firebase.firestore();
      if (name === "downloads") return downloads;
      if (name === "user") return { can: async () => true };
      throw new Error("unknown service " + name);
    },
  };
})();
