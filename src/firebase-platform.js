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
    box.innerHTML = `<form class="panel login-card" data-view="login">
        <img src="assets/logo-full.svg" alt="" width="64" height="64" style="display:block;border-radius:14px">
        <h2>City-Drop × Presta</h2>
        <p class="hint">Connecte-toi avec ton adresse et ton mot de passe. C'est demandé une seule fois sur cet ordinateur.</p>
        <label class="field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="field"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" required></label>
        <p class="login-error" hidden>Adresse ou mot de passe incorrect.</p>
        <button class="primary big" type="submit">Ouvrir</button>
        <button class="login-link" type="button" data-go="reset">Mot de passe oublié ?</button>
      </form>
      <form class="panel login-card" data-view="reset" hidden>
        <img src="assets/logo-full.svg" alt="" width="64" height="64" style="display:block;border-radius:14px">
        <h2>Mot de passe oublié</h2>
        <p class="hint">Indique ton adresse e-mail. Tu vas recevoir un lien pour choisir un nouveau mot de passe.</p>
        <label class="field"><span>Adresse e-mail</span><input type="email" name="email" autocomplete="username" required></label>
        <p class="login-sent" role="status" hidden>Si cette adresse a un compte, un e-mail vient de partir. Ouvre-le et clique sur le lien (pense à regarder dans les spams). Le lien est valable 1 heure.</p>
        <p class="login-error" hidden></p>
        <button class="primary big" type="submit">Recevoir le lien</button>
        <button class="login-link" type="button" data-go="login">Retour à la connexion</button>
      </form>`;
    document.body.append(box);
    const login = box.querySelector('[data-view="login"]');
    const reset = box.querySelector('[data-view="reset"]');
    const show = (view) => {
      login.hidden = view !== "login"; reset.hidden = view !== "reset";
      const form = view === "login" ? login : reset;
      const other = view === "login" ? reset : login;
      if (!form.email.value) form.email.value = other.email.value; // keep what was typed
      form.querySelectorAll(".login-error, .login-sent").forEach((p) => { p.hidden = true; });
      form.email.focus();
    };
    box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
    login.email.focus();
    login.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await auth.signInWithEmailAndPassword(login.email.value.trim(), login.password.value);
        box.remove();
      } catch { login.querySelector(".login-error").hidden = false; }
    });
    // Same answer whether the address has an account or not: nobody can use this screen to find out who has access.
    // The button stays off for 60 s after each send, so it cannot be used to flood someone's inbox.
    reset.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = reset.querySelector('button[type="submit"]');
      const error = reset.querySelector(".login-error");
      const sent = reset.querySelector(".login-sent");
      const email = reset.email.value.trim();
      button.disabled = true; error.hidden = true; sent.hidden = true;
      auth.languageCode = "fr";
      const back = { url: location.origin + location.pathname };
      let failure = null;
      try {
        await auth.sendPasswordResetEmail(email, back).catch((err) => {
          // A site address missing from Firebase's allowed list: send the e-mail without the « back to the app » link.
          if (err && /continue-uri|unauthorized-domain/.test(err.code || "")) return auth.sendPasswordResetEmail(email);
          throw err;
        });
      } catch (err) { failure = err && err.code; }
      if (failure === "auth/network-request-failed") {
        error.textContent = "Pas de connexion internet. Réessaie dans un instant.";
        error.hidden = false; button.disabled = false; return;
      }
      if (failure === "auth/too-many-requests") {
        error.textContent = "Trop de demandes d'un coup. Réessaie dans quelques minutes.";
        error.hidden = false;
      } else {
        sent.hidden = false; // also for « no such account » or « invalid address »: never say which
      }
      let wait = 60;
      const tick = () => {
        if (wait <= 0) { button.disabled = false; button.textContent = "Renvoyer le lien"; return; }
        button.textContent = `Renvoyer le lien (${wait--} s)`;
        setTimeout(tick, 1000);
      };
      tick();
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
