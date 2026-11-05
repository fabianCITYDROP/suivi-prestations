// Stand-alone hosting (GitHub Pages): gives the page the same `window.claude.use(...)` services
// it has inside claude.ai, backed by Firebase. The Firestore compat API (doc, collection,
// onSnapshot, set, update, delete) is the one store.js already speaks.
(function () {
  const config = window.SUIVI_FIREBASE_CONFIG;
  if (!config || !config.apiKey || !window.firebase) return;
  firebase.initializeApp(config);
  window.SUIVI_MAX_PHOTO_CHARS = 950000; // Firestore documents can hold up to 1 MiB: photos keep much more detail.
  const auth = firebase.auth();

  // Each person has their own Firebase account (e-mail + password); the browser stays signed in.
  function signedIn() {
    return new Promise((resolve) => {
      const stop = auth.onAuthStateChanged((user) => {
        if (user) { stop(); resolve(user); showSignOut(user); return; }
        showLogin();
      });
    });
  }
  function showLogin() {
    if (document.getElementById("login")) return;
    const box = document.createElement("div");
    box.id = "login";
    box.innerHTML = `<form class="panel login-card">
        <img src="assets/logo-full.svg" alt="" width="64" height="64" style="display:block;border-radius:14px">
        <h2>City-Drop × Presta</h2>
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

  // Power button, always at the right of the header. A first tap asks « Se déconnecter ? »,
  // a second tap within 4 s signs out: no accidental sign-out on a phone.
  function showSignOut(user) {
    const button = document.getElementById("signOutBtn");
    if (!button) return;
    let disarm = null;
    button.title = `Se déconnecter (${user.email || ""})`;
    button.hidden = false;
    button.onclick = () => {
      if (button.classList.contains("armed")) { auth.signOut().then(() => location.reload()); return; }
      button.classList.add("armed");
      clearTimeout(disarm);
      disarm = setTimeout(() => button.classList.remove("armed"), 4000);
    };
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
      if (name === "user") return { can: async () => true, email: auth.currentUser?.email || "" };
      throw new Error("unknown service " + name);
    },
  };
})();
