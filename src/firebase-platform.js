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

  function addSignOut(user) {
    const sync = document.getElementById("sync");
    if (!sync || document.getElementById("signOut")) return;
    const button = Object.assign(document.createElement("button"), { id: "signOut", type: "button", className: "ghost small", textContent: "Se déconnecter" });
    button.title = user.email || "";
    button.onclick = () => auth.signOut().then(() => location.reload());
    sync.after(button);
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
