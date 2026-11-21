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
    // Façon iPhone (21/11/2026) : l'icône de l'appli, une liste groupée de deux lignes, un bouton capsule.
    const logo = (document.querySelector(".brand-logo")?.outerHTML || "").replace('class="brand-logo"', 'class="login-logo"');
    box.innerHTML = `<div class="login-stage">
      <form class="login-card" data-view="login" novalidate>
        <div class="login-hero">${logo}<h1 class="login-title"><b>City-Drop</b> <i>×</i> <em>Presta</em></h1><p class="login-sub">Suivi des prestations du parc</p></div>
        <div class="login-group">
          <label class="login-row"><span>E-mail</span><input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="nom@exemple.fr" required></label>
          <label class="login-row"><span>Mot de passe</span><input type="password" name="password" autocomplete="current-password" placeholder="Ton mot de passe" required></label>
        </div>
        <p class="login-error" role="alert" hidden>Adresse ou mot de passe incorrect.</p>
        <button class="login-btn" type="submit">Se connecter</button>
        <button class="login-link" type="button" data-go="reset">Mot de passe oublié ?</button>
        <p class="login-foot">Demandé une seule fois sur cet appareil.</p>
      </form>
      <form class="login-card" data-view="reset" novalidate hidden>
        <div class="login-hero"><span class="login-tile" data-art="login-mail"></span><h1 class="login-title">Mot de passe oublié</h1><p class="login-sub">Indique ton adresse e-mail. Tu vas recevoir un lien pour choisir un nouveau mot de passe.</p></div>
        <div class="login-group">
          <label class="login-row"><span>E-mail</span><input type="email" name="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="nom@exemple.fr" required></label>
        </div>
        <p class="login-sent" role="status" hidden><span class="login-sent-ico" data-art="ret-fait"></span><span>Si cette adresse a un compte, un e-mail vient de partir. Ouvre-le et clique sur le lien (pense à regarder dans les spams). Le lien est valable 1 heure.</span></p>
        <p class="login-error" role="alert" hidden></p>
        <button class="login-btn" type="submit">Recevoir le lien</button>
        <button class="login-link" type="button" data-go="login"><svg class="icon" aria-hidden="true"><use href="#i-chev-l"/></svg>Retour à la connexion</button>
      </form>
    </div>`;
    box.querySelectorAll("[data-art]").forEach((s) => { s.innerHTML = window.IssueArt?.art(s.dataset.art, "login-art") || ""; });
    document.body.append(box);
    const login = box.querySelector('[data-view="login"]');
    const reset = box.querySelector('[data-view="reset"]');
    const show = (view) => {
      login.hidden = view !== "login"; reset.hidden = view !== "reset";
      const form = view === "login" ? login : reset;
      // Glisse comme une page d'iPhone : vers la gauche en avançant, vers la droite en revenant.
      form.classList.remove("login-fwd", "login-back"); void form.offsetWidth; form.classList.add(view === "reset" ? "login-fwd" : "login-back");
      const other = view === "login" ? reset : login;
      if (!form.email.value) form.email.value = other.email.value; // keep what was typed
      form.querySelectorAll(".login-error, .login-sent").forEach((p) => { p.hidden = true; });
      form.email.focus();
    };
    // Mauvais mot de passe : la liste tremble deux fois, comme sur iPhone (coupé si « réduire les animations »).
    const shake = (form) => { const g = form.querySelector(".login-group"); g.classList.remove("shake"); void g.offsetWidth; g.classList.add("shake"); };
    box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
    login.email.focus();
    login.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = login.querySelector('button[type="submit"]');
      const error = login.querySelector(".login-error");
      if (!login.email.value.trim() || !login.password.value) {
        error.textContent = "Indique ton adresse e-mail et ton mot de passe."; error.hidden = false; shake(login); return;
      }
      button.disabled = true; button.textContent = "Connexion…"; error.hidden = true;
      try {
        await auth.signInWithEmailAndPassword(login.email.value.trim(), login.password.value);
        box.classList.add("login-out");
        setTimeout(() => box.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260);
      } catch (err) {
        error.textContent = err && err.code === "auth/network-request-failed" ? "Pas de connexion internet. Réessaie dans un instant."
          : err && err.code === "auth/too-many-requests" ? "Trop d'essais d'un coup. Réessaie dans quelques minutes." : "Adresse ou mot de passe incorrect.";
        error.hidden = false; shake(login);
        button.disabled = false; button.textContent = "Se connecter";
        login.password.select();
      }
    });
    // Same answer whether the address has an account or not: nobody can use this screen to find out who has access.
    // The button stays off for 60 s after each send, so it cannot be used to flood someone's inbox.
    reset.addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = reset.querySelector('button[type="submit"]');
      const error = reset.querySelector(".login-error");
      const sent = reset.querySelector(".login-sent");
      const email = reset.email.value.trim();
      if (!email) { error.textContent = "Indique ton adresse e-mail."; error.hidden = false; shake(reset); return; }
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
