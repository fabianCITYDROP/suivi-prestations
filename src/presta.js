// Provider screen: what a provider sees after signing in. Only its own requests are loaded
// (the access rules refuse anything else). It answers each request: taken, done (with a photo
// of the plate), vehicle missing, or another date.
(function (root) {
  function start({ store, account, email, D, ui }) {
    const { $, esc, toast, prepareImage, icon, plateTag, safeImageSrc } = ui; // photos open through the page's shared lightbox (data-zoom, data-proof)
    const state = { demandes: [], models: new Map(), tab: "todo", openForm: null, busy: new Set() };
    const today = () => D.toIsoDate(new Date());
    const view = $("#view-presta");

    document.querySelector("nav.tabs").hidden = true;
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s !== view));
    view.hidden = false;

    const modelPhotos = (d) => state.models.get(D.modelKey(d))?.photos || [];
    const photosHtml = (d) => modelPhotos(d).slice(0, 4).map((p) =>
      `<img class="presta-thumb" src="${safeImageSrc(p.thumb)}" data-zoom="${esc(p.key)}" alt="Photo du pare-brise">`).join("");

    function actionButtons(d) {
      if (state.busy.has(d.id)) return `<p class="hint">Envoi en cours…</p>`;
      const taken = d.retour?.etat === "confirme" || d.statut === "confirmee";
      return `<div class="presta-actions">
        <button type="button" class="primary big" data-done="${esc(d.id)}">${icon("image")}OK fait (photo de la plaque)</button>
        ${taken ? "" : `<button type="button" data-take="${esc(d.id)}">Je prends</button>`}
        <button type="button" data-form="absent:${esc(d.id)}">Véhicule absent</button>
        <button type="button" data-form="date:${esc(d.id)}">Autre date</button>
      </div>${formHtml(d)}`;
    }
    function formHtml(d) {
      if (state.openForm === "absent:" + d.id) return `<div class="presta-form">
        <label class="field"><span>Un mot pour l'équipe (facultatif)</span><input data-note placeholder="Ex. pas sur le parking à 9h"></label>
        <button type="button" class="primary" data-send="absent:${esc(d.id)}">Signaler le véhicule absent</button></div>`;
      if (state.openForm === "date:" + d.id) return `<div class="presta-form">
        <div class="row"><label class="field"><span>Date proposée</span><input type="date" data-date min="${today()}"></label>
        <label class="field"><span>Heure</span><input type="time" data-time step="900"></label></div>
        <label class="field"><span>Un mot (facultatif)</span><input data-note placeholder="Ex. pas de créneau jeudi"></label>
        <button type="button" class="primary" data-send="date:${esc(d.id)}">Proposer cette date</button></div>`;
      return "";
    }
    function card(d, done) {
      const address = [d.site, d.adresse].filter(Boolean).join(" – ");
      const answer = d.retour ? `<p class="presta-answer">${esc(D.answerSummary(d.retour))}${d.retour.vu && d.retour.etat === "autre-date" && d.date === d.retour.date ? " (acceptée)" : ""}</p>` : "";
      return `<article class="panel presta-card" data-id="${esc(d.id)}">
        <div class="row">${plateTag(d.plaque)}<b>${esc(D.vehicleLabel(d) || "Véhicule")}</b><span class="tag">${esc(D.serviceOf(d.service).label)}</span></div>
        <p>${esc(address || "Site à préciser")}</p>
        <p class="muted">${done ? "Fait le " + esc(D.numericDate((d.retour?.at || d.doneAt || d.date || "").slice(0, 10))) : `Disponible ${esc(D.availabilityLabel(d))}, ${esc(D.timeSlotLabel(d))}`}</p>
        ${d.notes ? `<p class="muted">Remarque : ${esc(d.notes)}</p>` : ""}
        ${!done && D.isWindshield(d) && modelPhotos(d).length ? `<div class="presta-photos">${photosHtml(d)}</div>` : ""}
        ${answer}
        ${done ? (d.retour?.preuve ? `<button type="button" class="ghost" data-proof="${esc(d.retour.preuve)}">Voir la photo envoyée</button>` : "") : actionButtons(d)}
      </article>`;
    }
    function render() {
      const { todo, done } = D.providerLists(state.demandes);
      const counts = D.providerCounts(state.demandes, today());
      const list = state.tab === "todo" ? todo : done;
      view.innerHTML = `<div class="presta-head">
          <h1>Mes demandes</h1>
          <p class="muted">Véhicules faits ce mois-ci : <b>${counts.month}</b> · cette année : <b>${counts.year}</b></p>
          <div class="presta-tabs" role="tablist">
            <button role="tab" data-tab="todo" aria-selected="${state.tab === "todo"}">À faire (${todo.length})</button>
            <button role="tab" data-tab="done" aria-selected="${state.tab === "done"}">Faits (${done.length})</button>
          </div>
        </div>
        ${list.length ? list.map((d) => card(d, state.tab === "done")).join("") : `<div class="empty"><b>${state.tab === "todo" ? "Rien à faire pour l'instant" : "Aucun véhicule fait pour l'instant"}</b><span>Les nouvelles demandes apparaissent ici toutes seules.</span></div>`}
        <p class="hint" style="margin-top:16px">Connecté en tant que ${esc(email)} · <button type="button" class="ghost" data-signout>Se déconnecter</button></p>`;
    }

    const byId = (id) => state.demandes.find((d) => d.id === id);
    async function send(d, retour, message) {
      state.busy.add(d.id); render();
      try { await store.answer(d, { ...retour, par: email }); state.openForm = null; toast(message); }
      catch { toast("Envoi impossible, vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    // "OK fait": the camera opens, the photo of the plate is the proof.
    const camera = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
    camera.setAttribute("capture", "environment");
    document.body.append(camera);
    let doneTarget = null;
    camera.addEventListener("change", async () => {
      const file = camera.files[0]; camera.value = "";
      const d = doneTarget && byId(doneTarget);
      if (!file || !d) return;
      state.busy.add(d.id); render();
      try {
        const { full } = await prepareImage(file);
        const preuve = await store.addProof(d, full);
        state.busy.delete(d.id);
        await send(d, { etat: "fait", preuve }, `${d.plaque} : c'est noté, merci !`);
      } catch { state.busy.delete(d.id); render(); toast("La photo n'a pas pu être envoyée, réessaie"); }
    });

    view.addEventListener("click", async (e) => {
      const el = (sel) => e.target.closest(sel);
      let b;
      if ((b = el("[data-tab]"))) { state.tab = b.dataset.tab; state.openForm = null; render(); }
      else if ((b = el("[data-take]"))) send(byId(b.dataset.take), { etat: "confirme" }, "Passage confirmé à l'équipe");
      else if ((b = el("[data-done]"))) { doneTarget = b.dataset.done; camera.click(); }
      else if ((b = el("[data-form]"))) { state.openForm = state.openForm === b.dataset.form ? null : b.dataset.form; render(); }
      else if ((b = el("[data-send]"))) {
        const [kind, id] = b.dataset.send.split(":");
        const form = b.closest(".presta-form");
        const note = form.querySelector("[data-note]").value.trim();
        if (kind === "absent") send(byId(id), { etat: "absent", ...(note ? { note } : {}) }, "L'équipe est prévenue");
        else {
          const date = form.querySelector("[data-date]").value;
          if (!date) return toast("Choisis la date proposée");
          const debut = form.querySelector("[data-time]").value;
          send(byId(id), { etat: "autre-date", date, ...(debut ? { debut } : {}), ...(note ? { note } : {}) }, "Date proposée à l'équipe");
        }
      }
      else if (el("[data-signout]")) firebase.auth().signOut().then(() => location.reload());
    });

    render();
    store.subscribeProvider(account.prestataireId, {
      onDemandes: (rows) => { state.demandes = rows; render(); },
      onModels: (rows) => { state.models = new Map(rows.map((m) => [D.modelKey(m), m])); render(); },
      onError: () => toast("Connexion interrompue, recharge la page"),
    });
  }
  root.SuiviPresta = { start };
})(typeof self !== "undefined" ? self : this);
