// Provider screen: what a provider sees after signing in. Only its own requests are loaded
// (the access rules refuse anything else).
// 1. "À valider": a new request is accepted, refused, or answered with another date.
// 2. "Aujourd'hui": accepted vehicles on site today (multi-day windows included), done with a photo of the plate.
// 3. "À venir": accepted vehicles of the next days, searchable; one can be done early if the vehicle is already there.
// 4. "Faits": history and counts.
(function (root) {
  const TABS = [
    { id: "validate", label: "À valider", icon: "bell" },
    { id: "today", label: "Aujourd'hui", icon: "clock" },
    { id: "upcoming", label: "À venir", icon: "cal" },
    { id: "done", label: "Faits", icon: "check" },
  ];

  function start({ store, account, email, D, ui }) {
    const { $, esc, toast, prepareImage, icon, plateTag, safeImageSrc } = ui;
    const state = { demandes: [], models: new Map(), providerName: "", tab: null, openForm: null, busy: new Set(), query: "" };
    const today = () => D.toIsoDate(new Date());
    const view = $("#view-presta");

    document.body.classList.add("presta-mode");
    document.querySelector("nav.tabs").hidden = true;
    document.querySelectorAll("main > section").forEach((s) => (s.hidden = s !== view));
    view.hidden = false;

    // ---------- pieces ----------
    const modelPhotos = (d) => state.models.get(D.modelKey(d))?.photos || [];
    const slot = (d) => D.timeSlotLabel(d).replace(/^de /, "").replace(" à ", " – ");
    const when = (d) => (D.isMultiDay(d) ? `Du ${D.shortDate(d.date)} au ${D.shortDate(D.lastDay(d))}` : D.shortDate(d.date));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    function modelHtml(d) {
      const [name, size] = (D.vehicleLabel(d) || "").split(" – ");
      return `<span class="job-model">${esc(name || "Modèle non précisé")}${size ? `<small>${esc(size)}</small>` : ""}</span>`;
    }
    function jobHead(d) {
      return `<div class="job-head">${plateTag(d.plaque)}
        ${modelHtml(d)}
        <span class="job-kind">${esc(D.serviceOf(d.service).label)}</span></div>`;
    }
    function jobMeta(d, { withDate = true, withSite = true } = {}) {
      const late = D.isLate(d, today());
      return `<ul class="job-meta">
        ${withDate ? `<li>${icon("cal")}<span>${esc(cap(when(d)))}</span></li>` : ""}
        <li>${icon("clock")}<span>${esc(cap(slot(d)))}${!withDate && D.isMultiDay(d) ? ` · sur site jusqu'au ${esc(D.shortDate(D.lastDay(d)))}` : ""}</span></li>
        ${withSite ? `<li>${icon("pin")}<span>${esc([d.site, d.adresse].filter(Boolean).join(" · ") || "Site à préciser")}</span></li>` : ""}
        ${late ? `<li class="late">${icon("alert")}<span>En retard : prévu jusqu'au ${esc(D.shortDate(D.lastDay(d)))}</span></li>` : ""}
      </ul>${d.tache ? `<p class="job-task">${icon("check")}<span><b>À faire :</b> ${esc(d.tache)}</span></p>` : ""}${d.notes ? `<p class="job-note">${esc(d.notes)}</p>` : ""}`;
    }
    const photosStrip = (d) => (D.isWindshield(d) && modelPhotos(d).length
      ? `<div class="job-photos">${modelPhotos(d).slice(0, 4).map((p) => `<img src="${safeImageSrc(p.thumb)}" data-zoom="${esc(p.key)}" alt="Photo du pare-brise">`).join("")}</div>` : "");
    function answerLine(d) {
      const r = d.retour;
      if (!r || r.etat === "fait" || r.etat === "confirme") return "";
      return `<p class="job-answer">${icon("alert")}<span>${esc(D.answerSummary(r))}${r.vu ? "" : " · en attente de l'équipe"}</span></p>`;
    }

    // ---------- inline forms (another date, missing vehicle, not possible) ----------
    function formHtml(d) {
      const cancel = (kind) => `<button type="button" class="ghost" data-form="${kind}:${esc(d.id)}">Annuler</button>`;
      const note = (label, placeholder) => `<label class="field"><span>${label}</span><input data-note placeholder="${placeholder}"></label>`;
      if (state.openForm === "date:" + d.id) return `<div class="job-form">
        <div class="job-form-row"><label class="field"><span>Date proposée</span><input type="date" data-date min="${today()}"></label>
        <label class="field"><span>Heure</span><input type="time" data-time step="900"></label></div>
        ${note("Un mot pour l'équipe (facultatif)", "Ex. complet jeudi matin")}
        <div class="job-form-actions">${cancel("date")}<button type="button" class="primary" data-send="date:${esc(d.id)}">Proposer cette date</button></div></div>`;
      if (state.openForm === "absent:" + d.id) return `<div class="job-form">
        ${note("Un mot pour l'équipe (facultatif)", "Ex. pas sur le parking à 9 h")}
        <div class="job-form-actions">${cancel("absent")}<button type="button" class="primary" data-send="absent:${esc(d.id)}">Signaler le véhicule absent</button></div></div>`;
      if (state.openForm === "refuse:" + d.id) return `<div class="job-form">
        ${note("Pourquoi ? (facultatif)", "Ex. pièce indisponible")}
        <div class="job-form-actions">${cancel("refuse")}<button type="button" class="primary" data-send="refuse:${esc(d.id)}">Confirmer : pas possible</button></div></div>`;
      return "";
    }
    const busyLine = `<p class="job-busy"><span class="spinner" aria-hidden="true"></span>Envoi en cours…</p>`;
    const formOpen = (d) => state.openForm?.endsWith(":" + d.id);

    // ---------- cards per tab ----------
    function validateCard(d) {
      return `<article class="job">${jobHead(d)}${jobMeta(d)}${photosStrip(d)}${answerLine(d)}
        ${state.busy.has(d.id) ? busyLine : formOpen(d) ? formHtml(d) : `<div class="job-actions">
          <button type="button" class="primary" data-take="${esc(d.id)}">${icon("check")}Accepter</button>
          <button type="button" data-form="date:${esc(d.id)}">${icon("cal")}Autre date</button>
          <button type="button" class="ghost" data-form="refuse:${esc(d.id)}">Pas possible</button></div>`}
      </article>`;
    }
    function doCard(d, { early = false } = {}) {
      return `<article class="job">${jobHead(d)}${jobMeta(d, { withDate: early, withSite: early })}${photosStrip(d)}${answerLine(d)}
        ${state.busy.has(d.id) ? busyLine : formOpen(d) ? formHtml(d) : `<div class="job-actions">
          <button type="button" class="primary big" data-done="${esc(d.id)}">${icon("camera")}${early ? "Fait en avance" : "Fait"} · photo de la plaque</button>
          <button type="button" class="ghost" data-form="absent:${esc(d.id)}">Véhicule absent</button></div>`}
      </article>`;
    }
    function doneRow(d) {
      const day = (d.retour?.etat === "fait" ? d.retour.at : d.doneAt || d.date || "").slice(0, 10);
      return `<li class="done-row">${plateTag(d.plaque)}<span><b>${esc(D.vehicleLabel(d) || D.serviceOf(d.service).label)}</b><small>${esc([d.site, day && cap(D.shortDate(day))].filter(Boolean).join(" · "))}</small></span>
        ${d.retour?.preuve ? `<button type="button" class="ghost" data-proof="${esc(d.retour.preuve)}" aria-label="Voir la photo de ${esc(d.plaque)}">${icon("image")}</button>` : "<span></span>"}</li>`;
    }
    // Today's vehicles grouped by site: the provider goes site by site.
    function todayHtml(list) {
      return [...D.groupBy(list, D.siteOf).entries()].map(([site, rows]) => `<section class="spot">
        <header class="spot-head">${icon("pin")}<span><b>${esc(site)}</b>${rows[0].adresse ? `<small>${esc(rows[0].adresse)}</small>` : ""}</span><em>${rows.length}</em></header>
        ${rows.map((d) => doCard(d)).join("")}</section>`).join("");
    }
    const searchBox = () => `<label class="job-search">${icon("search")}<input type="search" data-search value="${esc(state.query)}" placeholder="Chercher une plaque, un site…" aria-label="Chercher"></label>`;
    const filtered = (list) => list.filter((d) => D.matchesSearch([d.plaque, D.vehicleLabel(d), d.site, d.adresse], state.query));
    const empty = (title, text) => `<div class="job-empty"><b>${title}</b><span>${text}</span></div>`;

    const loadingHtml = `<div class="job-empty" aria-busy="true"><span class="spinner"></span><span>Chargement de tes demandes…</span></div>`;
    function tabsHtml(lists) {
      return TABS.map((t) => {
        const n = t.id === "done" ? 0 : lists[t.id].length;
        const badge = n ? `<span class="count${t.id === "validate" ? " hot" : ""}">${n}</span>` : "";
        return `<button role="tab" data-tab="${t.id}" aria-selected="${state.tab === t.id}">${icon(t.icon)}<span>${t.label}</span>${badge}</button>`;
      }).join("");
    }
    function validateTab(list) {
      return list.length
        ? `<p class="tab-intro">Accepte chaque demande, ou propose une autre date.</p>${list.map(validateCard).join("")}`
        : empty("Aucune demande à valider", "Les nouvelles demandes de City-Drop arrivent ici.");
    }
    function todayTab(list) {
      return list.length ? todayHtml(list) : empty("Rien de prévu aujourd'hui", "Tes véhicules acceptés s'affichent ici les jours où ils sont sur site.");
    }
    function upcomingTab(all) {
      const list = filtered(all);
      return searchBox() + (list.length
        ? `<p class="tab-intro">Un véhicule est déjà sur site ? Tu peux le faire en avance.</p>${list.map((d) => doCard(d, { early: true })).join("")}`
        : state.query ? empty("Aucun véhicule trouvé", "Vérifie la plaque ou le site.") : empty("Rien à venir", "Tes demandes acceptées des prochains jours s'afficheront ici."));
    }
    function doneTab(all) {
      const counts = D.providerCounts(state.demandes, today());
      const list = filtered(all);
      return `<p class="tally"><b>${counts.month}</b> véhicule${counts.month > 1 ? "s" : ""} ce mois-ci<span aria-hidden="true">·</span><b>${counts.year}</b> cette année</p>${searchBox()}` +
        (list.length ? `<ul class="done-list">${list.map(doneRow).join("")}</ul>` : empty("Aucun véhicule fait", "Chaque véhicule validé avec sa photo s'ajoute ici."));
    }
    const TAB_BODY = { validate: validateTab, today: todayTab, upcoming: upcomingTab, done: doneTab };

    // Re-renders the whole screen, keeping the cursor in the search box while the provider types.
    function render() {
      const lists = D.providerLists(state.demandes, today());
      if (!state.tab && state.loaded) state.tab = lists.validate.length ? "validate" : "today";
      const body = state.loaded ? TAB_BODY[state.tab](lists[state.tab]) : loadingHtml;
      const focusSearch = document.activeElement?.matches?.("[data-search]");
      view.innerHTML = `<header class="presta-top">
          <p class="presta-who">${esc(state.providerName || "Mon espace prestataire")}</p>
          <h1>${esc(cap(D.dayLabel(today())))}</h1>
        </header>
        <nav class="presta-tabs" role="tablist" aria-label="Mes demandes">${tabsHtml(lists)}</nav>
        <div class="presta-body">${body}</div>
`;
      if (focusSearch) { const input = view.querySelector("[data-search]"); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // ---------- actions ----------
    const byId = (id) => state.demandes.find((d) => d.id === id);
    async function send(d, retour, message) {
      state.busy.add(d.id); state.openForm = null; render();
      try { await store.answer(d, { ...retour, par: email }); toast(message); }
      catch { toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    // "Fait": the camera opens; the photo of the plate is the proof.
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
        await send(d, { etat: "fait", preuve }, `${d.plaque} validé, merci !`);
      } catch { state.busy.delete(d.id); render(); toast("La photo n'est pas partie : réessaie"); }
    });

    view.addEventListener("input", (e) => { if (e.target.matches("[data-search]")) { state.query = e.target.value; render(); } });
    view.addEventListener("click", (e) => {
      const el = (sel) => e.target.closest(sel);
      let b;
      if ((b = el("[data-tab]"))) { state.tab = b.dataset.tab; state.openForm = null; state.query = ""; render(); window.scrollTo({ top: 0 }); }
      else if ((b = el("[data-take]"))) send(byId(b.dataset.take), { etat: "confirme" }, "Demande acceptée : elle est dans ton planning");
      else if ((b = el("[data-done]"))) { doneTarget = b.dataset.done; camera.click(); }
      else if ((b = el("[data-form]"))) { state.openForm = state.openForm === b.dataset.form ? null : b.dataset.form; render(); }
      else if ((b = el("[data-send]"))) {
        const [kind, id] = b.dataset.send.split(":");
        const form = b.closest(".job-form");
        const note = form.querySelector("[data-note]").value.trim();
        const withNote = note ? { note } : {};
        if (kind === "absent") send(byId(id), { etat: "absent", ...withNote }, "L'équipe est prévenue");
        else if (kind === "refuse") send(byId(id), { etat: "refuse", ...withNote }, "L'équipe est prévenue");
        else {
          const date = form.querySelector("[data-date]").value;
          if (!date) return toast("Choisis la date que tu proposes");
          const debut = form.querySelector("[data-time]").value;
          send(byId(id), { etat: "autre-date", date, ...(debut ? { debut } : {}), ...withNote }, "Date proposée à l'équipe");
        }
      }
    });

    render();
    store.getProvider(account.prestataireId).then((p) => { state.providerName = p?.nom || ""; render(); }).catch(() => {});
    store.subscribeProvider(account.prestataireId, {
      onDemandes: (rows) => { state.demandes = rows; state.loaded = true; render(); },
      onModels: (rows) => { state.models = new Map(rows.map((m) => [D.modelKey(m), m])); render(); },
      onError: () => toast("Connexion interrompue : recharge la page"),
    });
  }
  root.SuiviPresta = { start };
})(typeof self !== "undefined" ? self : this);
