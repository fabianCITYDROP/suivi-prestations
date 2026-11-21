// Provider screen: what a provider sees after signing in. Only its own requests are loaded
// (the access rules refuse anything else).
// 1. "À valider": a new request is accepted, refused, or answered with another date.
// 2. "Aujourd'hui": accepted vehicles on site today (multi-day windows included), closed with "OK prestation réalisée".
// 3. "À venir": accepted vehicles of the next days, searchable; one can be done early if the vehicle is already there.
// 4. "Faits": history and counts.
// On any accepted vehicle (and for 7 days once done), the provider can report a problem seen on it: a few words, an optional photo.
// For 10 minutes after « OK prestation réalisée », the provider can take it back (wrong vehicle): it goes back to its list.
// To add something, it simply reports again.
// 5. "Signaler" (+): what the provider saw on ANY vehicle, even one it was not sent to (dirty, windscreen, tyres…),
//    one after the other. The team gets it in « Retours »; the provider only sees its own reports, and changes or
//    deletes one until the team has handled it.
(function (root) {
  const TABS = [
    { id: "validate", label: "À valider", icon: "bell" },
    { id: "today", label: "Aujourd'hui", icon: "clock" },
    { id: "upcoming", label: "À venir", icon: "cal" },
    { id: "done", label: "Faits", icon: "check" },
    { id: "report", label: "Signaler", icon: "plus" },
  ];

  function start({ store, account, email, D, ui, alerts }) {
    const { $, esc, toast, icon, plateTag, safeImageSrc, prepareImage } = ui;
    // draft: what the provider is typing in the open form, kept across re-renders (a new request arriving redraws the screen).
    const state = { demandes: [], models: new Map(), problems: [], providerName: "", tab: null, openForm: null, draft: {}, busy: new Set(), query: "", month: "", monthLoading: false, fd: null }; // month: "AAAA-MM" of an older report asked for in « Faits », "" = last 40 days
    const today = () => D.toIsoDate(new Date());
    const recentFrom = D.recentWindowStart(today()); // older requests are read only when asked for (free plan's daily reads)
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
    // A report sent by mistake: its author removes it until the team has handled it (two taps: the first one asks).
    function deleteReportBtn(p) {
      if (p.statut === "traite" || p.par !== email) return "";
      if (state.busy.has("pdel:" + p.id)) return `<span class="spinner" aria-hidden="true"></span>`;
      return state.pdelArmed === p.id
        ? `<button type="button" class="del-report armed" data-pdel="${esc(p.id)}">${icon("trash")}Supprimer ?</button>`
        : `<button type="button" class="del-report" data-pdel="${esc(p.id)}" aria-label="Supprimer ce signalement">${icon("trash")}</button>`;
    }
    // Problems already reported on this request: the provider sees the team got them, and does not send them twice.
    function problemLines(d) {
      return D.problemsOfRequest(state.problems, d.id).map((p) => `<div class="job-problem">${icon("alert")}<span><b>Problème signalé :</b> ${esc(D.problemSummary(p))}<small>${p.statut === "traite" ? "Vu par l'équipe" : "Envoyé à l'équipe"}${p.photo ? " · avec photo" : ""}</small></span>${deleteReportBtn(p)}</div>`).join("");
    }
    function answerLine(d) {
      const r = d.retour;
      if (!r || ["fait", "confirme", "erreur"].includes(r.etat)) return "";
      return `<p class="job-answer">${icon("alert")}<span>${esc(D.answerSummary(r))}${r.vu ? "" : " · en attente de l'équipe"}</span></p>`;
    }

    // ---------- inline forms (done, another date, missing vehicle, not possible) ----------
    function formHtml(d) {
      const cancel = (kind) => `<button type="button" class="ghost" data-form="${kind}:${esc(d.id)}">Annuler</button>`;
      const note = (label, placeholder) => `<label class="field"><span>${label}</span><input data-note value="${esc(state.draft.note || "")}" placeholder="${placeholder}" maxlength="${D.PROBLEM_TEXT_MAX}"></label>`;
      // "Done": one confirmation step so a slip of the finger does not close a job. No photo: providers are trusted.
      if (state.openForm === "done:" + d.id) return `<div class="job-form">
        ${note("Un mot pour l'équipe (facultatif)", "Ex. RAS, tout est propre")}
        <div class="job-form-actions">${cancel("done")}<button type="button" class="primary" data-send="done:${esc(d.id)}">${icon("check")}Confirmer : réalisée</button></div></div>`;
      if (state.openForm === "undo:" + d.id) return `<div class="job-form">
        <p class="job-form-text">Ce véhicule revient dans ta liste à faire. L'équipe est prévenue.</p>
        ${note("Un mot pour l'équipe (facultatif)", "Ex. c'était le véhicule d'à côté")}
        <div class="job-form-actions">${cancel("undo")}<button type="button" class="primary" data-send="undo:${esc(d.id)}">Oui, remettre à faire</button></div></div>`;
      if (state.openForm === "problem:" + d.id) return `<div class="job-form">
        <label class="field"><span>Qu'est-ce qui ne va pas sur le véhicule ?</span><textarea data-note rows="3" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="Ex. impact sur l'aile avant droite, pneu arrière gauche à plat, voyant moteur allumé">${esc(state.draft.note || "")}</textarea></label>
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
          <button type="button" class="ghost" data-form="absent:${esc(d.id)}">Véhicule absent</button>
          <button type="button" class="report" data-form="problem:${esc(d.id)}">${icon("alert")}Signaler un problème</button></div>`}
      ${problemLines(d)}</article>`;
    }
    const doneDayOf = (d) => (d.retour?.etat === "fait" ? d.retour.at : d.doneAt || d.date || "").slice(0, 10);
    function doneRow(d) {
      const day = doneDayOf(d);
      // A problem noticed after « OK prestation réalisée » can still be reported for a few days.
      const recent = D.canReportAfterDone(day, today());
      const undo = D.canUndoDone(d, email, Date.now());
      const more = recent || undo ? (state.busy.has(d.id) ? busyLine : formOpen(d) ? formHtml(d)
        : (undo ? `<button type="button" class="undo-done" data-form="undo:${esc(d.id)}">${icon("x")}${esc(D.UNDO_DONE_LABEL)}</button>` : "") +
          (recent ? `<button type="button" class="report" data-form="problem:${esc(d.id)}">${icon("alert")}Signaler un problème</button>` : "")) : "";
      const lines = problemLines(d);
      return `<li class="done-row">${plateTag(d.plaque)}<span><b>${esc(D.vehicleLabel(d) || D.jobLabel(d))}</b><small>${esc([d.site, day && cap(D.shortDate(day))].filter(Boolean).join(" · "))}</small></span>
        ${d.retour?.preuve ? `<button type="button" class="ghost" data-proof="${esc(d.retour.preuve)}" aria-label="Voir la photo de ${esc(d.plaque)}">${icon("image")}</button>` : "<span></span>"}
        ${more || lines ? `<div class="done-more">${lines}${more}</div>` : ""}</li>`;
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
        const n = lists[t.id]?.length || 0; // « Faits » and « Signaler » show no count
        const badge = n ? `<span class="count${t.id === "validate" ? " hot" : ""}">${n}</span>` : "";
        // « Signaler »: the round blue + in the middle of the bar, like the team's « Nouvelle demande ».
        return `<button role="tab" data-tab="${t.id}" aria-selected="${state.tab === t.id}"${t.id === "report" ? ` class="tab-plus" aria-label="Signaler un souci sur un véhicule"` : ""}>${icon(t.icon)}<span>${t.label}</span>${badge}</button>`;
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
      const picker = `<label class="field month-pick"><span>Voir un ancien mois</span>
          <input type="month" data-month value="${esc(state.month)}" max="${today().slice(0, 7)}" ${state.monthLoading ? "disabled aria-busy=\"true\"" : ""}></label>`;
      if (state.month) { // report of one month, loaded on demand
        const inMonth = all.filter((d) => doneDayOf(d).slice(0, 7) === state.month);
        const list = filtered(inMonth);
        const head = state.monthLoading ? `<p class="tally">Chargement de ${esc(D.monthLabel(state.month))}…</p>`
          : `<p class="tally"><b>${inMonth.length}</b> véhicule${inMonth.length > 1 ? "s" : ""} en ${esc(D.monthLabel(state.month))}</p>`;
        const back = `<button type="button" class="month-back" data-month-reset>${icon("chev-l")}Revenir aux 40 derniers jours</button>`;
        return back + head + picker + searchBox() +
          (state.monthLoading ? "" : list.length ? `<ul class="done-list">${list.map(doneRow).join("")}</ul>` : empty("Aucun véhicule fait ce mois-là", "Choisis un autre mois."));
      }
      const list = filtered(all.filter((d) => doneDayOf(d) >= recentFrom)); // an older month looked at stays loaded, not listed here
      return `<p class="tally"><b>${counts.month}</b> véhicule${counts.month > 1 ? "s" : ""} ce mois-ci</p>${searchBox()}` +
        (list.length ? `<ul class="done-list">${list.map(doneRow).join("")}</ul>` : empty("Aucun véhicule fait", "Chaque prestation réalisée s'ajoute ici.")) +
        `<p class="tab-intro">Ici : les 40 derniers jours.</p>` + picker;
    }
    // ---------- « Signaler »: field reports on any vehicle ----------
    // One vehicle at a time: « Envoyer » clears the form for the next one (several vehicles = several quick sends).
    // A report of the list is touched to change or delete it, until the team has handled it.
    const emptyField = () => ({ plaque: "", quoi: [], texte: "", photo: null, photoKey: "", photoBusy: false, editId: null });
    const fd = () => (state.fd ||= emptyField());
    const editable = (p) => p.statut !== "traite" && p.par === email;
    function fieldForm() {
      const r = fd(), editing = !!r.editId;
      const photo = r.photoBusy ? `<p class="job-busy"><span class="spinner" aria-hidden="true"></span>Préparation de la photo…</p>`
        : r.photo || r.photoKey ? `<div class="problem-photo">${r.photo ? `<img src="${safeImageSrc(r.photo.thumb)}" alt="Photo">` : `<span class="photo-kept">${icon("image")}Photo jointe</span>`}<button type="button" class="ghost" data-fphoto-remove>${icon("x")}Retirer la photo</button></div>`
        : `<label class="problem-photo-add">${icon("camera")}<span>Ajouter une photo (facultatif)</span><input type="file" accept="image/*" capture="environment" data-fphoto hidden></label>`;
      const del = state.pdelArmed === r.editId
        ? `<button type="button" class="field-del armed" data-pdel="${esc(r.editId)}">${icon("trash")}Supprimer ?</button>`
        : `<button type="button" class="field-del" data-pdel="${esc(r.editId)}">${icon("trash")}Supprimer</button>`;
      return `<article class="job field-card${editing ? " editing" : ""}">
        ${editing ? `<p class="field-editing">Modification du signalement. L'équipe verra la nouvelle version.</p>` : ""}
        <label class="field"><span>Immatriculation</span><input class="field-plate" data-fplate data-keep="fplate" value="${esc(r.plaque)}" placeholder="AB-123-CD" autocapitalize="characters" autocomplete="off" spellcheck="false" list="fieldPlates" maxlength="12"></label>
        <fieldset class="issue-set"><legend>Anomalies constatées</legend><div class="issue-grid">
          ${D.FIELD_ISSUES.map((q) => { const on = r.quoi.includes(q); return `<button type="button" class="issue-tile" data-fissue data-q="${esc(q)}" aria-pressed="${on}"><span class="tick" aria-hidden="true">${on ? icon("check") : ""}</span>${esc(q)}</button>`; }).join("")}
        </div></fieldset>
        <label class="field"><span>${r.quoi.includes("Autre") ? "Précision (obligatoire pour « Autre »)" : "Précision (facultatif)"}</span><input data-ftext data-keep="ftext" value="${esc(r.texte)}" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="Ex. impact côté passager, pneu avant gauche usé"></label>
        ${photo}
        ${state.fieldBusy ? busyLine : editing
          ? `<div class="field-actions"><button type="button" class="primary big" data-fsend>${icon("check")}Enregistrer</button><div class="field-actions-row"><button type="button" class="ghost" data-fcancel>Annuler</button>${del}</div></div>`
          : `<button type="button" class="primary big field-send" data-fsend>${icon("check")}Transmettre à City-Drop</button>`}
      </article>`;
    }
    function sentRow(p) {
      const body = `${plateTag(p.plaque)}<span class="sent-text"><b>${esc(D.problemSummary(p))}</b><small>${esc(cap(D.shortDate(p.at.slice(0, 10))))}${p.photo ? " · avec photo" : ""}${p.modifieAt ? " · modifié" : ""}</small></span>
        <span class="seen-pill${p.statut === "traite" ? " ok" : ""}">${p.statut === "traite" ? "Traité" : "Transmis"}</span>`;
      return editable(p)
        ? `<li><button type="button" class="sent-row${fd().editId === p.id ? " current" : ""}" data-fedit="${esc(p.id)}" aria-label="Modifier ou supprimer le signalement ${esc(p.plaque)}">${body}${icon("chev-r")}</button></li>`
        : `<li><div class="sent-row">${body}<span></span></div></li>`;
    }
    function reportTab() {
      const plates = [...new Set(state.demandes.map((d) => d.plaque).filter(Boolean))];
      const mine = state.problems.filter(D.isFieldReport).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 15);
      return `<p class="tab-intro">Signalez toute anomalie constatée sur un véhicule de la flotte, même hors de vos interventions. Un véhicule par envoi.</p>
        <datalist id="fieldPlates">${plates.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        ${fieldForm()}
        ${mine.length ? `<h2 class="field-sent-title">Signalements récents</h2><p class="field-sent-hint">Modifiable ou supprimable tant que City-Drop ne l'a pas traité.</p><ul class="field-sent">${mine.map(sentRow).join("")}</ul>` : ""}`;
    }
    async function sendField() {
      const r = fd();
      const photo = r.photo ? "new" : r.photoKey;
      const check = D.fieldReport({ ...r, photo }, account.prestataireId, email, "");
      if (check.error) return toast(check.error);
      state.fieldBusy = true; render();
      try {
        const fields = { plaque: r.plaque, quoi: r.quoi, texte: r.texte, par: email };
        if (r.editId) { await store.updateField(state.problems.find((p) => p.id === r.editId), fields, r.photo?.full, r.photoKey); toast(`Signalement ${D.normalizePlate(r.plaque)} modifié`); }
        else { await store.reportField(account.prestataireId, fields, r.photo?.full); toast(`Signalement ${D.normalizePlate(r.plaque)} transmis, merci`); }
        state.fd = emptyField();
        window.scrollTo({ top: 0 });
      } catch (err) {
        toast(err?.code === "permission-denied" && r.editId ? "Déjà traité par City-Drop : faites un nouveau signalement" : "Envoi impossible : vérifie ta connexion et réessaie");
      } finally {
        state.fieldBusy = false; render();
        if (!state.fd.editId) view.querySelector("[data-fplate]")?.focus({ preventScroll: true });
      }
    }
    function editField(id) {
      const p = state.problems.find((x) => x.id === id);
      if (!p || !editable(p)) return;
      state.fd = { ...emptyField(), editId: p.id, plaque: p.plaque, quoi: [...(p.quoi || [])], texte: D.fieldNoteOf(p), photoKey: p.photo || "" };
      state.pdelArmed = null; render();
      view.querySelector(".field-card")?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    async function deleteReport(id) {
      if (state.pdelArmed !== id) { state.pdelArmed = id; render(); return; }
      state.pdelArmed = null; state.busy.add("pdel:" + id); state.fieldBusy = state.fd?.editId === id; render();
      try { await store.deleteProblem(id); toast("Signalement supprimé"); if (state.fd?.editId === id) state.fd = emptyField(); }
      catch (err) { toast(err?.code === "permission-denied" ? "Déjà vu par l'équipe : appelle-la pour corriger" : "Suppression impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete("pdel:" + id); state.fieldBusy = false; render(); }
    }
    async function addFieldPhoto(file) {
      const r = fd(); r.photoBusy = true; render();
      try { r.photo = await prepareImage(file); r.photoKey = ""; }
      catch { toast("Photo illisible : essaie avec une autre"); }
      finally { r.photoBusy = false; render(); }
    }

    const TAB_BODY = { validate: validateTab, today: todayTab, upcoming: upcomingTab, done: doneTab, report: reportTab };

    // Until alerts work on this phone: one card above the tabs, with the one thing to do.
    function alertCard() {
      const st = alerts?.state;
      if (!st || ["off", "loading", "on"].includes(st)) return "";
      const text = st === "ask" ? "Sois prévenu dès qu'une demande arrive, même téléphone verrouillé." : root.SuiviAlertes.TEXTS[st];
      return `<div class="alert-card" role="region" aria-label="Alertes">
          <span class="alert-icon" aria-hidden="true">${icon("bell")}</span>
          <div><p class="alert-title">${st === "ask" || st === "error" ? "Alertes des nouvelles demandes" : "Alertes pas encore actives"}</p><p class="alert-text">${esc(text)}</p></div>
          ${st === "ask" || st === "error" ? `<button type="button" class="primary big" data-alerts>Activer les alertes</button>` : ""}
        </div>`;
    }
    // Re-renders the whole screen, keeping the cursor in the search box while the provider types.
    function render() {
      const lists = D.providerLists(state.demandes, today());
      if (!state.tab && state.loaded) state.tab = lists.validate.length ? "validate" : "today";
      const body = state.loaded ? TAB_BODY[state.tab](lists[state.tab]) : loadingHtml;
      const a = document.activeElement;
      const typing = a?.matches?.("[data-keep]") ? `[data-keep="${a.dataset.keep}"]` : a?.matches?.("[data-search], [data-note]") ? (a.matches("[data-search]") ? "[data-search]" : "[data-note]") : null;
      view.innerHTML = `<header class="presta-top">
          <p class="presta-who">${esc(state.providerName || "Mon espace prestataire")}</p>
          <h1>${esc(cap(D.dayLabel(today())))}</h1>
        </header>
        ${alertCard()}
        <nav class="presta-tabs" role="tablist" aria-label="Mes demandes">${tabsHtml(lists)}</nav>
        <div class="presta-body">${body}</div>
`;
      scheduleUndoEnd();
      const input = typing && view.querySelector(typing);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }

    // The « Corriger » button disappears by itself when its 10 minutes are over.
    let undoTimer = null;
    function scheduleUndoEnd() {
      clearTimeout(undoTimer);
      const left = state.demandes.map((d) => D.undoDoneLeftMs(d, email, Date.now())).filter((ms) => ms > 0);
      if (left.length) undoTimer = setTimeout(() => { if (state.openForm?.startsWith("undo:")) state.openForm = null; render(); }, Math.min(...left) + 500);
    }

    // ---------- actions ----------
    const byId = (id) => state.demandes.find((d) => d.id === id);
    async function undoDone(d, note) {
      if (!d || !D.canUndoDone(d, email, Date.now())) { state.openForm = null; render(); return toast("Plus de 10 minutes : appelle l'équipe pour corriger"); }
      state.busy.add(d.id); state.openForm = null; render();
      try { await store.undoDone(d, email, note); toast(`C'est corrigé : ${d.plaque} est de nouveau à faire`); }
      catch (err) { toast(err?.code === "permission-denied" ? "Plus de 10 minutes : appelle l'équipe pour corriger" : "Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }
    async function send(d, retour, message) {
      state.busy.add(d.id); state.openForm = null; render();
      try { await store.answer(d, { ...retour, par: email }); toast(message); }
      catch { toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    // A problem report; the photo is optional. Nothing is lost if it fails: the form stays open with what was typed.
    async function sendProblem(d, note) {
      const check = D.problemReport(d, { texte: note }, email, "");
      if (check.error) return toast(check.error);
      const draft = { ...state.draft, note };
      state.busy.add(d.id); state.openForm = null; render();
      try {
        await store.reportProblem(d, { texte: note, par: email }, draft.photo?.full);
        state.draft = {}; toast("Problème envoyé à l'équipe, merci !");
      } catch { state.openForm = "problem:" + d.id; state.draft = draft; toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }
    async function addPhoto(file) {
      state.draft.photoBusy = true; render();
      try { state.draft.photo = await prepareImage(file); }
      catch { toast("Photo illisible : essaie avec une autre"); }
      finally { state.draft.photoBusy = false; render(); }
    }

    view.addEventListener("change", (e) => {
      if (e.target.matches("[data-photo]") && e.target.files[0]) addPhoto(e.target.files[0]);
      if (e.target.matches("[data-month]")) showMonth(e.target.value);
      if (e.target.matches("[data-fphoto]") && e.target.files[0]) addFieldPhoto(e.target.files[0]);
      if (e.target.matches("[data-fplate]")) { fd().plaque = D.normalizePlate(fd().plaque); e.target.value = fd().plaque; } // AB123CD -> AB-123-CD
    });
    // An older month's report: only that month is read (free plan's daily reads), then it stays loaded.
    function showMonth(month) {
      if (!/^\d{4}-\d{2}$/.test(month || "")) return;
      state.month = month; state.monthLoading = true; state.query = ""; render();
      store.loadProviderMonth(month + "-01").then(() => { state.monthLoading = false; render(); })
        .catch(() => { state.month = ""; state.monthLoading = false; toast("Impossible de charger ce mois, réessaie"); render(); });
    }
    view.addEventListener("input", (e) => {
      if (e.target.matches("[data-note]")) state.draft.note = e.target.value;
      else if (e.target.matches("[data-fplate]")) fd().plaque = e.target.value;
      else if (e.target.matches("[data-ftext]")) fd().texte = e.target.value;
      else if (e.target.matches("[data-search]")) { state.query = e.target.value; render(); }
    });
    view.addEventListener("click", (e) => {
      const el = (sel) => e.target.closest(sel);
      let b;
      if ((b = el("[data-alerts]"))) alerts.activate().then(() => { if (alerts.state === "on") toast("Alertes activées : une alerte d'essai arrive"); });
      else if ((b = el("[data-month-reset]"))) { state.month = ""; render(); }
      else if ((b = el("[data-fissue]"))) {
        const r = fd(), q = b.dataset.q;
        r.quoi = r.quoi.includes(q) ? r.quoi.filter((x) => x !== q) : [...r.quoi, q]; render();
        if (q === "Autre" && r.quoi.includes("Autre")) view.querySelector("[data-ftext]")?.focus({ preventScroll: true });
      }
      else if ((b = el("[data-fphoto-remove]"))) { fd().photo = null; fd().photoKey = ""; render(); }
      else if ((b = el("[data-fsend]"))) sendField();
      else if ((b = el("[data-fedit]"))) editField(b.dataset.fedit);
      else if ((b = el("[data-fcancel]"))) { state.fd = emptyField(); state.pdelArmed = null; render(); }
      else if ((b = el("[data-pdel]"))) deleteReport(b.dataset.pdel);
      else if ((b = el("[data-tab]"))) { state.tab = b.dataset.tab; state.openForm = null; state.query = ""; render(); window.scrollTo({ top: 0 }); }
      else if ((b = el("[data-take]"))) send(byId(b.dataset.take), { etat: "confirme" }, "Demande acceptée : elle est dans ton planning");
      else if ((b = el("[data-form]"))) {
        state.openForm = state.openForm === b.dataset.form ? null : b.dataset.form; state.draft = {}; render();
        const form = state.openForm && view.querySelector(".job-form");
        if (form) {
          form.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          if (state.openForm.startsWith("problem:")) form.querySelector("textarea")?.focus({ preventScroll: true });
        }
      }
      else if ((b = el("[data-photo-remove]"))) { state.draft.photo = null; render(); }
      else if ((b = el("[data-send]"))) {
        const [kind, id] = b.dataset.send.split(":");
        const form = b.closest(".job-form");
        const note = form.querySelector("[data-note]").value.trim();
        const withNote = note ? { note } : {};
        if (kind === "problem") sendProblem(byId(id), note);
        else if (kind === "undo") undoDone(byId(id), note);
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

    alerts?.listen(() => render());
    render();
    store.getProvider(account.prestataireId).then((p) => { state.providerName = p?.nom || ""; render(); }).catch(() => {});
    store.subscribeProvider(account.prestataireId, {
      recentFrom,
      onDemandes: (rows) => { state.demandes = rows; state.loaded = true; render(); },
      onModels: (rows) => { state.models = new Map(rows.map((m) => [D.modelKey(m), m])); render(); },
      onProblems: (rows) => { state.problems = rows; render(); },
      onError: () => toast("Connexion interrompue : recharge la page"),
    });
  }
  root.SuiviPresta = { start };
})(typeof self !== "undefined" ? self : this);
