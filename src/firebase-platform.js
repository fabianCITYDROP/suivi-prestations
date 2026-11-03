// Stand-alone hosting (GitHub Pages): gives the page the same `window.claude.use(...)` services
// it has inside claude.ai, backed by Firebase. The Firestore compat API (doc, collection,
// onSnapshot, set, update, delete) is the one store.js already speaks.
(function () {
  const config = window.SUIVI_FIREBASE_CONFIG;
  if (!config || !config.apiKey || !window.firebase) return;
  firebase.initializeApp(config);
  const auth = firebase.auth();

  // Each person has their own Firebase account (e-mail + password); the browser stays signed in.
  function signedIn() {
    return new Promise((resolve) => {
      const stop = auth.onAuthStateChanged((user) => {
        if (user) { stop(); resolve(user); addSignOut(user); return; }
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
        <p class="hint">Connecte-toi avec ton adresse et ton mot de passe. C'est demandé une seule fois sur cet ordinateur.</p>
        <label class="field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" required></label>
        <p class="login-error" hidden>Adresse ou mot de passe incorrect.</p>
        <button class="primary big" type="submit">Ouvrir</button>
      </form>`;
    document.body.append(box);
    box.querySelector("input").focus();
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      try {
        await auth.signInWithEmailAndPassword(form.email.value.trim(), form.password.value);
        box.remove();
      } catch { box.querySelector(".login-error").hidden = false; }
    });
  }

  // The account line lives at the top of Réglages, so the header stays on one line.
  function addSignOut(user) {
    const settings = document.getElementById("view-reglages");
    if (!settings || document.getElementById("account")) return;
    const bar = Object.assign(document.createElement("div"), { id: "account", className: "account" });
    bar.innerHTML = `<span>Connecté en tant que <b></b></span><button type="button" class="ghost">Se déconnecter</button>`;
    bar.querySelector("b").textContent = user.email || "";
    bar.querySelector("button").onclick = () => auth.signOut().then(() => location.reload());
    settings.prepend(bar);
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
