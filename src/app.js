// Screens of the tracker. Business rules live in domain.js, data access in store.js.
(() => {
  const D = window.SuiviDomain;
  const { createStore, MAX_PHOTOS_PER_VEHICLE } = window.SuiviStore;
  /*@SHEET_SCRIPT*/

  const state = {
    store: null,
    canWrite: true,
    downloads: null,
    demandes: [],
    vehicles: new Map(),          // plateKey -> vehicle doc
    providers: D.DEFAULT_PROVIDERS.slice(),
    sites: D.DEFAULT_SITES.slice(), // [{nom, adresse}]
    fleet: D.DEFAULT_FLEET.slice(), // [{modele, cubage}]
    contacts: {},                 // provider -> WhatsApp number
    sheetUrl: "",
    day: D.toIsoDate(new Date()),
    providerFilter: "",
    editingId: null,
    checkedForVerification: new Set(),
    openVehicleKey: null,
    models: new Map(), // modelKey -> {modele, cubage, photos}
    openModelKey: null,
    providerDocs: new Map(), // providerId -> {nom, tarifs}
    accounts: [],            // [{id: email, role, prestataireId}]
    alertDevices: null,      // alert devices (abonnements) without their secrets; null = not readable
    hayons: [],              // [{plaque, dernierControle}] vehicles with a tailgate, from the provider's sheet
    hayonWarned: "",
    problems: [],            // [{demandeId, plaque, prestataireId, type, texte, photo?, statut, at, par}] problems seen by providers         // warning already shown once for the form being saved
    userEmail: "",
    recentFrom: D.recentWindowStart(D.toIsoDate(new Date()), D.TEAM_RECENT_DAYS), // requests before this day are loaded only on demand
    olderRanges: [],         // [{from, to, ready}] older periods already asked for
    robot: null,             // robot/etat: last trace left by the mail robot
  };
  // Providers who have their own access get a link to answer in the app instead of WhatsApp.
  const appLink = (providerName) => state.accounts.some((a) => a.role === "prestataire" && a.prestataireId === D.providerId(providerName))
    ? `\n\nRéponds directement sur l'appli : ${location.origin}${location.pathname}` : "";
  const pricesOf = (providerId) => state.providerDocs.get(providerId)?.tarifs || [];
  const today = () => D.toIsoDate(new Date());
  const siteNames = () => state.sites.map((s) => s.nom);
  const defaultProvider = () => state.providers[0] || "";
  // Older requests (before state.recentFrom) are read only when a page shows their period.
  // Returns "loading" while they arrive, "" when the period is already in the list.
  function needOlder(from, to) {
    const part = D.olderPart(from, to, state.recentFrom);
    if (!part || !state.store?.loadDemandesBetween) return "";
    const known = state.olderRanges.find((r) => r.from <= part.from && part.to <= r.to);
    if (known) return known.ready ? "" : "loading";
    const range = { ...part, ready: false };
    state.olderRanges.push(range);
    state.store.loadDemandesBetween(range.from, range.to)
      .then(() => { range.ready = true; renderAll(); })
      .catch(() => { state.olderRanges = state.olderRanges.filter((r) => r !== range); toast("Impossible de charger les anciennes demandes, réessaie"); renderAll(); });
    return "loading";
  }
  const allOlderLoaded = () => state.olderRanges.some((r) => r.ready && r.from === D.OLDEST_DAY);
  const demandeById = (id) => state.demandes.find((x) => x.id === id) || null;

  // ================= DOM helpers =================
  const $ = (selector) => document.querySelector(selector);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeImageSrc = (src) => (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src || "") ? src : "");
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const options = (values) => values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const plateTag = (plate) => `<span class="plate"><span>${esc(plate || "—")}</span></span>`;
  const statusChip = (status) => `<span class="chip st-${esc(status)}">${D.statusOf(status).label}</span>`;
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  function setSelectOptions(select, html) {
    const previous = select.value;
    select.innerHTML = html;
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  let toastTimer;
  // action (optional): { label, run } adds one button to the bubble, e.g. « Corriger » just after « OK prestation réalisée ».
  function toast(text, action) {
    const el = $("#toast");
    el.textContent = text; el.hidden = false; el.classList.toggle("with-action", !!action);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "toast-action"; btn.textContent = action.label;
      btn.addEventListener("click", () => { el.hidden = true; action.run(); });
      el.append(btn);
    }
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), action ? 6000 : 3200);
  }
  function banner(text) { const el = $("#banner"); el.textContent = text || ""; el.hidden = !text; }
  function reportWriteError(err) {
    if (err?.code === "invalid_argument") {
      state.canWrite = false;
      banner("Tu as accès en lecture seule : demande au propriétaire de te passer en « Contributeur » pour saisir des demandes.");
    } else if (err?.code === "quota_exceeded") toast("Stockage plein : supprime d'anciennes photos ou demandes");
    else if (err?.code === "too_many_photos") toast(`Ce véhicule a déjà ${MAX_PHOTOS_PER_VEHICLE} photos : supprimes-en une dans l'onglet Photos`);
    else toast("Enregistrement impossible pour le moment, réessaie dans un instant");
  }
  const TRASH_NOT_READY = "Suppression impossible : les nouvelles règles de la base ne sont pas encore publiées";
  const requireStore = () => { if (!state.store) toast("La base n'est pas disponible depuis cette vue"); return !!state.store; };

  // ================= clipboard & files =================
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const area = document.createElement("textarea");
    area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    let copied = false; try { copied = document.execCommand("copy"); } catch {}
    area.remove();
    if (!copied) toast("Copie bloquée par le navigateur : sélectionne le texte et copie-le à la main");
    return copied;
  }

  const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  const canvasToBlob = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), type, quality));
  const dataUrlToBlob = (dataUrl) => fetch(dataUrl).then((r) => r.blob());

  // One image holding every photo, grouped under the name of their model; photos are never cropped.
  async function buildPhotoSheet(entries, type = "image/png") {
    const images = await Promise.all(entries.map((e) => state.store.loadPhoto(e.key).then(loadImage)));
    const groups = [];
    entries.forEach((entry, i) => {
      let group = groups.find((g) => g.label === entry.plate);
      if (!group) groups.push((group = { label: entry.plate, items: [] }));
      group.items.push(images[i]);
    });
    // WhatsApp shrinks a pasted image to its long side (about 1600 px, 4096 px in HD), so a near-square
    // sheet gives each photo the most pixels: about √n photos per row instead of one long strip.
    const sheetGroups = groups.map((g) => ({ label: g.label, ratios: g.items.map((img) => img.naturalWidth / img.naturalHeight) }));
    const layout = D.photoSheetLayout(sheetGroups, D.squareSheetOptions(sheetGroups, { width: 2048, pad: 20, gap: 12, header: 72 }));
    const canvas = document.createElement("canvas");
    canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eef2f5"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    layout.headers.forEach((h) => {
      ctx.fillStyle = "#0f6f8f"; roundRect(ctx, h.x, h.y, h.width, h.height, 16); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.textBaseline = "middle";
      ctx.font = "700 38px 'IBM Plex Sans', sans-serif";
      ctx.fillText("Pare-brise · " + h.label, h.x + 24, h.y + h.height / 2);
    });
    layout.tiles.forEach((t) => {
      ctx.save(); roundRect(ctx, t.x, t.y, t.width, t.height, 14); ctx.clip();
      ctx.drawImage(groups[t.group].items[t.index], t.x, t.y, t.width, t.height);
      ctx.restore();
    });
    return canvasToBlob(canvas, type, 0.92);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Photos of every distinct model among the given vehicles, captioned with the model.
  const photoEntries = (vehicles) => D.uniqueModels(vehicles).flatMap((v) =>
    modelPhotos(v).map((p) => ({ key: p.key, plate: D.fleetLabel(v), label: "" })));

  // Must start synchronously from the click: ClipboardItem accepts a promise so the gesture is kept.
  async function copyImage(makePng, fallbackName, makeJpeg) {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": makePng() })]);
      toast("Photos copiées : colle-les dans WhatsApp avec Ctrl+V");
    } catch {
      if (state.downloads) { toast("Copie d'image refusée ici : je te propose de l'enregistrer"); await saveBlob(makeJpeg(), fallbackName); }
      else toast("Copie d'image refusée par le navigateur : clic droit sur la photo › Copier l'image");
    }
  }
  async function saveBlob(blobPromise, filename) {
    if (!state.downloads) return toast("Enregistrement indisponible ici : clic droit sur la photo › Enregistrer l'image");
    try { await state.downloads.save({ filename, data: await blobPromise }); }
    catch (e) { if (e?.code !== "declined") toast("Enregistrement impossible"); }
  }
  const singlePhotoPng = (key) => state.store.loadPhoto(key).then(loadImage).then((img) => {
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0); return canvasToBlob(c, "image/png");
  });
  const singlePhotoJpeg = (key) => state.store.loadPhoto(key).then(dataUrlToBlob);

  function shrinkImage(file, maxSide, quality) {
    const url = URL.createObjectURL(file);
    return loadImage(url).then((img) => {
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    }).finally(() => URL.revokeObjectURL(url));
  }
  // Each photo is one document: 256 KiB max inside claude.ai, 1 MiB on Firebase (the platform raises the limit).
  const MAX_PHOTO_CHARS = window.SUIVI_MAX_PHOTO_CHARS || 240000;
  async function prepareImage(file) {
    for (const [side, quality] of [[2400, 0.9], [2000, 0.86], [1600, 0.82], [1400, 0.72], [1000, 0.6], [800, 0.5]]) {
      const full = await shrinkImage(file, side, quality);
      if (full.length <= MAX_PHOTO_CHARS) return { full, thumb: await shrinkImage(file, 360, 0.75) };
    }
    throw new Error("too_big");
  }

  // ================= vehicles & photos =================
  const vehicleOf = (plate) => state.vehicles.get(D.plateKey(plate));
  const albumOf = (v) => state.models.get(D.modelKey(v));
  const modelPhotos = (v) => albumOf(v)?.photos || [];
  const photoFileName = (plate, index) => `${D.plateKey(plate)}-pare-brise-${index + 1}.jpg`;

  let pendingPhotoModel = null;
  function pickPhotosFor(model) {
    if (!D.modelKey(model)) return toast("Choisis d'abord le modèle et le cubage");
    pendingPhotoModel = { modele: model.modele, cubage: model.cubage ?? null };
    $("#photoInput").click();
  }
  async function addPhotoFiles(model, files) {
    if (!requireStore() || !D.modelKey(model)) return;
    let added = 0;
    for (const file of files) {
      try {
        // Re-read the album each time: the snapshot listener updates it between two uploads.
        await state.store.addModelPhoto(albumOf(model), model, await prepareImage(file));
        added++;
      } catch (err) {
        if (err instanceof Error) toast("Cette image n'a pas pu être lue");
        else { reportWriteError(err); break; }
      }
    }
    if (added) toast(`${plural(added, "photo")} ajoutée${added > 1 ? "s" : ""} pour ${D.fleetLabel(model)}`);
  }
  $("#photoInput").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (pendingPhotoModel && files.length) await addPhotoFiles(pendingPhotoModel, files);
  });
  document.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    if (!$("#view-demande").hidden) addPhotoFiles(selectedFleetModel(), [file]);
    else if (!$("#view-photos").hidden && state.openModelKey) addPhotoFiles(openModel(), [file]);
  });

  // ================= share block (text + WhatsApp + photos) =================
  let shareCount = 0;
  const shareRegistry = new Map(); // block id -> plates whose photos it sends
  // A ready-to-paste WhatsApp message. A WhatsApp link can carry text but never photos, so text and photos are copied one after the other.
  // Folded: only the buttons show, the text stays one click away.
  function shareBlock({ text, vehicles = [], folded = false }) {
    const id = "share-" + ++shareCount;
    const entries = photoEntries(vehicles);
    shareRegistry.set(id, vehicles);
    const copy = `<button type="button" class="primary big" data-copy="#${id}">${icon("copy")}Copier le message</button>`;
    const photos = entries.length
      ? `<button type="button" class="primary big" data-copy-sheet="${id}">${icon("image")}${entries.length > 1 ? `Copier les ${entries.length} photos` : "Copier la photo"}</button>
        <button type="button" class="big" data-save-all="${id}">${icon("download")}${entries.length > 1 ? `Télécharger les ${entries.length} photos` : "Télécharger la photo"} en taille réelle</button>`
      : "";
    const message = `<pre class="msg" id="${id}">${esc(text)}</pre>`;
    const photoHelp = entries.length ? `<p class="small muted">Rapide : colle le texte (Ctrl+V), puis les photos (Ctrl+V).<br>Meilleure qualité : télécharge les photos, puis glisse-les toutes ensemble dans la conversation WhatsApp. Chacune part en taille réelle et reste nette au zoom.</p>
      <div class="photo-strip">${entries.map((e) => photoMini(e)).join("")}</div>` : "";
    if (folded) {
      return `<div class="share"><div class="actions">${copy}${photos}</div>
        <details class="more msg-fold"><summary>${icon("chev-d")}Voir le message</summary>${message}${photoHelp}</details></div>`;
    }
    return `<div class="share">${message}<div class="actions">${copy}${photos}</div>${photoHelp}</div>`;
  }
  function photoMini(entry) {
    const thumb = (vehicleOf(entry.plate)?.photos || []).find((p) => p.key === entry.key)?.thumb;
    return `<figure><img src="${safeImageSrc(thumb)}" data-zoom="${esc(entry.key)}" alt="Pare-brise ${esc(entry.plate)}"><figcaption>${esc(entry.plate)}</figcaption></figure>`;
  }
  function photoTile(plate, photo, index) {
    const name = photoFileName(plate, index);
    return `<figure class="ph"><img src="${safeImageSrc(photo.thumb)}" data-zoom="${esc(photo.key)}" alt="Pare-brise ${esc(plate)} photo ${index + 1}">
      <div class="actions"><button type="button" data-copy-photo="${esc(photo.key)}" data-name="${esc(name)}">${icon("copy")}Copier</button>
      <button type="button" class="ghost" data-save-photo="${esc(photo.key)}" data-name="${esc(name)}" aria-label="Enregistrer">${icon("download")}</button>
      ${state.canWrite ? `<button type="button" class="ghost danger" data-remove-photo="${esc(photo.key)}" aria-label="Supprimer">${icon("x")}</button>` : ""}</div></figure>`;
  }
  // Each photo as its own full-size file: dropped together into WhatsApp they arrive as separate, sharp images.
  async function saveAllPhotos(entries) {
    if (!state.downloads) return toast("Téléchargement indisponible ici");
    for (const [i, entry] of entries.entries()) {
      await saveBlob(singlePhotoJpeg(entry.key), `${D.plateKey(entry.plate).toLowerCase()}-pare-brise-${i + 1}.jpg`);
      await new Promise((r) => setTimeout(r, 300)); // browsers drop downloads fired in the same instant
    }
    toast(`${plural(entries.length, "photo")} téléchargée${entries.length > 1 ? "s" : ""} : glisse-les dans WhatsApp`);
  }
  const sheetName = () => `photos-pare-brise-${today()}.jpg`;
  // Capture phase: read the text before a re-render triggered by the same click replaces it.
  document.addEventListener("click", (e) => {
    const target = (sel) => e.target.closest(sel);
    let el;
    if ((el = target("[data-copy]"))) { copyText($(el.dataset.copy).textContent).then((ok) => ok && toast("Texte copié, prêt à coller")); return; }
    if ((el = target("[data-copy-sheet]"))) { const entries = photoEntries(shareRegistry.get(el.dataset.copySheet) || []); copyImage(() => buildPhotoSheet(entries), sheetName(), () => buildPhotoSheet(entries, "image/jpeg")); return; }
    if ((el = target("[data-save-all]"))) { saveAllPhotos(photoEntries(shareRegistry.get(el.dataset.saveAll) || [])); return; }
    if ((el = target("[data-save-sheet]"))) { saveBlob(buildPhotoSheet(photoEntries(shareRegistry.get(el.dataset.saveSheet) || []), "image/jpeg"), sheetName()); return; }
    if ((el = target("[data-copy-photo]"))) { const key = el.dataset.copyPhoto; copyImage(() => singlePhotoPng(key), el.dataset.name, () => singlePhotoJpeg(key)); return; }
    if ((el = target("[data-save-photo]"))) { saveBlob(singlePhotoJpeg(el.dataset.savePhoto), el.dataset.name); return; }
    if ((el = target("[data-zoom]"))) openLightbox(el.dataset.zoom, el.src);
    if ((el = target("[data-proof]"))) openProof(el.dataset.proof);
  }, true);
  async function openLightbox(key, fallbackSrc) {
    $("#lightImg").src = fallbackSrc; $("#lightbox").hidden = false;
    const full = state.store ? await state.store.loadPhoto(key).catch(() => null) : null;
    if (full && !$("#lightbox").hidden) $("#lightImg").src = safeImageSrc(full);
  }
  async function openProof(key) {
    $("#lightImg").removeAttribute("src"); $("#lightbox").hidden = false;
    const full = state.store ? await state.store.loadProof(key).catch(() => null) : null;
    if (full && !$("#lightbox").hidden) $("#lightImg").src = safeImageSrc(full);
    else if (!full) { $("#lightbox").hidden = true; toast("Photo introuvable"); }
  }
  $("#lightbox").onclick = () => ($("#lightbox").hidden = true);

  // ================= Corbeille: deleted requests, kept 20 days, restorable =================
  const trash = { groups: [], error: false, loading: false };
  async function openTrash() {
    trash.loading = true; trash.error = false; renderTrash();
    if (!state.store) return; // page opened from its link before sign-in: listed once connected
    try {
      if (state.store && state.canWrite) await state.store.purgeTrash().catch(() => {});
      trash.groups = D.groupTrash(await state.store.loadTrash());
    } catch { trash.groups = []; trash.error = true; }
    trash.loading = false; renderTrash();
  }
  function trashCard(group) {
    const first = group.rows[0].demande;
    const many = group.rows.length > 1;
    const left = D.trashDaysLeft(group.supprimeLe, new Date().toISOString());
    const plates = group.rows.map((r) => plateTag(r.demande.plaque)).join(" ");
    const title = many ? `Lavage groupé · ${group.rows.length} véhicules` : esc(D.jobLabel(first));
    const job = many ? D.jobLabel(first) : "";
    const when = first.date ? D.numericDate(first.date) + (first.dateFin && first.dateFin !== first.date ? " au " + D.numericDate(first.dateFin) : "") : "";
    const deleted = `Supprimée le ${D.numericDate(group.supprimeLe.slice(0, 10)).slice(0, 5)}${group.supprimePar ? " par " + group.supprimePar : ""}`;
    return `<div class="trash-card">
      <div class="trash-head"><div class="trash-plates">${plates}</div><span class="trash-days${left <= 3 ? " soon" : ""}">Effacée dans ${left} j</span></div>
      <div class="trash-body"><b>${title}</b><span class="muted">${esc([job, when, first.prestataire].filter(Boolean).join(" · "))}</span><span class="muted small">${esc(deleted)}</span></div>
      ${state.canWrite ? `<button type="button" data-trash-restore="${esc(group.ids.join(","))}">${icon("check")}Restaurer</button>` : ""}
    </div>`;
  }
  function renderTrash() {
    const box = $("#trashList");
    box.innerHTML = trash.loading && !trash.groups.length ? `<p class="hint">Chargement…</p>`
      : trash.error ? `<div class="empty"><b>La corbeille n'est pas encore active.</b></div>`
      : !trash.groups.length ? `<div class="empty"><b>La corbeille est vide.</b></div>`
      : trash.groups.map(trashCard).join("");
  }
  $("#trashList").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-trash-restore]");
    if (!button || !requireStore()) return;
    const ids = button.dataset.trashRestore.split(",");
    button.disabled = true;
    try {
      await state.store.restoreDemandes(ids);
      toast(ids.length > 1 ? `${ids.length} demandes restaurées` : "Demande restaurée");
      trash.groups = trash.groups.filter((g) => g.ids.join(",") !== button.dataset.trashRestore);
      renderTrash();
    } catch (err) {
      button.disabled = false;
      if (err?.code === "already_exists") toast("Cette demande existe déjà dans le planning"); else reportWriteError(err);
    }
  });

  // ================= Google Sheet link =================
  function sheetLink(plates) {
    if (!/^https:\/\/script\.google\.com\//.test(state.sheetUrl) || !plates.length) return "";
    const href = state.sheetUrl + (state.sheetUrl.includes("?") ? "&" : "?") + "plaques=" + encodeURIComponent(plates.map(D.plateKey).join(","));
    return `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${icon("list")}Cocher dans le Google Sheet (${plates.length})</a>`;
  }

  // ================= navigation =================
  const VIEWS = ["planning", "retours", "demande", "hayon", "photos", "verif", "bilan", "historique", "corbeille", "reglages"];
  const navButtons = () => document.querySelectorAll("nav.tabs [data-view]");
  // « Nouvelle demande » (and an opened request) is a sheet over the page underneath, never a page of its own.
  let baseView = "planning";
  function show(view) {
    if (state.providerMode) return;
    if (!VIEWS.includes(view)) view = "planning";
    if (view === "demande") {
      VIEWS.forEach((v) => v !== "demande" && ($("#view-" + v).hidden = v !== baseView));
      markCurrentNav(baseView);
      openFormSheet();
      if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
      return;
    }
    closeFormSheet();
    baseView = view;
    VIEWS.forEach((v) => v !== "demande" && ($("#view-" + v).hidden = v !== view));
    markCurrentNav(view);
    if (view === "corbeille") openTrash();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    if (view === "bilan") renderReport(); // its month is read only once the page is opened
  }
  // Rare pages live under « Plus »: its label names the open page so the menu never hides where you are.
  function markCurrentNav(view) {
    navButtons().forEach((b) => b.toggleAttribute("aria-current", b.dataset.view === view));
    const inMore = $(`#navMore [data-view="${view}"]`);
    $("#navMoreLabel").textContent = inMore ? (inMore.querySelector(".menu-label") || inMore).textContent.trim() : "Plus";
    $("#navMore").classList.toggle("current", !!inMore);
    $("#navMore").open = false;
  }
  navButtons().forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.view)));
  document.addEventListener("click", (e) => { if (!e.target.closest("#navMore")) $("#navMore").open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#navMore").open) { $("#navMore").open = false; $("#navMore summary").focus(); } });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ================= shared selects =================
  const fleetOptions = () => `<option value="">Choisir le modèle…</option>` + state.fleet.map((f, i) => `<option value="${i}">${esc(D.fleetLabel(f))}</option>`).join("");
  function renderSelects() {
    const allProviders = `<option value="">Tous les prestataires</option>` + options(state.providers);
    if (state.providerFilter && !state.providers.includes(state.providerFilter)) state.providerFilter = "";
    setSelectOptions($("#provFilter"), allProviders); $("#provFilter").value = state.providerFilter;
    $("#provFilter").hidden = state.providers.length < 2;
    ["#h-prest", "#v-prest", "#b-prest"].forEach((s) => setSelectOptions($(s), allProviders));
    setSelectOptions($("#f-prest"), options(state.providers));
    $("#provRow").hidden = state.providers.length === 0;
    document.querySelectorAll("#form .m-base").forEach((base) => {
      setSelectOptions(base, baseOptions());
      fillVariants(base, variantSelectOf(base));
    });
    setSelectOptions($("#f-site"), `<option value="">Choisir un site…</option>` + options(siteNames()));
    setSelectOptions($("#h-site"), `<option value="">Tous les sites</option>` + options(siteNames()));
    renderChoiceTiles();
  }
  $("#h-statut").innerHTML = `<option value="">Tous les statuts</option><option value="ouvert">En cours (hors réalisées / annulées)</option>` + D.STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  $("#h-svc").innerHTML = `<option value="">Toutes prestations</option>` + D.SERVICES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  // An old month is read only when it is picked here (free plan's daily reads); the weeks are on the Planning.
  $("#h-mois").innerHTML = `<option value="">15 derniers jours et en cours</option>` + Array.from({ length: 24 }, (_, i) => {
    const d = D.parseIsoDate(D.monthStart(today())); d.setMonth(d.getMonth() - i);
    const month = D.toIsoDate(d).slice(0, 7);
    return `<option value="${month}">${esc(D.monthLabel(month).replace(/^./, (c) => c.toUpperCase()))}</option>`;
  }).join("");
  $("#taskChips").innerHTML = D.TASK_SUGGESTIONS.map((t) => `<button type="button" class="chip-btn" data-task="${esc(t)}">${esc(t)}</button>`).join("");
  // A tapped task is added to the text, which stays editable so the request can be made more precise.
  $("#taskChips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-task]");
    if (!chip) return;
    const input = field("tache");
    const tasks = input.value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!tasks.includes(chip.dataset.task)) input.value = [...tasks, chip.dataset.task].join(", ");
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  });
  $("#svcSeg").innerHTML = D.SERVICES.map((s, i) => `<label><input type="radio" name="svc" id="svc-${s.id}" value="${s.id}" ${i === 0 ? "checked" : ""}><span>${s.label}</span></label>`).join("");
  $("#washSeg").innerHTML = D.WASH_KINDS.map((k, i) => `<label><input type="radio" name="wash" id="wash-${k.id}" value="${k.id}" ${i === 0 ? "checked" : ""}><span>${k.label.replace("Lavage ", "")}</span></label>`).join("");

  // ================= team sheet: a card over the screen (bottom on phone, right-hand panel on computer) =================
  // Same look as the providers' sheets (.presta-sheet). Built once; open() swaps its content. Drag the grabber down to close.
  const teamSheet = (() => {
    let el = null, scrim = null, lastFocus = null, onClose = null;
    function build() {
      if (el) return;
      document.body.insertAdjacentHTML("beforeend", `<div class="sheet-scrim team-scrim" data-team-sheet-close></div>
        <section class="presta-sheet team-sheet" role="dialog" aria-modal="true" aria-labelledby="teamSheetTitle" aria-hidden="true">
          <div class="sheet-grab" aria-hidden="true"><span></span></div>
          <header class="sheet-head"><h2 id="teamSheetTitle"></h2><button type="button" class="sheet-x" data-team-sheet-close aria-label="Fermer">${icon("x")}</button></header>
          <div class="sheet-b"></div>
        </section>`);
      el = document.querySelector(".team-sheet"); scrim = document.querySelector(".team-scrim");
      document.addEventListener("click", (e) => { if (e.target.closest("[data-team-sheet-close]")) close(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && api.isOpen) close(); });
      let startY = 0, lastY = 0, lastT = 0, v = 0, dragging = false;
      el.addEventListener("pointerdown", (e) => {
        if (!e.target.closest(".sheet-grab, .sheet-head") || e.target.closest("button") || matchMedia("(min-width: 900px)").matches) return;
        dragging = true; startY = lastY = e.clientY; lastT = e.timeStamp; v = 0; el.setPointerCapture(e.pointerId); el.classList.add("dragging");
      });
      el.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dy = e.clientY - startY;
        v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp;
        el.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
      });
      const end = (e) => { if (!dragging) return; dragging = false; el.classList.remove("dragging"); if (e.clientY - startY > 120 || v > 0.6) close(); else el.style.transform = ""; };
      el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    }
    function open(title, html, { cls = "", closed } = {}) {
      build();
      el.className = "presta-sheet team-sheet" + (cls ? " " + cls : "") + (api.isOpen ? " on" : "");
      el.querySelector("#teamSheetTitle").textContent = title;
      el.querySelector(".sheet-b").innerHTML = html;
      onClose = closed || null;
      if (api.isOpen) return;
      api.isOpen = true; lastFocus = document.activeElement; el.style.transform = "";
      document.body.classList.add("sheet-open", "team-sheet-open"); el.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => el.classList.add("on"));
      setTimeout(() => el.querySelector(".sheet-x")?.focus({ preventScroll: true }), 50);
    }
    function close() {
      if (!api.isOpen) return;
      api.isOpen = false; el.style.transform = ""; el.classList.remove("on");
      document.body.classList.remove("sheet-open", "team-sheet-open"); el.setAttribute("aria-hidden", "true");
      const done = onClose; onClose = null; done?.();
      lastFocus?.focus?.({ preventScroll: true });
    }
    const api = { open, close, isOpen: false, get body() { build(); return el.querySelector(".sheet-b"); }, setTitle: (t) => { build(); el.querySelector("#teamSheetTitle").textContent = t; } };
    return api;
  })();

  // ================= planning =================
  // Status = a dot and a word. Orange: still to send; green: done; red: a problem; grey: sent / confirmed / cancelled.
  const PLAN_TONE = { a_envoyer: "todo", realisee: "ok", annulee: "off" };
  const planStatus = (d) => `<span class="plan-st ${PLAN_TONE[d.statut] || "mid"}"><i aria-hidden="true"></i>${esc(D.statusOf(d.statut).label)}</span>`;
  const SERVICE_ART = { lavage: "Véhicule sale", "pare-brise": "Pare-brise", intervention: "svc-intervention", hayon: "svc-hayon" };
  const serviceTile = (d, size = "xs") => `<span class="svc-tile ${size}" aria-hidden="true">${self.IssueArt?.art(SERVICE_ART[d.service || "pare-brise"] || "svc-intervention", "svc-art") || ""}</span>`;
  const capFirst = (s) => s.replace(/^./, (c) => c.toUpperCase());
  const PLAN_FILTERS = {
    todo: { label: "À envoyer", test: (d) => d.statut === "a_envoyer" },
    pending: { label: "En cours", test: (d) => d.statut === "envoyee" || d.statut === "confirmee" },
    done: { label: "Réalisés", test: (d) => d.statut === "realisee" },
    problem: { label: "À regarder", test: (d) => planAlert(d) === "bad" },
  };
  // A provider answer the team should see right on the line: red when the job cannot happen, orange for a new date, green when done.
  function planAnswer(d) {
    const r = d.retour;
    if (!r?.etat || r.etat === "confirme") return null;
    const tone = r.etat === "fait" ? "ok" : r.etat === "autre-date" ? "todo" : "bad";
    return { tone, text: D.answerSummary(r), unseen: !r.vu };
  }
  const openProblemsOf = (d) => D.openProblems(D.problemsOfRequest(state.problems || [], d.id));
  const planAlert = (d) => (openProblemsOf(d).length || planAnswer(d)?.tone === "bad" ? "bad" : "");

  function dayHeading(day) {
    const gap = D.daysBetween ? D.daysBetween(today(), day) : Math.round((D.parseIsoDate(day) - D.parseIsoDate(today())) / 864e5);
    const names = { 0: "Aujourd'hui", 1: "Demain", "-1": "Hier" };
    const full = capFirst(D.dayLabel(day));
    if (names[gap] !== undefined) return { title: names[gap], kicker: full };
    return { title: full, kicker: gap > 0 ? `Dans ${gap} jours` : `Il y a ${-gap} jours` };
  }
  function renderPlanning() {
    const { day, providerFilter } = state;
    const head = dayHeading(day);
    $("#dayTitle").textContent = head.title;
    $("#dayKicker").textContent = head.kicker;
    $("#todayBtn").disabled = day === today();
    $("#dayPick").value = day;
    const monday = D.mondayOf(day);
    needOlder(D.addDays(monday, -7), D.addDays(monday, 7)); // the week shown, and the one before for jobs spread over several days
    renderWeekStrip();
    renderProviderPills();
    const ofDay = state.demandes.filter((d) => D.isAvailableOn(d, day) && (!providerFilter || d.prestataire === providerFilter));
    const active = ofDay.filter(D.isActive);
    if (state.planFilter && !PLAN_FILTERS[state.planFilter]) state.planFilter = "";
    const shown = state.planFilter ? ofDay.filter(PLAN_FILTERS[state.planFilter].test) : ofDay;
    $("#daySum").innerHTML = daySummary(active);
    $("#dayList").innerHTML = shown.length
      ? D.groupBySite(shown, siteNames()).map(([site, items]) => siteBlockHtml(site, items)).join("")
      : state.planFilter ? `<div class="plan-empty slim"><b>Aucun véhicule « ${esc(PLAN_FILTERS[state.planFilter].label.toLowerCase())} » ce jour-là.</b><button type="button" class="plan-link" data-plan-filter="">Tout afficher</button></div>`
      : `<div class="plan-empty"><span class="svc-tile lg" aria-hidden="true">${self.IssueArt?.art("empty-inbox", "svc-art") || ""}</span><b>Aucun véhicule prévu ce jour-là</b><span>Les véhicules disponibles ce jour apparaissent ici, classés par site.</span>${state.canWrite ? `<button type="button" class="plan-link" data-plan-new>${icon("plus")}Nouvelle demande ce jour</button>` : ""}</div>`;
    renderPlateFind();
    if (teamSheet.isOpen && planSheet.kind) refreshPlanSheet();
  }
  // The day card: how many vehicles, what is left to do; each count filters the list. The WhatsApp list is one tap away.
  function daySummary(active) {
    if (!active.length) return "";
    const n = (key) => active.filter(PLAN_FILTERS[key].test).length;
    const done = n("done"), todo = n("todo"), pending = n("pending"), alerts = n("problem");
    const sites = new Set(active.map((d) => d.site)).size;
    const stat = (key, count, tone) => `<button type="button" class="plan-count ${tone}" data-plan-filter="${state.planFilter === key ? "" : key}" aria-pressed="${state.planFilter === key}">
        <b>${count}</b><span>${PLAN_FILTERS[key].label}</span></button>`;
    const pct = Math.round((done / active.length) * 100);
    return `<section class="plan-sum" aria-label="Résumé du jour">
      <div class="plan-sum-top">
        <p class="plan-sum-main"><b>${active.length}</b><span>${active.length > 1 ? "véhicules" : "véhicule"}<small>${plural(sites, "site")}${state.providerFilter ? ` · ${esc(state.providerFilter)}` : ""}</small></span></p>
        <button type="button" class="plan-send" data-plan-send>${icon("wa")}<span>Envoyer la liste</span></button>
      </div>
      <div class="plan-bar" role="img" aria-label="${pct} % réalisés"><i style="width:${pct}%"></i></div>
      <div class="plan-counts">${stat("todo", todo, "todo")}${stat("pending", pending, "mid")}${stat("done", done, "ok")}${alerts ? stat("problem", alerts, "bad") : ""}</div>
    </section>`;
  }
  function renderWeekStrip() {
    const monday = D.mondayOf(state.day);
    const strip = $("#strip");
    const before = strip.querySelector('[aria-current="true"]');
    const oldX = before && strip.dataset.monday === monday ? before.offsetLeft : null;
    strip.dataset.monday = monday;
    strip.innerHTML = `<span class="plan-strip-pill" aria-hidden="true"></span>` + Array.from({ length: 7 }, (_, i) => {
      const iso = D.addDays(monday, i);
      const date = D.parseIsoDate(iso);
      const count = D.vehiclesOnDay(state.demandes, iso, state.providerFilter).length;
      return `<button type="button" data-day="${iso}" aria-current="${iso === state.day}" class="${iso === today() ? "today" : ""}" aria-label="${esc(D.dayLabel(iso))}, ${plural(count, "véhicule")}">
        <small>${date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</small><b>${date.getDate()}</b><span class="cnt">${count || ""}</span></button>`;
    }).join("");
    // The dark pill slides from the day left to the one picked (same week only).
    const pill = strip.querySelector(".plan-strip-pill"), now = strip.querySelector('[aria-current="true"]');
    if (!now) return;
    const place = (x) => { pill.style.width = now.offsetWidth + "px"; pill.style.transform = `translateX(${x}px)`; };
    if (oldX === null || matchMedia("(prefers-reduced-motion: reduce)").matches) { place(now.offsetLeft); pill.classList.add("still"); return; }
    pill.classList.add("still"); place(oldX);
    requestAnimationFrame(() => requestAnimationFrame(() => { pill.classList.remove("still"); place(now.offsetLeft); }));
  }
  function renderProviderPills() {
    const box = $("#provPills");
    box.hidden = state.providers.length < 2;
    if (box.hidden) { box.innerHTML = ""; return; }
    const count = (p) => D.vehiclesOnDay(state.demandes, state.day, p).length;
    const pill = (value, label) => `<button type="button" class="plan-prov" data-prov="${esc(value)}" aria-pressed="${state.providerFilter === value}">${esc(label)}<em>${count(value)}</em></button>`;
    box.innerHTML = pill("", "Tous") + state.providers.map((p) => pill(p, p)).join("");
  }
  function siteBlockHtml(site, items) {
    const address = D.siteAddress(state.sites, site);
    return `<section class="plan-site"><header class="plan-site-head"><h3>${esc(site)}<em>${items.filter(D.isActive).length}</em></h3>${address ? `<span>${esc(address)}</span>` : ""}</header>
      <div class="plan-list">${items.map(vehicleRow).join("")}</div></section>`;
  }
  function vehicleRow(d) {
    const thumb = D.isWindshield(d) ? modelPhotos(d)[0]?.thumb : null;
    const what = [D.vehicleLabel(d) || "Modèle non précisé", D.jobLabel(d)].filter(Boolean).join(" · ");
    const sub = [d.adresse && d.adresse !== D.siteAddress(state.sites, d.site) ? d.adresse : "", D.isMultiDay(d) ? `Dispo jusqu'au ${D.shortDate(D.lastDay(d))}` : "", d.tache && d.service === "intervention" ? d.tache : "", d.notes].filter(Boolean).join(" · ");
    const answer = planAnswer(d);
    const problems = openProblemsOf(d);
    const flags = [
      problems.length ? `<span class="plan-flag bad">${icon("alert")}${esc(problems.length > 1 ? `${problems.length} problèmes signalés` : D.problemSummary(problems[0]))}</span>` : "",
      answer ? `<span class="plan-flag ${answer.tone}">${answer.unseen ? `<i class="plan-new" aria-label="nouveau"></i>` : ""}${esc(answer.text)}</span>` : "",
    ].join("");
    return `<button type="button" class="plan-row${D.isActive(d) ? "" : " cancel"}" data-open="${esc(d.id)}">
      ${serviceTile(d)}
      <span class="plan-row-main">
        <span class="plan-row-line">${plateTag(d.plaque)}<span class="plan-time">${esc(D.timeSlotLabel(d).replace(/^de /, ""))}</span></span>
        <span class="plan-what">${esc(what)}${state.providerFilter ? "" : `<span class="plan-who"> · ${esc(d.prestataire || "")}</span>`}</span>
        ${sub ? `<span class="plan-sub">${esc(sub)}</span>` : ""}
        ${flags ? `<span class="plan-flags">${flags}</span>` : ""}
      </span>
      <span class="plan-row-end">${planStatus(d)}${thumb ? `<img class="plan-thumb" src="${safeImageSrc(thumb)}" alt="">` : ""}${icon("chev-r")}</span>
    </button>`;
  }

  // ---------- the request's card, in a sheet: details, provider answer, status in one tap, « Modifier » for the full form ----------
  const planSheet = { kind: "", id: "" };
  const PLAN_STEPS = ["a_envoyer", "envoyee", "confirmee", "realisee"];
  function ficheBody(d) {
    const answer = planAnswer(d);
    const problems = D.problemsOfRequest(state.problems || [], d.id);
    const photos = D.isWindshield(d) ? modelPhotos(d).slice(0, 3) : [];
    const price = d.prixHT != null && d.prixHT !== "" ? D.euros(Number(d.prixHT)) + " HT" : "";
    const line = (label, value) => (value ? `<div class="plan-kv"><dt>${label}</dt><dd>${value}</dd></div>` : "");
    const address = d.adresse || D.siteAddress(state.sites, d.site);
    const answerBox = answer || d.retour?.etat === "confirme" ? `<section class="plan-box ${answer?.tone || "mid"}">
        <p class="sheet-label">Réponse de ${esc(d.prestataire || "du prestataire")}</p>
        <p class="plan-box-text">${esc(D.answerSummary(d.retour))}<small>${esc(timeOf(d.retour.at || ""))}</small></p>
        ${state.canWrite ? `<div class="plan-box-actions">${d.retour.etat === "autre-date" && d.retour.date !== d.date ? `<button type="button" class="primary" data-plan-accept="${esc(d.id)}">${icon("check")}Accepter la date</button>` : ""}
          ${d.retour.vu ? "" : `<button type="button" data-plan-seen="${esc(d.id)}">Marquer comme vu</button>`}</div>` : ""}
      </section>` : "";
    const problemBox = problems.length ? `<section class="plan-box bad"><p class="sheet-label">Signalé sur le véhicule</p>
        ${problems.map((p) => `<p class="plan-box-text"><span>${problemArts(p)}${esc(D.problemSummary(p))}</span><small>${esc(providerOfProblem(p))} · ${esc(atLabel(p.at))}${p.statut === "traite" ? " · traité" : ""}</small></p>`).join("")}
        <a class="plan-link" href="#retours" data-team-sheet-close>Voir dans Retours</a></section>` : "";
    const steps = state.canWrite && d.statut !== "annulee" ? `<section><p class="sheet-label">Statut</p>
        <div class="plan-steps" role="group" aria-label="Statut">${PLAN_STEPS.map((s) => `<button type="button" data-plan-status="${s}" aria-pressed="${d.statut === s}" class="${PLAN_TONE[s] || "mid"}"><i aria-hidden="true"></i>${esc(D.statusOf(s).label)}</button>`).join("")}</div></section>` : "";
    return `<div class="plan-fiche-head">${serviceTile(d, "sm")}<div>${plateTag(d.plaque)}<p>${esc([D.vehicleLabel(d), D.jobLabel(d)].filter(Boolean).join(" · "))}</p></div>${planStatus(d)}</div>
      ${problemBox}${answerBox}
      <dl class="plan-kvs">
        ${line("Quand", esc(capFirst(D.isMultiDay(d) ? D.availabilityLabel(d) : D.dayLabel(d.date))) + `<br><span>${esc(D.timeSlotLabel(d))}</span>`)}
        ${line("Où", esc(D.siteOf(d)) + (address ? `<br><span>${esc(address)}</span>` : ""))}
        ${line("Prestataire", esc(d.prestataire || ""))}
        ${line(d.service === "intervention" ? "À faire" : "", esc(d.tache || ""))}
        ${line("Note", esc(d.notes || ""))}
        ${line("Prix", esc(price))}
      </dl>
      ${photos.length ? `<div class="plan-photos">${photos.map((ph) => `<img src="${safeImageSrc(ph.thumb)}" data-zoom="${esc(ph.key)}" alt="Pare-brise ${esc(d.plaque)}">`).join("")}</div>` : ""}
      ${steps}
      <div class="plan-fiche-actions">
        <button type="button" class="primary plan-cta" data-plan-edit="${esc(d.id)}">${icon("list")}${state.canWrite ? "Modifier la demande" : "Voir la demande complète"}</button>
        <button type="button" class="plan-soft" data-pf-history="${esc(d.plaque)}">Historique de la plaque</button>
      </div>`;
  }
  // The day's WhatsApp list, then « mark them as sent » once it has gone out.
  function sendBody() {
    const active = D.vehiclesOnDay(state.demandes, state.day, state.providerFilter);
    if (!active.length) return `<p class="sheet-sub">Rien à envoyer pour ce jour.</p>`;
    const toSend = active.filter((d) => d.statut === "a_envoyer");
    return `<p class="sheet-sub">${plural(active.length, "véhicule")} sur ${plural(new Set(active.map((d) => d.site)).size, "site")}${state.providerFilter ? ` pour ${esc(state.providerFilter)}` : ""}, en un seul message WhatsApp.</p>
      <div id="dayShare" class="plan-share">${shareBlock({ text: D.dayListMessage(state.demandes, { date: state.day, provider: state.providerFilter, sites: state.sites }) + appLink(state.providerFilter || defaultProvider()), vehicles: active.filter(D.isWindshield), folded: true })}</div>
      ${state.canWrite && toSend.length ? `<section class="plan-box mid"><p class="plan-box-text">Message envoyé ?<small>${plural(toSend.length, "véhicule")} encore « À envoyer ».</small></p>
        <div class="plan-box-actions"><button type="button" data-plan-mark-sent>${icon("check")}Passer en « Envoyée »</button></div></section>` : ""}`;
  }
  function openPlanSheet(kind, id = "") {
    planSheet.kind = kind; planSheet.id = id;
    refreshPlanSheet(true);
  }
  function refreshPlanSheet(opening = false) {
    if (!opening && !teamSheet.isOpen) return;
    const closed = () => { planSheet.kind = ""; planSheet.id = ""; };
    if (planSheet.kind === "fiche") {
      const d = demandeById(planSheet.id);
      if (!d) { teamSheet.close(); return; }
      if (!opening && teamSheet.body.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;
      teamSheet.open(d.plaque ? `Demande ${d.plaque}` : "Demande", ficheBody(d), { cls: "plan-sheet side-sheet", closed });
    } else if (planSheet.kind === "send") {
      if (!opening) return; // the folded message stays as the user left it
      teamSheet.open("Liste du jour à envoyer", sendBody(), { cls: "plan-sheet side-sheet", closed });
    }
  }
  const openDemandeFromPlanning = (id) => openPlanSheet("fiche", id);

  // ---------- plate search: today, the next and the last request of a vehicle, without leaving the Planning ----------
  const plateReads = new Map(); // full plate -> "loading" | "done": its older requests are read once
  function readOlderOfPlate(text) {
    const key = D.plateKey(text);
    if (!D.isFullPlate(text) || !state.store?.loadDemandesOfPlate || !state.store.olderOnDemand?.() || allOlderLoaded()) return "";
    if (plateReads.has(key)) return plateReads.get(key);
    plateReads.set(key, "loading");
    state.store.loadDemandesOfPlate(text)
      .then(() => plateReads.set(key, "done"))
      .catch(() => { plateReads.delete(key); toast("Impossible de chercher les anciennes demandes de cette plaque, réessaie"); })
      .finally(renderPlateFind);
    return "loading";
  }
  const pfStatus = (d) => {
    const tone = d.statut === "realisee" ? "ok" : d.statut === "a_envoyer" ? "todo" : "";
    return `<span class="pf-status ${tone}">${esc(D.statusOf(d.statut).label)}</span>`;
  };
  function pfLine(label, d, { when, empty, extra = "" }) {
    if (!d) return `<div class="pf-line none"><span class="pf-when">${label}</span><span class="pf-what muted">${empty}</span></div>`;
    const what = [when(d), D.jobLabel(d), D.siteOf(d), d.prestataire].filter(Boolean).map(esc).join(" · ");
    return `<button type="button" class="pf-line" data-open="${esc(d.id)}"><span class="pf-when">${label}</span><span class="pf-what">${what}${extra}</span>${pfStatus(d)}</button>`;
  }
  function pfCard(p) {
    const year = (iso) => (iso.slice(0, 4) !== today().slice(0, 4) ? " " + iso.slice(0, 4) : ""); // an older year says so
    const day = (d) => D.isMultiDay(d) ? `${D.shortDate(d.date)} → ${D.shortDate(D.lastDay(d))}${year(D.lastDay(d))}` : `${D.shortDate(d.date)}${year(d.date)}, ${D.timeSlotLabel(d)}`;
    const todayLines = p.today.length
      ? p.today.map((d) => pfLine("Aujourd'hui", d, { when: (x) => D.timeSlotLabel(x) })).join("")
      : pfLine("Aujourd'hui", null, { empty: "Rien aujourd'hui" });
    const more = p.moreUpcoming ? ` <span class="muted">(+${p.moreUpcoming} après)</span>` : "";
    return `<div class="pf-card">
      <div class="pf-head">${plateTag(p.plaque)}<span class="pf-model">${esc(D.vehicleLabel(p.vehicle) || "")}</span>
        <button type="button" class="ghost small-btn" data-pf-history="${esc(p.plaque)}">Tout l'historique</button></div>
      ${todayLines}
      ${pfLine("À venir", p.next, { when: day, empty: "Rien de prévu", extra: more })}
      ${pfLine("Dernière", p.last, { when: day, empty: "Aucune trouvée" })}
    </div>`;
  }
  function renderPlateFind() {
    const box = $("#plateResults"), text = $("#plateFind").value;
    const key = D.plateKey(text);
    box.hidden = !key;
    if (!key) { box.innerHTML = ""; return; }
    if (key.length < D.PLATE_SEARCH_MIN) { box.innerHTML = `<p class="pf-note muted">Tape au moins ${D.PLATE_SEARCH_MIN} lettres ou chiffres de la plaque.</p>`; return; }
    const reading = readOlderOfPlate(text) === "loading";
    const { plates, more } = D.plateLookup(state.demandes, text, today());
    const partial = state.store?.olderOnDemand?.() && !allOlderLoaded() && !plateReads.has(key);
    const note = reading ? `<p class="pf-note muted">Recherche dans les demandes plus anciennes…</p>`
      : partial ? `<p class="pf-note muted">Cherché depuis le ${esc(D.numericDate(state.recentFrom))}. Tape la plaque en entier pour chercher aussi avant.</p>` : "";
    if (!plates.length) {
      const known = state.vehicles.get(key);
      box.innerHTML = `<p class="pf-note"><b>Aucune prestation trouvée pour « ${esc(text.trim())} ».</b>${known ? ` Véhicule connu : ${esc(D.vehicleLabel(known))}.` : ""}</p>${note}`;
      return;
    }
    box.innerHTML = plates.map(pfCard).join("")
      + (more ? `<p class="pf-note muted">Et ${plural(more, "autre plaque")} : tape plus de caractères.</p>` : "") + note;
  }
  $("#plateFind").addEventListener("input", renderPlateFind);
  $("#plateFind").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; renderPlateFind(); } });
  $("#plateResults").addEventListener("click", (e) => {
    const all = e.target.closest("[data-pf-history]");
    if (all) { $("#q").value = all.dataset.pfHistory; show("historique"); renderHistory(); return; }
    const row = e.target.closest("[data-open]");
    if (row) openDemandeFromPlanning(row.dataset.open);
  });
  const goToDay = (day) => { state.day = day; renderPlanning(); };
  $("#strip").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) goToDay(b.dataset.day); });
  // Phone: a sideways swipe on the week moves one week back or forward.
  (function swipeWeeks() {
    let x0 = null, y0 = 0;
    $("#strip").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    $("#strip").addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) goToDay(D.addDays(state.day, dx < 0 ? 7 : -7));
    });
  })();
  $("#prevDay").onclick = () => goToDay(D.addDays(state.day, -1));
  $("#nextDay").onclick = () => goToDay(D.addDays(state.day, 1));
  $("#todayBtn").onclick = () => goToDay(today());
  $("#dayPick").onchange = (e) => e.target.value && goToDay(e.target.value);
  const setProviderFilter = (value) => {
    state.providerFilter = value;
    $("#provFilter").value = value;
    try { localStorage.setItem("suivi.provFilter", state.providerFilter); } catch {}
    renderPlanning();
  };
  $("#provFilter").onchange = (e) => setProviderFilter(e.target.value);
  $("#provPills").addEventListener("click", (e) => { const b = e.target.closest("[data-prov]"); if (b) setProviderFilter(b.dataset.prov); });
  // From the planning, a new request starts on the day being looked at.
  const newOnPlanningDay = () => {
    const fromPlanning = !$("#view-planning").hidden;
    resetForm();
    if (fromPlanning) setAvailability(state.day);
    renderFormSide();
    show("demande");
  };
  $("#newOnDay").onclick = newOnPlanningDay;
  $("#view-planning").addEventListener("click", (e) => {
    const el = e.target.closest("[data-plan-filter], [data-plan-send], [data-plan-new]");
    if (!el) return;
    if (el.dataset.planNew !== undefined) return newOnPlanningDay();
    if (el.dataset.planSend !== undefined) return openPlanSheet("send");
    state.planFilter = el.dataset.planFilter; renderPlanning();
  });
  $("#dayList").addEventListener("click", (e) => { const row = e.target.closest("[data-open]"); if (row) openDemandeFromPlanning(row.dataset.open); });
  // Buttons inside the planning sheet (request card, day list).
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(".plan-sheet [data-plan-status], .plan-sheet [data-plan-edit], .plan-sheet [data-pf-history], .plan-sheet [data-plan-accept], .plan-sheet [data-plan-seen], .plan-sheet [data-plan-mark-sent]");
    if (!b) return;
    if (b.dataset.planEdit) { teamSheet.close(); return openDemande(b.dataset.planEdit); }
    if (b.dataset.pfHistory) { teamSheet.close(); $("#q").value = b.dataset.pfHistory; show("historique"); renderHistory(); return; }
    if (!requireStore()) return;
    b.disabled = true;
    try {
      if (b.dataset.planMarkSent !== undefined) {
        const targets = D.vehiclesOnDay(state.demandes, state.day, state.providerFilter).filter((d) => d.statut === "a_envoyer");
        for (const d of targets) await state.store.setStatus(d, "envoyee");
        toast(`${plural(targets.length, "véhicule")} passé${targets.length > 1 ? "s" : ""} en « Envoyée »`);
        teamSheet.close(); return;
      }
      const d = demandeById(b.dataset.planAccept || b.dataset.planSeen || planSheet.id);
      if (!d) return;
      if (b.dataset.planStatus) {
        if (b.dataset.planStatus === d.statut) return;
        await state.store.setStatus(d, b.dataset.planStatus);
        toast(`${d.plaque} : « ${D.statusOf(b.dataset.planStatus).label} »`);
      } else if (b.dataset.planAccept) { await state.store.acceptProposedDate(d); toast(`Date changée pour ${d.plaque}`); }
      else await state.store.markAnswerSeen(d);
    } catch (err) { reportWriteError(err); }
    finally { b.disabled = false; refreshPlanSheet(); }
  });

  // ================= request form =================
  const field = (name) => $("#f-" + name);
  const chosenService = () => document.querySelector('input[name="svc"]:checked')?.value || "";
  // Shows only the services the chosen provider does; "Intervention" also asks what to do.
  function renderServiceChoice() {
    const name = field("prest").value;
    const allowed = D.servicesFor(state.providerDocs.get(D.providerId(name)), name);
    if (state.editingId) allowed.push(demandeById(state.editingId)?.service);
    D.SERVICES.forEach((s) => ($("#svc-" + s.id).closest("label").hidden = !allowed.includes(s.id)));
    const nothing = !allowed.filter(Boolean).length;
    $("#svcNone").hidden = !nothing; $("#svcSeg").hidden = nothing;
    if (nothing) document.querySelectorAll('input[name="svc"]').forEach((r) => (r.checked = false));
    else if (!allowed.includes(chosenService())) $("#svc-" + allowed[0]).checked = true;
    $("#taskRow").hidden = chosenService() !== "intervention";
    $("#washRow").hidden = chosenService() !== "lavage";
    renderChoiceTiles();
  }

  // ----- the sheet itself: slides up over the page on a phone, centred window on a computer -----
  const ndView = $("#view-demande");
  const ndSheet = ndView.querySelector(".nd-sheet");
  let ndHideTimer, ndLastFocus = null;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function openFormSheet() {
    clearTimeout(ndHideTimer);
    if (!ndView.hidden && ndView.classList.contains("on")) return;
    if (teamSheet.isOpen) teamSheet.close();
    ndLastFocus = document.activeElement;
    ndView.hidden = false; ndSheet.style.transform = "";
    document.body.classList.add("nd-open");
    requestAnimationFrame(() => requestAnimationFrame(() => ndView.classList.add("on")));
    setTimeout(() => ndSheet.querySelector(".sheet-x")?.focus({ preventScroll: true }), 60);
  }
  function closeFormSheet() {
    if (ndView.hidden) return;
    ndView.classList.remove("on"); ndSheet.style.transform = "";
    document.body.classList.remove("nd-open");
    clearTimeout(ndHideTimer);
    ndHideTimer = setTimeout(() => { ndView.hidden = true; }, reducedMotion() ? 200 : 380);
    if (ndLastFocus?.isConnected) ndLastFocus.focus({ preventScroll: true });
  }
  // Closing a new request that was started keeps it: the bubble offers to pick it up again.
  function leaveFormSheet() {
    const started = !state.editingId && (field("plaque").value.trim() || readExtras().length);
    show(baseView);
    if (started) toast("Demande non enregistrée", { label: "Reprendre", run: () => show("demande") });
  }
  ndView.addEventListener("click", (e) => { if (e.target.closest("[data-nd-close]")) leaveFormSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ndView.hidden && ndView.classList.contains("on") && !document.querySelector(".lightbox:not([hidden])")) leaveFormSheet();
  }, true); // capture: runs before the photo viewer closes itself on the same key
  // Drag the grabber or the title down to close: follows the finger, closes past 120 px or on a quick flick.
  (function dragToClose() {
    let startY = 0, lastY = 0, lastT = 0, v = 0, dragging = false;
    ndSheet.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".sheet-grab, .nd-head") || e.target.closest("button") || window.innerWidth > 720) return;
      dragging = true; startY = lastY = e.clientY; lastT = e.timeStamp; v = 0;
      ndSheet.setPointerCapture(e.pointerId); ndSheet.classList.add("dragging");
    });
    ndSheet.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      v = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT); lastY = e.clientY; lastT = e.timeStamp;
      ndSheet.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false; ndSheet.classList.remove("dragging");
      if (e.clientY - startY > 120 || v > 0.6) leaveFormSheet(); else ndSheet.style.transform = "";
    };
    ndSheet.addEventListener("pointerup", end); ndSheet.addEventListener("pointercancel", end);
  })();

  // ----- tiles: type first, then only the providers who do it (same rules as Réglages › Prestataires) -----
  const offers = (name, service) => D.servicesFor(state.providerDocs.get(D.providerId(name)), name).includes(service);
  const providersFor = (service) => state.providers.filter((name) => offers(name, service));
  const initials = (name) => name.replace(/\(.*?\)/g, "").split(/[\s-]+/).filter((w) => /^[a-zà-ÿ]/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
  const nextDays = () => Array.from({ length: 7 }, (_, i) => D.addDays(today(), i));
  const dayChipLabel = (iso, i) => i === 0 ? "Aujourd'hui" : i === 1 ? "Demain"
    : D.parseIsoDate(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }).replace(".", "").replace(/^./, (c) => c.toUpperCase());
  const SLOTS = [{ label: "Journée", debut: D.DEFAULT_SLOT.debut, fin: D.DEFAULT_SLOT.fin }, { label: "Matin", debut: "08:30", fin: "12:30" }, { label: "Après-midi", debut: "13:30", fin: "19:30" }];
  const tile = (attrs, pressed, art, label) => `<button type="button" class="issue-tile nd-tile" ${attrs} aria-pressed="${pressed}">
      <span class="issue-ico">${self.IssueArt?.art(art) || ""}<span class="issue-check">${icon("check")}</span></span><span class="issue-lbl">${esc(label)}</span></button>`;
  function renderChoiceTiles() {
    const editing = state.editingId ? demandeById(state.editingId)?.service : "";
    const services = D.SERVICES.filter((s) => s.id === editing || providersFor(s.id).length);
    const svc = chosenService();
    $("#ndSvc").innerHTML = services.map((s) => tile(`data-nd-svc="${s.id}"`, s.id === svc, SERVICE_ART[s.id], s.label)).join("");
    $("#ndSvc").style.setProperty("--n", Math.max(services.length, 1));
    const current = field("prest").value;
    const names = svc ? state.providers.filter((n) => n === current || offers(n, svc)) : state.providers;
    $("#ndProv").innerHTML = names.map((n) => `<button type="button" class="nd-pv" role="radio" data-nd-prov="${esc(n)}" aria-checked="${n === current}">
        <span class="nd-pv-av" aria-hidden="true">${esc(initials(n))}</span><span class="nd-pv-txt"><b>${esc(n)}</b><small class="nd-pv-price"></small></span>
        <span class="nd-pv-tick" aria-hidden="true">${icon("check")}</span></button>`).join("");
    $("#provRow").hidden = state.providers.length === 0;
    const site = field("site").value;
    $("#ndSites").innerHTML = siteNames().map((n) => `<button type="button" class="nd-chip" role="radio" data-nd-site="${esc(n)}" aria-checked="${n === site}">${esc(n)}</button>`).join("")
      || `<p class="nd-hint">Aucun site : ajoute-les dans Réglages › Sites.</p>`;
    $("#ndDays").innerHTML = nextDays().map((iso, i) => `<button type="button" class="nd-chip" data-nd-day="${iso}" aria-pressed="false">${esc(dayChipLabel(iso, i))}</button>`).join("");
    $("#ndSlots").innerHTML = SLOTS.map((t) => `<button type="button" class="nd-chip" data-nd-slot="${t.debut}-${t.fin}" aria-pressed="false">${t.label}<small>${t.debut.replace(":", "h")}–${t.fin.replace(":", "h")}</small></button>`).join("");
    syncChoiceTiles();
  }
  // Only the pressed states and prices change while typing: the tiles are not redrawn (no flicker, focus kept).
  function syncChoiceTiles() {
    const d = readForm();
    const press = (sel, on) => document.querySelectorAll(sel).forEach((b) => b.setAttribute(b.getAttribute("role") === "radio" ? "aria-checked" : "aria-pressed", on(b)));
    press("#ndSites [data-nd-site]", (b) => b.dataset.ndSite === field("site").value);
    press("#ndDays [data-nd-day]", (b) => b.dataset.ndDay === field("date").value && (field("dateFin").value || field("date").value) === field("date").value);
    press("#ndSlots [data-nd-slot]", (b) => b.dataset.ndSlot === `${field("debut").value}-${field("fin").value}`);
    const before = demandeById(state.editingId);
    document.querySelectorAll("#ndProv [data-nd-prov]").forEach((b) => {
      const name = b.dataset.ndProv;
      const prices = pricesOf(D.providerId(name)).filter((l) => (l.service || "pare-brise") === d.service);
      const price = before && before.prestataire === name ? D.providerFields({ ...d, prestataire: name }, before, pricesOf).prixHT : D.priceFor(prices, { ...d, prestataire: name });
      b.querySelector(".nd-pv-price").textContent = price != null ? D.euros(price) + " HT" : prices.length ? "Prix selon le cubage" : d.service === "hayon" ? "Forfait mensuel" : "Pas de tarif";
    });
  }
  function pop(button) { button.classList.remove("pop"); void button.offsetWidth; button.classList.add("pop"); }
  $("#form").addEventListener("click", (e) => {
    const b = e.target.closest("[data-nd-svc], [data-nd-prov], [data-nd-site], [data-nd-day], [data-nd-slot]");
    if (!b) return;
    if (b.dataset.ndSvc) {
      const svc = b.dataset.ndSvc;
      if (!offers(field("prest").value, svc)) {
        const first = providersFor(svc).find((n) => n === state.providerFilter) || providersFor(svc)[0];
        if (first) field("prest").value = first;
      }
      const radio = $("#svc-" + svc);
      renderServiceChoice();
      if (radio && !radio.closest("label").hidden) radio.checked = true;
      renderServiceChoice();
      pop($(`#ndSvc [data-nd-svc="${svc}"]`));
    } else if (b.dataset.ndProv) {
      field("prest").value = b.dataset.ndProv;
      renderServiceChoice();
    } else if (b.dataset.ndSite) {
      field("site").value = b.dataset.ndSite;
      field("site").dispatchEvent(new Event("change", { bubbles: true }));
    } else if (b.dataset.ndDay) {
      setAvailability(b.dataset.ndDay);
    } else if (b.dataset.ndSlot) {
      [field("debut").value, field("fin").value] = b.dataset.ndSlot.split("-");
    }
    renderFormSide();
  });
  const chosenWashKind = () => document.querySelector('input[name="wash"]:checked')?.value || "complet";
  function selectedFleetModel() {
    const index = field("modele").value;
    return index === "" ? { modele: "", cubage: null } : state.fleet[+index];
  }
  function readForm() {
    const model = selectedFleetModel();
    return {
      service: chosenService(),
      plaque: D.normalizePlate(field("plaque").value),
      modele: model.modele,
      cubage: model.cubage,
      site: field("site").value,
      adresse: field("adresse").value.trim(),
      date: field("date").value,
      dateFin: field("dateFin").value || field("date").value,
      debut: field("debut").value || D.DEFAULT_SLOT.debut,
      fin: field("fin").value || D.DEFAULT_SLOT.fin,
      prestataire: field("prest").value || defaultProvider(),
      notes: field("notes").value.trim(),
      tache: chosenService() === "intervention" ? field("tache").value.trim() : "",
      ...(chosenService() === "lavage" ? { formule: chosenWashKind() } : {}),
    };
  }
  // ----- model picker: brand + model first, then cubage (year shown only when the cubage is ambiguous) -----
  const baseOptions = () => `<option value="">Choisir le modèle…</option>` + options(D.fleetBases(state.fleet));
  const variantSelectOf = (base) => base.closest(".nd-veh, .extra-veh").querySelector(".m-var");
  function fillVariants(base, variant) {
    const variants = D.fleetVariants(state.fleet, base.value);
    setSelectOptions(variant, base.value
      ? (variants.length > 1 ? `<option value="">Choisir…</option>` : "") + variants.map((v) => `<option value="${v.index}">${esc(v.label)}</option>`).join("")
      : `<option value="">—</option>`);
    if (variants.length === 1) variant.value = String(variants[0].index);
    variant.disabled = !base.value;
  }
  function setModelPicker(base, variant, v) {
    if (D.fleetIndex(state.fleet, v) < 0 && v.modele) { state.fleet.push({ modele: v.modele, cubage: v.cubage }); renderSelects(); }
    base.value = D.baseModel(v.modele);
    fillVariants(base, variant);
    variant.value = String(D.fleetIndex(state.fleet, v));
  }
  const selectFleetModel = (v) => setModelPicker(field("base"), field("modele"), v);
  $("#form").addEventListener("change", (e) => {
    if (e.target.matches(".m-base")) fillVariants(e.target, variantSelectOf(e.target));
  }, true);
  // ----- grouped request: extra vehicles at the same place, own time window -----
  const extraRows = () => [...document.querySelectorAll("#extraVeh .extra-veh")];
  function renumberExtraRows() { extraRows().forEach((row, i) => (row.querySelector(".num").textContent = `Véhicule ${i + 2}`)); }
  function addExtraRow(v = {}) {
    const row = document.createElement("div");
    row.className = "extra-veh";
    row.dataset.id = v.id || "";
    row.innerHTML = `<div class="xv-head"><span class="num"></span><button type="button" class="xv-remove" data-remove-veh aria-label="Retirer ce véhicule">${icon("x")}</button></div>
      <label class="nd-plate sm"><span class="nd-plate-eu" aria-hidden="true">F</span><input class="x-plaque plate-input" placeholder="AB-123-CD" list="dl-plaques" aria-label="Immatriculation" value="${esc(v.plaque || "")}"></label>
      <div class="nd-model">
        <label><span>Modèle</span><select class="x-base m-base">${baseOptions()}</select></label>
        <label><span>Cubage</span><select class="x-modele m-var"></select></label>
        <label><span>De</span><input type="time" class="x-debut" step="900" value="${esc(v.debut ?? field("debut").value)}"></label>
        <label><span>À</span><input type="time" class="x-fin" step="900" value="${esc(v.fin ?? field("fin").value)}"></label>
      </div>`;
    $("#extraVeh").append(row);
    fillVariants(row.querySelector(".x-base"), row.querySelector(".x-modele"));
    if (v.modele) setModelPicker(row.querySelector(".x-base"), row.querySelector(".x-modele"), v);
    renumberExtraRows();
    return row;
  }
  function readExtras() {
    return extraRows().map((row) => {
      const index = row.querySelector(".x-modele").value;
      const model = index === "" ? { modele: "", cubage: null } : state.fleet[+index];
      return { row, id: row.dataset.id, plaque: D.normalizePlate(row.querySelector(".x-plaque").value), modele: model.modele, cubage: model.cubage,
        debut: row.querySelector(".x-debut").value, fin: row.querySelector(".x-fin").value };
    }).filter((x) => x.plaque);
  }
  const groupMember = (main, extra) => ({ ...main, plaque: extra.plaque, modele: extra.modele, cubage: extra.cubage, debut: extra.debut, fin: extra.fin });
  $("#addVeh").onclick = () => { addExtraRow().querySelector(".x-plaque").focus(); renderFormSide(); };
  $("#extraVeh").addEventListener("change", (e) => {
    const input = e.target.closest(".x-plaque");
    if (!input) return;
    input.value = D.normalizePlate(input.value);
    const vehicle = vehicleOf(input.value);
    const row = input.closest(".extra-veh");
    if (vehicle?.modele) setModelPicker(row.querySelector(".x-base"), row.querySelector(".x-modele"), vehicle);
    renderFormSide();
  });
  $("#extraVeh").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-remove-veh]");
    if (!button) return;
    const row = button.closest(".extra-veh");
    if (row.dataset.id) {
      if (!requireStore()) return;
      try { await state.store.deleteDemande(demandeById(row.dataset.id) || { id: row.dataset.id }); toast("Véhicule retiré de la demande"); }
      catch (err) { if (err?.code === "trash_not_ready") toast(TRASH_NOT_READY); else reportWriteError(err); return; }
    }
    row.remove(); renumberExtraRows(); renderFormSide();
  });

  function setAvailability(start, end) { field("date").value = start; field("dateFin").value = end || start; }
  function fillForm(d) {
    (document.getElementById("svc-" + d.service) || document.getElementById("svc-pare-brise")).checked = true;
    $("#wash-" + D.washKindOf(d).id).checked = true;
    ["plaque", "adresse", "debut", "fin", "notes", "tache"].forEach((k) => (field(k).value = d[k] || ""));
    setAvailability(d.date, d.dateFin);
    if (d.prestataire && !state.providers.includes(d.prestataire)) state.providers.push(d.prestataire);
    if (d.site && !siteNames().includes(d.site)) state.sites.push({ nom: d.site, adresse: "" });
    renderSelects();
    field("base").value = ""; fillVariants(field("base"), field("modele")); if (d.modele) selectFleetModel(d);
    field("site").value = d.site || "";
    field("prest").value = d.prestataire || defaultProvider();
    $("#notesBox").open = !!d.notes;
    renderServiceChoice();
    $("#extraVeh").innerHTML = "";
    state.groupe = d.groupe || "";
    if (d.groupe) state.demandes.filter((x) => x.groupe === d.groupe && x.id !== d.id).sort(D.byStartTime).forEach(addExtraRow);
  }

  function renderFormSide() {
    const d = readForm();
    const others = readExtras().map((x) => groupMember(d, x));
    const vehicles = D.isWindshield(d) ? [d, ...others] : [];
    const photoCount = photoEntries(vehicles).length;
    $("#photosSet").hidden = !D.isWindshield(d);
    $("#msgTitle").textContent = others.length ? `Envoyer la demande (${others.length + 1} véhicules)` : "Envoyer la demande";
    $("#formShare").innerHTML = shareBlock({ text: D.requestMessage(d, photoCount, others) + appLink(d.prestataire), vehicles });
    renderFormPhotos(d);
    const vehicle = vehicleOf(d.plaque);
    const hayonWarning = (state.store ? hayonFormWarnings(d, readExtras())[0] : "") || problemHint(d.plaque);
    $("#vehHint").textContent = hayonWarning || (vehicle?.modele && D.plateKey(d.plaque) ? "Véhicule connu : modèle repris automatiquement." : "");
    $("#vehHint").classList.toggle("warn", !!hayonWarning);
    const current = demandeById(state.editingId);
    $("#formSheet").innerHTML = current && ["confirmee", "realisee"].includes(current.statut) ? sheetLink([d.plaque]) : "";
    syncChoiceTiles();
    renderSummary(d, others, current);
  }
  // What will be saved, in one card: vehicles, price HT frozen at the first save, and what is still missing.
  function renderSummary(d, others, current) {
    const problem = formProblem(d, readExtras());
    $("#saveBtn").dataset.ready = String(!problem); // greyed until complete, still clickable to say what is missing
    const count = others.length + 1;
    const price = d.prestataire ? D.providerFields(d, current, pricesOf).prixHT : null;
    const total = price != null ? D.euros(price * count) : "";
    const when = d.date ? D.dayLabel(d.date) + (d.dateFin && d.dateFin !== d.date ? " → " + D.dayLabel(d.dateFin) : "") : "";
    $("#ndSum").innerHTML = `<div class="nd-sum-top">
        <span class="svc-tile sm" aria-hidden="true">${d.service ? self.IssueArt?.art(SERVICE_ART[d.service], "svc-art") || "" : ""}</span>
        <span class="nd-sum-txt"><b>${esc(d.service ? D.jobLabel(d) : "Prestation à choisir")}${count > 1 ? ` · ${count} véhicules` : ""}</b>
        <small>${esc([d.prestataire, d.site].filter(Boolean).join(" · ") || "Prestataire et site à choisir")}</small></span>
        ${total ? `<span class="nd-sum-price"><b>${esc(total)}</b><small>HT${count > 1 ? ` · ${esc(D.euros(price))} / véh.` : ""}</small></span>` : ""}</div>
      ${when ? `<p class="nd-sum-when">${icon("cal")}${esc(when)} · ${esc(d.debut.replace(":", "h"))}–${esc(d.fin.replace(":", "h"))}</p>` : ""}
      ${problem ? `<p class="nd-sum-miss">${icon("alert")}${esc(problem)}</p>` : `<p class="nd-sum-ok">${icon("check")}${current ? "Prête à enregistrer les modifications" : "Prête à enregistrer"}</p>`}`;
  }
  // The windshield photos shown here are those of the chosen model: added once, sent with every request.
  function renderFormPhotos(d) {
    const photos = modelPhotos(d);
    $("#formPhotosHint").textContent = D.modelKey(d)
      ? `Photos du modèle ${D.fleetLabel(d)} : ajoutées une fois, elles partent avec chaque demande de ce modèle.`
      : "Choisis le modèle : ses photos s'affichent ici et partent avec la demande.";
    $("#formPhotos").innerHTML = photos.map((p, i) => `<img src="${safeImageSrc(p.thumb)}" data-zoom="${esc(p.key)}" alt="Photo ${i + 1} du pare-brise">`).join("")
      + (D.modelKey(d) ? `<button type="button" class="drop" data-add-photo>${icon("plus")}Ajouter une photo</button>` : "");
  }
  function fillFromVehicle() {
    field("plaque").value = D.normalizePlate(field("plaque").value);
    const vehicle = vehicleOf(field("plaque").value);
    if (vehicle?.modele) selectFleetModel(vehicle);
    renderFormSide();
  }
  $("#form").addEventListener("input", (e) => { if (e.target.id !== "f-plaque") renderFormSide(); });
  $("#form").addEventListener("change", renderFormSide);
  field("prest").addEventListener("change", renderServiceChoice);
  $("#svcSeg").addEventListener("change", renderServiceChoice);
  field("plaque").addEventListener("change", fillFromVehicle);
  field("site").addEventListener("change", () => { field("adresse").value = D.siteAddress(state.sites, field("site").value); renderFormSide(); });
  field("date").addEventListener("change", () => {
    if (!field("dateFin").value || field("dateFin").value < field("date").value) field("dateFin").value = field("date").value;
    renderFormSide();
  });
  field("debut").addEventListener("change", () => {
    if (field("debut").value && !field("fin").value) { field("fin").value = D.defaultEndTime(field("debut").value); renderFormSide(); }
  });
  $("#formPhotos").addEventListener("click", (e) => { if (e.target.closest("[data-add-photo]")) pickPhotosFor(selectedFleetModel()); });

  function resetForm() {
    state.editingId = null;
    $("#form").reset();
    $("#extraVeh").innerHTML = "";
    fillVariants(field("base"), field("modele"));
    state.groupe = "";
    setAvailability(D.addDays(today(), 1));
    field("debut").value = D.DEFAULT_SLOT.debut;
    field("fin").value = D.DEFAULT_SLOT.fin;
    field("prest").value = state.providerFilter || defaultProvider();
    if (!D.SERVICES.some((x) => offers(field("prest").value, x.id))) {
      const any = state.providers.find((n) => D.SERVICES.some((x) => offers(n, x.id)));
      if (any) field("prest").value = any;
    }
    renderServiceChoice();
    $(".nd-scroll").scrollTop = 0;
    $("#notesBox").open = false;
    $("#historyBox").hidden = true; $("#historyBox").open = false; $("#historyBox").dataset.id = "";
    $("#formTitle").textContent = "Nouvelle demande";
    $("#ndKicker").textContent = "Demande à un prestataire";
    $("#formStatusChip").hidden = true;
    setSaveLabel("Enregistrer la demande");
    ndView.classList.remove("saved");
    $("#delZone").innerHTML = "";
    renderFormSide();
  }
  $("#resetBtn").onclick = resetForm;
  function setSaveLabel(text) { $("#saveBtn").innerHTML = `<span class="ok-badge" aria-hidden="true">${icon("check")}</span><span>${esc(text)}</span>`; }

  function openDemande(id) {
    const d = demandeById(id);
    if (!d) return;
    state.editingId = id;
    fillForm(d);
    showSavedHeader(d);
    renderFormSide(); show("demande"); $(".nd-scroll").scrollTop = 0;
  }
  function newDemandeFor(vehicle) {
    resetForm();
    field("plaque").value = vehicle.plaque;
    fillFromVehicle(); show("demande");
  }
  function showSavedHeader(d) {
    const count = extraRows().length + 1;
    $("#formTitle").textContent = count > 1 ? `Demande groupée · ${count} véhicules` : "Demande " + (d.plaque || "");
    const chip = $("#formStatusChip");
    chip.hidden = false; chip.className = "chip st-" + d.statut; chip.textContent = D.statusOf(d.statut).label;
    $("#ndKicker").textContent = [D.jobLabel(d), d.date ? D.shortDate(d.date) : ""].filter(Boolean).join(" · ");
    setSaveLabel("Enregistrer les modifications");
    ndView.classList.add("saved");
    $("#delZone").innerHTML = deleteZone(d);
    showHistoryBox();
  }
  // ----- change history of the open request: loaded only when opened (saves reads on the free plan) -----
  function showHistoryBox() {
    const box = $("#historyBox");
    box.hidden = !state.editingId || state.providerMode;
    if (box.dataset.id === (state.editingId || "")) return; // same request re-drawn: keep the list open
    box.dataset.id = state.editingId || "";
    box.open = false;
    $("#historyBody").innerHTML = "";
  }
  async function renderChangeLog() {
    const ids = [state.editingId, ...extraRows().map((row) => row.dataset.id)].filter(Boolean);
    if (!ids.length || !state.store) return;
    const body = $("#historyBody");
    body.innerHTML = `<p class="muted small">Chargement…</p>`;
    try {
      const several = ids.length > 1;
      const lines = (await Promise.all(ids.map(async (id) => {
        const d = demandeById(id);
        return D.historyLines(await state.store.loadHistory(id), d).map((line) => ({ ...line, plaque: several ? d?.plaque : "" }));
      }))).flat().sort((a, b) => b.time - a.time);
      body.innerHTML = lines.length ? `<ol class="history-list">${lines.map(historyItem).join("")}</ol>` : "";
      body.insertAdjacentHTML("beforeend", `<p class="hint">Chaque changement de statut, de prix ou de date est noté ici avec son auteur et l'heure du serveur. Personne ne peut modifier ni effacer cette liste, même après la suppression de la demande.</p>`);
    } catch {
      body.innerHTML = `<p class="hint">L'historique n'est pas encore lisible : les nouvelles règles Firebase doivent être publiées.</p>`;
    }
  }
  function historyItem(line) {
    const changes = line.changes.map((c) => `<li><span class="muted">${esc(c.label)} :</span> ${c.avant != null ? `<s>${esc(c.avant)}</s> → ` : ""}<b>${esc(c.apres)}</b></li>`).join("");
    const who = line.who || "avant le suivi des modifications";
    return `<li><div class="history-head"><b>${esc(line.action)}${line.plaque ? " · " + esc(line.plaque) : ""}</b><span class="muted small">${esc(line.when)} · ${esc(who)}</span></div>${changes ? `<ul>${changes}</ul>` : ""}</li>`;
  }
  $("#historyBox").addEventListener("toggle", () => { if ($("#historyBox").open) renderChangeLog(); });
  // « Annuler » keeps the request in the history (and stops the tailgate counter from using it); « Supprimer » moves it to the Corbeille (kept 20 days, restorable).
  const deleteZone = (d) => !state.canWrite ? "" : (d?.statut === "annulee"
    ? `<button type="button" class="ghost" data-restore>Rétablir la demande</button>`
    : `<button type="button" class="ghost" data-cancel>Annuler la demande</button>`) + `<button type="button" class="ghost danger" data-delete>Supprimer</button>`;

  // Status is not edited in the form: a new request starts "à envoyer" and becomes "envoyée" once copied or opened in WhatsApp.
  // What stops the form from being saved, as a sentence for the toast; "" when it can be saved.
  function hayonFormWarnings(main, extras) {
    const ownIds = [state.editingId, ...extras.map((x) => x.id)].filter(Boolean);
    return [main, ...extras.map((x) => groupMember(main, x))].flatMap((v) => D.hayonWarnings(v, state.demandes, state.hayons, today(), ownIds));
  }
  function formProblem(main, extras) {
    // Only the jobs ticked for this provider in Réglages (an existing request keeps its own type).
    const provider = main.prestataire;
    const allowed = D.servicesFor(state.providerDocs.get(D.providerId(provider)), provider);
    if (!main.service) return `${provider} n'a aucune prestation cochée dans Réglages › Prestataires`;
    if (!allowed.includes(main.service) && demandeById(state.editingId)?.service !== main.service)
      return `${provider} ne fait pas ce type de prestation (Réglages › Prestataires)`;
    const missing = D.missingFields(main);
    if (missing.length) return "Il manque " + missing.join(", ");
    const twice = D.duplicatePlates([main.plaque, ...extras.map((x) => x.plaque)]);
    if (twice.length) return `La plaque ${D.normalizePlate(twice[0])} est saisie deux fois`;
    const ownIds = [state.editingId, ...extras.map((x) => x.id)].filter(Boolean);
    for (const vehicle of [main, ...extras.map((x) => groupMember(main, x))]) {
      const same = D.existingDuplicate(vehicle, state.demandes, ownIds);
      if (same) return `${D.normalizePlate(vehicle.plaque)} a déjà une demande ${D.jobLabel(same).toLowerCase()} le ${D.shortDate(same.date)} (${D.statusOf(same.statut || "a_envoyer").label.toLowerCase()}) : ouvre-la plutôt que d'en créer une deuxième`;
    }
    return "";
  }
  // Saves one vehicle of the request (alone or in a group) and remembers its plate; returns its id.
  async function saveRequest(id, fields, { groupe, markSent }) {
    const before = demandeById(id);
    const current = before?.statut || "a_envoyer";
    const statut = markSent && current === "a_envoyer" ? "envoyee" : current;
    const savedId = await state.store.saveDemande(id, { ...fields, ...D.providerFields(fields, before, pricesOf), groupe, statut }, before);
    await state.store.saveVehicle(vehicleOf(fields.plaque), fields);
    return savedId;
  }
  async function saveForm({ markSent = false } = {}) {
    if (!requireStore()) return false;
    const extras = readExtras();
    const main = readForm();
    const problem = formProblem(main, extras);
    if (problem) { toast(problem); return false; }
    // A tailgate control booked twice within a week, or long before it is due: warn once, save on the second click.
    const warnings = hayonFormWarnings(main, extras);
    if (warnings.length && state.hayonWarned !== warnings.join("|")) {
      state.hayonWarned = warnings.join("|");
      toast(`${warnings[0]} Clique encore une fois pour le poser quand même.`);
      return false;
    }
    state.hayonWarned = "";
    if (extras.length && !state.groupe) state.groupe = demandeById(state.editingId)?.groupe || "g" + Date.now().toString(36);
    const options = { groupe: state.groupe || "", markSent };
    try {
      state.editingId = await saveRequest(state.editingId, main, options);
      for (const extra of extras) extra.row.dataset.id = await saveRequest(extra.id || null, groupMember(main, extra), options);
      showSavedHeader(main);
      if ($("#historyBox").open) setTimeout(renderChangeLog, 800); // the new line arrives once the save is written
      return true;
    } catch (err) { reportWriteError(err); return false; }
  }
  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const wasNew = !state.editingId;
    if (await saveForm()) {
      toast(extraRows().length ? "Demande groupée enregistrée" : "Demande enregistrée");
      state.day = field("date").value || state.day;
      // Next step after a new request: send it. On a phone the message is below the form.
      if (wasNew) {
        const box = $(".nd-scroll"), top = $("#ndSum").getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8;
        box.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
      }
    }
  });
  $("#formShare").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-copy]")) return;
    const wasNew = !state.editingId || demandeById(state.editingId)?.statut === "a_envoyer";
    if (await saveForm({ markSent: true }) && wasNew) toast("Demande enregistrée et passée en « Envoyée »");
  });
  $("#delZone").addEventListener("click", async (e) => {
    if (e.target.closest("[data-delete]")) {
      $("#delZone").innerHTML = `<span class="row">Mettre à la corbeille ? Tu pourras la restaurer pendant 20 jours. <button type="button" class="danger" data-delete-yes>Oui, à la corbeille</button><button type="button" class="ghost" data-delete-no>Non</button></span>`;
    } else if (e.target.closest("[data-delete-no]")) {
      $("#delZone").innerHTML = deleteZone(demandeById(state.editingId));
    } else if (e.target.closest("[data-cancel], [data-restore]") && state.editingId && requireStore()) {
      const cancel = !!e.target.closest("[data-cancel]");
      const ids = [state.editingId, ...extraRows().map((row) => row.dataset.id).filter(Boolean)];
      try {
        for (const d of ids.map(demandeById).filter(Boolean)) await state.store.setStatus(d, cancel ? "annulee" : (d.sentAt ? "envoyee" : "a_envoyer"));
        toast(cancel ? "Demande annulée : elle reste dans l'historique" : "Demande rétablie");
        if (cancel) show("planning");
      } catch (err) { reportWriteError(err); }
    } else if (e.target.closest("[data-delete-yes]") && state.editingId && requireStore()) {
      const ids = [state.editingId, ...extraRows().map((row) => row.dataset.id).filter(Boolean)];
      try { await Promise.all(ids.map((id) => state.store.deleteDemande(demandeById(id) || { id }))); toast(ids.length > 1 ? "Demande groupée mise à la corbeille" : "Demande mise à la corbeille"); resetForm(); show("planning"); }
      catch (err) { if (err?.code === "trash_not_ready") toast(TRASH_NOT_READY); else reportWriteError(err); }
    }
  });

  // ================= photo library (one album per fleet model) =================
  const openModel = () => state.fleet.find((f) => D.modelKey(f) === state.openModelKey) || state.models.get(state.openModelKey);
  function renderPhotoLibrary() {
    const query = $("#p-q").value;
    const models = D.uniqueModels(state.fleet).filter((f) => D.matchesSearch([D.fleetLabel(f)], query));
    $("#p-list").innerHTML = models.length
      ? `<div class="veh-grid">${models.map(modelCard).join("")}</div>`
      : `<div class="empty"><b>Aucun modèle ne correspond.</b><span>Les modèles viennent de la flotte, dans Réglages.</span></div>`;
    renderModelDetail();
  }
  function modelCard(f) {
    const key = D.modelKey(f);
    const photos = modelPhotos(f);
    const thumbs = Array.from({ length: 4 }, (_, i) => photos[i] ? `<img src="${safeImageSrc(photos[i].thumb)}" alt="">` : "<span></span>").join("");
    return `<button class="veh-card" data-model="${esc(key)}" aria-current="${key === state.openModelKey}">
      <span class="row"><b>${esc(f.modele)}</b><span class="muted small">${photos.length ? plural(photos.length, "photo") : "aucune photo"}</span></span>
      <span>${f.cubage ? esc(f.cubage) + " m³" : ""}</span>
      <span class="thumbs">${thumbs}</span></button>`;
  }
  function renderModelDetail() {
    const model = state.openModelKey ? openModel() : null;
    if (!model) { $("#p-detail").innerHTML = ""; return; }
    const photos = modelPhotos(model);
    const label = D.fleetLabel(model);
    $("#p-detail").innerHTML = `<div class="panel" style="margin-bottom:24px">
      <div class="panel-head"><h2>${esc(label)}</h2><button type="button" class="ghost" data-close-model aria-label="Fermer">${icon("x")}</button></div>
      <p class="hint">Ces photos partent avec chaque demande de pare-brise pour un ${esc(model.modele)}${model.cubage ? ` de ${esc(model.cubage)} m³` : ""}. Tu peux aussi coller une capture (Ctrl+V).</p>
      <h3>Photos du pare-brise · ${photos.length}/${MAX_PHOTOS_PER_VEHICLE}</h3>
      <div class="ph-grid">${photos.map((p, i) => photoTile(label, p, i)).join("")}<button type="button" class="drop" style="width:auto;height:auto;min-height:150px" data-add-model-photo>${icon("plus")}Ajouter des photos</button></div>
    </div>`;
  }
  $("#p-q").addEventListener("input", renderPhotoLibrary);
  $("#p-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-model]");
    if (card) { state.openModelKey = card.dataset.model; renderPhotoLibrary(); window.scrollTo({ top: 0 }); }
  });
  $("#p-detail").addEventListener("click", async (e) => {
    const model = openModel();
    if (!model) return;
    if (e.target.closest("[data-close-model]")) { state.openModelKey = null; renderPhotoLibrary(); }
    else if (e.target.closest("[data-add-model-photo]")) pickPhotosFor(model);
    else if (e.target.closest("[data-remove-photo]")) confirmPhotoRemoval(e.target.closest("[data-remove-photo]"), albumOf(model));
  });
  async function confirmPhotoRemoval(button, album) {
    if (!album) return;
    if (button.dataset.armed !== "1") { button.dataset.armed = "1"; button.textContent = "Confirmer"; return; }
    try { await state.store.removeModelPhoto(album, button.dataset.removePhoto); toast("Photo supprimée"); }
    catch (err) { reportWriteError(err); }
  }

  // ================= verification =================
  $("#v-from").value = D.addDays(today(), -14);
  $("#v-to").value = D.addDays(today(), 7);
  const VERIFICATION_FILTERS = {
    pending: (d) => ["envoyee", "confirmee"].includes(d.statut),
    envoyee: (d) => d.statut === "envoyee",
    confirmee: (d) => d.statut === "confirmee",
    all: D.isActive,
  };
  function verificationRows() {
    const provider = $("#v-prest").value, from = $("#v-from").value, to = $("#v-to").value;
    const statusFilter = VERIFICATION_FILTERS[$("#v-st").value];
    return state.demandes
      .filter((d) => (!provider || d.prestataire === provider) && (!from || D.lastDay(d) >= from) && (!to || d.date <= to) && statusFilter(d))
      .sort(D.byDateThenTime);
  }
  function renderVerification() {
    if ($("#v-from").value) needOlder($("#v-from").value, $("#v-to").value ? D.addDays($("#v-to").value, 1) : null);
    const rows = verificationRows();
    const checked = state.checkedForVerification;
    [...checked].forEach((id) => { if (!rows.some((r) => r.id === id)) checked.delete(id); });
    $("#v-count").textContent = `${plural(rows.length, "véhicule")} · ${plural(checked.size, "coché")}`;
    $("#v-table").innerHTML = rows.length ? `<div class="tablewrap"><table><thead><tr>
        <th><input type="checkbox" id="v-all" aria-label="Tout cocher" ${checked.size && checked.size === rows.length ? "checked" : ""}></th><th>Dispo</th><th>Plaque</th><th>Site</th><th>Statut</th></tr></thead><tbody>
      ${rows.map((d) => `<tr><td><input type="checkbox" data-check="${esc(d.id)}" aria-label="Cocher ${esc(d.plaque)}" ${checked.has(d.id) ? "checked" : ""}></td>
        <td class="date">${esc(D.shortDate(d.date))}</td><td>${plateTag(d.plaque)}</td><td>${esc(D.siteOf(d))}</td><td>${statusChip(d.statut)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><b>Rien à vérifier sur cette période.</b><span>Les demandes envoyées ou confirmées dont la disponibilité tombe entre les deux dates s'affichent ici.</span></div>`;
    const provider = $("#v-prest").value;
    const kind = document.querySelector('input[name="vkind"]:checked')?.value;
    $("#v-share").innerHTML = shareBlock({ text: D.verificationMessage(rows, { provider, kind, siteNames: siteNames() }) });
    $("#v-sheet").innerHTML = sheetLink(state.demandes.filter((d) => checked.has(d.id)).map((d) => d.plaque));
  }
  ["#v-prest", "#v-from", "#v-to", "#v-st"].forEach((s) => $(s).addEventListener("change", renderVerification));
  $("#v-kind").addEventListener("change", renderVerification);
  $("#v-table").addEventListener("change", (e) => {
    const checked = state.checkedForVerification;
    if (e.target.id === "v-all") { checked.clear(); if (e.target.checked) verificationRows().forEach((r) => checked.add(r.id)); }
    else if (e.target.dataset.check) e.target.checked ? checked.add(e.target.dataset.check) : checked.delete(e.target.dataset.check);
    renderVerification();
  });
  $("#v-paste").addEventListener("input", () => {
    const cited = D.platesInText($("#v-paste").value);
    const newlyChecked = verificationRows().filter((r) => cited.includes(D.plateKey(r.plaque)) && !state.checkedForVerification.has(r.id));
    newlyChecked.forEach((r) => state.checkedForVerification.add(r.id));
    if (newlyChecked.length) toast(`${plural(newlyChecked.length, "véhicule")} coché${newlyChecked.length > 1 ? "s" : ""}`);
    renderVerification();
  });
  document.querySelectorAll("[data-bulk]").forEach((button) => button.addEventListener("click", async () => {
    if (!requireStore()) return;
    const status = button.dataset.bulk;
    const targets = state.demandes.filter((d) => state.checkedForVerification.has(d.id));
    if (!targets.length) return toast("Coche d'abord des véhicules");
    try {
      for (const d of targets) await state.store.setStatus(d, status);
      toast(`${plural(targets.length, "véhicule")} passé${targets.length > 1 ? "s" : ""} en « ${D.statusOf(status).label} »`);
      if (status === "annulee") state.checkedForVerification.clear();
    } catch (err) { reportWriteError(err); }
  }));

  // ================= monthly report =================
  $("#b-month").value = today().slice(0, 7);
  const currentReport = () => D.monthlyReport(state.demandes, { month: $("#b-month").value, provider: $("#b-prest").value, todayIso: today() });
  function tallyTable(title, list) {
    return `<div class="section"><h3>${title}</h3><div class="tablewrap"><table><thead><tr><th></th><th class="num">Demandés</th><th class="num">Réalisés</th><th class="num">Annulés</th><th class="num">En attente</th></tr></thead><tbody>
      ${list.map(([k, t]) => `<tr><td>${esc(k)}</td><td class="num">${t.requested}</td><td class="num">${t.done}</td><td class="num">${t.cancelled}</td><td class="num">${t.overdue + t.upcoming}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }
  function reportLine(d) {
    return `<tr class="click" data-open="${esc(d.id)}"><td class="date">${esc(D.numericDate(d.date))}</td><td>${plateTag(d.plaque)}</td><td>${esc(D.vehicleLabel(d))}</td><td>${esc(D.siteOf(d))}</td><td>${esc(d.prestataire)}</td><td>${statusChip(d.statut)}</td></tr>`;
  }
  function renderReport() {
    const month = $("#b-month").value, provider = $("#b-prest").value;
    // The start of the month is read only when the Bilan page is open (it would cost reads at every opening otherwise).
    const loading = month && !$("#view-bilan").hidden && needOlder(D.monthStart(month + "-01"), D.nextMonthStart(month + "-01"));
    const report = currentReport();
    if (loading && !report.rows.length) {
      $("#b-body").innerHTML = `<div class="empty" aria-busy="true"><b>Chargement de ${esc(D.monthLabel(month))}…</b><span>Les mois anciens sont lus seulement quand tu les ouvres.</span></div>`;
      return;
    }
    if (!report.rows.length) {
      $("#b-body").innerHTML = `<div class="empty"><b>Aucune demande en ${esc(D.monthLabel(month))}${provider ? " avec " + esc(provider) : ""}.</b><span>Le bilan compte les demandes selon leur premier jour de disponibilité : demandées, réalisées, annulées et encore en attente.</span></div>`;
      return;
    }
    const t = report.total;
    const done = report.rows.filter((d) => d.statut === "realisee").sort(D.byDateThenTime);
    const open = report.rows.filter(D.isOpen).sort(D.byDateThenTime);
    const head = `<thead><tr><th>Dispo</th><th>Plaque</th><th>Modèle</th><th>Site</th><th>Prestataire</th><th>Statut</th></tr></thead>`;
    $("#b-body").innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="label">Demandés</span><b>${t.requested}</b><span class="muted small">${esc(D.monthLabel(month))}</span></div>
        <div class="kpi done"><span class="label">Réalisés</span><b>${t.done}</b><span class="muted small">${t.requested ? Math.round((t.done / t.requested) * 100) : 0} % des demandes</span></div>
        <div class="kpi wait"><span class="label">À confirmer</span><b>${t.overdue}</b><span class="muted small">dispo passée, pas encore réalisé</span></div>
        <div class="kpi"><span class="label">À venir</span><b>${t.upcoming}</b><span class="muted small">pas encore passé</span></div>
        <div class="kpi off"><span class="label">Annulés</span><b>${t.cancelled}</b><span class="muted small">&nbsp;</span></div>
      </div>
      <div class="tallies">${tallyTable("Par prestataire", report.byProvider)}${tallyTable("Par site", report.bySite)}${tallyTable("Par modèle", report.byModel)}</div>
      <div class="section"><h3>Véhicules réalisés · ${done.length}</h3>${done.length ? `<div class="tablewrap"><table class="wide">${head}<tbody>${done.map(reportLine).join("")}</tbody></table></div>` : `<p class="muted">Aucun véhicule marqué « Réalisée » ce mois-ci. Utilise l'onglet Vérification pour les cocher.</p>`}</div>
      ${open.length ? `<div class="section"><h3>Pas encore réalisés · ${open.length}</h3><div class="tablewrap"><table class="wide">${head}<tbody>${open.map(reportLine).join("")}</tbody></table></div></div>` : ""}`;
  }
  $("#b-body").addEventListener("click", (e) => { const r = e.target.closest("[data-open]"); if (r) openDemande(r.dataset.open); });
  ["#b-month", "#b-prest"].forEach((s) => $(s).addEventListener("change", renderReport));
  $("#b-copy").onclick = async () => {
    const text = D.monthlySummaryMessage(currentReport(), { month: $("#b-month").value, provider: $("#b-prest").value });
    if (await copyText(text)) toast("Résumé copié");
  };
  const exportRows = () => [D.EXPORT_HEADER, ...currentReport().rows.slice().sort(D.byDateThenTime).map(D.exportRow)];
  $("#b-tsv").onclick = async () => {
    const rows = exportRows();
    if (await copyText(D.toTsv(rows))) toast(`${plural(rows.length - 1, "ligne")} copiée${rows.length > 2 ? "s" : ""} : colle-les dans une feuille Google Sheets`);
  };
  $("#b-csv").onclick = () => {
    const provider = $("#b-prest").value;
    const filename = `bilan-prestations-${$("#b-month").value}${provider ? "-" + provider.replace(/[^\w-]+/g, "-") : ""}.csv`;
    saveBlob(Promise.resolve(new Blob([D.toCsv(exportRows())], { type: "text/csv" })), filename);
  };

  // ================= history =================
  const HISTORY_STATUS_FILTERS = { "": () => true, ouvert: D.isOpen };
  function renderHistory() {
    const query = $("#q").value, provider = $("#h-prest").value, status = $("#h-statut").value, service = $("#h-svc").value, site = $("#h-site").value;
    const statusFilter = HISTORY_STATUS_FILTERS[status] || ((d) => d.statut === status);
    const month = $("#h-mois").value, from = month && month + "-01", to = month && D.nextMonthStart(from);
    const loading = month && needOlder(from, to);
    renderOlderNote();
    const rows = state.demandes.filter((d) => (!month || (d.date && d.date < to && D.lastDay(d) >= from)) &&
      (!provider || d.prestataire === provider) && (!service || d.service === service) && (!site || d.site === site) && statusFilter(d) &&
      D.matchesSearch([d.plaque, D.vehicleLabel(d), d.site, d.adresse, d.notes, d.prestataire], query)
    ).sort((a, b) => (b.date || "").localeCompare(a.date || "") || D.byStartTime(a, b));
    if (loading && !rows.length) {
      $("#histWrap").innerHTML = `<div class="empty" aria-busy="true"><b>Chargement de ${esc(D.monthLabel(month))}…</b><span>Les mois anciens sont lus seulement quand tu les choisis.</span></div>`;
      return;
    }
    if (!rows.length) {
      $("#histWrap").innerHTML = `<div class="empty"><b>${state.demandes.length ? "Aucune demande ne correspond à ces filtres." : "Aucune demande enregistrée pour l'instant."}</b><span>Chaque demande saisie dans « Nouvelle demande » est listée ici, avec la date à laquelle elle a été envoyée.</span></div>`;
      return;
    }
    $("#histWrap").innerHTML = `<div class="tablewrap"><table class="wide hist"><thead><tr><th>Dispo</th><th>Créneau</th><th>Plaque</th><th>Modèle</th><th>Site</th><th>Prestataire</th><th>Statut</th><th>Envoyée le</th></tr></thead><tbody>${rows.map(historyLine).join("")}</tbody></table></div>`;
  }
  // Below the history: older requests stay unread until asked for, to spare the free plan's daily reads.
  function renderOlderNote() {
    const note = $("#h-older");
    const loading = state.olderRanges.some((r) => !r.ready && r.from === D.OLDEST_DAY);
    note.hidden = !state.store?.olderOnDemand?.() || allOlderLoaded() || !!$("#h-mois").value;
    if (note.hidden) return;
    note.innerHTML = `Ici : les demandes depuis le ${esc(D.numericDate(state.recentFrom))}, plus toutes celles encore en cours ou en retard, quel que soit leur âge, et les contrôles hayon des 8 derniers mois. Pour un mois plus ancien, choisis-le dans la liste des périodes en haut (une semaine : dans le Planning).
      <button type="button" class="ghost small-btn" id="h-older-btn" ${loading ? "disabled aria-busy=\"true\"" : ""}>${loading ? "Chargement…" : "Afficher aussi les plus anciennes"}</button>`;
  }
  $("#h-older").addEventListener("click", (e) => { if (e.target.closest("#h-older-btn")) { needOlder(D.OLDEST_DAY, null); renderHistory(); } });
  function historyLine(d) {
    const span = D.isMultiDay(d) ? `${D.shortDate(d.date)} → ${D.shortDate(D.lastDay(d))}` : D.shortDate(d.date);
    const slot = esc(D.timeSlotLabel(d));
    // data-slot / data-provider let the phone layout show a compact card without a second markup.
    return `<tr class="click" data-open="${esc(d.id)}"><td class="date" data-slot="· ${slot}">${esc(span)}</td><td class="date">${slot}</td><td>${plateTag(d.plaque)}</td>
      <td>${esc(D.vehicleLabel(d))}${D.isWindshield(d) ? "" : ` <span class="tag">${esc(D.jobLabel(d))}</span>`}</td><td data-provider="${esc(d.prestataire)}">${esc(D.siteOf(d))}</td><td>${esc(d.prestataire)}</td>
      <td>${statusChip(d.statut)}</td><td class="date muted">${d.sentAt ? esc(D.shortDate(d.sentAt.slice(0, 10))) : "—"}</td></tr>`;
  }
  ["#q", "#h-prest", "#h-statut", "#h-svc", "#h-site", "#h-mois"].forEach((s) => $(s).addEventListener("input", renderHistory));
  $("#histWrap").addEventListener("click", (e) => { const r = e.target.closest("[data-open]"); if (r) openDemande(r.dataset.open); });

  // ================= settings =================
  const currentSettings = () => ({ sites: state.sites, flotte: state.fleet, prestataires: state.providers, contacts: state.contacts, sheetUrl: state.sheetUrl });
  async function persistSettings(message) {
    if (!requireStore()) return;
    try { await state.store.saveSettings(currentSettings()); if (message) toast(message); } catch (err) { reportWriteError(err); }
  }
  const removeButton = (attr, i, label) => `<button type="button" class="ghost" ${attr}="${i}" aria-label="Retirer ${esc(label)}">${icon("x")}</button>`;
  function renderSettings() {
    $("#s-sites").innerHTML = state.sites.map((s, i) => `<div class="item"><b>${esc(s.nom)}</b>
      <input data-site-address="${i}" value="${esc(s.adresse)}" placeholder="Adresse du site" aria-label="Adresse de ${esc(s.nom)}">${removeButton("data-remove-site", i, s.nom)}</div>`).join("");
    $("#s-fleet").innerHTML = state.fleet.map((f, i) => `<div class="item"><span>${esc(f.modele)}</span><span class="muted">${f.cubage ? esc(f.cubage) + " m³" : ""}</span>${removeButton("data-remove-model", i, D.fleetLabel(f))}</div>`).join("");
    const provFlag = (p, flag, label) => `<label class="check"><input type="checkbox" data-prov-flag="${flag}" data-prov="${esc(p)}" ${D.offers(state.providerDocs.get(D.providerId(p)), flag, p) ? "checked" : ""}>${label}</label>`;
    $("#s-provs").innerHTML = state.providers.map((p, i) => `<div class="item"><div class="prov-name"><b>${esc(p)}</b>${alertChip(D.providerAlertStatus(state.alertDevices, state.accounts, D.providerId(p)), true)}</div>
      <div class="prov-flags">${provFlag(p, "lavage", "Lavage")}${provFlag(p, "pareBrise", "Pare-brise")}${provFlag(p, "interventions", "Interventions")}${provFlag(p, "hayon", "Contrôle hayon")}</div>${removeButton("data-remove-provider", i, p)}</div>`).join("");
    $("#s-sheeturl").value = state.sheetUrl;
    renderPrices(); renderAccounts(); renderAlertSummary();
  }
  // Who receives the alerts on a closed app: green = on, orange = not on (or app not opened for 2 months).
  const ALERT_CHIP = { on: "st-realisee", stale: "st-a_envoyer", none: "st-a_envoyer", nobody: "st-annulee" };
  const alertChip = (st, short) => (st ? `<span class="chip alert-chip ${ALERT_CHIP[st.level]}" title="${esc(st.title)}">${esc(short ? st.short : st.text)}</span>` : "");
  function renderAlertSummary() {
    const box = $("#al-who");
    if (!box) return;
    const devices = state.alertDevices;
    box.hidden = !devices;
    if (!devices) return;
    const people = state.accounts.filter((a) => a.role === "prestataire" || a.role === "admin");
    const count = (role) => {
      const list = people.filter((a) => a.role === role);
      return [list.filter((a) => D.alertStatus(devices, a.id).level === "on").length, list.length];
    };
    const [provOn, provAll] = count("prestataire");
    const [teamOn, teamAll] = count("admin");
    const names = (level) => [...new Set(people.filter((a) => a.role === "prestataire" && D.alertStatus(devices, a.id).level === level)
      .map((a) => providerName(a.prestataireId) || a.id))].join(", ");
    const missing = names("none"), stale = names("stale");
    $("#al-who-text").innerHTML = `Alertes actives : <b>${provOn} compte${provOn > 1 ? "s" : ""} prestataire sur ${provAll}</b>, ${teamOn} de l'équipe sur ${teamAll}.`
      + (missing ? ` Pas encore activées chez : ${esc(missing)}.` : "") + (stale ? ` À vérifier (appli pas ouverte depuis 2 mois) : ${esc(stale)}.` : "")
      + (provAll && provOn === provAll ? " Tous les prestataires les reçoivent." : "");
  }

  // ----- prices (HT), per provider -----
  const pricesProvider = () => $("#t-prov").value || defaultProvider();
  function renderPrices() {
    setSelectOptions($("#t-prov"), options(state.providers));
    setSelectOptions($("#t-svc"), priceKinds().map(([value, line]) => `<option value="${value}">${esc(D.jobLabel(line))}</option>`).join(""));
    const lines = pricesOf(D.providerId(pricesProvider()));
    $("#t-list").innerHTML = lines.length
      ? lines.map((line, i) => `<div class="item price"><span>${esc(D.priceLineLabel(line))}</span>
          <b>${esc(D.euros(+line.prixHT))} HT</b><span class="muted">${esc(D.euros(D.withVat(+line.prixHT)))} TTC</span>${removeButton("data-remove-price", i, D.priceLineLabel(line))}</div>`).join("")
      : `<p class="hint">Aucun tarif pour ce prestataire : ses demandes n'auront pas de montant.</p>`;    const missing = D.missingKnownPrices(state.providers, pricesOf);
    const count = missing.reduce((n, m) => n + m.add.length, 0);
    $("#t-known-box").hidden = !count || !state.canWrite;
    $("#t-known-text").textContent = count ? `${plural(count, "tarif")} à ajouter pour ${missing.map((m) => m.name).join(", ")}.` : "";
  }
  // One choice per price kind: windshield, complete wash, inside wash, intervention.
  const priceKinds = () => D.SERVICES.flatMap((x) => (x.id === "lavage" ? D.WASH_KINDS.map((k) => ({ service: x.id, formule: k.id })) : [{ service: x.id }]))
    .map((line) => [[line.service, line.formule].filter(Boolean).join(":"), line]);
  async function savePrices(providerName, tarifs, message) {
    if (!requireStore()) return;
    try { await state.store.saveProvider(D.providerId(providerName), { nom: providerName, tarifs }); toast(message); }
    catch (err) { reportWriteError(err); }
  }
  $("#t-prov").addEventListener("change", renderPrices);
  // One click fills the prices agreed with Allo and the washers (see D.KNOWN_PRICES); lines already there are kept.
  $("#t-known").onclick = async () => {
    if (!requireStore()) return;
    const missing = D.missingKnownPrices(state.providers, pricesOf);
    try {
      for (const m of missing) await state.store.saveProvider(D.providerId(m.name), { nom: m.name, tarifs: [...pricesOf(D.providerId(m.name)), ...m.add] });
      toast(`${plural(missing.reduce((n, m) => n + m.add.length, 0), "tarif")} ajouté(s)`);
    } catch (err) { reportWriteError(err); }
  };
  $("#t-add").onclick = () => {
    const prix = parseFloat($("#t-prix").value.replace(",", "."));
    if (!Number.isFinite(prix) || prix < 0) return toast("Indique le prix hors taxe, par exemple 266,67");
    const bound = (sel) => ($(sel).value === "" ? null : +$(sel).value);
    const kind = priceKinds().find(([value]) => value === $("#t-svc").value)[1];
    const line = { ...kind, cubageMin: bound("#t-min"), cubageMax: bound("#t-max"), prixHT: Math.round(prix * 100) / 100 };
    if (line.cubageMin != null && line.cubageMax != null && line.cubageMin > line.cubageMax) return toast("Le cubage « de » doit être plus petit que « à »");
    const name = pricesProvider();
    savePrices(name, [...pricesOf(D.providerId(name)), line], "Tarif ajouté");
    ["#t-min", "#t-max", "#t-prix"].forEach((sel) => ($(sel).value = ""));
  };

  // ----- who can open the app -----
  const providerName = (id) => state.providers.find((p) => D.providerId(p) === id) || state.providerDocs.get(id)?.nom || id || "";
  const ownAccountMissing = () => !!state.userEmail && !state.accounts.some((a) => a.id === D.emailKey(state.userEmail));
  function renderAccounts() {
    setSelectOptions($("#a-prov"), options(state.providers));
    $("#a-prov").disabled = $("#a-role").value !== "prestataire";
    const sorted = state.accounts.slice().sort((a, b) => (a.role || "").localeCompare(b.role || "") || a.id.localeCompare(b.id));
    $("#a-list").innerHTML = sorted.length
      ? sorted.map((a) => `<div class="item account"><span>${esc(a.id)}</span>
          <span class="account-meta"><span class="muted">${esc(a.role === "prestataire" ? providerName(a.prestataireId) : D.roleOf(a.role)?.label.split(" (")[0] || a.role)}</span>${["prestataire", "admin"].includes(a.role) ? alertChip(D.alertStatus(state.alertDevices, a.id)) : ""}</span>
          ${removeButton("data-remove-account", esc(a.id), a.id)}</div>`).join("")
      : `<p class="hint">Aucun accès enregistré pour l'instant.</p>`;
    const toLink = D.accessMigration(state.demandes, pricesOf).length;
    const meMissing = ownAccountMissing();
    $("#a-prepare").hidden = !toLink && !meMissing;
    $("#a-prepare-text").textContent = [
      toLink ? `${plural(toLink, "demande")} à rattacher à leur prestataire ou à chiffrer avec les nouveaux tarifs` : "",
      meMissing ? `ton propre accès (${state.userEmail}) à créer en équipe City-Drop` : "",
    ].filter(Boolean).join(" et ") + ".";
  }
  $("#a-role").addEventListener("change", renderAccounts);
  $("#a-add").onclick = async () => {
    const email = D.emailKey($("#a-email").value);
    if (!D.isEmail(email)) return toast("Adresse e-mail invalide");
    const role = $("#a-role").value;
    const fields = role === "prestataire" ? { role, prestataireId: D.providerId($("#a-prov").value) } : { role };
    if (role === "prestataire" && !fields.prestataireId) return toast("Choisis le prestataire de ce compte");
    if (!requireStore()) return;
    try {
      if (role === "prestataire") await state.store.saveProvider(fields.prestataireId, { nom: $("#a-prov").value });
      await state.store.saveAccount(email, fields);
      $("#a-email").value = ""; toast("Accès enregistré");
    } catch (err) { reportWriteError(err); }
  };
  $("#a-prepare-btn").onclick = async () => {
    if (!requireStore()) return;
    try {
      for (const name of state.providers) {
        const id = D.providerId(name);
        if (!state.providerDocs.has(id)) await state.store.saveProvider(id, { nom: name, tarifs: [] });
      }
      if (ownAccountMissing()) await state.store.saveAccount(state.userEmail, { role: "admin" });
      const updates = D.accessMigration(state.demandes, pricesOf);
      await state.store.linkRequests(updates);
      toast(`Accès préparés : ${plural(updates.length, "demande")} rattachée${updates.length > 1 ? "s" : ""}`);
    } catch (err) { reportWriteError(err); }
  };
  function addFromInput(input, list, make, message) {
    const value = $(input).value.trim();
    if (!value) return;
    list.push(make(value)); $(input).value = ""; renderAll(); persistSettings(message);
  }
  $("#s-addsite").onclick = () => !siteNames().includes($("#s-newsite").value.trim()) && addFromInput("#s-newsite", state.sites, (nom) => ({ nom, adresse: "" }), "Site ajouté");
  $("#s-importsites").onclick = () => {
    const incoming = D.parseSiteList($("#s-paste").value);
    if (!incoming.length) return toast("Aucun site reconnu : colle le nom puis l'adresse de chaque site");
    const { sites, added, updated } = D.mergeSites(state.sites, incoming);
    state.sites = sites; $("#s-paste").value = ""; $("#s-pastebox").open = false; renderAll();
    persistSettings(added || updated ? `${plural(added, "site")} ajouté${added > 1 ? "s" : ""}, ${updated} mis à jour` : "Tous ces sites étaient déjà à jour");
  };
  $("#s-provs").addEventListener("change", async (e) => {
    const box = e.target.closest("[data-prov-flag]");
    if (!box || !requireStore()) return;
    const nom = box.dataset.prov, flag = box.dataset.provFlag;
    const what = { hayon: "des contrôles hayon", pareBrise: "des pare-brise", lavage: "des lavages" }[flag] || "des interventions";
    try { await state.store.saveProvider(D.providerId(nom), { nom, [flag]: box.checked }); toast(box.checked ? `${nom} peut recevoir ${what}` : `${nom} ne reçoit plus ${what.replace(/^des /, "de ")}`); }
    catch (err) { box.checked = !box.checked; reportWriteError(err); }
  });
  $("#s-addprov").onclick = () => !state.providers.includes($("#s-newprov").value.trim()) && addFromInput("#s-newprov", state.providers, (p) => p, "Prestataire ajouté");
  $("#s-addmodel").onclick = () => {
    const cubage = +$("#s-newcub").value || null;
    addFromInput("#s-newmodel", state.fleet, (modele) => ({ modele, cubage }), "Modèle ajouté");
    $("#s-newcub").value = "";
  };
  function removeAt(list, index) { list.splice(index, 1); renderAll(); persistSettings(); }
  $("#view-reglages").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-site], [data-remove-model], [data-remove-provider], [data-remove-price], [data-remove-account]");
    if (!b) return;
    if (b.dataset.removePrice) {
      const name = pricesProvider();
      return savePrices(name, pricesOf(D.providerId(name)).filter((_, i) => i !== +b.dataset.removePrice), "Tarif retiré");
    }
    if (b.dataset.removeAccount) {
      if (b.dataset.removeAccount === D.emailKey(state.userEmail)) return toast("Tu ne peux pas retirer ton propre accès");
      return requireStore() && state.store.deleteAccount(b.dataset.removeAccount).then(() => toast("Accès retiré"), reportWriteError);
    }
    if (b.dataset.removeSite) removeAt(state.sites, +b.dataset.removeSite);
    else if (b.dataset.removeModel) removeAt(state.fleet, +b.dataset.removeModel);
    else removeAt(state.providers, +b.dataset.removeProvider);
  });
  $("#view-reglages").addEventListener("change", (e) => {
    const address = e.target.closest("[data-site-address]");
    const phone = e.target.closest("[data-phone]");
    if (address) { state.sites[+address.dataset.siteAddress].adresse = address.value.trim(); persistSettings("Adresse enregistrée"); }
    if (phone) { state.contacts = { ...state.contacts, [phone.dataset.phone]: phone.value.trim() }; persistSettings("Numéro enregistré"); }
  });
  $("#s-savesheet").onclick = () => {
    const url = $("#s-sheeturl").value.trim();
    if (url && !/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) return toast("L'URL doit commencer par https://script.google.com/ et finir par /exec");
    state.sheetUrl = url; persistSettings(url ? "URL enregistrée" : "Liaison retirée"); renderAll();
  };
  $("#s-script").textContent = SHEET_SCRIPT;
  $("#s-copyscript").onclick = async () => { if (await copyText(SHEET_SCRIPT)) toast("Script copié"); };

  // ================= provider answers (team side) =================
  // A "done" answer closes the request on its own; every answer is listed until someone marks it seen.
  const applying = new Set();
  let knownAnswers = null;
  function followAnswers(rows) {
    if (!state.canWrite) return;
    rows.forEach((d) => {
      const status = D.statusFromAnswer(d);
      if (!status || applying.has(d.id)) return;
      applying.add(d.id);
      state.store.applyAnswer(d, status).catch(() => {}).finally(() => applying.delete(d.id));
    });
    const signature = (d) => d.id + "|" + d.retour.at;
    const fresh = D.unseenAnswers(rows).filter((d) => knownAnswers && !knownAnswers.has(signature(d)));
    knownAnswers = new Set(D.unseenAnswers(rows).map(signature));
    if (fresh.length) { toast(fresh.length > 1 ? `${fresh.length} nouveaux retours des prestataires` : answerSentence(fresh[0])); notifyAnswers(fresh); }
  }
  // ---------- requests imported from City-Drop mails: the team app links them to the provider and fills in what it knows ----------
  const completing = new Set();
  function completeMailRequests() {
    if (!state.canWrite || !state.store) return;
    const ctx = { demandes: state.demandes, vehicleOf, providerNames: state.providers, pricesOf };
    state.demandes.forEach((d) => {
      const patch = D.mailCompletion(d, ctx);
      if (!patch || completing.has(d.id)) return;
      completing.add(d.id);
      state.store.completeDemande(d, patch).catch(() => {}).finally(() => completing.delete(d.id));
    });
  }
  // ================= tailgate controls (hayon) =================
  // A sent control whose day has passed is done: the provider never reports it, so the team app closes it.
  const closingHayons = new Set();
  function closePastHayons(rows) {
    if (!state.canWrite) return;
    rows.filter((d) => D.hayonAutoClose(d, today()) && !closingHayons.has(d.id)).forEach((d) => {
      closingHayons.add(d.id);
      state.store.setStatus(d, "realisee", { auto: true }).catch(() => {}).finally(() => closingHayons.delete(d.id));
    });
  }
  const HAYON_FILTERS = {
    "": () => true,
    atraiter: (r) => !r.booked && ["depasse", "urgent", "bientot", "inconnu"].includes(r.level),
    rdv: (r) => !!r.booked,
  };
  function hayonDaysLabel(r) {
    if (r.daysLeft == null) return "Date inconnue";
    if (r.daysLeft < 0) return `Dépassé de ${plural(-r.daysLeft, "jour")}`;
    if (r.daysLeft === 0) return "À faire aujourd'hui";
    return `Reste ${plural(r.daysLeft, "jour")}`;
  }
  const slotOf = (d) => `${D.shortDate(d.date)}${d.debut && d.debut !== D.DEFAULT_SLOT.debut ? " à " + d.debut.replace(":", "h") : ""}`;
  function hayonRow(r) {
    const key = D.plateKey(r.plaque);
    const known = state.hayons.some((h) => D.plateKey(h.plaque) === key);
    const notes = [];
    if (r.tooSoon) notes.push(`<span class="hy-warn">${icon("alert")}Deux contrôles posés à ${plural(r.tooSoon.gap, "jour")} d'écart (${esc(D.shortDate(r.tooSoon.first.date))} et ${esc(D.shortDate(r.tooSoon.second.date))})</span>`);
    if (r.notDone) notes.push(`<span class="muted">Pas fait le ${esc(D.shortDate(r.notDone.date))}</span>`);
    const recent = r.lastRequest && D.daysBetween(r.lastRequest.date, today()) <= 30;
    const rdv = r.booked
      ? `<button type="button" class="hy-rdv" data-open="${esc(r.booked.id)}">${icon("cal")}<span>RDV ${esc(slotOf(r.booked))}${r.booked.site ? ` · ${esc(r.booked.site)}` : ""}</span></button>`
      : `<span class="muted hy-nordv">Pas de RDV</span>`;
    return `<li class="hy-row lv-${r.level}">
      <span class="hy-days">${esc(hayonDaysLabel(r))}</span>
      ${plateTag(r.plaque)}
      <span class="hy-dates"><span>Dernier contrôle <b>${r.lastControl ? esc(D.numericDate(r.lastControl)) : "—"}</b></span><span>À refaire avant <b>${r.nextDue ? esc(D.numericDate(r.nextDue)) : "—"}</b></span>${notes.join("")}</span>
      <span class="hy-actions">${rdv}
        ${state.canWrite && recent ? `<button type="button" class="ghost small-btn" data-hy-notdone="${esc(r.lastRequest.id)}" title="Le contrôle du ${esc(D.shortDate(r.lastRequest.date))} n'a pas eu lieu">Pas fait ?</button>` : ""}
        ${state.canWrite && r.notDone && !r.booked ? `<button type="button" class="ghost small-btn" data-hy-done="${esc(r.notDone.id)}">Finalement fait</button>` : ""}
        ${state.canWrite && known ? `<button type="button" class="ghost small-btn" data-hy-remove="${esc(key)}" aria-label="Retirer ${esc(r.plaque)} de la liste">${icon("x")}</button>` : ""}</span>
    </li>`;
  }
  function renderHayon() {
    const rows = D.hayonFollowUp(state.hayons, state.demandes, today());
    const count = (...levels) => rows.filter((r) => levels.includes(r.level)).length;
    const urgent = rows.filter((r) => !r.booked && ["depasse", "urgent"].includes(r.level)).length;
    $("#hayonBadge").hidden = !urgent; $("#hayonBadge").textContent = urgent;
    $("#hy-kpis").innerHTML = rows.length ? [[["depasse", "urgent"], "Dépassés ou 5 jours ou moins"], [["bientot"], "30 jours ou moins"], [["ok"], "À jour"]]
      .map(([levels, label]) => `<div class="hy-kpi lv-${levels[levels.length - 1]}"><b>${count(...levels)}</b><span>${label}</span></div>`).join("") : "";
    const query = $("#hy-q").value, filter = HAYON_FILTERS[$("#hy-filter").value] || HAYON_FILTERS[""];
    const shown = rows.filter((r) => filter(r) && D.matchesSearch([r.plaque], query));
    $("#hy-list").innerHTML = !rows.length
      ? `<div class="empty"><b>Aucun véhicule à hayon pour l'instant.</b><span>Colle la liste du prestataire ci-dessous (plaque et date du dernier contrôle) : le compteur des 180 jours démarre tout de suite. Chaque contrôle hayon reçu par mail s'ajoute aussi ici.</span></div>`
      : shown.length ? `<ul class="hy-list">${shown.map(hayonRow).join("")}</ul>` : `<div class="empty"><b>Aucun véhicule ne correspond.</b></div>`;
    $("#hy-pastebox").hidden = !state.canWrite;
    $("#hy-pastebox").open = state.canWrite && !rows.length ? true : $("#hy-pastebox").open;
  }
  ["#hy-q", "#hy-filter"].forEach((sel) => $(sel).addEventListener("input", renderHayon));
  $("#hy-paste").addEventListener("input", () => {
    const list = D.parseHayonList($("#hy-paste").value);
    const undated = list.filter((h) => !h.dernierControle).length;
    $("#hy-preview").textContent = list.length ? `${plural(list.length, "véhicule")} reconnu${list.length > 1 ? "s" : ""}${undated ? `, dont ${undated} sans date` : ""}` : "";
  });
  $("#hy-import").onclick = async () => {
    const list = D.parseHayonList($("#hy-paste").value);
    if (!list.length) return toast("Aucune plaque reconnue : colle une plaque et sa date par ligne");
    if (!requireStore()) return;
    try { await state.store.saveHayons(list); $("#hy-paste").value = ""; $("#hy-preview").textContent = ""; $("#hy-pastebox").open = false; toast(`${plural(list.length, "véhicule")} enregistré${list.length > 1 ? "s" : ""}`); }
    catch (err) { reportWriteError(err); }
  };
  $("#hy-list").addEventListener("click", async (e) => {
    const open = e.target.closest("[data-open]");
    if (open) return openDemande(open.dataset.open);
    const notDone = e.target.closest("[data-hy-notdone], [data-hy-done]");
    if (notDone && requireStore()) {
      const missed = !!notDone.dataset.hyNotdone;
      const d = demandeById(notDone.dataset.hyNotdone || notDone.dataset.hyDone);
      try { await state.store.markHayonNotDone(d, missed); toast(missed ? `Contrôle du ${D.shortDate(d.date)} marqué « pas fait » : le compteur reprend l'ancien contrôle` : "Contrôle remis comme fait"); }
      catch (err) { reportWriteError(err); }
      return;
    }
    const remove = e.target.closest("[data-hy-remove]");
    if (remove && requireStore()) {
      if (!remove.classList.contains("confirm")) { remove.classList.add("confirm"); remove.textContent = "Retirer ?"; return; }
      try { await state.store.deleteHayon(remove.dataset.hyRemove); toast("Véhicule retiré de la liste des hayons"); }
      catch (err) { reportWriteError(err); }
    }
  });

  // ---------- answers from providers: Retours page, tab badge, window title, desktop notifications ----------
  const answerSentence = (d) => `${d.prestataire} ${D.answerOf(d.retour.etat)?.team || "a répondu pour"} ${d.plaque}`;
  // ---------- problems seen on a vehicle by a provider (shock, tyre, warning light) ----------
  const providerOfProblem = (p) => demandeById(p.demandeId)?.prestataire || state.providerDocs.get(p.prestataireId)?.nom || "Prestataire";
  const atLabel = (iso) => `${D.numericDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
  function problemHint(plate) {
    const open = D.openProblems(D.problemsOfPlate(state.problems, plate));
    return open.length && D.plateKey(plate) ? `Problème signalé par ${providerOfProblem(open[0])} le ${D.shortDate(open[0].at.slice(0, 10))} : ${D.problemSummary(open[0])}` : "";
  }
  // Petites icônes des anomalies cochées par le prestataire (pare-brise, pneu…), les mêmes que sur son écran.
  const problemArts = (p) => { const arts = (p.quoi || []).filter((q) => self.IssueArt?.has(q)).slice(0, 4).map((q) => self.IssueArt.art(q, "mini-art")).join(""); return arts ? `<span class="mini-arts">${arts}</span>` : ""; };
  let knownProblems = null;
  function followProblems(rows) {
    const fresh = D.openProblems(rows).filter((p) => knownProblems && !knownProblems.has(p.id));
    knownProblems = new Set(rows.map((p) => p.id));
    if (!fresh.length) return;
    const sentence = (p) => `${providerOfProblem(p)} signale un problème sur ${p.plaque} : ${D.problemSummary(p)}`;
    toast(fresh.length > 1 ? `${fresh.length} problèmes signalés sur des véhicules` : sentence(fresh[0]));
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
      const n = new Notification("Problème signalé sur un véhicule", { body: fresh.slice(0, 3).map(sentence).join("\n"), icon: "assets/icon-180.png", tag: "problemes" });
      n.onclick = () => { window.focus(); show("retours"); n.close(); };
    }
  }

  function renderAnswers() {
    const rows = D.unseenAnswers(state.demandes);
    const openProblems = D.openProblems(state.problems).length;
    const n = rows.length + openProblems;
    $("#retoursBadge").hidden = !n; $("#retoursBadge").textContent = n;
    document.title = (n ? `(${n}) ` : "") + "City-Drop × Presta";
    try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
    renderRetoursSide(rows, openProblems);
    renderAlertButton();
    renderRetours();
  }
  // Planning side card: the latest unseen answers, handled without leaving the planning.
  const SIDE_MAX = 4;
  const timeOf = (iso) => (iso.slice(0, 10) === today() ? iso.slice(11, 16).replace(":", "h") : D.shortDate(iso.slice(0, 10)));
  function sideRow(d) {
    const r = d.retour;
    const quick = [
      r.preuve ? `<button type="button" class="ghost icon-btn" data-proof="${esc(r.preuve)}" aria-label="Voir la photo de ${esc(d.plaque)}">${icon("image")}</button>` : "",
      r.etat === "autre-date" && state.canWrite ? `<button type="button" class="ghost" data-accept-date="${esc(d.id)}">Accepter</button>` : "",
      state.canWrite ? `<button type="button" class="ghost icon-btn" data-seen="${esc(d.id)}" aria-label="Marquer comme vu">${icon("check")}</button>` : "",
    ].join("");
    return `<li class="side-row"><button type="button" class="side-open" data-open="${esc(d.id)}">
        <span class="side-line"><b>${esc(d.plaque)}</b><span class="muted side-time">${esc(timeOf(r.at))}</span></span>
        <span class="side-what">${esc(d.prestataire)} · ${esc(D.answerSummary(r))}</span></button>
      <span class="side-quick">${quick}</span></li>`;
  }
  function renderRetoursSide(rows, openProblems = 0) {
    const n = rows.length;
    const head = `<div class="panel-head"><h2>Retours${n + openProblems ? ` <span class="tab-badge">${n + openProblems}</span>` : ""}</h2><a href="#retours" class="side-all">Tout voir</a></div>`;
    const problems = openProblems ? `<a href="#retours" class="side-problems">${icon("alert")}${openProblems > 1 ? `${openProblems} problèmes signalés sur des véhicules` : "1 problème signalé sur un véhicule"}</a>` : "";
    $("#retoursSide").innerHTML = head + problems + (n
      ? `<ul class="side-list">${rows.slice(0, SIDE_MAX).map(sideRow).join("")}</ul>${n > SIDE_MAX ? `<a href="#retours" class="side-more">+ ${plural(n - SIDE_MAX, "autre retour")}</a>` : ""}`
      : `<p class="side-empty">Aucun nouveau retour des prestataires.</p>`);
  }
  // A system notification for answers that arrive while the app is open in another tab or window.
  function notifyAnswers(fresh) {
    if (state.alerts?.state === "on") return; // the alert script already sends it to this device
    if (!("Notification" in window) || Notification.permission !== "granted" || document.visibilityState === "visible") return;
    const n = new Notification(fresh.length > 1 ? `${fresh.length} nouveaux retours des prestataires` : "Nouveau retour d'un prestataire", {
      body: fresh.slice(0, 3).map(answerSentence).join("\n"), icon: "assets/icon-180.png", tag: "retours",
    });
    n.onclick = () => { window.focus(); show("retours"); n.close(); };
  }
  // ---------- alerts on a closed app (team side): button on the Retours page, settings panel ----------
  const ALERT_TEAM_TEXTS = { on: "Alertes actives sur cet appareil.", ask: "Les alertes ne sont pas encore activées sur cet appareil.", loading: "" };
  function renderAlertButton() {
    const a = state.alerts;
    const pushable = a && a.state !== "off" && a.state !== "loading" && state.canWrite;
    $("#notifBtn").hidden = pushable ? !["ask", "error"].includes(a.state) : !("Notification" in window) || Notification.permission !== "default";
    const hint = pushable && window.SuiviAlertes.TEXTS[a.state];
    $("#alertHint").hidden = !hint; $("#alertHint").textContent = hint || "";
    const status = !a || a.state === "off" ? (a?.settings?.url ? "" : "Pas encore branché : colle l'adresse du script.") : window.SuiviAlertes.TEXTS[a.state] || ALERT_TEAM_TEXTS[a.state] || "";
    $("#al-status").textContent = status;
    if (a?.settings?.url && document.activeElement !== $("#al-url")) $("#al-url").value = a.settings.url;
  }
  $("#notifBtn").onclick = () => {
    if (state.alerts && state.alerts.state !== "off") return state.alerts.activate().then(() => { if (state.alerts.state === "on") toast("Alertes activées : une alerte d'essai arrive"); });
    Notification.requestPermission().then((p) => { renderAnswers(); toast(p === "granted" ? "Notifications activées sur cet ordinateur" : "Notifications refusées par le navigateur"); });
  };
  $("#al-save").onclick = async () => {
    if (!requireStore()) return;
    const url = $("#al-url").value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return toast("L'adresse doit commencer par https://script.google.com/macros/s/ et finir par /exec");
    let cle = "";
    try { cle = (await (await fetch(url + "?action=cle", { cache: "no-store" })).json()).cle || ""; } catch {}
    if (!/^[\w-]{80,100}$/.test(cle)) return toast("Le script ne répond pas : vérifie qu'il est déployé en « Application Web », accès « Tout le monde »");
    try { await state.store.saveAlertSettings({ url, cle }); await state.alerts?.reload(); toast("Script des alertes branché"); renderAnswers(); }
    catch (err) { reportWriteError(err); }
  };
  // ================= « Retours » page (2026-11-21, façon iPhone) =================
  // Grouped by what the team has to do: problems on a vehicle, answers to decide (other date, not possible, absent,
  // cancelled « fait »), things seen in passing, then answers already applied (done, taken) that only need « Vu ».
  // A card opens a sheet with the detail and the photo; « Vu » / « Traité » send the card away with « Annuler » in the bubble.
  const RET_ART = { "autre-date": "act-date", absent: "act-absent", refuse: "act-refuse", erreur: "ret-erreur", fait: "ret-fait", confirme: "ret-confirme" };
  const RET_DECIDE = ["autre-date", "refuse", "absent", "erreur"];
  const RET_GROUPS = [
    { id: "problems", title: "Problèmes sur un véhicule", short: "Problèmes", art: "act-problem" },
    { id: "decide", title: "À décider", short: "À décider", art: "act-date" },
    { id: "field", title: "Vu en passant", short: "Vu en passant", art: "Pare-brise" },
    { id: "info", title: "Pour info · déjà appliqué", short: "Pour info", art: "ret-fait" },
  ];
  const ret = { tab: "todo", open: null, thumbs: new Map() };
  const retArt = (key, cls = "ret-art") => self.IssueArt?.art(key, cls) || "";
  const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const hourLabel = (t) => (t ? t.replace(":", "h") : "");
  const ticksOf = (p) => (p.quoi || []).filter((q) => q !== "Autre");
  function retItem(key) {
    const [kind, id] = [key.slice(0, 1), key.slice(2)];
    if (kind === "d") { const d = demandeById(id); return d?.retour ? { key, kind, d, at: d.retour.at } : null; }
    const p = state.problems.find((x) => x.id === id);
    return p ? { key, kind, p, d: p.demandeId ? demandeById(p.demandeId) : null, at: p.at } : null;
  }
  const answerItem = (d) => ({ key: "d:" + d.id, kind: "d", d, at: d.retour.at });
  const problemItem = (p) => ({ key: (D.isFieldReport(p) ? "f:" : "p:") + p.id, kind: D.isFieldReport(p) ? "f" : "p", p, d: p.demandeId ? demandeById(p.demandeId) : null, at: p.at });
  function retGroups() {
    const answers = D.unseenAnswers(state.demandes).map(answerItem);
    const problems = D.openProblems(state.problems).map(problemItem);
    return {
      problems: problems.filter((it) => it.kind === "p"),
      decide: answers.filter((it) => RET_DECIDE.includes(it.d.retour.etat)),
      field: problems.filter((it) => it.kind === "f"),
      info: answers.filter((it) => !RET_DECIDE.includes(it.d.retour.etat)),
    };
  }
  const isRetDone = (it) => (it.kind === "d" ? !!it.d.retour.vu : it.p.statut === "traite");
  // What a card and its sheet show, for the three kinds of retour.
  function retView(it) {
    const done = isRetDone(it);
    const d = it.d;
    const job = d ? [D.jobLabel(d), d.tache].filter(Boolean).join(" · ") : "";
    if (it.kind === "d") {
      const r = d.retour;
      const what = r.etat === "autre-date" ? `Propose le ${D.shortDate(r.date)}${r.debut ? " à " + hourLabel(r.debut) : ""}`
        : r.etat === "fait" ? "Passage fait" : D.answerOf(r.etat)?.label || r.etat;
      const acts = done ? [{ act: "unseen", label: "Remettre à traiter" }]
        : r.etat === "autre-date" ? [{ act: "accept", label: `Accepter le ${D.shortDate(r.date)}`, primary: true }, { act: "seen", label: "Vu" }]
        : RET_DECIDE.includes(r.etat) ? [{ act: "replan", label: "Replanifier", primary: true }, { act: "seen", label: "Vu" }]
        : [{ act: "seen", label: "Vu" }];
      return { art: RET_ART[r.etat] || "ret-fait", kind: "Réponse à une demande", what, note: r.note || "", who: d.prestataire, plate: d.plaque, job, d, photo: r.preuve || "", acts,
        doneLine: done ? "Vu" : "" };
    }
    const p = it.p;
    const who = providerOfProblem(p);
    const handledBy = done ? `Traité${p.traitePar ? " par " + p.traitePar.split("@")[0] : ""}${p.traiteAt ? " le " + atLabel(p.traiteAt) : ""}` : "";
    if (it.kind === "p") {
      const acts = done ? [{ act: "reopen", label: "Rouvrir" }] : [{ act: "handled", label: "Traité", primary: true, check: true }, ...(d ? [{ act: "open", label: "Ouvrir la demande" }] : [])];
      return { art: "act-problem", kind: "Problème sur un véhicule", what: D.problemSummary(p), note: "", who, plate: p.plaque, job, d, photo: p.photo || "", acts, doneLine: handledBy };
    }
    const ticks = ticksOf(p);
    const tickText = ticks.join(", ");
    const words = p.texte && p.texte !== tickText ? p.texte.replace(tickText + " – ", "") : "";
    const acts = done ? [{ act: "reopen", label: "Rouvrir" }] : [{ act: "new", label: "Créer une demande", primary: true, plus: true }, { act: "handled", label: "Traité" }];
    return { art: ticks.find((q) => self.IssueArt?.has(q)) || "Autre", kind: "Vu en passant", what: ticks.length ? ticks.join(", ") : "Autre", note: ticks.length ? words : "", noteIsText: !ticks.length,
      extraArts: ticks.slice(1).filter((q) => self.IssueArt?.has(q)), who, plate: p.plaque, job: "", d: null, photo: p.photo || "", acts, doneLine: handledBy,
      edited: p.modifieAt ? `modifié le ${atLabel(p.modifieAt)}` : "", whatOverride: !ticks.length ? words || p.texte : "" };
  }
  const retBtn = (a, key) => `<button type="button" class="ret-btn${a.primary ? " primary" : ""}" data-ret-act="${a.act}" data-key="${esc(key)}">${a.check ? icon("check") : a.plus ? icon("plus") : ""}${esc(a.label)}</button>`;
  function retCard(it) {
    const v = retView(it);
    const thumb = v.photo ? `<span class="ret-thumb" data-thumb="${esc(v.photo)}">${ret.thumbs.get(v.photo) ? `<img src="${ret.thumbs.get(v.photo)}" alt="">` : ""}${icon("image")}</span>` : "";
    const meta = [v.who, v.job, v.d && D.siteOf(v.d)].filter(Boolean).join(" · ");
    const acts = state.canWrite ? v.acts.filter((a) => !["open", "replan"].includes(a.act) || v.d) : [];
    return `<article class="ret-card${isRetDone(it) ? " done" : ""}" data-ret="${esc(it.key)}">
      <button type="button" class="ret-open" data-ret-open="${esc(it.key)}" aria-label="${esc(`${v.kind} : ${v.plate} – détail`)}">
        <span class="ret-ico" aria-hidden="true">${retArt(v.art)}</span>
        <span class="ret-main">
          <span class="ret-line">${plateTag(v.plate)}<span class="ret-time">${esc(isRetDone(it) ? it.at.slice(11, 16).replace(":", "h") : timeOf(it.at))}</span></span>
          <span class="ret-what">${v.extraArts?.length ? `<span class="ret-minis">${v.extraArts.map((q) => retArt(q, "mini-art")).join("")}</span>` : ""}${esc(v.whatOverride || v.what)}</span>
          ${v.note ? `<span class="ret-note">${esc(v.note)}</span>` : ""}
          <span class="ret-meta">${esc(meta)}${v.doneLine && v.doneLine !== "Vu" ? ` · ${esc(v.doneLine)}` : ""}${v.edited ? ` · ${esc(v.edited)}` : ""}</span>
        </span>
        ${thumb}
      </button>
      ${acts.length ? `<div class="ret-acts">${acts.map((a) => retBtn(a, it.key)).join("")}</div>` : ""}
    </article>`;
  }
  const retDayLabel = (iso) => { const day = iso.slice(0, 10); return day === today() ? "Aujourd'hui" : day === D.addDays(today(), -1) ? "Hier" : D.shortDate(day); };
  function renderRetours() {
    const g = retGroups();
    const todo = g.problems.length + g.decide.length + g.field.length;
    const all = todo + g.info.length;
    $("#retTodoN").textContent = todo || ""; $("#retTodoN").hidden = !todo;
    $("#retKicker").textContent = !all ? "Tout est à jour" : [todo ? `${todo} à traiter` : "Rien à décider", g.info.length ? `${g.info.length} pour info` : ""].filter(Boolean).join(" · ");
    document.querySelectorAll("[data-ret-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.retTab === ret.tab)));
    let html;
    if (ret.tab === "done") {
      const items = [...D.seenAnswers(state.demandes).map(answerItem), ...D.handledProblems(state.problems).map(problemItem)].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 60);
      const days = [];
      items.forEach((it) => { const lbl = retDayLabel(it.at); (days.at(-1)?.lbl === lbl ? days.at(-1).items : (days.push({ lbl, items: [] }), days.at(-1).items)).push(it); });
      html = items.length ? days.map((day) => `<section class="ret-group"><h2 class="ret-gh"><span>${esc(day.lbl)}</span></h2><div class="ret-cards">${day.items.map(retCard).join("")}</div></section>`).join("")
        + `<p class="ret-foot">Les 40 derniers retours vus et les 40 derniers problèmes traités.</p>`
        : `<div class="ret-empty"><span class="ret-ico xl" aria-hidden="true">${retArt("faits-vide")}</span><b>Rien de traité pour l'instant</b><span>Les retours rangés avec « Vu » ou « Traité » restent ici quelques semaines.</span></div>`;
    } else if (!all) {
      html = `<div class="ret-empty"><span class="ret-ico xl" aria-hidden="true">${retArt("empty-inbox")}</span><b>Tout est traité</b><span>Les réponses des prestataires et ce qu'ils signalent sur les véhicules arrivent ici.</span></div>`;
    } else {
      const tiles = `<div class="ret-tiles">${RET_GROUPS.map((grp) => `<button type="button" class="ret-tile" data-ret-jump="${grp.id}"${g[grp.id].length ? "" : " disabled"}>
          <span class="ret-ico sm" aria-hidden="true">${retArt(grp.art)}</span><b>${g[grp.id].length}</b><span>${grp.short}</span></button>`).join("")}</div>`;
      html = tiles + RET_GROUPS.filter((grp) => g[grp.id].length).map((grp) => `<section class="ret-group" id="ret-g-${grp.id}">
          <h2 class="ret-gh"><span>${grp.title}</span><em>${g[grp.id].length}</em>${grp.id === "info" && state.canWrite && g.info.length > 1 ? `<button type="button" class="ret-link" data-ret-act="all-info">Tout ranger</button>` : ""}</h2>
          ${grp.id === "info" ? `<p class="ret-gsub">Déjà reportés sur le planning. « Vu » les range simplement.</p>` : ""}
          <div class="ret-cards${grp.id === "info" ? " compact" : ""}">${g[grp.id].map(retCard).join("")}</div></section>`).join("");
    }
    $("#retList").innerHTML = html;
    loadThumbs();
    if (teamSheet.isOpen && ret.open) { const it = retItem(ret.open); it ? (teamSheet.body.innerHTML = retSheetHtml(it)) : teamSheet.close(); }
  }
  // Photos: read once (one read each, kept in memory), only for retours that have one.
  function loadThumbs() {
    if (!state.store) return;
    document.querySelectorAll("[data-thumb]:not(:has(img))").forEach((el) => {
      const key = el.dataset.thumb;
      state.store.loadProof(key).then((src) => {
        const safe = safeImageSrc(src); if (!safe) return;
        ret.thumbs.set(key, safe);
        document.querySelectorAll(`[data-thumb="${CSS.escape(key)}"]:not(:has(img))`).forEach((t) => t.insertAdjacentHTML("afterbegin", `<img src="${safe}" alt="">`));
      }).catch(() => {});
    });
  }
  function retSheetHtml(it) {
    const v = retView(it);
    const d = v.d;
    const rows = [
      ["Véhicule", `${plateTag(v.plate)}${d ? `<small>${esc(D.vehicleLabel(d))}</small>` : ""}`],
      ["Prestataire", esc(v.who)],
      d && ["Prestation", esc(v.job)],
      d && ["Site", esc(D.siteOf(d))],
      d?.date && ["Prévue le", esc(D.shortDate(d.date) + (d.debut ? " à " + hourLabel(d.debut) : ""))],
      ["Reçu le", esc(atLabel(it.at))],
      v.edited && ["Modifié", esc(v.edited.replace("modifié ", ""))],
      v.doneLine && ["Rangé", esc(v.doneLine)],
    ].filter(Boolean);
    const acts = state.canWrite ? v.acts.filter((a) => !["open", "replan"].includes(a.act) || d) : [];
    if (d && !acts.some((a) => ["open", "replan"].includes(a.act))) acts.push({ act: "open", label: "Ouvrir la demande" });
    return `<div class="ret-sheet">
      <div class="ret-sh-hero"><span class="ret-ico lg" aria-hidden="true">${retArt(v.art)}</span>
        <div><b class="ret-sh-what">${esc(v.whatOverride || v.what)}</b>
        ${v.extraArts?.length ? `<span class="ret-minis">${[v.art, ...v.extraArts].map((q) => retArt(q, "mini-art")).join("")}</span>` : ""}</div></div>
      ${v.note ? `<blockquote class="ret-sh-note">${esc(v.note)}<cite>${esc(v.who)}</cite></blockquote>` : ""}
      ${v.photo ? `<button type="button" class="ret-sh-photo" data-proof="${esc(v.photo)}" aria-label="Voir la photo en grand"><span class="ret-thumb big" data-thumb="${esc(v.photo)}">${ret.thumbs.get(v.photo) ? `<img src="${ret.thumbs.get(v.photo)}" alt="">` : ""}${icon("image")}</span><span class="ret-sh-zoom">Agrandir</span></button>` : ""}
      <dl class="ret-sh-info">${rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join("")}</dl>
      ${acts.length ? `<div class="ret-sh-acts">${acts.map((a) => retBtn(a, it.key)).join("")}</div>` : ""}
    </div>`;
  }
  function openRetSheet(key) {
    const it = retItem(key); if (!it) return;
    ret.open = key;
    teamSheet.open(retView(it).kind, retSheetHtml(it), { cls: "ret-sheet-b", closed: () => (ret.open = null) });
    loadThumbs();
  }
  // The card leaves (fade + slide), then the write; the snapshot re-renders the list without it.
  async function retLeave(key) {
    const card = document.querySelector(`#retList .ret-card[data-ret="${CSS.escape(key)}"]`);
    if (!card || reduceMotion()) return;
    card.style.height = card.offsetHeight + "px"; card.classList.add("ret-leave");
    await new Promise((r) => setTimeout(r, 260));
  }
  const retBack = (card) => { if (card) { card.classList.remove("ret-leave"); card.style.height = ""; } };
  async function retAct(act, key) {
    if (act === "all-info") return retAllInfo();
    const it = retItem(key); if (!it) return;
    const { d, p } = it;
    if (act === "replan" || act === "open") { teamSheet.close(); return openDemande(d.id); }
    if (act === "new") { teamSheet.close(); return newDemandeFor({ plaque: p.plaque }); }
    if (!requireStore()) return;
    const plate = d?.plaque || p?.plaque;
    const fromSheet = teamSheet.isOpen; teamSheet.close();
    const leaves = ["seen", "handled", "accept"].includes(act) && ret.tab === "todo" || ["unseen", "reopen"].includes(act) && ret.tab === "done";
    if (leaves) { if (fromSheet) await new Promise((r) => setTimeout(r, 120)); await retLeave(key); }
    const card = () => document.querySelector(`#retList .ret-card[data-ret="${CSS.escape(key)}"]`);
    try {
      if (act === "seen") { await state.store.markAnswerSeen(d); toast(`Retour de ${d.prestataire} sur ${plate} rangé`, { label: "Annuler", run: () => state.store.markAnswerUnseen(d).catch(reportWriteError) }); }
      else if (act === "unseen") { await state.store.markAnswerUnseen(d); toast(`Retour sur ${plate} remis à traiter`); }
      else if (act === "accept") { const day = d.retour.date; await state.store.acceptProposedDate(d); toast(`Date changée pour ${plate} : ${D.shortDate(day)}`); }
      else if (act === "handled") { await state.store.markProblemHandled(p, state.userEmail, true); toast(`${it.kind === "f" ? "Signalement" : "Problème"} sur ${plate} traité`, { label: "Annuler", run: () => state.store.markProblemHandled(p, state.userEmail, false).catch(reportWriteError) }); }
      else if (act === "reopen") { await state.store.markProblemHandled(p, state.userEmail, false); toast(`${it.kind === "f" ? "Signalement" : "Problème"} sur ${plate} rouvert`); }
    } catch (err) { retBack(card()); reportWriteError(err); }
  }
  // « Tout ranger » only touches answers already applied (done, taken), never one that still needs a decision.
  async function retAllInfo() {
    const list = retGroups().info.map((it) => it.d);
    if (!list.length || !requireStore()) return;
    try {
      await Promise.all(list.map((d) => state.store.markAnswerSeen(d)));
      toast(`${plural(list.length, "retour")} pour info rangé${list.length > 1 ? "s" : ""}`, { label: "Annuler", run: () => Promise.all(list.map((d) => state.store.markAnswerUnseen(d))).catch(reportWriteError) });
    } catch (err) { reportWriteError(err); }
  }
  document.querySelectorAll("[data-ret-tab]").forEach((b) => b.addEventListener("click", () => { ret.tab = b.dataset.retTab; renderRetours(); }));
  const retClick = (e) => {
    const act = e.target.closest("[data-ret-act]");
    if (act) return retAct(act.dataset.retAct, act.dataset.key);
    const open = e.target.closest("[data-ret-open]");
    if (open) return openRetSheet(open.dataset.retOpen);
    const jump = e.target.closest("[data-ret-jump]");
    if (jump) $("#ret-g-" + jump.dataset.retJump)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  };
  $("#retList").addEventListener("click", retClick);
  teamSheet.body.addEventListener("click", retClick);
  $("#retoursSide").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seen], [data-accept-date], [data-open]");
    const d = b && demandeById(b.dataset.seen || b.dataset.acceptDate || b.dataset.open);
    if (!d) return;
    if (b.dataset.open) return sel === "#retoursSide" ? openDemandeFromPlanning(d.id) : openDemande(d.id);
    if (!requireStore()) return;
    (b.dataset.seen ? state.store.markAnswerSeen(d) : state.store.acceptProposedDate(d))
      .then(() => b.dataset.acceptDate && toast(`Date changée pour ${d.plaque}`), reportWriteError);
  });

  // ================= render & boot =================
  function renderAll() {
    shareRegistry.clear();
    renderSelects();
    renderAnswers(); renderPlanning(); renderHayon(); renderPhotoLibrary(); renderVerification(); renderReport(); renderHistory(); renderSettings();
    $("#dl-plaques").innerHTML = [...state.vehicles.values()].map((v) => `<option value="${esc(v.plaque)}">${esc(D.vehicleLabel(v))}</option>`).join("");
    renderFormSide();
  }

  // ---------- mail robot: a stopped robot cannot warn anyone, so the team app shows it ----------
  function renderRobot() {
    const health = D.robotHealth(state.robot);
    const loud = health.level === "alert" || health.level === "warn";
    $("#robotAlert").hidden = !loud || state.providerMode;
    $("#robotAlert").classList.toggle("alert", health.level === "alert");
    $("#robotAlertText").textContent = health.text;
    $("#s-robot").textContent = health.text;
    $("#s-robot").className = "robot-state " + health.level;
  }
  setInterval(() => state.robot && renderRobot(), 5 * 60000); // the alert also appears when the page stays open without new data

  function applySettings(settings) {
    if (Array.isArray(settings.sites)) state.sites = D.normalizeSites(settings.sites);
    if (Array.isArray(settings.flotte)) state.fleet = settings.flotte.slice();
    if (Array.isArray(settings.prestataires)) state.providers = settings.prestataires.slice();
    state.contacts = settings.contacts || {};
    state.sheetUrl = settings.sheetUrl || "";
  }
  function setSync(text, ok) { $("#sync").textContent = text; $("#sync").classList.toggle("off", !ok); }

  // The page stays blank until the account's role is known, so a provider never glimpses the team screens.
  async function connect() {
    try { await connectStore(); } finally { document.body.classList.add("ready"); }
  }
  async function connectStore() {
    const db = window.claude?.use ? await window.claude.use("db").catch(() => null) : null;
    if (!db) {
      setSync("Hors ligne", false);
      banner("La base de données n'est pas encore branchée : rien ne peut être enregistré pour l'instant.");
      return;
    }
    state.store = createStore(db, { email: () => state.userEmail });
    window.claude.use("downloads").then((d) => { state.downloads = d; $("#b-csv").hidden = !d; }).catch(() => {});
    const user = await window.claude.use("user").catch(() => null);
    state.userEmail = user?.email || "";
    const account = await state.store.getAccount(state.userEmail);
    state.alerts = window.SuiviAlertes.create({ store: state.store, account: account || { role: "admin" }, email: D.emailKey(state.userEmail) });
    state.alerts.listen(() => (state.providerMode ? null : renderAnswers()));
    if (account?.role === "prestataire") return startProviderMode(account);
    if (account?.role === "lecture") setReadOnly("Accès en lecture : tu vois tout mais tu ne modifies rien.");
    if ((await user?.can("data.write")) === false) setReadOnly("Tu as accès en lecture seule : tu vois le planning mais tu ne peux pas saisir de demandes.");
    subscribeTeam();
    if (!$("#view-corbeille").hidden) openTrash();
    // Erase for good what has spent 20 days in the trash: done by the team app itself, no paid server needed.
    else if (state.canWrite) setTimeout(() => state.store.purgeTrash().catch(() => {}), 5000);
  }
  function startProviderMode(account) {
    state.providerMode = true;
    setSync("Connecté", true);
    window.SuiviPresta.start({ store: state.store, account, email: D.emailKey(state.userEmail), D, alerts: state.alerts,
      ui: { $, esc, toast, prepareImage, icon, plateTag, safeImageSrc } });
  }
  function setReadOnly(message) {
    state.canWrite = false;
    $("#saveBtn").disabled = true;
    banner(message);
  }
  function subscribeTeam() {
    state.store.subscribe({
      recentFrom: state.recentFrom,
      hayonFrom: D.hayonWindowStart(today()),
      problemsFrom: D.recentWindowStart(today()),
      onDemandes: (rows) => { state.demandes = rows; followAnswers(rows); completeMailRequests(); closePastHayons(rows); renderAll(); setSync(`${plural(rows.length, "demande")} · synchronisé`, true); },
      onVehicles: (rows) => { state.vehicles = new Map(rows.map((v) => [D.plateKey(v.plaque || v.id), v])); completeMailRequests(); renderAll(); },
      onModels: (rows) => { state.models = new Map(rows.map((m) => [D.modelKey(m), m])); renderAll(); },
      onSettings: (settings) => { applySettings(settings); completeMailRequests(); renderAll(); },
      onProviders: (rows) => { state.providerDocs = new Map(rows.map((p) => [p.id, p])); renderServiceChoice(); completeMailRequests(); renderAll(); },
      onAccounts: (rows) => { state.accounts = rows; renderSettings(); },
      onHayons: (rows) => { state.hayons = rows; renderHayon(); renderFormSide(); },
      onProblems: (rows) => { followProblems(rows); state.problems = rows; renderAnswers(); renderPlanning(); renderFormSide(); },
      onRobot: (etat) => { state.robot = etat; renderRobot(); },
      onDevices: (rows) => { state.alertDevices = rows; renderSettings(); },
      onError: (err) => {
        setSync("Synchronisation interrompue, recharge la page", false);
        if (err?.code === "permission-denied") banner("Ton compte n'a pas encore d'accès à l'appli : demande à l'équipe City-Drop de t'ajouter dans Réglages › Accès.");
      },
    });
  }

  try { state.providerFilter = localStorage.getItem("suivi.provFilter") || ""; } catch {}

  renderSelects(); resetForm(); renderAll(); renderRobot(); show(location.hash.slice(1) || "planning");
  connect();
})();
