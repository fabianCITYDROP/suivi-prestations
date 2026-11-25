// Provider screen: what a provider sees after signing in. Only its own requests are loaded
// (the access rules refuse anything else).
// 1. "À valider": a new request is accepted, refused, or answered with another date.
// 2. "Aujourd'hui": accepted vehicles on site today (multi-day windows included), closed with "Prestation réalisée".
// 3. "À venir": accepted vehicles of the next days, searchable; one can be done early if the vehicle is already there.
// 4. "Faits": history and counts.
// On any accepted vehicle (and for 7 days once done), the provider can report a problem seen on it: a few words, up to 3 photos.
// For 10 minutes after « Prestation réalisée », the provider can take it back (wrong vehicle): it goes back to its list.
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

    // ---------- barre du haut (fixe, translucide) ----------
    // Au repos : logo + « City-Drop × Presta » et le nom du prestataire dessous. Une fois le grand titre passé sous la barre,
    // le titre de l'onglet prend sa place (comme les grands titres sur iPhone) et un filet fin apparaît sous la barre.
    const brandWord = document.querySelector("header.top .brand-word");
    const bar = document.createElement("span");
    bar.className = "bar-stack";
    brandWord.replaceWith(bar);
    bar.innerHTML = `<span class="bar-rest"></span><span class="bar-ctx" aria-hidden="true"><b data-bar-title></b><small data-bar-sub></small></span>`;
    bar.firstChild.append(brandWord);
    bar.firstChild.insertAdjacentHTML("beforeend", `<small class="bar-who" data-bar-who></small>`);
    let barTicking = false;
    function barScroll() {
      barTicking = false;
      const h1 = view.querySelector(".presta-top h1");
      const barBottom = document.querySelector("header.top").getBoundingClientRect().bottom;
      document.body.classList.toggle("bar-edge", scrollY > 4);
      document.body.classList.toggle("bar-titled", !!h1 && h1.getBoundingClientRect().bottom < barBottom + 2);
    }
    addEventListener("scroll", () => { if (!barTicking) { barTicking = true; requestAnimationFrame(barScroll); } }, { passive: true });
    function paintBar(title) {
      const who = state.providerName || "Mon espace prestataire";
      bar.querySelector("[data-bar-who]").textContent = who;
      bar.querySelector("[data-bar-title]").textContent = title;
      bar.querySelector("[data-bar-sub]").textContent = who;
      barScroll();
    }
    // Initiales du prestataire dans une pastille en relief (« Allo Pare-Brise » → AP).
    const initials = (name) => (name || "").replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

    // ---------- pieces ----------
    const modelPhotos = (d) => state.models.get(D.modelKey(d))?.photos || [];
    const slot = (d) => D.timeSlotLabel(d).replace(/^de /, "").replace(" à ", " – ");
    const when = (d) => (D.isMultiDay(d) ? `Du ${D.shortDate(d.date)} au ${D.shortDate(D.lastDay(d))}` : D.shortDate(d.date));
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    function modelHtml(d) {
      const [name, size] = (D.vehicleLabel(d) || "").split(" – ");
      return `<span class="job-model">${esc(name || "Modèle non précisé")}${size ? ` · ${esc(size)}` : ""}</span>`;
    }
    // Le type de prestation en icône en volume (même famille que « Signaler »), dans une tuile en relief.
    const SERVICE_ART = { lavage: "Véhicule sale", "pare-brise": "Pare-brise", intervention: "svc-intervention", hayon: "svc-hayon" };
    const serviceTile = (d, cls = "svc-tile") => `<span class="${cls}" aria-hidden="true">${self.IssueArt?.art(SERVICE_ART[d.service] || "svc-intervention", "svc-art") || ""}</span>`;
    // withTime: the slot on the right (« Aujourd'hui », where date and site are already given by the section).
    function jobHead(d, { withTime = false } = {}) {
      return `<div class="job-head">${serviceTile(d)}
        <div class="job-id"><div class="job-line">${plateTag(d.plaque)}${withTime ? `<span class="job-time">${esc(slot(d))}</span>` : ""}</div>${modelHtml(d)}<span class="job-kind">${esc(D.jobLabel(d))}</span>
        ${D.isLate(d, today()) ? `<span class="late-pill">${icon("alert")}En retard · prévu ${esc(D.shortDate(D.lastDay(d)))}</span>` : ""}</div></div>`;
    }
    function jobMeta(d, { withDate = true, withSite = true } = {}) {
      const late = D.isLate(d, today());
      const items = [
        withDate && `<li>${icon("cal")}<span>${esc(cap(when(d)))}</span></li>`,
        withDate ? `<li>${icon("clock")}<span>${esc(cap(slot(d)))}</span></li>`
          : D.isMultiDay(d) && !late && `<li>${icon("cal")}<span>Sur site jusqu'au ${esc(D.shortDate(D.lastDay(d)))}</span></li>`,
        withSite && `<li>${icon("pin")}<span>${esc([d.site, d.adresse].filter(Boolean).join(" · ") || "Site à préciser")}</span></li>`,
      ].filter(Boolean);
      return (items.length ? `<ul class="job-meta">${items.join("")}</ul>` : "") +
        (d.tache ? `<p class="job-task">${icon("check")}<span><b>À faire :</b> ${esc(d.tache)}</span></p>` : "") +
        (d.notes ? `<p class="job-note">${esc(d.notes)}</p>` : "");
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
      return D.problemsOfRequest(state.problems, d.id).map((p) => `<div class="job-problem">${icon("alert")}<span><b>Problème signalé :</b> ${esc(D.problemSummary(p))}<small>${p.statut === "traite" ? "Vu par l'équipe" : "Envoyé à l'équipe"}${D.photosLabel(p)}</small></span>${deleteReportBtn(p)}</div>`).join("");
    }
    function answerLine(d) {
      const r = d.retour;
      if (!r || ["fait", "confirme", "erreur"].includes(r.etat)) return "";
      return `<p class="job-answer">${icon("alert")}<span>${esc(D.answerSummary(r))}${r.vu ? "" : " · en attente de l'équipe"}</span></p>`;
    }

    // ---------- actions in a sheet over the screen (done, postpone, missing vehicle, problem, not possible, take back) ----------
    // Same sheet as « Signaler »: the card stays where it is, nothing unfolds inside the list.
    const ACTS = {
      done: { title: "Prestation réalisée ?", btn: "Confirmer : réalisée", noteLabel: "Un mot pour l'équipe", ph: "Ex. RAS, tout est propre" },
      undo: { title: "Remettre à faire ?", btn: "Oui, remettre à faire", noteLabel: "Un mot pour l'équipe", ph: "Ex. c'était le véhicule d'à côté" },
      date: { title: "Reporter", btn: "Proposer cette date", noteLabel: "Un mot pour l'équipe", ph: "Ex. complet jeudi matin" },
      absent: { title: "Véhicule absent", btn: "Signaler le véhicule absent", noteLabel: "Un mot pour l'équipe", ph: "Ex. pas sur le parking à 9 h" },
      refuse: { title: "Pas possible", btn: "Confirmer : pas possible", noteLabel: "Pourquoi ?", ph: "Ex. pièce indisponible" },
      problem: { title: "Problème sur le véhicule", btn: "Envoyer à l'équipe" },
    };
    const actOf = () => { const [kind, id] = (state.openForm || "").split(":"); return { kind, d: byId(id) }; };
    const actTitle = (kind, d) => (kind === "veh" && d ? (d.date ? upDayTitle(d.date) : "Date à préciser")
      : kind === "date" && d && !D.isAccepted(d) ? "Proposer une autre date" : ACTS[kind]?.title || "");
    // Secondary actions: round raised buttons with an icon in volume (same family as « Signaler »), label underneath.
    const ACT_ART = { date: "act-date", absent: "act-absent", problem: "act-problem", refuse: "act-refuse" };
    const actBtn = (kind, id, label) => `<button type="button" class="act-btn" data-act="${kind}" data-id="${esc(id)}"><span class="act-ico" aria-hidden="true">${self.IssueArt?.art(ACT_ART[kind], "act-art") || ""}</span><span class="act-lbl">${label}</span></button>`;
    // The next days as one-tap choices; any other day stays in the date field.
    function nextDays(n) {
      const out = []; const d0 = new Date(today() + "T12:00:00");
      for (let i = 1; i <= n; i++) { const x = new Date(d0); x.setDate(d0.getDate() + i); out.push(D.toIsoDate(x)); }
      return out;
    }
    const dayChip = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }).replace(".", "");
    function actBody() {
      const { kind, d } = actOf();
      if (kind === "veh" && d) return vehBody(d);
      const a = ACTS[kind];
      if (!a || !d) return "";
      const dr = state.draft;
      const note = (rows) => `<label class="sheet-group"><span class="sheet-label">${a.noteLabel || "Un mot pour l'équipe"} <i>facultatif</i></span>${rows
        ? `<textarea class="sheet-input" data-note rows="3" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="${a.ph}">${esc(dr.note || "")}</textarea>`
        : `<input class="sheet-input" data-note value="${esc(dr.note || "")}" placeholder="${a.ph}" maxlength="${D.PROBLEM_TEXT_MAX}">`}</label>`;
      const veh = `<div class="act-veh">${serviceTile(d, "svc-tile sm")}<span>${plateTag(d.plaque)}<small>${esc([D.vehicleLabel(d), D.jobLabel(d)].filter(Boolean).join(" · "))}</small></span></div>`;
      let fields = "";
      if (kind === "problem") fields = `<label class="sheet-group"><span class="sheet-label">Qu'est-ce qui ne va pas ?</span><textarea class="sheet-input" data-note rows="3" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="Ex. impact sur l'aile avant droite, pneu arrière gauche à plat, voyant moteur allumé">${esc(dr.note || "")}</textarea></label>${photosPicker(dr.photos || [], dr.photoBusy, "photo")}`;
      else if (kind === "date") fields = `<fieldset class="sheet-group day-set"><legend class="sheet-label">Nouvelle date</legend>
          <div class="day-chips">${nextDays(4).map((iso) => `<button type="button" class="day-chip" data-day="${iso}" aria-pressed="${dr.date === iso}">${esc(dayChip(iso))}</button>`).join("")}</div>
          <div class="day-row"><label><span>Autre jour</span><input type="date" class="sheet-input" data-date data-keep="adate" min="${today()}" value="${esc(dr.date || "")}"></label>
          <label><span>Heure <i>facultatif</i></span><input type="time" class="sheet-input" data-time data-keep="atime" step="900" value="${esc(dr.time || "")}"></label></div></fieldset>${note(false)}`;
      else fields = (a.text ? `<p class="sheet-sub">${a.text}</p>` : "") + note(false);
      const back = state.actFrom === d.id ? `<button type="button" class="sheet-back" data-veh="${esc(d.id)}">${icon("chev-l")}Retour au véhicule</button>` : "";
      return `<div class="act-sheet" data-asheet>${back}${veh}${fields}
        ${state.busy.has(d.id) ? busyLine : `<button type="button" class="primary big field-send${kind === "done" ? " ok" : ""}" data-asend>${kind === "done" ? icon("check") : ""}${a.btn}</button>`}</div>`;
    }
    // Up to 3 photos: the ones chosen (× takes one back), then « Ajouter » while there is room.
    // list: {full, thumb} just taken, or {key} already sent (a report being changed). kind: "photo" | "fphoto".
    function photosPicker(list, busy, kind) {
      const max = D.MAX_REPORT_PHOTOS;
      const tiles = list.map((ph, i) => `<span class="sheet-ph">${ph.thumb ? `<img src="${safeImageSrc(ph.thumb)}" alt="Photo ${i + 1}">` : `<span class="sheet-ph-kept">${icon("image")}</span>`}<button type="button" class="sheet-ph-x" data-${kind}-remove="${i}" aria-label="Retirer la photo ${i + 1}">${icon("x")}</button></span>`).join("");
      const add = busy ? `<p class="job-busy"><span class="spinner" aria-hidden="true"></span>Préparation de la photo…</p>`
        : list.length < max ? `<label class="sheet-photo-add">${icon("camera")}<span>${list.length ? "Ajouter une photo" : "Ajouter des photos"}</span><small>${list.length ? `${list.length} sur ${max}` : `facultatif · ${max} max`}</small><input type="file" accept="image/*" multiple data-${kind} hidden></label>` : "";
      return (tiles ? `<div class="sheet-photos">${tiles}</div>` : "") + add;
    }
    // The chosen files, made light, added after the ones already there (never more than 3).
    async function addPhotos(files, list, setBusy) {
      const room = D.MAX_REPORT_PHOTOS - list.length;
      if ([...files].length > room) toast(`${D.MAX_REPORT_PHOTOS} photos au maximum`);
      setBusy(true); render();
      try { for (const file of [...files].slice(0, Math.max(0, room))) list.push(await prepareImage(file, { light: true })); }
      catch { toast("Photo illisible : essaie avec une autre"); }
      finally { setBusy(false); render(); }
    }
    const busyLine = `<p class="job-busy"><span class="spinner" aria-hidden="true"></span>Envoi en cours…</p>`;

    // ---------- cards per tab ----------
    // « À valider » : la date et le site d'abord (c'est ce qui décide), le véhicule ensuite.
    const relDay = (iso) => { const n = Math.round((new Date(iso + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5); return n === 0 ? "Aujourd'hui" : n === 1 ? "Demain" : ""; };
    function calTile(iso) {
      const x = new Date((iso || today()) + "T12:00:00");
      return `<span class="cal-tile" aria-hidden="true"><small>${esc(x.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""))}</small><b>${x.getDate()}</b></span>`;
    }
    // En tête de carte : le jour en grand (c'est ce qui décide), puis le lieu et le véhicule dans une liste groupée.
    function askWhen(d) {
      const rel = !D.isMultiDay(d) && d.date ? relDay(d.date) : "";
      const n = d.date ? Math.round((new Date(d.date + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5) : null;
      const over = !d.date ? "" : rel || (n > 1 ? `Dans ${n} jours` : "");
      const long = (iso) => cap(new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
      const dm = (iso, month = true) => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", month ? { day: "numeric", month: "long" } : { day: "numeric" });
      const last = D.lastDay(d);
      const day = !d.date ? "Date à préciser"
        : D.isMultiDay(d) ? `Du ${dm(d.date, d.date.slice(0, 7) !== last.slice(0, 7))} au ${dm(last)}`
        : long(d.date);
      return `<header class="ask-when">${calTile(d.date)}
        <div class="ask-when-txt">${over ? `<p class="ask-rel">${esc(over)}</p>` : ""}<p class="ask-day">${esc(day)}</p><p class="ask-slot">${icon("clock")}${esc(slot(d))}</p></div></header>`;
    }
    function askFacts(d) {
      return `<ul class="ask-facts">
        <li><span class="ask-glyph" aria-hidden="true">${icon("pin")}</span><span class="ask-fact"><b>${esc(d.site || "Site à préciser")}</b>${d.adresse ? `<small>${esc(d.adresse)}</small>` : ""}</span></li>
        <li>${serviceTile(d, "svc-tile xs")}<span class="ask-fact"><span class="ask-plate">${plateTag(d.plaque)}<em>${esc(D.jobLabel(d))}</em></span>${modelHtml(d)}</span></li>
      </ul>`;
    }
    const askAlt = (kind, id, label) => `<button type="button" class="ask-alt" data-act="${kind}" data-id="${esc(id)}"><span class="ask-alt-art" aria-hidden="true">${self.IssueArt?.art(ACT_ART[kind], "act-art") || ""}</span>${label}</button>`;
    // Réponse déjà envoyée (autre date, pas possible…) : pastille orange en haut de la carte, l'équipe n'a pas encore tranché.
    function askAnswer(d) {
      const r = d.retour;
      if (!r || ["fait", "confirme", "erreur"].includes(r.etat)) return "";
      return `<p class="ask-answer">${icon("clock")}<span><b>${esc(D.answerSummary(r))}</b>${r.vu ? "Vu par l'équipe" : "En attente de l'équipe"}</span></p>`;
    }
    function validateCard(d) {
      const flying = state.accepting === d.id;
      return `<article class="job ask${flying ? " accepting" : ""}" data-job="${esc(d.id)}">${askWhen(d)}${askFacts(d)}${d.tache ? `<p class="job-task">${icon("check")}<span><b>À faire :</b> ${esc(d.tache)}</span></p>` : ""}${d.notes ? `<p class="job-note">${esc(d.notes)}</p>` : ""}${photosStrip(d)}${askAnswer(d)}
        ${state.busy.has(d.id) && !flying ? busyLine : `<div class="job-actions ask-btns">
          <button type="button" class="primary big ok-btn" data-take="${esc(d.id)}"><span class="ok-badge" aria-hidden="true">${icon("check")}</span>Accepter</button>
          <div class="ask-alts">${askAlt("date", d.id, "Autre date")}${askAlt("refuse", d.id, "Pas possible")}</div></div>`}
      ${flying ? `<div class="job-done-flash ask-flash" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg><b>Acceptée</b><small>Rangée dans ${esc(state.acceptTo === "today" ? "Aujourd'hui" : "À venir")}</small></div>` : ""}</article>
`;
    }
    // early: a vehicle of « À venir » done ahead of time (date and site shown, the section does not give them).
    function doCard(d, { early = false } = {}) {
      const leaving = state.leaving === d.id;
      return `<article class="job${leaving ? " leaving" : ""}" data-job="${esc(d.id)}">${jobHead(d, { withTime: !early })}${jobMeta(d, { withDate: early, withSite: early })}${photosStrip(d)}${answerLine(d)}
        ${state.busy.has(d.id) && !leaving ? busyLine : `<div class="job-actions">
          <button type="button" class="primary big ok-btn" data-act="done" data-id="${esc(d.id)}"><span class="ok-badge" aria-hidden="true">${icon("check")}</span>Prestation réalisée</button>
          <div class="act-row">${actBtn("date", d.id, "Reporter")}${actBtn("absent", d.id, "Véhicule absent")}${actBtn("problem", d.id, "Problème")}</div></div>`}
      ${problemLines(d)}${leaving ? `<div class="job-done-flash" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg><b>Réalisée</b></div>` : ""}</article>`;
    }
    const doneDayOf = (d) => (d.retour?.etat === "fait" ? d.retour.at : d.doneAt || d.date || "").slice(0, 10);
    // « Faits » : une liste groupée par jour, façon iPhone. L'heure du « fait » à droite, les deux actions possibles
    // (Corriger pendant 10 minutes, Problème pendant 7 jours) en petites capsules sous la ligne.
    function doneTime(d) {
      const at = d.retour?.etat === "fait" ? d.retour.at : d.doneAt;
      if (!at || !String(at).includes("T")) return "";
      const t = new Date(at);
      return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }
    function doneRow(d) {
      const day = doneDayOf(d);
      // A problem noticed after « Prestation réalisée » can still be reported for a few days.
      const recent = D.canReportAfterDone(day, today());
      const undo = D.canUndoDone(d, email, Date.now());
      const acts = recent || undo ? (state.busy.has(d.id) ? busyLine
        : `<div class="done-acts">${undo ? `<button type="button" class="done-pill undo" data-act="undo" data-id="${esc(d.id)}">${icon("x")}${esc(D.UNDO_DONE_LABEL)}</button>` : ""}${recent ? `<button type="button" class="done-pill" data-act="problem" data-id="${esc(d.id)}"><span class="done-pill-art" aria-hidden="true">${self.IssueArt?.art("act-problem", "act-art") || ""}</span>Problème</button>` : ""}</div>`) : "";
      const [name, size] = (D.vehicleLabel(d) || "").split(" – ");
      const time = doneTime(d);
      return `<li class="done-item">${serviceTile(d, "svc-tile xs")}
        <div class="done-main"><div class="done-line">${plateTag(d.plaque)}${time ? `<time class="done-time">${esc(time)}</time>` : ""}</div>
          <b class="done-model">${esc(name || D.jobLabel(d))}${size ? `<span> · ${esc(size)}</span>` : ""}</b>
          <small class="done-sub">${esc([name ? D.jobLabel(d) : "", d.site].filter(Boolean).join(" · "))}</small>
          ${problemLines(d)}${acts}</div>
        ${d.retour?.preuve ? `<button type="button" class="done-proof" data-proof="${esc(d.retour.preuve)}" aria-label="Voir la photo de ${esc(d.plaque)}">${icon("image")}</button>` : ""}</li>`;
    }
    // « Aujourd'hui », « Hier », puis « Mercredi 18 novembre ».
    function doneDayHead(iso) {
      if (iso === today()) return "Aujourd'hui";
      if (iso === D.addDays(today(), -1)) return "Hier";
      return iso ? cap(D.dayLabel(iso)) : "Date inconnue";
    }
    function doneGroups(list) {
      return [...D.groupBy(list, doneDayOf).entries()].map(([iso, rows]) => `<section class="done-day">
        <h2 class="done-day-head"><span>${esc(doneDayHead(iso))}</span><em>${rows.length}</em></h2>
        <ul class="done-list">${rows.map(doneRow).join("")}</ul></section>`).join("");
    }
    // Today's vehicles grouped by site: the provider goes site by site.
    function todayHtml(list) {
      return [...D.groupBy(list, D.siteOf).entries()].map(([site, rows]) => `<section class="spot">
        <header class="spot-head"><span class="spot-pin">${icon("pin")}</span><span><b>${esc(site)}</b>${rows[0].adresse ? `<small>${esc(rows[0].adresse)}</small>` : ""}</span><em aria-label="${rows.length} véhicule${rows.length > 1 ? "s" : ""}">${rows.length}</em></header>
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
        if (t.id === "report") return `<button type="button" class="tab-plus" data-sheet-open aria-haspopup="dialog" aria-label="Signaler une anomalie">${icon(t.icon)}<span>${t.label}</span></button>`;
        return `<button role="tab" data-tab="${t.id}" aria-selected="${state.tab === t.id}">${icon(t.icon)}<span>${t.label}</span>${badge}</button>`;
      }).join("");
    }
    // En tête : combien de demandes attendent une réponse, et combien attendent l'équipe (réponse déjà envoyée).
    function validateTab(all) {
      const list = all.filter((d) => d.id !== state.gone);
      if (!list.length) return `<div class="job-empty ask-empty"><span class="svc-tile lg" aria-hidden="true">${self.IssueArt?.art("empty-inbox", "svc-art") || ""}</span><b>Aucune demande à valider</b><span>Les nouvelles demandes de City-Drop arrivent ici.</span></div>`;
      const waiting = list.filter((d) => d.retour && !["fait", "confirme", "erreur"].includes(d.retour.etat)).length;
      const todo = list.length - waiting;
      const tile = (n, label, cls = "") => `<div class="ask-stat${cls}"><b>${n}</b><span>${label}</span></div>`;
      return `<section class="ask-sum" aria-label="Résumé">
          <span class="svc-tile" aria-hidden="true">${self.IssueArt?.art(todo ? "ask-inbox" : "empty-inbox", "svc-art") || ""}</span>
          ${todo ? tile(todo, `demande${todo > 1 ? "s" : ""} à valider`) : `<div class="ask-stat all"><b>${icon("check")}</b><span>Tu as répondu à tout</span></div>`}
          ${tile(waiting, "en attente de l'équipe", waiting ? " wait" : " none")}
        </section>
        ${list.map(validateCard).join("")}`;
    }
    // The day at a glance: what is left, what is already done today (green bar = done only).
    function daySummary(left) {
      const doneToday = state.demandes.filter((d) => D.isForProvider(d) && (d.retour?.etat === "fait" || d.statut === "realisee") && doneDayOf(d) === today()).length;
      const total = left + doneToday;
      if (!total) return "";
      const pct = Math.round((doneToday / total) * 100);
      const late = state.demandes.filter((d) => D.providerLists([d], today()).today.length && D.isLate(d, today())).length;
      const text = left ? `<b>${left}</b> véhicule${left > 1 ? "s" : ""} à faire${doneToday ? `<span> · ${doneToday} fait${doneToday > 1 ? "s" : ""}</span>` : ""}${late ? `<span class="sum-late"> · ${late} en retard</span>` : ""}`
        : `<b class="all-done">${icon("check")}Tout est fait</b><span> · ${doneToday} véhicule${doneToday > 1 ? "s" : ""}</span>`;
      return `<div class="day-sum"><p>${text}</p><div class="day-bar" role="progressbar" aria-label="Avancement de la journée" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${doneToday}"><i style="width:${pct}%"></i></div></div>`;
    }
    function todayTab(list) {
      return daySummary(list.length) + (list.length ? todayHtml(list) : empty("Rien de prévu aujourd'hui", "Tes véhicules acceptés s'affichent ici les jours où ils sont sur site."));
    }
    // « À venir » : groupé par jour (« Lundi 23 »), cartes compactes ; un appui sur la carte ouvre la feuille du véhicule
    // (détails + OK en avance, Reporter, Véhicule absent, Problème).
    const daysFromToday = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5);
    function upDayTitle(iso) {
      const dt = new Date(iso + "T12:00:00");
      const sameMonth = iso.slice(0, 7) === today().slice(0, 7);
      return cap(dt.toLocaleDateString("fr-FR", sameMonth ? { weekday: "long", day: "numeric" } : { weekday: "long", day: "numeric", month: "long" }));
    }
    const upDaySub = (iso) => { const n = daysFromToday(iso); return n === 1 ? "Demain" : `Dans ${n} jours`; };
    function upCard(d) {
      const leaving = state.leaving === d.id;
      const late = D.isMultiDay(d) ? `Jusqu'au ${D.shortDate(D.lastDay(d))}` : "";
      const probs = D.problemsOfRequest(state.problems, d.id).length;
      const r = d.retour, waiting = r && !["fait", "confirme", "erreur"].includes(r.etat);
      const flags = [
        waiting && `<span class="up-flag warn">${icon("alert")}${esc(D.answerOf(r.etat)?.label || "Réponse envoyée")}${r.vu ? "" : " · en attente"}</span>`,
        probs && `<span class="up-flag bad">${icon("alert")}Problème signalé</span>`,
      ].filter(Boolean).join("");
      return `<article class="up-card${leaving ? " leaving" : ""}" data-job="${esc(d.id)}">
        <button type="button" class="up-row" data-veh="${esc(d.id)}" aria-haspopup="dialog" aria-label="${esc(`${d.plaque || "Véhicule"}, ${D.jobLabel(d)}, ${d.site || "site à préciser"} : voir et agir`)}">
          ${serviceTile(d, "svc-tile sm")}
          <span class="up-id"><span class="up-line">${plateTag(d.plaque)}<span class="up-time">${esc(d.date ? slot(d) : "")}</span></span>
            <span class="up-what"><b>${esc(D.vehicleLabel(d) || "Modèle non précisé")}</b> · ${esc(D.jobLabel(d))}</span>
            <span class="up-where">${icon("pin")}<span>${esc(d.site || "Site à préciser")}${late ? ` · ${esc(late)}` : ""}</span></span>
            ${flags ? `<span class="up-flags">${flags}</span>` : ""}</span>
          <span class="up-chev" aria-hidden="true">${icon("chev-r")}</span>
        </button>
        ${state.busy.has(d.id) && !leaving ? `<div class="up-busy">${busyLine}</div>` : ""}
        ${leaving ? `<div class="job-done-flash" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg><b>Réalisée</b></div>` : ""}</article>`;
    }
    // La feuille d'un véhicule d'« À venir » : tout ce que la carte compacte ne montre pas, puis les actions.
    function vehBody(d) {
      return `<div class="act-sheet veh-sheet" data-asheet>
        <div class="act-veh">${serviceTile(d, "svc-tile sm")}<span>${plateTag(d.plaque)}<small>${esc([D.vehicleLabel(d), D.jobLabel(d)].filter(Boolean).join(" · "))}</small></span></div>
        <div class="veh-info">${jobMeta(d)}${photosStrip(d)}${answerLine(d)}${problemLines(d)}</div>
        ${state.busy.has(d.id) ? busyLine : `<div class="job-actions">
          <button type="button" class="primary big ok-btn" data-act="done" data-id="${esc(d.id)}"><span class="ok-badge" aria-hidden="true">${icon("check")}</span>Prestation réalisée</button>
          <div class="act-row">${actBtn("date", d.id, "Reporter")}${actBtn("absent", d.id, "Véhicule absent")}${actBtn("problem", d.id, "Problème")}</div></div>`}</div>`;
    }
    function upcomingTab(all) {
      const list = filtered(all);
      const groups = [...D.groupBy(list, (d) => d.date || "").entries()].sort(([a], [b]) => (!a) - (!b) || a.localeCompare(b));
      const search = `<div class="up-search">${searchBox()}</div>`;
      if (!list.length) return search + (state.query
        ? upEmpty("Aucun véhicule trouvé", `Rien ne correspond à « ${esc(state.query.trim())} ». Vérifie la plaque ou le site.`)
        : upEmpty("Rien à venir", "Tes demandes acceptées des prochains jours s'afficheront ici, jour par jour."));
      return search + `<p class="tab-intro up-intro">Un véhicule est déjà sur site ? Touche-le pour le faire en avance.</p>` +
        groups.map(([iso, rows]) => `<section class="up-day" aria-label="${esc(iso ? upDayTitle(iso) : "Date à préciser")}">
          <header class="up-day-head"><span><b>${esc(iso ? upDayTitle(iso) : "Date à préciser")}</b>${iso ? `<small>${esc(upDaySub(iso))}</small>` : ""}</span><em aria-label="${rows.length} véhicule${rows.length > 1 ? "s" : ""}">${rows.length}</em></header>
          <div class="up-list">${rows.map(upCard).join("")}</div></section>`).join("");
    }
    const upEmpty = (title, text) => `<div class="up-empty"><span class="up-empty-ico" aria-hidden="true">${self.IssueArt?.art("act-date", "act-art") || ""}</span><b>${title}</b><span>${text}</span></div>`;
    // Le sélecteur de mois : les 40 derniers jours (chargés à l'ouverture), les 2 mois d'avant en un appui, les autres dans une feuille.
    // Un ancien mois n'est lu qu'à la demande (quota de lectures), comme avant.
    const monthOf = (k) => { const d = new Date(today().slice(0, 7) + "-15T12:00:00"); d.setMonth(d.getMonth() - k); return D.toIsoDate(d).slice(0, 7); };
    const monthShort = (ym) => cap(new Date(ym + "-15T12:00:00").toLocaleDateString("fr-FR", { month: "long" }));
    function monthPills() {
      const quick = [monthOf(1), monthOf(2)];
      const other = state.month && !quick.includes(state.month) ? state.month : "";
      const pill = (ym, label) => `<button type="button" class="month-pill" data-month-pick="${ym}" aria-pressed="${state.month === ym}">${esc(label)}</button>`;
      return `<div class="month-pills" role="group" aria-label="Période">${pill("", "40 derniers jours")}${quick.map((ym) => pill(ym, monthShort(ym))).join("")}
        ${other ? pill(other, D.monthLabel(other)) : ""}<button type="button" class="month-pill more" data-month-more aria-haspopup="dialog">${icon("cal")}Autre mois</button></div>`;
    }
    function monthSheetBody() {
      const months = Array.from({ length: 12 }, (_, i) => monthOf(i + 1));
      return `<div class="month-sheet">
        ${[...D.groupBy(months, (ym) => ym.slice(0, 4)).entries()].map(([y, list]) => `<section><h3 class="sheet-label">${y}</h3><div class="month-grid">
          ${list.map((ym) => `<button type="button" class="day-chip" data-month-pick="${ym}" aria-pressed="${state.month === ym}">${esc(monthShort(ym))}</button>`).join("")}</div></section>`).join("")}
        <label class="sheet-group"><span class="sheet-label">Plus ancien</span><input type="month" class="sheet-input" data-month value="${esc(state.month)}" max="${monthOf(1)}"></label></div>`;
    }
    // Le compteur en grand : le mois en cours (ou le mois choisi), avec aujourd'hui et cette semaine à côté.
    function doneSummary(n, label, side) {
      return `<div class="done-sum"><div class="done-sum-main"><b class="done-count">${n}</b><span>${icon("check")}${esc(label)}</span></div>
        ${side.length ? `<dl class="done-sum-side">${side.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}</div>`;
    }
    const doneEmpty = (title, text) => `<div class="done-empty"><span class="done-empty-ico" aria-hidden="true">${self.IssueArt?.art("faits-vide", "svc-art") || ""}</span><b>${title}</b><span>${text}</span></div>`;
    const plural = (n, w) => `${w}${n > 1 ? "s" : ""}`;
    function doneTab(all) {
      if (state.month) { // report of one month, loaded on demand
        const inMonth = all.filter((d) => doneDayOf(d).slice(0, 7) === state.month);
        const list = filtered(inMonth);
        const days = new Set(inMonth.map(doneDayOf)).size;
        const head = state.monthLoading
          ? `<div class="done-sum loading" aria-busy="true"><span class="spinner" aria-hidden="true"></span><span>Chargement de ${esc(D.monthLabel(state.month))}…</span></div>`
          : doneSummary(inMonth.length, `${plural(inMonth.length, "véhicule")} en ${D.monthLabel(state.month)}`, inMonth.length ? [["Jours travaillés", days]] : []);
        return head + monthPills() + (state.monthLoading ? "" : searchBox() + (list.length ? doneGroups(list)
          : state.query ? doneEmpty("Aucun véhicule trouvé", "Vérifie la plaque ou le site.") : doneEmpty("Aucun véhicule fait ce mois-là", "Choisis un autre mois.")));
      }
      const counts = D.providerCounts(state.demandes, today());
      const recent = all.filter((d) => doneDayOf(d) >= recentFrom); // an older month looked at stays loaded, not listed here
      const list = filtered(recent);
      const monday = D.mondayOf(today());
      const side = [["Aujourd'hui", recent.filter((d) => doneDayOf(d) === today()).length], ["Cette semaine", recent.filter((d) => doneDayOf(d) >= monday).length]];
      return doneSummary(counts.month, `${plural(counts.month, "véhicule")} ${plural(counts.month, "fait")} en ${monthShort(today().slice(0, 7)).toLowerCase()}`, side) + monthPills() + searchBox() +
        (list.length ? doneGroups(list) : state.query ? doneEmpty("Aucun véhicule trouvé", "Vérifie la plaque ou le site.")
          : doneEmpty("Aucun véhicule fait", "Chaque prestation réalisée s'ajoute ici."));
    }
    // ---------- « Signaler »: field reports on any vehicle ----------
    // One vehicle at a time: « Envoyer » clears the form for the next one (several vehicles = several quick sends).
    // A report of the list is touched to change or delete it, until the team has handled it.
    const emptyField = () => ({ plaque: "", quoi: [], texte: "", photos: [], photoBusy: false, editId: null });
    const fd = () => (state.fd ||= emptyField());
    const editable = (p) => p.statut !== "traite" && p.par === email;
    // One drawn icon per anomaly (same 24px grid and stroke as the app's icons): quicker to spot than words.
    // Icônes en volume (src/icons3d.js). popQ : la tuile qu'on vient de choisir, qui fait un petit rebond.
    const issueIcon = (q) => self.IssueArt?.art(q) || "";
    const miniIcons = (quoi) => (quoi || []).filter((q) => self.IssueArt?.has(q)).slice(0, 4).map((q) => self.IssueArt.art(q, "mini-art")).join("");
    // Le bouton reste gris tant qu'il manque l'immatriculation ou un choix ; un appui explique quand même ce qui manque.
    const fieldReady = () => !D.fieldReport({ ...fd(), photos: [] }, account.prestataireId, email, "").error;
    const syncSend = () => sheetEl.querySelector("[data-fsend]")?.setAttribute("aria-disabled", String(!fieldReady()));
    const sheetTitle = () => (fd().editId ? "Modifier le signalement" : "Signaler une anomalie");
    function sheetBody() {
      const r = fd(), editing = !!r.editId;
      const photo = photosPicker(r.photos, r.photoBusy, "fphoto");
      const del = state.pdelArmed === r.editId
        ? `<button type="button" class="field-del armed" data-pdel="${esc(r.editId)}">${icon("trash")}Supprimer ?</button>`
        : `<button type="button" class="field-del" data-pdel="${esc(r.editId)}">${icon("trash")}Supprimer</button>`;
      const plates = [...new Set(state.demandes.map((d) => d.plaque).filter(Boolean))];
      const mine = state.problems.filter(D.isFieldReport).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 15);
      return `
        <datalist id="fieldPlates">${plates.map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
        <label class="sheet-group"><span class="sheet-label">Immatriculation</span><input class="field-plate" data-fplate data-keep="fplate" value="${esc(r.plaque)}" placeholder="AB-123-CD" autocapitalize="characters" autocomplete="off" spellcheck="false" list="fieldPlates" maxlength="12"></label>
        <fieldset class="issue-set"><legend class="sheet-label">Anomalies constatées</legend><div class="issue-grid">
          ${D.FIELD_ISSUES.map((q) => { const on = r.quoi.includes(q); return `<button type="button" class="issue-tile${state.popQ === q ? " pop" : ""}" data-fissue data-q="${esc(q)}" aria-pressed="${on}"><span class="issue-ico">${issueIcon(q)}<span class="issue-check" aria-hidden="true">${icon("check")}</span></span><span class="issue-lbl">${esc(q)}</span></button>`; }).join("")}
        </div></fieldset>
        <label class="sheet-group"><span class="sheet-label">${r.quoi.includes("Autre") ? "Précision (obligatoire pour « Autre »)" : "Précision (facultatif)"}</span><input class="sheet-input" data-ftext data-keep="ftext" value="${esc(r.texte)}" maxlength="${D.PROBLEM_TEXT_MAX}" placeholder="Ex. impact côté passager, pneu avant gauche usé"></label>
        ${photo}
        ${state.fieldBusy ? busyLine : editing
          ? `<div class="field-actions"><button type="button" class="primary big" data-fsend aria-disabled="${!fieldReady()}">Enregistrer</button><div class="field-actions-row"><button type="button" class="ghost" data-fcancel>Annuler</button>${del}</div></div>`
          : `<button type="button" class="primary big field-send" data-fsend aria-disabled="${!fieldReady()}">Transmettre à City-Drop</button>`}
        ${mine.length && !editing ? `<h3 class="sheet-label sent-title">Signalements récents</h3><ul class="field-sent">${mine.map(sentRow).join("")}</ul>` : ""}`;
    }
    function sentRow(p) {
      const body = `${plateTag(p.plaque)}<span class="sent-text"><b>${miniIcons(p.quoi) ? `<span class="mini-arts">${miniIcons(p.quoi)}</span>` : ""}${esc(D.problemSummary(p))}</b><small>${esc(cap(D.shortDate(p.at.slice(0, 10))))}${D.photosLabel(p)}${p.modifieAt ? " · modifié" : ""}</small></span>
        <span class="seen-pill${p.statut === "traite" ? " ok" : ""}">${D.washOfReport(p, state.demandes) ? "Lavage validé" : p.statut === "traite" ? "Traité" : "Transmis"}</span>`;
      return editable(p)
        ? `<li><button type="button" class="sent-row${fd().editId === p.id ? " current" : ""}" data-fedit="${esc(p.id)}" aria-label="Modifier ou supprimer le signalement ${esc(p.plaque)}">${body}${icon("chev-r")}</button></li>`
        : `<li><div class="sent-row">${body}<span></span></div></li>`;
    }
    async function sendField() {
      const r = fd();
      const check = D.fieldReport({ ...r, photos: [] }, account.prestataireId, email, "");
      if (check.error) return toast(check.error);
      state.fieldBusy = true; render();
      try {
        const fields = { plaque: r.plaque, quoi: r.quoi, texte: r.texte, par: email };
        const fresh = r.photos.filter((ph) => ph.full).map((ph) => ph.full);
        if (r.editId) { await store.updateField(state.problems.find((p) => p.id === r.editId), fields, fresh, r.photos.filter((ph) => ph.key).map((ph) => ph.key)); toast(`Signalement ${D.normalizePlate(r.plaque)} modifié`); }
        else { await store.reportField(account.prestataireId, fields, fresh); sentFlash(D.normalizePlate(r.plaque)); }
        state.fd = emptyField();
        sheetEl.querySelector(".sheet-b").scrollTop = 0;
      } catch (err) {
        toast(err?.code === "permission-denied" && r.editId ? "Déjà traité par City-Drop : faites un nouveau signalement" : "Envoi impossible : vérifie ta connexion et réessaie");
      } finally {
        state.fieldBusy = false; render();
        if (!state.fd.editId && state.sheetOpen) sheetEl.querySelector("[data-fplate]")?.focus({ preventScroll: true });
      }
    }
    // Après un envoi : une grande coche verte par-dessus la feuille pendant un peu plus d'une seconde.
    function sentFlash(plate) {
      sheetEl.querySelector(".sent-flash")?.remove();
      sheetEl.insertAdjacentHTML("beforeend", `<div class="sent-flash" role="status"><span class="sent-flash-card"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27l7.5 7.5L37.5 19"/></svg><b>Transmis à City-Drop</b><small>${esc(plate)}</small></span></div>`);
      navigator.vibrate?.([10, 60, 14]);
      const f = sheetEl.querySelector(".sent-flash");
      setTimeout(() => { f.classList.add("out"); setTimeout(() => f.remove(), 260); }, 1300);
    }
    function editField(id) {
      const p = state.problems.find((x) => x.id === id);
      if (!p || !editable(p)) return;
      state.fd = { ...emptyField(), editId: p.id, plaque: p.plaque, quoi: [...(p.quoi || [])], texte: D.fieldNoteOf(p), photos: D.reportPhotos(p).map((key) => ({ key, thumb: thumbOf(key) })) };
      state.pdelArmed = null; render();
      // Photos sent from another phone: read once (one read each) so the provider sees which one to take back.
      const form = state.fd;
      form.photos.filter((ph) => !ph.thumb).forEach((ph) => store.loadProof(ph.key).then((src) => { if (src && state.fd === form) { ph.thumb = src; render(); } }).catch(() => {}));
      sheetEl.querySelector(".sheet-b").scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    async function deleteReport(id) {
      if (state.pdelArmed !== id) { state.pdelArmed = id; render(); return; }
      state.pdelArmed = null; state.busy.add("pdel:" + id); state.fieldBusy = state.fd?.editId === id; render();
      try { await store.deleteProblem(state.problems.find((p) => p.id === id) || { id }); toast("Signalement supprimé"); if (state.fd?.editId === id) state.fd = emptyField(); }
      catch (err) { toast(err?.code === "permission-denied" ? "Déjà vu par l'équipe : appelle-la pour corriger" : "Suppression impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete("pdel:" + id); state.fieldBusy = false; render(); }
    }
    // A photo sent from this phone is still in memory: its small version is shown while the report is changed.
    const thumbOf = (key) => store.cachedPhoto?.("preuve:" + key) || "";

    const TAB_BODY = { validate: validateTab, today: todayTab, upcoming: upcomingTab, done: doneTab };

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
    // ---------- the « Signaler » sheet: slides up over the screen (iPhone-style), never a new page ----------
    // Built once; render() only refreshes its content, so it never re-animates. Drag the grabber down to close.
    view.innerHTML = `<div class="presta-main"></div>
      <div class="sheet-scrim" data-sheet-close></div>
      <section class="presta-sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" aria-hidden="true">
        <div class="sheet-grab" aria-hidden="true"><span></span></div>
        <header class="sheet-head"><h2 id="sheetTitle">Signaler une anomalie</h2><button type="button" class="sheet-x" data-sheet-close aria-label="Fermer">${icon("x")}</button></header>
        <div class="sheet-b"></div>
      </section>`;
    const main = view.querySelector(".presta-main");
    const sheetEl = view.querySelector(".presta-sheet");
    let lastFocus = null;
    // mode: "report" (« Signaler ») or "act" (an action on one vehicle, state.openForm = "kind:id").
    function openSheet(mode = "report") {
      if (state.sheetOpen) return;
      state.sheetMode = mode; state.sheetOpen = true; lastFocus = document.activeElement; render();
      sheetEl.style.transform = "";
      document.body.classList.add("sheet-open"); sheetEl.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => sheetEl.classList.add("on"));
      setTimeout(() => sheetEl.querySelector(".sheet-x")?.focus({ preventScroll: true }), 50);
    }
    function closeSheet() {
      if (!state.sheetOpen) return;
      state.sheetOpen = false; state.pdelArmed = null;
      if (state.sheetMode === "act") { state.openForm = null; state.draft = {}; state.actFrom = null; }
      if (state.fd?.editId) state.fd = null; // an edit left half-way is dropped; a new report being typed is kept
      sheetEl.style.transform = ""; sheetEl.classList.remove("on");
      document.body.classList.remove("sheet-open"); sheetEl.setAttribute("aria-hidden", "true");
      lastFocus?.focus?.({ preventScroll: true });
    }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.sheetOpen) closeSheet(); });
    // Drag to dismiss: follows the finger 1:1 from the grabber or the title, closes past 120 px or on a quick flick.
    (function dragToClose() {
      let startY = 0, lastY = 0, lastT = 0, v = 0, dragging = false;
      sheetEl.addEventListener("pointerdown", (e) => {
        if (!e.target.closest(".sheet-grab, .sheet-head") || e.target.closest("button")) return;
        dragging = true; startY = lastY = e.clientY; lastT = e.timeStamp; v = 0;
        sheetEl.setPointerCapture(e.pointerId); sheetEl.classList.add("dragging");
      });
      sheetEl.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp;
        sheetEl.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`; // resists upwards
      });
      const end = (e) => {
        if (!dragging) return;
        dragging = false; sheetEl.classList.remove("dragging");
        if (e.clientY - startY > 120 || v > 0.6) closeSheet(); else sheetEl.style.transform = "";
      };
      sheetEl.addEventListener("pointerup", end); sheetEl.addEventListener("pointercancel", end);
    })();

    // Re-renders the whole screen, keeping the cursor in the search box while the provider types.
    function render() {
      const lists = D.providerLists(state.demandes, today());
      if (!state.tab && state.loaded) state.tab = lists.validate.length ? "validate" : "today";
      const body = state.loaded ? TAB_BODY[state.tab](lists[state.tab]) : loadingHtml;
      const a = document.activeElement;
      const typing = a?.matches?.("[data-keep]") ? `[data-keep="${a.dataset.keep}"]` : a?.matches?.("[data-search], [data-note]") ? (a.matches("[data-search]") ? "[data-search]" : "[data-note]") : null;
      const title = TABS.find((t) => t.id === state.tab)?.label || "Mes demandes";
      const who = state.providerName || "Mon espace prestataire";
      main.innerHTML = `<header class="presta-top hero">
          <div class="hero-txt"><p class="hero-date">${esc(cap(D.dayLabel(today())))}</p><h1>${esc(title)}</h1></div>
          <span class="hero-me" role="img" aria-label="${esc(who)}" title="${esc(who)}"><span>${esc(initials(state.providerName))}</span></span>
        </header>
        ${alertCard()}
        <nav class="presta-tabs" role="tablist" aria-label="Mes demandes">${tabsHtml(lists)}</nav>
        <div class="presta-body">${body}</div>
`;
      const acting = state.sheetMode === "act";
      if (acting && state.sheetOpen && !actOf().d) closeSheet(); // the vehicle left the list meanwhile (done from another phone)
      const months = state.sheetMode === "month";
      sheetEl.querySelector("#sheetTitle").textContent = acting ? actTitle(actOf().kind, actOf().d) : months ? "Voir un autre mois" : sheetTitle();
      sheetEl.querySelector(".sheet-b").innerHTML = acting ? (state.openForm ? actBody() : "") : months ? monthSheetBody() : sheetBody();
      scheduleUndoEnd();
      paintBar(title);
      const input = typing && view.querySelector(typing);
      if (input) { input.focus(); try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* date / time fields */ } }
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
    async function send(d, retour, message, action) {
      state.busy.add(d.id); state.openForm = null; render();
      try { await store.answer(d, { ...retour, par: email }); toast(message, action); }
      catch { toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    // A problem report; the photo is optional. Nothing is lost if it fails: the form stays open with what was typed.
    async function sendProblem(d, note, typed = state.draft) {
      const check = D.problemReport(d, { texte: note }, email, "");
      if (check.error) { state.openForm = "problem:" + d.id; state.draft = typed; openSheet("act"); return toast(check.error); }
      const draft = { ...typed, note };
      state.busy.add(d.id); state.openForm = null; render();
      try {
        await store.reportProblem(d, { texte: note, par: email }, (draft.photos || []).map((ph) => ph.full));
        state.draft = {}; toast("Problème envoyé à l'équipe, merci !");
      } catch { state.openForm = "problem:" + d.id; state.draft = draft; openSheet("act"); toast("Envoi impossible : vérifie ta connexion et réessaie"); }
      finally { state.busy.delete(d.id); render(); }
    }

    view.addEventListener("change", (e) => {
      if (e.target.matches("[data-photo]") && e.target.files.length) addPhotos(e.target.files, (state.draft.photos ||= []), (v) => { state.draft.photoBusy = v; });
      if (e.target.matches("[data-month]")) { closeSheet(); showMonth(e.target.value); }
      if (e.target.matches("[data-fphoto]") && e.target.files.length) { const r = fd(); addPhotos(e.target.files, r.photos, (v) => { r.photoBusy = v; }); }
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
      else if (e.target.matches("[data-date]")) { state.draft.date = e.target.value; sheetEl.querySelectorAll("[data-day]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.day === e.target.value))); }
      else if (e.target.matches("[data-time]")) state.draft.time = e.target.value;
      else if (e.target.matches("[data-fplate]")) { fd().plaque = e.target.value; syncSend(); }
      else if (e.target.matches("[data-ftext]")) { fd().texte = e.target.value; syncSend(); }
      else if (e.target.matches("[data-search]")) { state.query = e.target.value; render(); }
    });
    view.addEventListener("click", (e) => {
      const el = (sel) => e.target.closest(sel);
      let b;
      if ((b = el("[data-alerts]"))) alerts.activate().then(() => { if (alerts.state === "on") toast("Alertes activées : une alerte d'essai arrive"); });
      else if ((b = el("[data-month-pick]"))) { const ym = b.dataset.monthPick; closeSheet(); if (!ym) { state.month = ""; state.query = ""; render(); } else if (ym !== state.month) showMonth(ym); }
      else if ((b = el("[data-month-more]"))) openSheet("month");
      else if ((b = el("[data-sheet-open]"))) openSheet();
      else if ((b = el("[data-sheet-close]"))) closeSheet();
      else if ((b = el("[data-fissue]"))) {
        const r = fd(), q = b.dataset.q;
        const adding = !r.quoi.includes(q);
        r.quoi = adding ? [...r.quoi, q] : r.quoi.filter((x) => x !== q);
        if (adding) { state.popQ = q; navigator.vibrate?.(8); }
        render(); state.popQ = null;
        if (q === "Autre" && r.quoi.includes("Autre")) sheetEl.querySelector("[data-ftext]")?.focus({ preventScroll: true });
      }
      else if ((b = el("[data-fphoto-remove]"))) { fd().photos.splice(Number(b.dataset.fphotoRemove), 1); render(); }
      else if ((b = el("[data-fsend]"))) sendField();
      else if ((b = el("[data-fedit]"))) editField(b.dataset.fedit);
      else if ((b = el("[data-fcancel]"))) { state.fd = emptyField(); state.pdelArmed = null; render(); }
      else if ((b = el("[data-pdel]"))) deleteReport(b.dataset.pdel);
      else if ((b = el("[data-tab]"))) { state.tab = b.dataset.tab; state.openForm = null; state.query = ""; render(); window.scrollTo({ top: 0 }); }
      else if ((b = el("[data-take]"))) acceptRequest(byId(b.dataset.take));
      else if ((b = el("[data-veh]"))) { // « À venir » : la feuille du véhicule (ou retour vers elle depuis une action)
        state.openForm = "veh:" + b.dataset.veh; state.actFrom = null; state.draft = {};
        if (state.sheetOpen) { render(); sheetEl.querySelector(".sheet-b").scrollTop = 0; } else openSheet("act");
      }
      else if ((b = el("[data-act]"))) {
        // From the vehicle sheet of « À venir »: the sheet stays open and shows the action, with a way back.
        const inSheet = state.sheetOpen && state.openForm?.startsWith("veh:");
        state.actFrom = inSheet ? b.dataset.id : null;
        state.openForm = `${b.dataset.act}:${b.dataset.id}`; state.draft = {};
        if (inSheet) { render(); sheetEl.querySelector(".sheet-b").scrollTop = 0; } else openSheet("act");
        if (b.dataset.act === "problem") setTimeout(() => sheetEl.querySelector("textarea[data-note]")?.focus({ preventScroll: true }), 380);
      }
      else if ((b = el("[data-day]"))) { state.draft.date = b.dataset.day; render(); }
      else if ((b = el("[data-photo-remove]"))) { (state.draft.photos || []).splice(Number(b.dataset.photoRemove), 1); render(); }
      else if ((b = el("[data-asend]"))) sendAct();
    });
    // The sheet's main button. « Prestation réalisée »: the card shows a green tick, then leaves the list.
    function sendAct() {
      const { kind, d } = actOf();
      if (!d) return closeSheet();
      const dr = state.draft;
      const note = (dr.note || "").trim();
      const withNote = note ? { note } : {};
      if (kind === "date" && !dr.date) return toast("Choisis la date que tu proposes");
      if (kind === "problem") { const typed = { ...dr }; closeSheet(); return sendProblem(d, note, typed); }
      if (kind === "undo") { closeSheet(); return undoDone(d, note); }
      closeSheet();
      if (kind === "done") return finishDone(d, withNote);
      if (kind === "absent") send(d, { etat: "absent", ...withNote }, "L'équipe est prévenue");
      else if (kind === "refuse") send(d, { etat: "refuse", ...withNote }, "L'équipe est prévenue");
      else if (kind === "date") send(d, { etat: "autre-date", date: dr.date, ...(dr.time ? { debut: dr.time } : {}), ...withNote }, "Date proposée à l'équipe");
    }
    const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    async function finishDone(d, withNote) {
      if (!reduceMotion()) { state.leaving = d.id; render(); navigator.vibrate?.([10, 60, 14]); await new Promise((r) => setTimeout(r, 720)); }
      state.leaving = null;
      // The bubble offers « Corriger » for a slip of the finger (same 10 minutes as in « Faits »).
      await send(d, { etat: "fait", ...withNote }, `${d.plaque} réalisé, merci !`,
        { label: "Corriger", run: () => { if (byId(d.id) && D.canUndoDone(byId(d.id), email, Date.now())) { state.openForm = "undo:" + d.id; state.draft = {}; openSheet("act"); } } });
    }

    // « Accepter » : coche verte sur la carte, puis la carte part vers l'onglet où elle est rangée (Aujourd'hui ou À venir),
    // les cartes du dessous remontent et le compteur de l'onglet rebondit. Sans animation si « réduire les animations ».
    async function acceptRequest(d) {
      if (!d || state.accepting) return;
      const to = d.date && d.date <= today() ? "today" : "upcoming";
      const label = to === "today" ? "Aujourd'hui" : "À venir";
      if (!reduceMotion()) {
        state.accepting = d.id; state.acceptTo = to; render(); navigator.vibrate?.(10);
        await new Promise((r) => setTimeout(r, 560));
        const card = main.querySelector(`[data-job="${CSS.escape(d.id)}"]`);
        const tab = main.querySelector(`[data-tab="${to}"]`);
        if (card && tab) {
          const c = card.getBoundingClientRect(), t = tab.getBoundingClientRect();
          const dx = t.left + t.width / 2 - (c.left + c.width / 2), dy = t.top + t.height / 2 - (c.top + c.height / 2);
          const fly = card.animate([{ transform: "none", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0 }],
            { duration: 420, easing: "cubic-bezier(.55, 0, .75, .2)", fill: "forwards" });
          const gap = parseFloat(getComputedStyle(card.parentElement).rowGap) || 0;
          card.style.height = c.height + "px";
          const shut = card.animate([{ height: c.height + "px", marginBottom: "0px" }, { height: "0px", marginBottom: -gap + "px" }],
            { duration: 300, delay: 260, easing: "cubic-bezier(.32, .72, 0, 1)", fill: "forwards" });
          await Promise.all([fly.finished, shut.finished]).catch(() => {});
        }
        state.gone = d.id; // la carte reste cachée pendant l'envoi ; elle revient seulement si l'envoi échoue
      }
      state.accepting = null;
      await send(d, { etat: "confirme" }, `${d.plaque} acceptée : dans ${label}`);
      if (state.gone && !reduceMotion()) main.querySelector(`[data-tab="${to}"] .count`)?.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.45)" }, { transform: "scale(.92)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
      state.gone = null; render();
    }

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
