// Provider screen: what a provider sees after signing in. Only its own requests are loaded
// (the access rules refuse anything else).
// 1. "À valider": a new request is accepted, refused, or answered with another date.
// 2. "Aujourd'hui": accepted vehicles on site today (multi-day windows included), closed with "OK prestation réalisée".
// 3. "À venir": accepted vehicles of the next days, searchable; one can be done early if the vehicle is already there.
// 4. "Faits": history and counts.
// On any accepted vehicle, the provider can report a problem seen on it (shock, tyre, warning light), with an optional photo.
(function (root) {
  const TABS = [
    { id: "validate", label: "À valider", icon: "bell" },
    { id: "today", label: "Aujourd'hui", icon: "clock" },
    { id: "upcoming", label: "À venir", icon: "cal" },
    { id: "done", label: "Faits", icon: "check" },
  ];

  function start({ store, account, email, D, ui }) {
    const { $, esc, toast, icon, plateTag, safeImageSrc, prepareImage } = ui;
    // draft: what the provider is typing in the open form, kept across re-renders (a new request arriving redraws the screen).
    const state = { demandes: [], models: new Map(), problems: [], providerName: "", tab: null, openForm: null, draft: {}, busy: new Set(), query: "" };
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
        <span class="job-kind">${esc(D.jobLabel(d))}</span></div>`;
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
    // Problems already reported on this request: the provider sees the team got them, and does not send them twice.
    function problemLines(d) {
      return D.problemsOfRequest(state.problems, d.id).map((p) => `<p class="job-problem">${icon("alert")}<span><b>Problème signalé :</b> ${esc(D.problemSummary(p))}<small>${p.statut === "traite" ? "Vu par l'équipe" : "Envoyé à l'équipe"}</small></span></p>`).join("");
    }
    function answerLine(d) {
      const r = d.retour;
      if (!r || r.etat === "fait" || r.etat === "confirme") return "";
      return `<p class="job-answer">${icon("alert")}<span>${esc(D.answerSummary(r))}${r.vu ? "" : " · en attente de l'équipe"}</span></p>`;
    }

    // ---------- inline forms (done, another date, missing vehicle, not possible) ----------
    function formHtml(d) {
      const cancel = (kind) => `<button type="button" class="ghost" data-form="${kind}:${esc(d.id)}">Annuler</button>`;
      const note = (label, placeholder) => `<label class="field"><span>${label}</span><input data-note value="${esc(state.draft.note || "")}" placeholder="${placeholder}" maxlength="${D.PROBLEM_TEXT_MAX}"></label>`;
      // "Done": one confirmation step so a slip of the finger does not close a job. No photo: providers are trusted.
      // A problem seen while working (shock, tyre, warning light) can be ticked here: the note then goes with it.
      if (state.openForm === "done:" + d.id) return `<div class="job-form">
        ${note("Un mot pour l'équipe (facultatif)", "Ex. rayure côté passager")}
        <fieldset class="problem-pick"><legend>Un problème vu sur le véhicule ? (facultatif)</legend>${problemChips()}</fieldset>
        <div class="job-form-actions">${cancel("done")}<button type="button" class="primary" data-send="done:${esc(d.id)}">${icon("check")}Confirmer : réalisée</button></div></div>`;
      if (state.openForm === "problem:" + d.id) return `<div class="job-form">
        <fieldset class="problem-pick"><legend>Quel problème ?</legend>${problemChips()}</fieldset>
        <label class="field"><span>Ce que tu as vu${state.draft.type === "autre" ? "" : " (facultatif)"}</span><textarea data-note rows="2" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="Ex. impact sur l'aile avant droite, pneu arrière gauche à plat">${esc(state.draft.note || "")}</textarea></label>
        ${photoPicker()}
        <div class="job-form-actions">${cancel("problem")}<button type="button" class="primary" data-send="problem:${esc(d.id)}">${icon("alert")}Envoyer à l'équipe</button></div></div>`;
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
    function problemChips() {
      return `<div class="task-chips" role="radiogroup">${D.PROBLEMS.map((p) => `<button type="button" class="chip-btn" role="radio" data-ptype="${p.id}" aria-checked="${state.draft.type === p.id}">${esc(p.label)}</button>`).join("")}</div>`;
    }
    function photoPicker() {
      const ph = state.draft.photo;
      if (state.draft.photoBusy) return `<p class="job-busy"><span class="spinner" aria-hidden="true"></span>Préparation de la photo…</p>`;
      if (ph) return `<div class="problem-photo"><img src="${safeImageSrc(ph.thumb)}" alt="Photo du problème"><button type="button" class="ghost" data-photo-remove>${icon("x")}Retirer la photo</button></div>`;
      return `<label class="problem-photo-add">${icon("camera")}<span>Ajouter une photo (facultatif)</span><input type="file" accept="image/*" capture="environment" data-photo hidden></label>`;
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
          <button type="button" class="primary big" data-form="done:${esc(d.id)}">${icon("check")}OK prestation réalisée</button>
          <button type="button" data-form="date:${esc(d.id)}">${icon("cal")}Reporter</button>
          <button type="button" class="ghost" data-form="absent:${esc(d.id)}">Véhicule absent</button></div>
        <button type="button" class="job-report" data-form="problem:${esc(d.id)}">${icon("alert")}Signaler un problème sur le véhicule</button>`}
      ${problemLines(d)}</article>`;
    }
    function doneRow(d) {
      const day = (d.retour?.etat === "fait" ? d.retour.at : d.doneAt || d.date || "").slice(0, 10);
      return `<li class="done-row">${plateTag(d.plaque)}<span><b>${esc(D.vehicleLabel(d) || D.jobLabel(d))}</b><small>${esc([d.site, day && cap(D.shortDate(day))].filter(Boolean).join(" · "))}</small></span>
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
        (list.length ? `<ul class="done-list">${list.map(doneRow).join("")}</ul>` : empty("Aucun véhicule fait", "Chaque prestation réalisée s'ajoute ici."));
    }
    const TAB_BODY = { validate: validateTab, today: todayTab, upcoming: upcomingTab, done: doneTab };

    // Re-renders the whole screen, keeping the cursor in the search box while the provider types.
    function render() {
      const lists = D.providerLists(state.demandes, today());
      if (!state.tab && state.loaded) state.tab = lists.validate.length ? "validate" : "today";
      const body = state.loaded ? TAB_BODY[state.tab](lists[state.tab]) : loadingHtml;
      const typing = document.activeElement?.matches?.("[data-search], [data-note]") ? (document.activeElement.matches("[data-search]") ? "[data-search]" : "[data-note]") : null;
      view.innerHTML = `<header class="presta-top">
          <p class="presta-who">${esc(state.providerName || "Mon espace prestataire")}</p>
          <h1>${esc(cap(D.dayLabel(today())))}</h1>
        </header>
        <nav class="presta-tabs" role="tablist" aria-label="Mes demandes">${tabsHtml(lists)}</nav>
        <div class="presta-body">${body}</div>
`;
      const input = typing && view.querySelector(typing);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // ---------- actions ----------
    const byId = (id) => state.demandes.find((d) => d.id === id);
    async function send(d, retour, message) {
      state.busy.add(d.id); state.openForm = null; render();
      try { await store.answer(d, { ...retour, par: email }); toast(message); }
      catch { toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    // A problem report; the photo is optional. Nothing is lost if it fails: the form stays open with what was typed.
    async function sendProblem(d, note) {
      const check = D.problemReport(d, { type: state.draft.type, texte: note }, email, "");
      if (check.error) return toast(check.error);
      const draft = { ...state.draft, note };
      state.busy.add(d.id); state.openForm = null; render();
      try {
        await store.reportProblem(d, { type: draft.type, texte: note, par: email }, draft.photo?.full);
        state.draft = {}; toast("Problème envoyé à l'équipe, merci !");
      } catch { state.openForm = "problem:" + d.id; state.draft = draft; toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }
    // "Done" with a problem ticked: the job is closed and the problem reported, the note going with the problem.
    async function doneWithProblem(d, note) {
      const type = state.draft.type;
      state.busy.add(d.id); state.openForm = null; render();
      try {
        await store.answer(d, { etat: "fait", par: email });
        await store.reportProblem(d, { type, texte: note, par: email });
        state.draft = {}; toast(`${d.plaque} réalisé, problème envoyé à l'équipe`);
      } catch { toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }
    async function addPhoto(file) {
      state.draft.photoBusy = true; render();
      try { state.draft.photo = await prepareImage(file); }
      catch { toast("Photo illisible : essaie avec une autre"); }
      finally { state.draft.photoBusy = false; render(); }
    }

    view.addEventListener("change", (e) => { if (e.target.matches("[data-photo]") && e.target.files[0]) addPhoto(e.target.files[0]); });
    view.addEventListener("input", (e) => {
      if (e.target.matches("[data-note]")) state.draft.note = e.target.value;
      else if (e.target.matches("[data-search]")) { state.query = e.target.value; render(); }
    });
    view.addEventListener("click", (e) => {
      const el = (sel) => e.target.closest(sel);
      let b;
      if ((b = el("[data-tab]"))) { state.tab = b.dataset.tab; state.openForm = null; state.query = ""; render(); window.scrollTo({ top: 0 }); }
      else if ((b = el("[data-take]"))) send(byId(b.dataset.take), { etat: "confirme" }, "Demande acceptée : elle est dans ton planning");
      else if ((b = el("[data-form]"))) { state.openForm = state.openForm === b.dataset.form ? null : b.dataset.form; state.draft = {}; render(); }
      else if ((b = el("[data-ptype]"))) {
        state.draft.type = state.draft.type === b.dataset.ptype ? "" : b.dataset.ptype;
        render(); view.querySelector(`[data-ptype="${b.dataset.ptype}"]`)?.focus();
      }
      else if ((b = el("[data-photo-remove]"))) { state.draft.photo = null; render(); }
      else if ((b = el("[data-send]"))) {
        const [kind, id] = b.dataset.send.split(":");
        const form = b.closest(".job-form");
        const note = form.querySelector("[data-note]").value.trim();
        const withNote = note ? { note } : {};
        if (kind === "problem") sendProblem(byId(id), note);
        else if (kind === "done" && state.draft.type) doneWithProblem(byId(id), note);
        else if (kind === "done") send(byId(id), { etat: "fait", ...withNote }, `${byId(id).plaque} réalisé, merci !`);
        else if (kind === "absent") send(byId(id), { etat: "absent", ...withNote }, "L'équipe est prévenue");
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
      onProblems: (rows) => { state.problems = rows; render(); },
      onError: () => toast("Connexion interrompue : recharge la page"),
    });
  }
  root.SuiviPresta = { start };
})(typeof self !== "undefined" ? self : this);
