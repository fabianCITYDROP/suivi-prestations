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
    garages: [],                  // [{garage, prestataire, site}] City-Drop garage names of the mails (config/garages)
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
  // action (optional): { label, run } adds one button to the bubble, e.g. « Corriger » just after « Prestation réalisée ».
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
    if ((el = target("[data-zoom]"))) { const all = [...(el.parentElement?.querySelectorAll("[data-zoom]") || [])]; const list = all.length ? all : [el];
      viewer.open(list.map((x) => ({ key: x.dataset.zoom, thumb: x.getAttribute("src") || "" })), Math.max(0, list.indexOf(el))); }
    if ((el = target("[data-proof]"))) viewer.open([{ key: el.dataset.proof, proof: true }], 0);
  }, true);

  // ================= photo en grand, plein écran (façon app Photos) =================
  // Glisser à gauche / à droite = photo suivante, vers le bas = fermer ; Échap, flèches du clavier, ×.
  // Avec un album (page Photos) : barre du bas Copier / Enregistrer / Supprimer.
  const viewer = (() => {
    let el = null, items = [], index = 0, album = null, lastFocus = null, token = 0;
    let zoom = { s: 1, x: 0, y: 0 }, resetZoom = () => {}, wheelT = 0, touchUpAt = 0;
    const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    function build() {
      if (el) return;
      document.body.insertAdjacentHTML("beforeend", `<div class="pho-viewer" role="dialog" aria-modal="true" aria-label="Photo en grand" hidden>
        <div class="pho-v-top"><button type="button" class="pho-v-round" data-v-close aria-label="Fermer">${icon("x")}</button>
          <p class="pho-v-title"><b></b><span></span></p><span class="pho-v-pad"></span></div>
        <div class="pho-v-stage"><img alt="Photo du pare-brise" draggable="false"></div>
        <button type="button" class="pho-v-round pho-v-nav prev" data-v-step="-1" aria-label="Photo précédente">${icon("chev-l")}</button>
        <button type="button" class="pho-v-round pho-v-nav next" data-v-step="1" aria-label="Photo suivante">${icon("chev-r")}</button>
        <div class="pho-v-bar"></div></div>`);
      el = document.querySelector(".pho-viewer");
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-v-close]")) return close();
        const st = e.target.closest("[data-v-step]"); if (st) return step(+st.dataset.vStep);
        const del = e.target.closest("[data-v-remove]"); if (del) return removeCurrent();
        if (moved) return;
        if (e.target.matches(".pho-v-stage")) { if (zoom.s <= 1.001) close(); }
        else if (e.target.matches(".pho-v-stage img")) el.classList.toggle("bare");
      });
      document.addEventListener("keydown", (e) => {
        if (el.hidden) return;
        if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
        else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1);
      }, true);
      // Les gestes, comme dans l'app Photos :
      // - pincer à deux doigts = zoomer (jusqu'à ×5) autour des doigts ; un doigt sur une photo zoomée = la déplacer ;
      // - double appui = zoomer à cet endroit / revenir ; molette avec Ctrl (pincement du pavé tactile) sur ordinateur ;
      // - photo non zoomée : glisser à gauche / à droite = suivante, vers le bas = fermer.
      const stage = el.querySelector(".pho-v-stage"), img = stage.querySelector("img");
      const pts = new Map();
      let x0 = 0, y0 = 0, axis = "", down = false, moved = false, lastT = 0, lastX = 0, lastY = 0, vx = 0, vy = 0;
      let pinch = null, pan = null, lastTap = { t: 0, x: 0, y: 0 };
      const centre = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      const clamp = (v, max) => Math.max(-max, Math.min(max, v));
      const bounds = (s) => ({ x: Math.max(0, (img.offsetWidth * s - stage.clientWidth) / 2), y: Math.max(0, (img.offsetHeight * s - stage.clientHeight) / 2) });
      const apply = () => { img.style.transform = zoom.s > 1.001 ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` : ""; el.classList.toggle("zoomed", zoom.s > 1.001); };
      // Zoomer à l'échelle s en gardant le point (px, py) de l'écran sous le doigt.
      const zoomAt = (s, px, py, from = zoom) => {
        const c = centre(); s = Math.max(1, Math.min(5, s));
        const qx = (px - c.x - from.x) / from.s, qy = (py - c.y - from.y) / from.s;
        const b = bounds(s);
        zoom = s <= 1.001 ? { s: 1, x: 0, y: 0 } : { s, x: clamp(px - c.x - s * qx, b.x), y: clamp(py - c.y - s * qy, b.y) };
        apply();
      };
      resetZoom = () => { zoom = { s: 1, x: 0, y: 0 }; pts.clear(); pinch = pan = null; el.classList.remove("zoomed"); };
      const toggleZoom = (px, py) => { el.classList.remove("dragging"); zoom.s > 1.001 ? zoomAt(1, px, py) : zoomAt(2.5, px, py); };
      stage.addEventListener("pointerdown", (e) => {
        if (e.button) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { stage.setPointerCapture(e.pointerId); } catch {}
        if (pts.size === 2) { // deux doigts : on passe en pincement, le glissé en cours est abandonné
          const [a, b] = [...pts.values()];
          pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, from: { ...zoom } };
          down = false; pan = null; axis = ""; moved = true; el.classList.add("dragging"); el.style.removeProperty("--pho-dim");
          return;
        }
        if (pts.size > 2) return;
        if (zoom.s > 1.001) { pan = { x: e.clientX, y: e.clientY, from: { ...zoom } }; moved = false; el.classList.add("dragging"); return; }
        down = true; moved = false; axis = ""; x0 = lastX = e.clientX; y0 = lastY = e.clientY; lastT = e.timeStamp; vx = vy = 0;
      });
      stage.addEventListener("pointermove", (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pts.size >= 2) {
          const [a, b] = [...pts.values()];
          const s = pinch.from.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
          // Le point sous les doigts au départ suit le milieu des deux doigts (zoomer et déplacer en même temps).
          const c = centre(), from = pinch.from, sc = Math.max(1, Math.min(5, s));
          const qx = (pinch.mx - c.x - from.x) / from.s, qy = (pinch.my - c.y - from.y) / from.s;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, bd = bounds(sc);
          zoom = { s: sc, x: clamp(mx - c.x - sc * qx, bd.x), y: clamp(my - c.y - sc * qy, bd.y) };
          apply(); return;
        }
        if (pan) {
          const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
          if (Math.hypot(dx, dy) > 4) moved = true;
          const b = bounds(zoom.s);
          zoom = { s: zoom.s, x: clamp(pan.from.x + dx, b.x), y: clamp(pan.from.y + dy, b.y) };
          apply(); return;
        }
        if (!down) return;
        const dx = e.clientX - x0, dy = e.clientY - y0;
        if (!axis && Math.hypot(dx, dy) > 8) { axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"; moved = true; el.classList.add("dragging"); }
        const dt = Math.max(1, e.timeStamp - lastT); vx = (e.clientX - lastX) / dt; vy = (e.clientY - lastY) / dt; lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
        if (axis === "x") { const edge = (index === 0 && dx > 0) || (index === items.length - 1 && dx < 0); img.style.transform = `translateX(${edge ? dx / 4 : dx}px)`; }
        else if (axis === "y") { const d = Math.max(0, dy); img.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px) scale(${1 - Math.min(d, 400) / 1600})`; el.style.setProperty("--pho-dim", String(Math.max(0.25, 1 - d / 500))); }
      });
      const end = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        if (pinch) { // un doigt levé : on continue en déplaçant avec l'autre doigt
          if (pts.size < 2) { pinch = null; const rest = [...pts.values()][0];
            if (zoom.s <= 1.001) { zoom = { s: 1, x: 0, y: 0 }; apply(); }
            if (rest && zoom.s > 1.001) pan = { x: rest.x, y: rest.y, from: { ...zoom } }; else el.classList.remove("dragging"); }
          setTimeout(() => (moved = false), 0); return;
        }
        if (pan) { if (!pts.size) { pan = null; el.classList.remove("dragging"); } }
        else if (down) {
          down = false; el.classList.remove("dragging");
          const dx = e.clientX - x0, dy = e.clientY - y0;
          if (axis === "y" && (dy > 110 || vy > 0.6)) { close(true); }
          else if (axis === "x" && (Math.abs(dx) > 70 || Math.abs(vx) > 0.5) && items[index + (dx < 0 ? 1 : -1)]) { step(dx < 0 ? 1 : -1, true); }
          else { img.style.transform = ""; el.style.removeProperty("--pho-dim"); }
        }
        // Double appui au doigt (sur iPhone, le double-clic n'arrive pas toujours).
        if (e.pointerType === "touch") touchUpAt = e.timeStamp;
        if (e.pointerType === "touch" && !moved && e.type === "pointerup") {
          const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
          if (e.timeStamp - lastTap.t < 320 && near) { lastTap.t = 0; toggleZoom(e.clientX, e.clientY); }
          else lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
        }
        setTimeout(() => (moved = false), 0);
      };
      stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
      stage.addEventListener("dblclick", (e) => { if (!e.sourceCapabilities?.firesTouchEvents && e.timeStamp - touchUpAt > 700) toggleZoom(e.clientX, e.clientY); });
      stage.addEventListener("wheel", (e) => {
        if (!e.ctrlKey && zoom.s <= 1.001) return; // la molette seule ne zoome que si la photo est déjà zoomée (déplacement)
        e.preventDefault(); el.classList.add("dragging");
        if (e.ctrlKey) zoomAt(zoom.s * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
        else { const b = bounds(zoom.s); zoom = { ...zoom, x: clamp(zoom.x - e.deltaX, b.x), y: clamp(zoom.y - e.deltaY, b.y) }; apply(); }
        clearTimeout(wheelT); wheelT = setTimeout(() => el.classList.remove("dragging"), 120);
      }, { passive: false });
    }
    async function show(fromSwipe) {
      const it = items[index]; if (!it) return close();
      const img = el.querySelector(".pho-v-stage img"), my = ++token;
      resetZoom(); img.style.transform = ""; el.style.removeProperty("--pho-dim");
      if (fromSwipe && !reduce()) { img.classList.remove("pho-v-in"); void img.offsetWidth; img.classList.add("pho-v-in"); }
      if (it.thumb) img.src = safeImageSrc(it.thumb); else img.removeAttribute("src");
      el.querySelector(".pho-v-title b").textContent = album ? album.label : "Photo";
      el.querySelector(".pho-v-title span").textContent = items.length > 1 ? `${index + 1} sur ${items.length}` : "";
      el.querySelector(".prev").hidden = index === 0; el.querySelector(".next").hidden = index >= items.length - 1;
      const name = album ? photoFileName(album.label, index) : "photo.jpg";
      el.querySelector(".pho-v-bar").innerHTML = album ? `
        <button type="button" class="pho-v-act" data-copy-photo="${esc(it.key)}" data-name="${esc(name)}">${icon("copy")}<span>Copier</span></button>
        <button type="button" class="pho-v-act" data-save-photo="${esc(it.key)}" data-name="${esc(name)}">${icon("download")}<span>Enregistrer</span></button>
        ${state.canWrite ? `<button type="button" class="pho-v-act danger" data-v-remove>${icon("trash")}<span>Supprimer</span></button>` : ""}` : "";
      el.classList.toggle("with-bar", !!album);
      const full = state.store ? await (it.proof ? state.store.loadProof(it.key) : state.store.loadPhoto(it.key)).catch(() => null) : null;
      if (my !== token || el.hidden) return;
      if (full) img.src = safeImageSrc(full);
      else if (!it.thumb) { close(); toast("Photo introuvable"); }
    }
    function open(list, at = 0, withAlbum = null) {
      build();
      items = list.filter((x) => x.key); index = Math.min(Math.max(0, at), items.length - 1); album = withAlbum;
      if (!items.length) return;
      if (el.hidden) { lastFocus = document.activeElement; el.hidden = false; el.classList.remove("bare"); document.body.classList.add("pho-viewing"); requestAnimationFrame(() => el.classList.add("on")); }
      show();
      setTimeout(() => el.querySelector("[data-v-close]")?.focus({ preventScroll: true }), 30);
    }
    function close(fromSwipe) {
      if (!el || el.hidden) return;
      token++; resetZoom(); el.classList.remove("on"); document.body.classList.remove("pho-viewing");
      const img = el.querySelector(".pho-v-stage img");
      if (fromSwipe && !reduce()) img.style.transform = `translateY(${innerHeight * 0.6}px) scale(.85)`;
      setTimeout(() => { el.hidden = true; img.style.transform = ""; el.style.removeProperty("--pho-dim"); img.removeAttribute("src"); }, reduce() ? 0 : 220);
      lastFocus?.focus?.({ preventScroll: true });
    }
    function step(d, fromSwipe) { if (!items[index + d]) return; index += d; show(fromSwipe); }
    async function removeCurrent() {
      const it = items[index]; if (!it || !album) return;
      const ok = await removeAlbumPhoto(album.model, it.key);
      if (!ok) return;
      // La liste a peut-être déjà été mise à jour par refresh() pendant l'attente : on retire par la clé, pas par la position.
      items = items.filter((x) => x.key !== it.key);
      if (!items.length) close(); else { index = Math.min(index, items.length - 1); show(); }
    }
    // Les photos de l'album ont changé (ajout, suppression, autre appareil) : on suit, en restant sur la même photo.
    function refresh() {
      if (!el || el.hidden || !album) return;
      const key = items[index]?.key;
      items = modelPhotos(album.model).map((p) => ({ key: p.key, thumb: p.thumb }));
      if (!items.length) return close();
      const i = items.findIndex((p) => p.key === key); index = i >= 0 ? i : Math.min(index, items.length - 1);
      show();
    }
    return { open, close, refresh, get isOpen() { return !!el && !el.hidden; } };
  })();

  // ================= Corbeille: deleted requests, kept 20 days, restorable =================
  // Façon iPhone (2026-11-21) : résumé en haut, recherche de plaque, cartes groupées par jour de suppression avec les jours
  // restants (gris, orange à 3 jours, rouge le dernier jour), « Restaurer » en bouton clair + bulle « Voir au planning »,
  // fiche complète dans la feuille de l'équipe (teamSheet). Rien n'est effacé avant 20 jours : les règles l'interdisent.
  const trash = { groups: [], error: false, loading: false, query: "" };
  async function openTrash() {
    trash.loading = true; trash.error = false; renderTrash();
    if (!state.store) return; // page opened from its link before sign-in: listed once connected
    try {
      if (state.store && state.canWrite) await state.store.purgeTrash().catch(() => {});
      trash.groups = D.groupTrash(await state.store.loadTrash());
    } catch { trash.groups = []; trash.error = true; }
    trash.loading = false; renderTrash();
  }
  const trashKey = (group) => group.ids.join(",");
  const trashLeft = (group) => D.trashDaysLeft(group.supprimeLe, new Date().toISOString());
  const trashTone = (left) => (left <= 1 ? "bad" : left <= 3 ? "soon" : "");
  const trashLeftLabel = (left) => (left <= 0 ? "Effacée aujourd'hui" : left === 1 ? "Effacée demain" : `Effacée dans ${left} j`);
  const trashWho = (email) => { const name = String(email || "").split("@")[0].split(/[._-]/)[0]; return name ? capFirst(name) : ""; };
  const trashHour = (iso) => (iso ? iso.slice(11, 16).replace(":", "h") : "");
  const trashLocalIso = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); };
  function trashDayHeading(iso) {
    const day = iso.slice(0, 10);
    if (day === today()) return "Aujourd'hui";
    if (day === D.addDays(today(), -1)) return "Hier";
    return capFirst(D.dayLabel(day));
  }
  function trashTitle(group) {
    const first = group.rows[0].demande;
    return group.rows.length > 1 ? `${D.jobLabel(first)} · ${plural(group.rows.length, "véhicule")}` : D.jobLabel(first);
  }
  const trashWhen = (d) => (d.date ? D.numericDate(d.date).slice(0, 5) + (d.dateFin && d.dateFin !== d.date ? " au " + D.numericDate(d.dateFin).slice(0, 5) : "") : "");
  const trashMatches = (group) => !trash.query || group.rows.some((r) => D.plateKey(r.demande.plaque || "").includes(D.plateKey(trash.query)));
  function trashCard(group) {
    const first = group.rows[0].demande;
    const left = trashLeft(group);
    const local = trashLocalIso(group.supprimeLe);
    const plates = group.rows.slice(0, 3).map((r) => plateTag(r.demande.plaque)).join("") + (group.rows.length > 3 ? `<span class="tr-more">+${group.rows.length - 3}</span>` : "");
    const meta = [trashWhen(first) ? "Prévue le " + trashWhen(first) : "", first.prestataire].filter(Boolean).join(" · ");
    const by = `Supprimée à ${trashHour(local)}${group.supprimePar ? " par " + trashWho(group.supprimePar) : ""}`;
    return `<article class="tr-card" data-trash-key="${esc(trashKey(group))}">
      <button type="button" class="tr-open" data-trash-open="${esc(trashKey(group))}" aria-label="${esc(trashTitle(group))} : voir le détail">
        ${serviceTile(first, "sm")}
        <span class="tr-main">
          <span class="tr-line"><span class="tr-plates">${plates}</span><span class="tr-days ${trashTone(left)}">${trashLeftLabel(left)}</span></span>
          <span class="tr-what">${esc(trashTitle(group))}</span>
          <span class="tr-meta">${esc(meta)}</span>
          <span class="tr-meta">${esc(by)}</span>
        </span>
      </button>
      ${state.canWrite ? `<div class="tr-acts"><button type="button" class="tr-restore" data-trash-restore="${esc(trashKey(group))}">${icon("check")}Restaurer</button></div>` : ""}
    </article>`;
  }
  function renderTrash() {
    const box = $("#trashList");
    const groups = trash.groups;
    const soon = groups.filter((g) => trashLeft(g) <= 3).length;
    const count = groups.reduce((n, g) => n + g.rows.length, 0);
    $("#trashSearchWrap").hidden = trash.loading || trash.error || groups.length < 2;
    $("#trashSum").innerHTML = trash.loading || trash.error || !groups.length ? "" : `<div class="tr-sum">
        <span class="ret-ico lg" aria-hidden="true">${self.IssueArt?.art("corbeille", "ret-art") || ""}</span>
        <div class="tr-sum-txt"><b>${plural(count, "demande")}</b><span>Restaurables pendant 20 jours après la suppression, puis effacées pour de bon.</span>
        ${soon ? `<span class="tr-days soon">${soon} bientôt effacée${soon > 1 ? "s" : ""}</span>` : ""}</div>
      </div>`;
    if (trash.loading && !groups.length) { box.innerHTML = `<p class="hint">Chargement…</p>`; return; }
    if (trash.error || !groups.length) {
      box.innerHTML = `<div class="ret-empty"><span class="ret-ico xl" aria-hidden="true">${self.IssueArt?.art("corbeille-vide", "ret-art") || ""}</span>
        <b>${trash.error ? "La corbeille n'est pas encore active" : "La corbeille est vide"}</b>
        <span>Une demande supprimée reste ici 20 jours : tu peux la remettre dans le planning telle qu'elle était.</span></div>`;
      return;
    }
    const shown = groups.filter(trashMatches);
    if (!shown.length) { box.innerHTML = `<div class="ret-empty"><b>Aucune plaque ne correspond</b><span>La corbeille contient seulement les demandes supprimées ces 20 derniers jours.</span></div>`; return; }
    const days = [];
    for (const g of shown) {
      const day = trashLocalIso(g.supprimeLe).slice(0, 10);
      const last = days[days.length - 1];
      if (last && last.day === day) last.groups.push(g); else days.push({ day, groups: [g] });
    }
    box.innerHTML = days.map(({ day, groups: list }) => `<section class="tr-group">
        <h2 class="ret-gh">${esc(trashDayHeading(day))}<em>· ${list.reduce((n, g) => n + g.rows.length, 0)}</em></h2>
        <div class="tr-cards">${list.map(trashCard).join("")}</div>
      </section>`).join("")
      + (state.canWrite ? "" : `<p class="ret-foot">Seuls les administrateurs peuvent restaurer une demande.</p>`);
  }
  function trashSheetBody(group) {
    const first = group.rows[0].demande;
    const many = group.rows.length > 1;
    const left = trashLeft(group);
    const local = trashLocalIso(group.supprimeLe);
    const line = (label, value, small = "") => (value ? `<div><dt>${label}</dt><dd>${esc(value)}${small ? `<small>${esc(small)}</small>` : ""}</dd></div>` : "");
    const total = group.rows.reduce((n, r) => n + (Number(r.demande.prixHT) || 0), 0);
    const when = first.date ? capFirst(D.isMultiDay(first) ? D.availabilityLabel(first) : D.dayLabel(first.date)) : "";
    const vehicles = many ? `<section><p class="sheet-label">Véhicules</p><dl class="ret-sh-info">${group.rows.map((r) => `<div><dt>${plateTag(r.demande.plaque)}</dt><dd>${esc(D.timeSlotLabel(r.demande))}</dd></div>`).join("")}</dl></section>` : "";
    return `<div class="ret-sheet tr-sheet">
      <div class="ret-sh-hero">${serviceTile(first, "lg")}<div><p class="ret-sh-kind">Dans la corbeille</p><span class="ret-sh-what">${esc(trashTitle(group))}</span>
        <div class="tr-plates">${many ? "" : plateTag(first.plaque)}</div></div></div>
      <div class="tr-count ${trashTone(left)}"><b>${left > 1 ? `Encore ${left} jours dans la corbeille` : trashLeftLabel(left)}</b><span>Effacée pour de bon le ${esc(D.dayLabel(D.trashPurgeDate(group.supprimeLe).slice(0, 10)))}.</span></div>
      ${vehicles}
      <dl class="ret-sh-info">
        ${line("Prévue", when, many ? "" : D.timeSlotLabel(first))}
        ${line("Site", D.siteOf(first), first.adresse || "")}
        ${line("Prestataire", first.prestataire || "")}
        ${line(first.service === "intervention" ? "À faire" : "", first.tache || "")}
        ${line("Prix", total ? D.euros(total) + " HT" : "", many ? "pour les " + group.rows.length + " véhicules" : "")}
        ${line("Statut", first.statut ? D.statusOf(first.statut).label : "", "au moment de la suppression")}
        ${line("Supprimée", capFirst(D.dayLabel(local.slice(0, 10))) + " à " + trashHour(local), group.supprimePar ? "par " + group.supprimePar : "")}
      </dl>
      ${first.notes ? `<p class="ret-sh-note">${esc(first.notes)}</p>` : ""}
      <div class="ret-sh-acts">${state.canWrite
        ? `<button type="button" class="ret-btn primary" data-trash-restore="${esc(trashKey(group))}">${icon("check")}Restaurer dans le planning</button>`
        : `<p class="ret-foot">Seuls les administrateurs peuvent restaurer une demande.</p>`}</div>
    </div>`;
  }
  async function restoreTrash(key, button) {
    if (!requireStore()) return;
    const group = trash.groups.find((g) => trashKey(g) === key);
    if (!group) return;
    const ids = key.split(",");
    const date = group.rows[0].demande.date;
    document.querySelectorAll(`[data-trash-restore="${CSS.escape(key)}"]`).forEach((b) => (b.disabled = true));
    try {
      await state.store.restoreDemandes(ids);
      if (teamSheet.isOpen) teamSheet.close();
      toast(ids.length > 1 ? `${ids.length} demandes restaurées` : "Demande restaurée",
        date ? { label: "Voir au planning", run: () => { state.day = date; show("planning"); renderPlanning(); } } : undefined);
      const card = document.querySelector(`.tr-card[data-trash-key="${CSS.escape(key)}"]`);
      const drop = () => { trash.groups = trash.groups.filter((g) => trashKey(g) !== key); renderTrash(); };
      if (card && !matchMedia("(prefers-reduced-motion: reduce)").matches) { card.classList.add("tr-leave"); setTimeout(drop, 260); } else drop();
    } catch (err) {
      document.querySelectorAll(`[data-trash-restore="${CSS.escape(key)}"]`).forEach((b) => (b.disabled = false));
      if (err?.code === "already_exists") toast("Cette demande existe déjà dans le planning"); else reportWriteError(err);
    }
  }
  $("#trashList").addEventListener("click", (e) => {
    const button = e.target.closest("[data-trash-restore]");
    if (button) { restoreTrash(button.dataset.trashRestore, button); return; }
    const open = e.target.closest("[data-trash-open]");
    const group = open && trash.groups.find((g) => trashKey(g) === open.dataset.trashOpen);
    if (group) teamSheet.open("Demande supprimée", trashSheetBody(group), { cls: "tr-sheet-wrap" });
  });
  document.addEventListener("click", (e) => {
    const button = e.target.closest(".tr-sheet [data-trash-restore]");
    if (button) restoreTrash(button.dataset.trashRestore, button);
  });
  $("#trashSearch").addEventListener("input", (e) => { trash.query = e.target.value; renderTrash(); });

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
    if (view !== "reglages" && document.querySelector(".team-sheet.rg-sheet-b.on")) teamSheet.close(); // a Réglages sheet never stays over another page
    if (view === "demande") {
      VIEWS.forEach((v) => v !== "demande" && ($("#view-" + v).hidden = v !== baseView));
      markCurrentNav(baseView);
      openFormSheet();
      if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
      return;
    }
    closeFormSheet();
    const before = baseView && !$("#view-" + baseView).hidden ? baseView : null;
    baseView = view;
    VIEWS.forEach((v) => v !== "demande" && ($("#view-" + v).hidden = v !== view));
    if (before && before !== view) enterView($("#view-" + view));
    markCurrentNav(view);
    if (view === "corbeille") openTrash();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    if (view === "bilan") renderReport(); // its month is read only once the page is opened
    document.body.classList.toggle("vf-bar-on", view === "verif" && !$("#vfBar").hidden);
  }
  // Rare pages live under « Plus »: its label names the open page so the menu never hides where you are.
  function markCurrentNav(view) {
    navButtons().forEach((b) => b.toggleAttribute("aria-current", b.dataset.view === view));
    const inMore = $(`#navMore [data-view="${view}"]`);
    $("#navMoreLabel").textContent = inMore ? (inMore.querySelector(".menu-label") || inMore).textContent.trim() : "Plus";
    $("#navMore").classList.toggle("current", !!inMore);
    $("#navMore").open = false;
  }
  // Changing page: the new page rises in quickly (a short fade), as on an iPhone. Off with « réduire les animations » (CSS).
  function enterView(section) {
    section.classList.remove("view-enter"); void section.offsetWidth; section.classList.add("view-enter");
    section.addEventListener("animationend", () => section.classList.remove("view-enter"), { once: true });
  }
  // « Plus »: each page has a line icon, same style as the bottom bar (2026-11-21). On a phone the menu opens as a sheet from the bottom, on a computer as a popover.
  const phoneNav = () => matchMedia("(max-width: 720px)").matches;
  function openMoreSheet() {
    const rows = [...document.querySelectorAll("#navMore .nav-menu [data-view]")].map((b) => {
      const badge = b.querySelector(".menu-badge");
      const current = b.hasAttribute("aria-current");
      return `<button type="button" class="more-row" data-more-view="${b.dataset.view}"${current ? ' aria-current="page"' : ""}>
        <span class="more-tile">${b.querySelector(".more-art").innerHTML}</span><span class="more-lbl">${esc(b.querySelector(".menu-label").textContent)}</span>
        ${badge && !badge.hidden ? `<span class="more-badge">${esc(badge.textContent)}</span>` : ""}${current ? `<span class="more-here">${icon("check")}</span>` : `<span class="more-chev">${icon("chev-r")}</span>`}</button>`;
    }).join("");
    teamSheet.open("Plus", `<div class="more-list">${rows}</div>`, { cls: "more-sheet" });
  }
  $("#navMore summary").addEventListener("click", (e) => { if (!phoneNav()) return; e.preventDefault(); $("#navMore").open = false; openMoreSheet(); });
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".more-sheet [data-more-view]");
    if (!row) return;
    teamSheet.close(); show(row.dataset.moreView);
  });
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
  const planSheet = { kind: "", id: "", log: false }; // log: the Historique page adds the change timeline
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
  function openPlanSheet(kind, id = "", log = false) {
    planSheet.kind = kind; planSheet.id = id; planSheet.log = log;
    refreshPlanSheet(true);
  }
  function refreshPlanSheet(opening = false) {
    if (!opening && !teamSheet.isOpen) return;
    const closed = () => { planSheet.kind = ""; planSheet.id = ""; planSheet.log = false; };
    if (planSheet.kind === "fiche") {
      const d = demandeById(planSheet.id);
      if (!d) { teamSheet.close(); return; }
      if (!opening && teamSheet.body.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;
      teamSheet.open(d.plaque ? `Demande ${d.plaque}` : "Demande", ficheBody(d) + (planSheet.log ? histLogHtml() : ""), { cls: "plan-sheet side-sheet", closed });
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
    finally { b.disabled = false; refreshPlanSheet(); if (planSheet.log) setTimeout(() => planSheet.log && loadHistLog(planSheet.id), 900); }
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
    // Only the sites given to the chosen provider (Garages des mails); all of them when it has none. The site already chosen stays.
    const given = D.providerSites(state.garages, current, siteNames());
    const shownSites = given.length ? siteNames().filter((n) => n === site || given.includes(n)) : siteNames();
    $("#ndSites").innerHTML = shownSites.map((n) => `<button type="button" class="nd-chip" role="radio" data-nd-site="${esc(n)}" aria-checked="${n === site}">${esc(n)}</button>`).join("")
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

  // ================= photo library (one album per fleet model), façon app Photos =================
  // Une grille d'albums (un par modèle de la flotte) ; toucher un album = feuille avec ses photos, ajout en tuile,
  // prochains pare-brise du modèle ; toucher une photo = plein écran. « Sans photo » montre ce qu'il reste à compléter.
  const lib = { filter: "all" };
  const openModel = () => state.fleet.find((f) => D.modelKey(f) === state.openModelKey) || state.models.get(state.openModelKey);
  const WIND_ART = (cls) => self.IssueArt?.art("Pare-brise", cls) || "";
  const relDay = (iso) => iso === today() ? "aujourd'hui" : iso === D.addDays(today(), 1) ? "demain" : D.dayLabel(iso);
  // Pare-brise encore à faire pour ce modèle (dans les demandes chargées), le plus proche d'abord.
  const upcomingWindshields = (key) => state.demandes
    .filter((d) => D.isWindshield(d) && D.isActive(d) && D.isOpen(d) && (d.dateFin || d.date || "") >= today() && D.modelKey(d) === key)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const libModels = () => D.uniqueModels(state.fleet).map((f) => { const key = D.modelKey(f); return { f, key, photos: modelPhotos(f), next: upcomingWindshields(key) }; });
  function renderPhotoLibrary() {
    const all = libModels();
    const missing = all.filter((m) => !m.photos.length);
    const urgent = missing.filter((m) => m.next.length);
    const total = all.reduce((n, m) => n + m.photos.length, 0);
    $("#phoKicker").textContent = `Pare-brise · ${plural(all.length, "modèle")} · ${plural(total, "photo")}`;
    $("#phoAllN").textContent = all.length;
    $("#phoMissN").textContent = missing.length || "";
    $("#phoMissN").hidden = !missing.length;
    for (const b of document.querySelectorAll("[data-pho-filter]")) b.setAttribute("aria-selected", String(b.dataset.phoFilter === lib.filter));
    const query = $("#p-q").value;
    $("#p-alert").innerHTML = urgent.length && !query ? alertCard(urgent) : "";
    const shown = all.filter((m) => (lib.filter === "all" || !m.photos.length) && D.matchesSearch([D.fleetLabel(m.f)], query));
    $("#p-list").innerHTML = shown.length
      ? `<div class="pho-grid">${shown.map(albumCard).join("")}</div>`
      : !all.length ? emptyLib("Aucun modèle dans la flotte.", "Les modèles viennent de la flotte, dans Réglages.")
      : lib.filter === "missing" && !query ? emptyLib("Tous les modèles ont leur photo.", "Chaque demande de pare-brise part avec les photos de son modèle.", "Pare-brise")
      : emptyLib("Aucun modèle ne correspond.", "Essaie avec la marque ou le cubage, par exemple « Movano » ou « 20 m³ ».");
    if (teamSheet.isOpen && state.openModelKey && teamSheet.body.querySelector(".pho-sheet")) {
      const model = openModel();
      if (model) { teamSheet.body.innerHTML = albumSheetHtml(model); } else teamSheet.close();
    }
    viewer.refresh();
  }
  const emptyLib = (title, text, art) => `<div class="pho-empty">${art ? `<span class="pho-ico xl" aria-hidden="true">${WIND_ART("pho-art")}</span>` : ""}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  function alertCard(urgent) {
    const first = urgent[0], d = first.next[0];
    const what = urgent.length > 1 ? `${urgent.length} modèles ont un pare-brise prévu sans photo` : "Pare-brise prévu, mais aucune photo";
    const sub = urgent.length > 1 ? urgent.map((m) => D.fleetLabel(m.f)).join(", ")
      : `${D.fleetLabel(first.f)}\n${[d.plaque, relDay(d.date)].filter(Boolean).join(", ")}`;
    return `<button type="button" class="pho-alert" data-model="${esc(first.key)}">
      <span class="pho-ico" aria-hidden="true">${WIND_ART("pho-art")}</span>
      <span class="pho-alert-t"><span class="pho-pill warn">À compléter</span><b>${esc(what)}</b><span>${esc(sub).replace("\n", "<br>")}</span></span>
      ${icon("chev-r")}</button>`;
  }
  function albumCard({ f, key, photos, next }) {
    const cover = photos[0]
      ? `<img src="${safeImageSrc(photos[0].thumb)}" alt="" loading="lazy">${photos.length > 1 ? `<span class="pho-count">${photos.length}</span>` : ""}`
      : `<span class="pho-ico lg" aria-hidden="true">${WIND_ART("pho-art")}</span>${state.canWrite ? `<span class="pho-cover-add">${icon("plus")}Ajouter</span>` : ""}`;
    const sub = [f.cubage ? `${esc(f.cubage)} m³` : "", photos.length ? plural(photos.length, "photo") : `<em class="pho-miss">Aucune photo</em>`].filter(Boolean).join(" · ");
    const nextLine = next.length ? `<span class="pho-next${photos.length ? "" : " warn"}">${next.length} pare-brise à venir</span>` : "";
    return `<button type="button" class="pho-album${photos.length ? "" : " none"}" data-model="${esc(key)}" aria-label="${esc(D.fleetLabel(f))}, ${photos.length ? plural(photos.length, "photo") : "aucune photo"}">
      <span class="pho-cover">${cover}</span><span class="pho-name">${esc(f.modele)}</span><span class="pho-sub">${sub}</span>${nextLine}</button>`;
  }
  function albumSheetHtml(model) {
    const key = D.modelKey(model), photos = modelPhotos(model), next = upcomingWindshields(key), label = D.fleetLabel(model);
    const canAdd = state.canWrite && photos.length < MAX_PHOTOS_PER_VEHICLE;
    const tiles = photos.map((p, i) => `<button type="button" class="pho-ph" data-pho-view="${esc(p.key)}" aria-label="Voir la photo ${i + 1} en grand"><img src="${safeImageSrc(p.thumb)}" alt=""></button>`).join("")
      + (canAdd ? `<button type="button" class="pho-add" data-pho-add><span class="pho-add-b">${icon("plus")}</span><span>Ajouter</span></button>` : "");
    const many = photos.length > 1;
    return `<div class="pho-sheet" data-pho-model="${esc(key)}">
      <div class="pho-sh-hero"><span class="pho-ico lg" aria-hidden="true">${WIND_ART("pho-art")}</span>
        <div><p class="pho-sh-kind">Photos du pare-brise</p><b>${esc(model.cubage ? `${model.cubage} m³` : model.modele)} · ${photos.length ? `${photos.length} sur ${MAX_PHOTOS_PER_VEHICLE}` : "aucune photo"}</b>
        <span>Elles partent avec chaque demande de pare-brise de ce modèle, pour tous ses véhicules.</span></div></div>
      ${photos.length || canAdd ? `<div class="pho-ph-grid">${tiles}</div>` : `<p class="sheet-sub">Aucune photo pour ce modèle.</p>`}
      ${canAdd ? `<p class="pho-tip desk">Tu peux aussi glisser des images ici, ou coller une capture (Ctrl+V).</p>` : photos.length >= MAX_PHOTOS_PER_VEHICLE ? `<p class="pho-tip">${MAX_PHOTOS_PER_VEHICLE} photos au maximum : supprimes-en une pour en ajouter.</p>` : ""}
      ${photos.length ? `<div class="pho-sh-acts">
        <button type="button" class="pho-btn primary" data-pho-copy-all>${icon("copy")}${many ? `Copier les ${photos.length} photos` : "Copier la photo"}</button>
        <button type="button" class="pho-btn" data-pho-save-all>${icon("download")}Télécharger en taille réelle</button></div>` : ""}
      ${next.length ? `<section><h3 class="sheet-label">Prochains pare-brise de ce modèle</h3><div class="pho-next-list">${next.slice(0, 4).map((d) => `
        <button type="button" class="pho-next-row" data-pho-demande="${esc(d.id)}">${plateTag(d.plaque)}<span><b>${esc(capFirst(relDay(d.date)))}</b><small>${esc([d.site, d.prestataire].filter(Boolean).join(" · "))}</small></span>${icon("chev-r")}</button>`).join("")}</div>
        ${next.length > 4 ? `<p class="pho-tip">et ${next.length - 4} autre${next.length - 4 > 1 ? "s" : ""}</p>` : ""}</section>` : ""}
    </div>`;
  }
  function openAlbum(key) {
    state.openModelKey = key;
    const model = openModel(); if (!model) return;
    teamSheet.open(model.modele, albumSheetHtml(model), { cls: "pho-sheet-b", closed: () => (state.openModelKey = null) });
  }
  // Supprimer : tout de suite, avec « Annuler » dans la bulle (la photo est gardée en mémoire le temps de la bulle).
  async function removeAlbumPhoto(model, key) {
    const album = albumOf(model);
    if (!album || !requireStore()) return false;
    const entry = album.photos.find((p) => p.key === key);
    if (!entry) return false;
    const full = await state.store.loadPhoto(key).catch(() => null);
    try { await state.store.removeModelPhoto(album, key); }
    catch (err) { reportWriteError(err); return false; }
    toast("Photo supprimée", full ? { label: "Annuler", run: async () => {
      try { await state.store.addModelPhoto(albumOf(model), model, { full, thumb: entry.thumb }); toast("Photo remise"); }
      catch (err) { reportWriteError(err); }
    } } : undefined);
    return true;
  }
  $("#p-q").addEventListener("input", renderPhotoLibrary);
  document.querySelector(".pho-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pho-filter]"); if (!b) return;
    lib.filter = b.dataset.phoFilter; renderPhotoLibrary();
  });
  $("#view-photos").addEventListener("click", (e) => {
    const card = e.target.closest("[data-model]");
    if (card) openAlbum(card.dataset.model);
  });
  teamSheet.body.addEventListener("click", (e) => {
    const sheet = e.target.closest(".pho-sheet"); if (!sheet) return;
    const model = openModel(); if (!model) return;
    const photos = modelPhotos(model), label = D.fleetLabel(model);
    const entries = photos.map((p) => ({ key: p.key, plate: label, label: "" }));
    let el;
    if ((el = e.target.closest("[data-pho-view]"))) viewer.open(photos.map((p) => ({ key: p.key, thumb: p.thumb })), photos.findIndex((p) => p.key === el.dataset.phoView), { model, label });
    else if (e.target.closest("[data-pho-add]")) pickPhotosFor(model);
    else if (e.target.closest("[data-pho-copy-all]")) copyImage(() => buildPhotoSheet(entries), sheetName(), () => buildPhotoSheet(entries, "image/jpeg"));
    else if (e.target.closest("[data-pho-save-all]")) saveAllPhotos(entries);
    else if ((el = e.target.closest("[data-pho-demande]"))) { teamSheet.close(); openDemande(el.dataset.phoDemande); }
  });
  // Glisser-déposer des images sur la feuille d'un album (ordinateur).
  document.addEventListener("dragover", (e) => { const s = e.target.closest?.(".pho-sheet"); if (s && state.canWrite) { e.preventDefault(); s.classList.add("drop-on"); } });
  document.addEventListener("dragleave", (e) => { const s = e.target.closest?.(".pho-sheet"); if (s && !s.contains(e.relatedTarget)) s.classList.remove("drop-on"); });
  document.addEventListener("drop", (e) => {
    const s = e.target.closest?.(".pho-sheet"); if (!s) return;
    e.preventDefault(); s.classList.remove("drop-on");
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    const model = openModel();
    if (files.length && model && state.canWrite) addPhotoFiles(model, files);
  });

  // ================= verification =================
  // Relance d'un prestataire (2026-11-21, façon iPhone) : qui et quand en pastilles, le message à copier, sa réponse collée
  // qui coche les plaques citées, la liste groupée par jour, puis une barre en bas pour tout mettre à jour (bulle « Annuler »).
  const VF_DEFAULT_RANGE = 14;
  function setVerificationRange(days) {
    $("#v-from").value = D.addDays(today(), -days);
    $("#v-to").value = D.addDays(today(), 7);
  }
  setVerificationRange(VF_DEFAULT_RANGE);
  $("#vfMsgArt").innerHTML = self.IssueArt?.art("vf-message", "svc-art") || "";
  $("#vfReplyArt").innerHTML = self.IssueArt?.art("vf-reponse", "svc-art") || "";
  const VERIFICATION_FILTERS = {
    pending: (d) => ["envoyee", "confirmee"].includes(d.statut),
    envoyee: (d) => d.statut === "envoyee",
    confirmee: (d) => d.statut === "confirmee",
    all: D.isActive,
  };
  function verificationRows(provider = $("#v-prest").value) {
    const from = $("#v-from").value, to = $("#v-to").value;
    const statusFilter = VERIFICATION_FILTERS[$("#v-st").value];
    return state.demandes
      .filter((d) => (!provider || d.prestataire === provider) && (!from || D.lastDay(d) >= from) && (!to || d.date <= to) && statusFilter(d))
      .sort(D.byDateThenTime);
  }
  const vfReply = () => D.replyPlates($("#v-paste").value);
  function vfRow(d, reply, showProvider) {
    const on = state.checkedForVerification.has(d.id);
    const hour = (t) => String(t || "").replace(/^0?(\d+):(\d\d)$/, (m, h, mn) => `${h}h${mn === "00" ? "" : mn}`);
    const slot = d.debut && d.fin ? `${hour(d.debut)}–${hour(d.fin)}` : D.timeSlotLabel(d);
    const sub = [D.siteOf(d), slot, showProvider ? d.prestataire : ""].filter(Boolean).map(esc).join(" · ");
    const key = D.plateKey(d.plaque);
    const said = reply.done.includes(key) ? `<span class="vf-said ok">Répondu : fait</span>` : reply.notDone.includes(key) ? `<span class="vf-said todo">Répondu : pas fait</span>` : "";
    return `<div class="vf-row${on ? " on" : ""}">
      <button type="button" class="vf-check" data-check="${esc(d.id)}" aria-pressed="${on}" aria-label="${on ? "Décocher" : "Cocher"} ${esc(d.plaque)}">
        <span class="vf-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9"/></svg></span>
        ${serviceTile(d)}
        <span class="vf-row-text"><span class="vf-row-top">${plateTag(d.plaque)}${said}</span><span class="vf-row-sub">${sub}</span></span>
        ${planStatus(d)}
      </button>
      <button type="button" class="vf-more" data-vf-open="${esc(d.id)}" aria-label="Voir la demande ${esc(d.plaque)}">${icon("chev-r")}</button>
    </div>`;
  }
  function renderVerificationPills() {
    const box = $("#vfProvs");
    const pill = (value, label) => `<button type="button" class="vf-prov" data-vf-prov="${esc(value)}" aria-pressed="${$("#v-prest").value === value}">${esc(label)}<em>${verificationRows(value).length}</em></button>`;
    box.innerHTML = pill("", "Tous") + state.providers.map((p) => pill(p, p)).join("");
    const from = $("#v-from").value, to = $("#v-to").value;
    $("#vfRange").querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(to === D.addDays(today(), 7) && from === D.addDays(today(), -Number(b.dataset.range)))));
    $("#vfStatus").querySelectorAll("[data-st]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.st === $("#v-st").value)));
  }
  function renderVerification() {
    if ($("#v-from").value) needOlder($("#v-from").value, $("#v-to").value ? D.addDays($("#v-to").value, 1) : null);
    const rows = verificationRows();
    const checked = state.checkedForVerification;
    [...checked].forEach((id) => { if (!rows.some((r) => r.id === id)) checked.delete(id); });
    const provider = $("#v-prest").value;
    const reply = vfReply();
    const cited = [...reply.done, ...reply.notDone];
    renderVerificationPills();
    $("#vfKicker").textContent = provider ? `Relance de ${provider}` : "Relance d'un prestataire";
    $("#v-count").textContent = rows.length ? `${plural(rows.length, "véhicule")} · ${plural(checked.size, "coché")}` : "";
    const allOn = rows.length && checked.size === rows.length;
    $("#vfAll").hidden = !rows.length;
    $("#vfAll").textContent = allOn ? "Tout décocher" : "Tout cocher";
    $("#v-table").innerHTML = rows.length
      ? [...D.groupBy(rows, (d) => d.date)].map(([date, items]) => `<section class="vf-day"><h3>${esc(capFirst(D.dayLabel(date)))}<em>${items.length}</em></h3>
          <div class="vf-list">${items.map((d) => vfRow(d, reply, !provider)).join("")}</div></section>`).join("")
      : `<div class="vf-empty"><span class="vf-empty-art" aria-hidden="true">${self.IssueArt?.art("faits-vide", "svc-art") || ""}</span><b>Rien à vérifier sur cette période</b><span>Les demandes envoyées ou confirmées dont la disponibilité tombe entre les deux dates s'affichent ici.</span></div>`;
    // Message: the same text as before, in a card with a capsule « Copier » and a WhatsApp shortcut.
    const kind = document.querySelector('input[name="vkind"]:checked')?.value;
    const text = D.verificationMessage(rows, { provider, kind, siteNames: siteNames() });
    $("#v-share").innerHTML = `<pre class="vf-msg" id="v-msg">${esc(text)}</pre>
      ${rows.length ? `<div class="vf-msg-actions"><button type="button" class="vf-copy" data-copy="#v-msg">${icon("copy")}Copier le message</button>
        <a class="vf-wa" href="${esc(D.whatsappLink(text))}" target="_blank" rel="noopener">${icon("wa")}WhatsApp</a></div>` : ""}`;
    // Reply: what was recognised (done = ticked, not done = left unticked), and the plates it cites that are not in the list.
    const known = new Set(rows.map((r) => D.plateKey(r.plaque)));
    const found = reply.done.filter((k) => known.has(k));
    const notDone = reply.notDone.filter((k) => known.has(k));
    const unknown = cited.filter((k) => !known.has(k));
    const plateList = (keys) => keys.map((k) => `<b>${esc(D.normalizePlate(k))}</b>`).join(", ");
    $("#vfClearBtn").hidden = !$("#v-paste").value;
    $("#vfMatch").innerHTML = !cited.length ? (($("#v-paste").value.trim()) ? `<p class="vf-match-line none">Aucune plaque reconnue dans ce texte.</p>` : "")
      : `${found.length ? `<p class="vf-match-line ok"><span class="vf-dot" aria-hidden="true"></span>${found.length > 1 ? `${found.length} faites, cochées` : "1 faite, cochée"} : ${plateList(found)}</p>` : ""}
        ${notDone.length ? `<p class="vf-match-line todo"><span class="vf-dot" aria-hidden="true"></span>${notDone.length > 1 ? `${notDone.length} pas encore faites, non cochées` : "1 pas encore faite, non cochée"} : ${plateList(notDone)}</p>` : ""}
        ${unknown.length ? `<p class="vf-match-line none"><span class="vf-dot" aria-hidden="true"></span>Pas dans la liste : ${plateList(unknown)}</p>` : ""}`;
    // Bottom bar: only once something is ticked.
    const n = checked.size;
    $("#vfBar").hidden = !n || !state.canWrite;
    $("#vfBarN").textContent = n;
    $("#vfBarLabel").textContent = n > 1 ? "véhicules cochés" : "véhicule coché";
    document.body.classList.toggle("vf-bar-on", !$("#vfBar").hidden && !$("#view-verif").hidden);
    $("#v-sheet").innerHTML = sheetLink(state.demandes.filter((d) => checked.has(d.id)).map((d) => d.plaque));
  }
  ["#v-from", "#v-to"].forEach((s) => $(s).addEventListener("change", renderVerification));
  $("#v-kind").addEventListener("change", renderVerification);
  $("#vfProvs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vf-prov]"); if (!b) return;
    $("#v-prest").value = b.dataset.vfProv; renderVerification();
  });
  $("#vfRange").addEventListener("click", (e) => { const b = e.target.closest("[data-range]"); if (b) { setVerificationRange(Number(b.dataset.range)); renderVerification(); } });
  $("#vfStatus").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) { $("#v-st").value = b.dataset.st; renderVerification(); } });
  $("#v-table").addEventListener("click", (e) => {
    const open = e.target.closest("[data-vf-open]");
    if (open) { openDemandeFromPlanning(open.dataset.vfOpen); return; }
    const b = e.target.closest("[data-check]"); if (!b) return;
    const checked = state.checkedForVerification, id = b.dataset.check;
    checked.has(id) ? checked.delete(id) : checked.add(id);
    renderVerification();
  });
  $("#vfAll").addEventListener("click", () => {
    const rows = verificationRows(), checked = state.checkedForVerification;
    if (rows.length && checked.size === rows.length) checked.clear(); else rows.forEach((r) => checked.add(r.id));
    renderVerification();
  });
  $("#vfNone").addEventListener("click", () => { state.checkedForVerification.clear(); renderVerification(); });
  function applyPastedReply() {
    const { done } = vfReply();
    const newlyChecked = verificationRows().filter((r) => done.includes(D.plateKey(r.plaque)) && !state.checkedForVerification.has(r.id));
    newlyChecked.forEach((r) => state.checkedForVerification.add(r.id));
    renderVerification(); // the « Sa réponse » card and the bottom bar say what was ticked
  }
  $("#v-paste").addEventListener("input", applyPastedReply);
  $("#vfPasteBtn").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { toast("Le presse-papiers est vide"); return; }
      $("#v-paste").value = text; applyPastedReply();
    } catch { $("#v-paste").focus(); toast("Colle sa réponse dans la case (Ctrl+V ou appui long)"); }
  });
  $("#vfClearBtn").addEventListener("click", () => { $("#v-paste").value = ""; renderVerification(); $("#v-paste").focus(); });
  document.querySelectorAll("#view-verif [data-bulk]").forEach((button) => button.addEventListener("click", async () => {
    if (!requireStore()) return;
    const status = button.dataset.bulk;
    const targets = state.demandes.filter((d) => state.checkedForVerification.has(d.id) && d.statut !== status);
    if (!targets.length) return toast(state.checkedForVerification.size ? `Déjà en « ${D.statusOf(status).label} »` : "Coche d'abord des véhicules");
    const before = targets.map((d) => ({ id: d.id, statut: d.statut }));
    const buttons = document.querySelectorAll("#view-verif [data-bulk]");
    buttons.forEach((b) => (b.disabled = true));
    try {
      for (const d of targets) await state.store.setStatus(d, status);
      state.checkedForVerification.clear();
      renderVerification();
      toast(`${plural(targets.length, "véhicule")} passé${targets.length > 1 ? "s" : ""} en « ${D.statusOf(status).label} »`, { label: "Annuler", run: async () => {
        try {
          for (const b of before) { const d = demandeById(b.id); if (d && d.statut === status) await state.store.setStatus(d, b.statut); }
          toast("Statuts remis comme avant");
        } catch (err) { reportWriteError(err); }
      } });
    } catch (err) { reportWriteError(err); }
    finally { buttons.forEach((b) => (b.disabled = false)); }
  }));

  // ================= monthly report (« Bilan », façon iPhone 2026-11-21) =================
  // HT amounts of the done jobs per provider, to check their invoices (payment stays by bank transfer).
  // The month and the provider stay in the hidden #b-month / #b-prest fields; the segmented control and the pills drive them.
  $("#b-month").value = today().slice(0, 7);
  const bil = { split: "service", all: new Set() };
  const currentReport = () => D.monthlyReport(state.demandes, { month: $("#b-month").value, provider: $("#b-prest").value, todayIso: today() });
  const bilArt = (key, size = "sm") => `<span class="ret-ico ${size}" aria-hidden="true">${self.IssueArt?.art(key, "ret-art") || ""}</span>`;
  const ht = (n) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const monthShift = (month, k) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const monthShort = (month) => { const s = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1, 1).toLocaleDateString("fr-FR", { month: "short" }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const isFlat = (d) => d.service === "hayon" && !(d.prixHT != null && d.prixHT !== "" && Number.isFinite(+d.prixHT));
  const priceOf = (d) => (isFlat(d) ? "Forfait" : d.prixHT != null && d.prixHT !== "" && Number.isFinite(+d.prixHT) ? ht(+d.prixHT) : "Sans prix");
  function setReportMonth(month) { $("#b-month").value = month; bil.all.clear(); renderReport(); }
  function setReportProvider(provider) { $("#b-prest").value = provider; bil.all.clear(); renderReport(); }
  function renderReportControls(month, provider) {
    const thisMonth = today().slice(0, 7);
    const recent = [-2, -1, 0].map((k) => monthShift(thisMonth, k));
    const other = !recent.includes(month);
    $("#bilMonths").innerHTML = recent.map((m) => `<button type="button" role="tab" data-bil-month="${m}" aria-selected="${m === month}">${esc(monthShort(m))}${m.slice(0, 4) !== thisMonth.slice(0, 4) ? " " + m.slice(0, 4) : ""}</button>`).join("")
      + `<button type="button" role="tab" data-bil-pick-month aria-selected="${other}">${other ? esc(monthShort(month) + " " + month.slice(0, 4)) : "Autre mois…"}</button>`;
    const names = [...new Set([...state.providers, ...(provider ? [provider] : [])])];
    $("#bilProvs").hidden = names.length < 2;
    $("#bilProvs").innerHTML = [["", "Tous"], ...names.map((p) => [p, p])].map(([v, l]) => `<button type="button" class="plan-prov" data-bil-filter="${esc(v)}" aria-pressed="${provider === v}">${esc(l)}</button>`).join("");
    $("#bilKicker").textContent = D.monthLabel(month) + (provider ? " · " + provider : "");
  }
  function bilRow(d, who = !$("#b-prest").value) {
    const late = D.isOpen(d) && D.lastDay(d) < today();
    const status = d.statut === "realisee" ? "" : `<span class="bil-st ${late ? "wait" : d.statut === "annulee" ? "off" : ""}"><i></i>${esc(late ? "À confirmer" : D.statusOf(d.statut).label)}</span>`;
    return `<button type="button" class="bil-row" data-open="${esc(d.id)}">
      <span class="bil-row-date"><b>${+d.date.slice(8, 10)}</b><small>${esc(new Date(d.date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short" }))}</small></span>
      <span class="bil-row-main"><span class="bil-row-line">${plateTag(d.plaque)}${status}</span>
        <span class="bil-row-sub">${esc([D.jobLabel(d), D.vehicleLabel(d), who && d.prestataire].filter(Boolean).join(" · "))}</span></span>
      <span class="bil-row-price${d.statut !== "realisee" || isFlat(d) || priceOf(d) === "Sans prix" ? " soft" : ""}${d.statut === "annulee" ? " off" : ""}">${esc(priceOf(d))}</span></button>`;
  }
  function bilList(id, title, rows, note = "") {
    if (!rows.length) return "";
    const open = bil.all.has(id) || rows.length <= 8;
    return `<section class="bil-sec" id="bil-${id}"><h2 class="ret-gh"><span>${title}</span><em>${rows.length}</em></h2>${note ? `<p class="ret-gsub">${note}</p>` : ""}
      <div class="bil-card bil-rows">${(open ? rows : rows.slice(0, 6)).map((d) => bilRow(d)).join("")}
      ${open ? "" : `<button type="button" class="bil-more" data-bil-all="${id}">Tout voir (${rows.length})${icon("chev-d")}</button>`}</div></section>`;
  }
  function providerCard(report) {
    const max = Math.max(1, ...report.byProvider.map(([, t]) => t.amountHT));
    const rows = report.byProvider.map(([name, t]) => {
      const flatOnly = !t.amountHT && t.flat;
      const sub = [`${t.done} réalisé${t.done > 1 ? "s" : ""} sur ${t.requested}`, t.overdue ? `<b class="wait">${t.overdue} à confirmer</b>` : "", t.unpriced ? `<b class="wait">${t.unpriced} sans prix</b>` : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="bil-prov-row" data-bil-prov="${esc(name)}">
        <span class="bil-prov-main"><b>${esc(name)}</b><span>${sub}</span>
          <span class="bil-bar" aria-hidden="true"><i style="width:${flatOnly ? 0 : Math.max(t.amountHT ? 3 : 0, Math.round((t.amountHT / max) * 100))}%"></i></span></span>
        <span class="bil-prov-amount">${flatOnly ? `<b class="soft">Forfait</b><small>mensuel</small>` : `<b>${esc(ht(t.amountHT))}</b><small>HT${t.flat ? " + forfait" : ""}</small>`}</span>
        ${icon("chev-r")}</button>`;
    }).join("");
    return `<section class="bil-sec"><h2 class="ret-gh"><span>Par prestataire</span><em>${report.byProvider.length}</em></h2>
      <p class="ret-gsub">Touche un prestataire pour le détail à comparer avec sa facture.</p><div class="bil-card">${rows}</div></section>`;
  }
  const SPLITS = [["service", "Prestation", "byService"], ["site", "Site", "bySite"], ["model", "Modèle", "byModel"]];
  function splitCard(report) {
    const [, , key] = SPLITS.find(([id]) => id === bil.split) || SPLITS[0];
    const list = report[key];
    const max = Math.max(1, ...list.map(([, t]) => t.requested));
    return `<section class="bil-sec"><h2 class="ret-gh"><span>Répartition</span></h2>
      <div class="ret-seg bil-seg" role="tablist" aria-label="Répartition">${SPLITS.map(([id, label]) => `<button type="button" role="tab" data-bil-split="${id}" aria-selected="${id === bil.split}">${label}</button>`).join("")}</div>
      <div class="bil-card">${list.map(([name, t]) => `<div class="bil-split-row"><span class="bil-split-name">${esc(name)}</span>
        <span class="bil-bar two" aria-hidden="true"><i style="width:${Math.round((t.requested / max) * 100)}%"><i style="width:${t.requested ? Math.round((t.done / t.requested) * 100) : 0}%"></i></i></span>
        <span class="bil-split-n"><span><b>${t.done}</b> / ${t.requested}</span>${t.amountHT ? `<small>${esc(ht(t.amountHT))} HT</small>` : ""}</span></div>`).join("")}</div>
      <p class="bil-legend"><i class="done"></i>réalisés <i></i>demandés</p></section>`;
  }
  function dayChart(report, month) {
    const days = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
    const counts = Array(days).fill(0);
    report.rows.filter((d) => d.statut === "realisee").forEach((d) => { counts[+d.date.slice(8, 10) - 1]++; });
    const max = Math.max(1, ...counts);
    const now = today().slice(0, 7) === month ? +today().slice(8, 10) : 0;
    return `<div class="bil-chart" role="img" aria-label="Prestations réalisées par jour">${counts.map((c, i) => `<span class="${i + 1 === now ? "now" : i + 1 > now && now ? "later" : ""}" title="${i + 1} : ${c}"><i style="height:${c ? Math.max(8, Math.round((c / max) * 100)) : 0}%"></i></span>`).join("")}</div>
      <div class="bil-chart-axis"><span>1</span><span>${Math.ceil(days / 2)}</span><span>${days}</span></div>`;
  }
  function renderReport() {
    const month = $("#b-month").value, provider = $("#b-prest").value;
    renderReportControls(month, provider);
    // The start of the month is read only when the Bilan page is open (it would cost reads at every opening otherwise).
    const loading = month && !$("#view-bilan").hidden && needOlder(D.monthStart(month + "-01"), D.nextMonthStart(month + "-01"));
    const report = currentReport();
    if (loading && !report.rows.length) {
      $("#b-body").innerHTML = `<div class="ret-empty" aria-busy="true">${bilArt("bil-facture", "xl")}<b>Chargement de ${esc(D.monthLabel(month))}…</b><span>Les mois anciens sont lus seulement quand tu les ouvres.</span></div>`;
      return;
    }
    if (!report.rows.length) {
      $("#b-body").innerHTML = `<div class="ret-empty">${bilArt("bil-facture", "xl")}<b>Aucune demande en ${esc(D.monthLabel(month))}${provider ? " avec " + esc(provider) : ""}</b><span>Le bilan compte les demandes selon leur premier jour de disponibilité : demandées, réalisées, annulées et encore en attente.</span></div>`;
      return;
    }
    const t = report.total;
    const pct = t.requested ? Math.round((t.done / (t.requested - t.cancelled || 1)) * 100) : 0;
    const done = report.rows.filter((d) => d.statut === "realisee").sort(D.byDateThenTime);
    const overdue = report.rows.filter((d) => D.isOpen(d) && D.lastDay(d) < today()).sort(D.byDateThenTime);
    const upcoming = report.rows.filter((d) => D.isOpen(d) && D.lastDay(d) >= today()).sort(D.byDateThenTime);
    const cancelled = report.rows.filter((d) => d.statut === "annulee").sort(D.byDateThenTime);
    const notes = [
      t.flat ? `<span class="bil-note">${t.flat} contrôle${t.flat > 1 ? "s" : ""} hayon au forfait mensuel, hors total</span>` : "",
      t.unpriced ? `<span class="bil-note wait">${plural(t.unpriced, "prestation réalisée")} sans prix : à vérifier sur la facture</span>` : "",
    ].join("");
    const tile = (art, n, label, jump, tone = "") => `<button type="button" class="ret-tile bil-tile ${tone}" data-bil-jump="${jump}"${n ? "" : " disabled"}>${bilArt(art)}<b>${n}</b><span>${label}</span></button>`;
    $("#b-body").innerHTML = `
      <section class="bil-hero">
        <div class="bil-hero-top">${bilArt("bil-facture", "lg")}
          <div class="bil-hero-txt"><span class="bil-hero-k">Total réalisé${provider ? " · " + esc(provider) : ""}</span>
            <span class="bil-total"><b class="bil-total-n">${esc(ht(t.amountHT))}</b><small>HT</small></span>
            <span class="bil-hero-sub">soit ${esc(ht(D.withVat(t.amountHT)))} TTC · ${t.done} réalisée${t.done > 1 ? "s" : ""} sur ${t.requested - t.cancelled} à faire</span></div></div>
        <div class="bil-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Part réalisée"><i style="width:${pct}%"></i></div>
        <div class="bil-progress-l"><span>${pct} % réalisé</span><span>${esc(D.monthLabel(month))}</span></div>
        ${dayChart(report, month)}
        ${notes ? `<div class="bil-notes">${notes}</div>` : ""}
      </section>
      <div class="ret-tiles bil-tiles">${tile("ret-fait", t.done, "Réalisés", "done")}${tile("bil-attente", t.overdue, "À confirmer", "overdue", "wait")}${tile("act-date", t.upcoming, "À venir", "upcoming")}${tile("bil-annule", t.cancelled, "Annulés", "cancelled")}</div>
      <div class="bil-cols"><div class="bil-col">
      ${provider ? invoiceSection(provider, report) : providerCard(report)}
      ${splitCard(report)}
      </div><div class="bil-col">
      ${bilList("overdue", "À confirmer", overdue, "Dispo passée, pas encore « Réalisée ». À vérifier avant de valider la facture.")}
      ${bilList("done", "Réalisés", done)}
      ${bilList("upcoming", "À venir", upcoming)}
      ${bilList("cancelled", "Annulés", cancelled)}
      </div></div>`;
  }
  // Invoice detail of one provider: lines « job × unit price », totals HT / TTC, what to check.
  function invoiceSection(name, report, inSheet = false) {
    const rows = report.rows.filter((d) => (d.prestataire || "—") === name);
    const t = (report.byProvider.find(([k]) => k === name) || [, null])[1];
    if (!t) return "";
    const done = rows.filter((d) => d.statut === "realisee").sort(D.byDateThenTime);
    const lines = D.invoiceLines(done);
    const checks = [
      t.overdue ? `<p class="bil-check wait">${bilArt("bil-attente", "xs")}<span><b>${plural(t.overdue, "véhicule")} encore à confirmer</b>Dispo passée sans « Réalisée » : vérifie avant de payer.</span></p>` : "",
      t.unpriced ? `<p class="bil-check wait">${bilArt("bil-attente", "xs")}<span><b>${plural(t.unpriced, "prestation")} sans prix</b>Le tarif manquait à l'enregistrement : prends le prix de la facture.</span></p>` : "",
    ].join("");
    return `<section class="bil-sec bil-invoice">${inSheet ? "" : `<h2 class="ret-gh"><span>Détail pour la facture</span></h2>`}
      <div class="bil-card bil-inv">
        ${lines.map((l) => `<div class="bil-inv-line"><span><b>${esc(l.label)}</b><small>${l.flat ? "Forfait mensuel" : l.unit == null ? "Sans prix" : `${l.count} × ${esc(ht(l.unit))}`}</small></span><em>${l.count}</em><strong class="${l.unit == null ? "soft" : ""}">${l.flat ? "Forfait" : l.unit == null ? "—" : esc(ht(l.total))}</strong></div>`).join("")
          || `<p class="bil-inv-empty">Rien de réalisé ce mois-ci.</p>`}
        ${!t.amountHT && t.flat ? `<p class="bil-inv-flat">Payé au forfait mensuel : la facture doit reprendre le forfait convenu. Les ${t.flat} contrôle${t.flat > 1 ? "s" : ""} du mois servent à vérifier que le travail a bien été fait.</p>`
          : `<div class="bil-inv-total"><span>Total HT${t.flat ? " (hors forfait)" : ""}</span><strong>${esc(ht(t.amountHT))}</strong></div>
        <div class="bil-inv-ttc"><span>TVA ${Math.round(D.VAT_RATE * 100)} %</span><span>${esc(ht(D.withVat(t.amountHT) - t.amountHT))}</span></div>
        <div class="bil-inv-ttc strong"><span>Total TTC</span><span>${esc(ht(D.withVat(t.amountHT)))}</span></div>`}
      </div>${checks}
      ${inSheet ? `${bilListPlain(done)}<div class="bil-sh-acts"><button type="button" class="ret-btn" data-bil-copy-prov="${esc(name)}">${icon("list")}Copier ses lignes pour Google Sheets</button>
        <button type="button" class="ret-btn" data-bil-filter="${esc(name)}" data-team-sheet-close>Voir seulement ${esc(name)}</button></div>` : ""}</section>`;
  }
  const bilListPlain = (rows) => rows.length ? `<h3 class="ret-gh bil-sh-h"><span>Véhicules réalisés</span><em>${rows.length}</em></h3><div class="bil-card bil-rows">${rows.map((d) => bilRow(d, false)).join("")}</div>` : "";
  function openInvoiceSheet(name) {
    const report = currentReport();
    const t = (report.byProvider.find(([k]) => k === name) || [, null])[1];
    if (!t) return;
    teamSheet.open(name, `<div class="bil-sheet"><div class="bil-sh-hero">${bilArt("bil-facture", "lg")}<span><span class="bil-hero-k">${esc(D.monthLabel($("#b-month").value))}</span>
        <span class="bil-total"><b>${!t.amountHT && t.flat ? "Forfait" : esc(ht(t.amountHT))}</b><small>${!t.amountHT && t.flat ? "mensuel" : "HT"}</small></span>
        <span class="bil-hero-sub">${t.done} réalisée${t.done > 1 ? "s" : ""} sur ${t.requested} demandée${t.requested > 1 ? "s" : ""}</span></span></div>
      ${invoiceSection(name, report, true)}</div>`, { cls: "bil-sheet-wrap" });
  }
  function openExportSheet() {
    const row = (attr, art, title, sub) => `<button type="button" class="bil-exp-row" ${attr}>${icon(art)}<span><b>${title}</b><small>${sub}</small></span>${icon("chev-r")}</button>`;
    teamSheet.open("Exporter le bilan", `<div class="bil-sheet"><p class="sheet-sub">${esc(D.monthLabel($("#b-month").value))}${$("#b-prest").value ? " · " + esc($("#b-prest").value) : ", tous les prestataires"}.</p>
      <div class="bil-card">${row("data-bil-do=\"copy\"", "copy", "Copier le résumé", "Les chiffres du mois, à coller dans WhatsApp ou un mail")}
      ${row("data-bil-do=\"tsv\"", "list", "Copier pour Google Sheets", "Une ligne par véhicule, avec le prix HT")}
      ${state.downloads ? row("data-bil-do=\"csv\"", "download", "Télécharger le CSV", "Le même tableau, en fichier") : ""}</div></div>`, { cls: "bil-sheet-wrap" });
  }
  function openMonthSheet() {
    const thisMonth = today().slice(0, 7), month = $("#b-month").value;
    const months = Array.from({ length: 24 }, (_, i) => monthShift(thisMonth, -i));
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    teamSheet.open("Choisir un mois", `<div class="bil-sheet">${years.map((y) => `<h3 class="ret-gh bil-sh-h"><span>${y}</span></h3><div class="bil-month-grid">
      ${months.filter((m) => m.startsWith(y)).reverse().map((m) => `<button type="button" class="bil-month" data-bil-set-month="${m}" aria-pressed="${m === month}">${esc(monthShort(m))}</button>`).join("")}</div>`).join("")}
      <p class="ret-gsub bil-sh-foot">Les mois anciens sont lus seulement quand tu les ouvres.</p></div>`, { cls: "bil-sheet-wrap" });
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-bil-month], [data-bil-pick-month], [data-bil-filter], [data-bil-prov], [data-bil-split], [data-bil-all], [data-bil-jump], [data-bil-export], [data-bil-do], [data-bil-set-month], [data-bil-copy-prov]");
    if (!el) return;
    const ds = el.dataset;
    if (ds.bilMonth) setReportMonth(ds.bilMonth);
    else if ("bilPickMonth" in ds) openMonthSheet();
    else if (ds.bilSetMonth) { teamSheet.close(); setReportMonth(ds.bilSetMonth); }
    else if ("bilFilter" in ds) setReportProvider(ds.bilFilter);
    else if (ds.bilProv) openInvoiceSheet(ds.bilProv);
    else if (ds.bilSplit) { bil.split = ds.bilSplit; renderReport(); }
    else if (ds.bilAll) { bil.all.add(ds.bilAll); renderReport(); }
    else if (ds.bilJump) { bil.all.add(ds.bilJump); renderReport(); $("#bil-" + ds.bilJump)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }
    else if ("bilExport" in ds) openExportSheet();
    else if (ds.bilDo) $("#b-" + ds.bilDo).click();
    else if (ds.bilCopyProv) copyProviderRows(ds.bilCopyProv);
  });
  $("#b-body").addEventListener("click", (e) => { const r = e.target.closest("[data-open]"); if (r) openDemandeFromPlanning(r.dataset.open); });
  document.addEventListener("click", (e) => { const r = e.target.closest(".bil-sheet [data-open]"); if (r) openDemandeFromPlanning(r.dataset.open); });
  ["#b-month", "#b-prest"].forEach((s) => $(s).addEventListener("change", renderReport));
  $("#b-copy").onclick = async () => {
    const text = D.monthlySummaryMessage(currentReport(), { month: $("#b-month").value, provider: $("#b-prest").value });
    if (await copyText(text)) toast("Résumé copié");
  };
  const exportRows = (rows = currentReport().rows) => [D.EXPORT_HEADER, ...rows.slice().sort(D.byDateThenTime).map(D.exportRow)];
  async function copyProviderRows(name) {
    const rows = exportRows(currentReport().rows.filter((d) => (d.prestataire || "—") === name && d.statut === "realisee"));
    if (await copyText(D.toTsv(rows))) toast(`${plural(rows.length - 1, "ligne")} copiée${rows.length > 2 ? "s" : ""} : colle-les dans une feuille Google Sheets`);
  }
  $("#b-tsv").onclick = async () => {
    const rows = exportRows();
    if (await copyText(D.toTsv(rows))) toast(`${plural(rows.length - 1, "ligne")} copiée${rows.length > 2 ? "s" : ""} : colle-les dans une feuille Google Sheets`);
  };
  $("#b-csv").onclick = () => {
    const provider = $("#b-prest").value;
    const filename = `bilan-prestations-${$("#b-month").value}${provider ? "-" + provider.replace(/[^\w-]+/g, "-") : ""}.csv`;
    saveBlob(Promise.resolve(new Blob([D.toCsv(exportRows())], { type: "text/csv" })), filename);
  };

  // ================= history (façon iPhone, 2026-11-21) =================
  // Big title, grey search field, period and status in pills, the other filters in a sheet; the list is grouped by day
  // (a fine table on computer). A tap opens the request's card in a sheet, with its change history as a timeline.
  // The hidden selects (#h-prest…#h-mois) stay the source of truth, so links from the Planning keep working.
  const HISTORY_STATUS_FILTERS = { "": () => true, ouvert: D.isOpen };
  const HIST_STATUS_PILLS = [["", "Toutes"], ["ouvert", "En cours"], ["a_envoyer", "À envoyer"], ["realisee", "Réalisées"], ["annulee", "Annulées"]];
  const HIST_TONE = { a_envoyer: "todo", realisee: "ok", annulee: "off" };
  const hv = (id) => $("#h-" + id).value;
  const setHist = (id, value) => { $("#h-" + id).value = value; renderHistory(); };
  const histMonthLabel = (m) => capFirst(D.monthLabel(m));
  function historyRows({ ignoreStatus = false } = {}) {
    const query = $("#q").value, provider = hv("prest"), status = hv("statut"), service = hv("svc"), site = hv("site");
    const statusFilter = ignoreStatus ? () => true : HISTORY_STATUS_FILTERS[status] || ((d) => d.statut === status);
    const month = hv("mois"), from = month && month + "-01", to = month && D.nextMonthStart(from);
    return state.demandes.filter((d) => (!month || (d.date && d.date < to && D.lastDay(d) >= from)) &&
      (!provider || d.prestataire === provider) && (!service || d.service === service) && (!site || d.site === site) && statusFilter(d) &&
      D.matchesSearch([d.plaque, D.vehicleLabel(d), d.site, d.adresse, d.notes, d.prestataire, d.tache], query)
    ).sort((a, b) => (b.date || "").localeCompare(a.date || "") || D.byStartTime(a, b));
  }
  function renderHistoryPills(all) {
    const month = hv("mois"), now = today().slice(0, 7);
    const prev = D.toIsoDate((() => { const d = D.parseIsoDate(now + "-01"); d.setMonth(d.getMonth() - 1); return d; })()).slice(0, 7);
    const other = month && month !== now && month !== prev;
    const per = (value, label) => `<button type="button" class="plan-prov" data-h-mois="${value}" aria-pressed="${month === value}">${esc(label)}</button>`;
    $("#h-periods").innerHTML = per("", "Récentes") + per(now, histMonthLabel(now).replace(/ \d{4}$/, "")) + per(prev, histMonthLabel(prev).replace(/ \d{4}$/, ""))
      + `<button type="button" class="plan-prov" data-h-other aria-pressed="${!!other}">${other ? esc(histMonthLabel(month)) : "Autre mois…"}${icon("chev-d")}</button>`;
    const status = hv("statut");
    const count = (value) => all.filter(HISTORY_STATUS_FILTERS[value] || ((d) => d.statut === value)).length;
    const pills = HIST_STATUS_PILLS.slice();
    if (status && !pills.some(([v]) => v === status)) pills.push([status, D.statusOf(status).label]);
    const extra = [["prest", hv("prest")], ["site", hv("site")], ["svc", hv("svc") && D.SERVICES.find((s) => s.id === hv("svc"))?.label]].filter(([, v]) => v);
    $("#h-filters").innerHTML = `<button type="button" class="hist-more${extra.length ? " on" : ""}" data-h-more aria-label="Filtres : prestataire, site, prestation">${icon("list")}<span>Filtres</span>${extra.length ? `<em>${extra.length}</em>` : ""}</button>`
      + extra.map(([id, label]) => `<button type="button" class="hist-chip" data-h-clear="${id}" aria-label="Retirer le filtre ${esc(label)}">${esc(label)}${icon("x")}</button>`).join("")
      + `<span class="hist-sep" aria-hidden="true"></span>`
      + pills.map(([v, label]) => `<button type="button" class="plan-prov hist-st ${HIST_TONE[v] || ""}" data-h-statut="${v}" aria-pressed="${status === v}">${v && v !== "ouvert" ? `<i aria-hidden="true"></i>` : ""}${esc(label)}<em>${count(v)}</em></button>`).join("");
  }
  function renderHistory() {
    const month = hv("mois"), from = month && month + "-01", to = month && D.nextMonthStart(from);
    const loading = month && needOlder(from, to);
    $("#h-kicker").textContent = month ? histMonthLabel(month) : "15 derniers jours et en cours";
    renderOlderNote();
    const all = historyRows({ ignoreStatus: true });
    renderHistoryPills(all);
    const rows = historyRows();
    $("#h-export").disabled = !rows.length;
    if (loading && !rows.length) {
      $("#histWrap").innerHTML = `<div class="plan-empty" aria-busy="true"><b>Chargement de ${esc(D.monthLabel(month))}…</b><span>Les mois anciens sont lus seulement quand tu les choisis.</span></div>`;
      return;
    }
    if (!rows.length) {
      const filtered = $("#q").value || hv("prest") || hv("site") || hv("svc") || hv("statut");
      $("#histWrap").innerHTML = `<div class="plan-empty"><span class="svc-tile lg" aria-hidden="true">${self.IssueArt?.art("hist-vide", "svc-art") || ""}</span>
        <b>${state.demandes.length ? (filtered ? "Aucune demande ne correspond" : "Aucune demande sur cette période") : "Aucune demande enregistrée pour l'instant"}</b>
        <span>${filtered ? "Essaie une autre plaque, ou retire un filtre." : "Chaque demande saisie dans « Nouvelle demande » est listée ici, avec la date à laquelle elle a été envoyée."}</span>
        ${filtered ? `<button type="button" class="plan-link" data-h-reset>Effacer la recherche et les filtres</button>` : ""}</div>`;
      return;
    }
    const groups = [];
    rows.forEach((d) => { const key = d.date || ""; const g = groups[groups.length - 1]; g && g.key === key ? g.items.push(d) : groups.push({ key, items: [d] }); });
    const year = today().slice(0, 4);
    const dayName = (iso) => !iso ? "Sans date" : capFirst(D.dayLabel(iso)) + (iso.slice(0, 4) !== year ? " " + iso.slice(0, 4) : "");
    $("#histWrap").innerHTML = `<p class="hist-count">${plural(rows.length, "demande")}${rows.length < all.length ? ` sur ${all.length}` : ""}</p>
      <div class="hist-cols" aria-hidden="true"><span></span><span>Véhicule</span><span>Site</span><span>Prestataire</span><span>Statut</span><span>Envoyée le</span></div>`
      + groups.map((g) => `<section class="hist-day"><h3 class="hist-day-head">${esc(dayName(g.key))}<em>${g.items.length}</em></h3>
        <div class="plan-list hist-list">${g.items.map(historyLine).join("")}</div></section>`).join("");
  }
  // Below the history: older requests stay unread until asked for, to spare the free plan's daily reads.
  function renderOlderNote() {
    const note = $("#h-older");
    const loading = state.olderRanges.some((r) => !r.ready && r.from === D.OLDEST_DAY);
    note.hidden = !state.store?.olderOnDemand?.() || allOlderLoaded() || !!hv("mois");
    if (note.hidden) return;
    note.innerHTML = `<span>Ici : les demandes depuis le ${esc(D.numericDate(state.recentFrom))}, plus toutes celles encore en cours ou en retard, et les contrôles hayon des 8 derniers mois. Pour un mois plus ancien, choisis-le dans « Autre mois ».</span>
      <button type="button" class="plan-link" id="h-older-btn" ${loading ? "disabled aria-busy=\"true\"" : ""}>${loading ? "Chargement…" : "Afficher aussi les plus anciennes"}</button>`;
  }
  $("#h-older").addEventListener("click", (e) => { if (e.target.closest("#h-older-btn")) { needOlder(D.OLDEST_DAY, null); renderHistory(); } });
  function historyLine(d) {
    const slot = D.timeSlotLabel(d).replace(/^de /, "");
    const span = D.isMultiDay(d) ? ` → ${D.shortDate(D.lastDay(d))}` : "";
    const what = [D.vehicleLabel(d) || "Modèle non précisé", D.jobLabel(d)].filter(Boolean).join(" · ");
    return `<button type="button" class="plan-row hist-row${D.isActive(d) ? "" : " cancel"}" data-open="${esc(d.id)}">
      ${serviceTile(d)}
      <span class="plan-row-main hist-veh">
        <span class="plan-row-line">${plateTag(d.plaque)}<span class="plan-time">${esc(slot + span)}</span></span>
        <span class="plan-what"><b class="hist-slot-m">${esc(slot + span)}</b>${esc(what)}</span>
        <span class="plan-sub hist-where">${esc(D.siteOf(d))}<span class="hist-who"> · ${esc(d.prestataire || "")}</span></span>
      </span>
      <span class="hist-c hist-c-site">${esc(D.siteOf(d))}</span>
      <span class="hist-c hist-c-prov">${esc(d.prestataire || "")}</span>
      <span class="hist-c hist-c-st">${planStatus(d)}</span>
      <span class="hist-c hist-c-sent">${d.sentAt ? esc(D.shortDate(d.sentAt.slice(0, 10))) : "—"}</span>
      <span class="plan-row-end hist-end">${planStatus(d)}${icon("chev-r")}</span>
    </button>`;
  }
  $("#q").addEventListener("input", renderHistory);
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Escape" && e.target.value) { e.target.value = ""; renderHistory(); } });
  ["#h-prest", "#h-statut", "#h-svc", "#h-site", "#h-mois"].forEach((s) => $(s).addEventListener("input", renderHistory));
  $("#histWrap").addEventListener("click", (e) => {
    if (e.target.closest("[data-h-reset]")) { $("#q").value = ""; ["prest", "site", "svc", "statut"].forEach((id) => ($("#h-" + id).value = "")); renderHistory(); return; }
    const r = e.target.closest("[data-open]"); if (r) openHistorySheet(r.dataset.open);
  });
  $("#view-historique").addEventListener("click", (e) => {
    const b = e.target.closest("[data-h-mois], [data-h-statut], [data-h-clear], [data-h-more], [data-h-other]");
    if (!b) return;
    if (b.dataset.hMois !== undefined) return setHist("mois", b.dataset.hMois);
    if (b.dataset.hStatut !== undefined) return setHist("statut", hv("statut") === b.dataset.hStatut ? "" : b.dataset.hStatut);
    if (b.dataset.hClear) return setHist(b.dataset.hClear, "");
    if (b.dataset.hMore !== undefined) return openHistFilters();
    if (b.dataset.hOther !== undefined) return openHistMonths();
  });

  // ---------- sheets: other month, filters, export ----------
  const histChoice = (attr, value, label, on, art = "") => `<button type="button" class="hist-opt" ${attr}="${esc(value)}" aria-pressed="${on}">${art}<span>${esc(label)}</span>${icon("check")}</button>`;
  function histMonthsBody() {
    const months = Array.from($("#h-mois").options).map((o) => o.value).filter(Boolean);
    const years = [...new Set(months.map((m) => m.slice(0, 4)))];
    return `<p class="sheet-sub">Un mois ancien est lu seulement quand tu le choisis.</p>
      ${histChoice("data-hs-mois", "", "15 derniers jours et en cours", !hv("mois"))}
      ${years.map((y) => `<section><p class="sheet-label">${y}</p><div class="hist-months">${months.filter((m) => m.startsWith(y)).map((m) =>
        `<button type="button" class="hist-month" data-hs-mois="${m}" aria-pressed="${hv("mois") === m}">${esc(capFirst(D.monthLabel(m).replace(/ \d{4}$/, "")))}</button>`).join("")}</div></section>`).join("")}`;
  }
  const histOpen = (title, html, cls) => { teamSheet.open(title, html, { cls }); teamSheet.body.scrollTop = 0; };
  const openHistMonths = () => histOpen("Choisir un mois", histMonthsBody(), "hist-sheet");
  function histFiltersBody() {
    const group = (title, id, list) => `<section><p class="sheet-label">${title}</p><div class="hist-opts">${list.map(([v, label, art]) => histChoice("data-hs-" + id, v, label, hv(id) === v, art)).join("")}</div></section>`;
    const n = historyRows().length;
    return group("Prestataire", "prest", [["", "Tous les prestataires"], ...state.providers.map((p) => [p, p])])
      + group("Prestation", "svc", [["", "Toutes les prestations"], ...D.SERVICES.map((s) => [s.id, s.label, serviceTile({ service: s.id })])])
      + (siteNames().length ? group("Site", "site", [["", "Tous les sites"], ...siteNames().map((s) => [s, s])]) : "")
      + group("Statut", "statut", [["", "Tous les statuts"], ["ouvert", "En cours (hors réalisées / annulées)"], ...D.STATUSES.map((s) => [s.id, s.label])])
      + `<div class="plan-fiche-actions"><button type="button" class="primary plan-cta" data-team-sheet-close>Voir ${plural(n, "demande")}</button>
        <button type="button" class="plan-soft" data-hs-reset>Tout effacer</button></div>`;
  }
  const openHistFilters = () => histOpen("Filtres", histFiltersBody(), "hist-sheet side-sheet");
  function histExportBody() {
    const rows = historyRows();
    const what = [hv("mois") ? histMonthLabel(hv("mois")) : "15 derniers jours et en cours", hv("prest"), hv("site"), hv("svc") && D.SERVICES.find((s) => s.id === hv("svc"))?.label,
      hv("statut") && (hv("statut") === "ouvert" ? "En cours" : D.statusOf(hv("statut")).label), $("#q").value && `« ${$("#q").value} »`].filter(Boolean).join(" · ");
    return `<div class="plan-fiche-head hist-export-head"><span class="svc-tile sm" aria-hidden="true">${self.IssueArt?.art("ask-inbox", "svc-art") || ""}</span><div><b>${plural(rows.length, "demande")}</b><p>${esc(what)}</p></div></div>
      <p class="sheet-sub">Exactement la liste affichée, avec les dates, la plaque, le modèle, le site, le prestataire, le statut et les dates d'envoi et de réalisation.</p>
      <div class="plan-fiche-actions"><button type="button" class="primary plan-cta" data-hs-tsv>${icon("copy")}Copier pour Google Sheets</button>
        <button type="button" class="plan-soft" data-hs-csv>${icon("download")}Télécharger le fichier (CSV)</button></div>`;
  }
  $("#h-export").addEventListener("click", () => histOpen("Exporter la liste", histExportBody(), "hist-sheet"));
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(".hist-sheet [data-hs-mois], .hist-sheet [data-hs-prest], .hist-sheet [data-hs-svc], .hist-sheet [data-hs-site], .hist-sheet [data-hs-statut], .hist-sheet [data-hs-reset], .hist-sheet [data-hs-tsv], .hist-sheet [data-hs-csv]");
    if (!b) return;
    if (b.dataset.hsMois !== undefined) { teamSheet.close(); return setHist("mois", b.dataset.hsMois); }
    const exportRows = () => [D.EXPORT_HEADER, ...historyRows().slice().reverse().map(D.exportRow)];
    if (b.dataset.hsTsv !== undefined) {
      const rows = exportRows();
      if (await copyText(D.toTsv(rows))) { teamSheet.close(); toast(`${plural(rows.length - 1, "ligne")} copiée${rows.length > 2 ? "s" : ""} : colle-les dans une feuille Google Sheets`); }
      return;
    }
    if (b.dataset.hsCsv !== undefined) {
      const name = `historique-prestations-${hv("mois") || today()}${hv("prest") ? "-" + hv("prest").replace(/[^\w-]+/g, "-") : ""}.csv`;
      saveBlob(Promise.resolve(new Blob([D.toCsv(exportRows())], { type: "text/csv" })), name); teamSheet.close(); return;
    }
    if (b.dataset.hsReset !== undefined) ["prest", "site", "svc", "statut"].forEach((id) => ($("#h-" + id).value = ""));
    else for (const id of ["prest", "svc", "site", "statut"]) if (b.dataset["hs" + capFirst(id)] !== undefined) $("#h-" + id).value = b.dataset["hs" + capFirst(id)];
    renderHistory();
    teamSheet.body.innerHTML = histFiltersBody();
  });

  // ---------- the request's card + its change history as a timeline (read once per opening: free plan's reads) ----------
  const histLog = { id: "", lines: null, failed: false };
  function openHistorySheet(id) {
    histLog.id = id; histLog.lines = null; histLog.failed = false;
    openPlanSheet("fiche", id, true); teamSheet.body.scrollTop = 0;
    loadHistLog(id);
  }
  function loadHistLog(id) {
    if (!state.store?.loadHistory) return;
    const d = demandeById(id);
    state.store.loadHistory(id).then((entries) => { if (histLog.id === id) histLog.lines = D.historyLines(entries, d); })
      .catch(() => { if (histLog.id === id) histLog.failed = true; })
      .finally(() => { if (histLog.id === id && planSheet.log && planSheet.id === id) refreshPlanSheet(); });
  }
  function histLogHtml() {
    const lines = histLog.lines;
    const body = histLog.failed ? `<p class="sheet-sub">L'historique n'est pas encore lisible : les règles Firebase doivent être publiées.</p>`
      : !lines ? `<p class="sheet-sub" aria-busy="true">Chargement…</p>`
      : !lines.length ? `<p class="sheet-sub">Aucune modification notée pour l'instant.</p>`
      : `<ol class="hist-tl">${lines.map((l) => {
          const tone = /annul|suppr/i.test(l.action) ? "bad" : /Réalisée|fait/i.test(l.changes.map((c) => c.apres).join(" ")) ? "ok" : /Création/.test(l.action) ? "start" : "";
          const changes = l.changes.map((c) => `<li><span>${esc(c.label)}</span>${c.avant != null ? `<s>${esc(c.avant)}</s>${icon("chev-r")}` : ""}<b>${esc(c.apres)}</b></li>`).join("");
          return `<li class="${tone}"><i aria-hidden="true"></i><div><p class="hist-tl-head"><b>${esc(l.action)}</b><small>${esc(l.when)}</small></p>
            <p class="hist-tl-who">${esc(l.who || "avant le suivi des modifications")}</p>${changes ? `<ul>${changes}</ul>` : ""}</div></li>`;
        }).join("")}</ol>`;
    return `<section class="hist-log"><p class="sheet-label">Modifications</p>${body}
      <p class="hist-log-note">Chaque changement est noté avec son auteur et l'heure du serveur. Personne ne peut modifier ni effacer cette liste.</p></section>`;
  }

  // ================= settings =================
  const currentSettings = () => ({ sites: state.sites, flotte: state.fleet, prestataires: state.providers, contacts: state.contacts, sheetUrl: state.sheetUrl });
  async function persistSettings(message) {
    if (!requireStore()) return;
    try { await state.store.saveSettings(currentSettings()); if (message) toast(message); } catch (err) { reportWriteError(err); }
  }
  // ================= « Réglages » façon Réglages de l'iPhone (2026-11-21) =================
  // Listes groupées ; chaque ligne ouvre une feuille (par le bas sur téléphone, à droite sur ordinateur).
  // Les écritures n'ont pas changé : config/reglages, prestataires/*, comptes/*, réglages des alertes. Aucune règle Firebase touchée.
  const rg = { open: null, armed: "" };
  const rgArt = (key) => self.IssueArt?.art(key, "rg-art") || "";
  const rgIco = (key, size = "") => `<span class="rg-ico ${size}" aria-hidden="true">${rgArt(key)}</span>`;
  const RG_FLAGS = [
    { flag: "lavage", label: "Lavage", sub: "Complet ou intérieur", art: "Véhicule sale", service: "lavage" },
    { flag: "pareBrise", label: "Pare-brise", sub: "Seulement ceux qui changent les pare-brise", art: "Pare-brise", service: "pare-brise" },
    { flag: "interventions", label: "Interventions", sub: "Vérification, ampoule, AdBlue…", art: "svc-intervention", service: "intervention" },
    { flag: "hayon", label: "Contrôle hayon", sub: "Celui qui contrôle les hayons", art: "svc-hayon", service: "hayon" },
  ];
  const provOffers = (p) => RG_FLAGS.filter((f) => D.offers(state.providerDocs.get(D.providerId(p)), f.flag, p));
  // Statuts : vert = ça marche, orange = à regarder, rouge = arrêté ; gris = rien à signaler (pas de compte, pas installé).
  const RG_TONE = { ok: "ok", on: "ok", warn: "todo", stale: "todo", none: "todo", alert: "bad", off: "off", nobody: "off" };
  const rgVal = (tone, text) => `<span class="rg-val">${tone ? `<i class="rg-dot ${tone}" aria-hidden="true"></i>` : ""}${esc(text)}</span>`;
  const rgRow = ({ open, art, title, sub = "", value = "", cls = "", badge = "" }) => `<button type="button" class="rg-row ${cls}" data-rg-open="${esc(open)}">
      ${art ? rgIco(art) : ""}<span class="rg-txt"><b>${esc(title)}${badge}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>${value}<span class="rg-chev" aria-hidden="true">${icon("chev-r")}</span></button>`;
  const rgSection = (title, inner, foot = "") => `<section class="rg-group">${title ? `<h2 class="rg-gh">${title}</h2>` : ""}<div class="rg-list">${inner}</div>${foot ? `<p class="rg-foot">${foot}</p>` : ""}</section>`;
  const rgRemove = (act, i, label) => `<button type="button" class="rg-x" data-rg-act="${act}" data-i="${esc(i)}" aria-label="Retirer ${esc(label)}">${icon("x")}</button>`;
  const ROBOT_SHORT = { ok: "Tourne bien", warn: "À vérifier", alert: "Arrêté", off: "Pas installé" };
  const ALERT_SHORT = { on: "Alertes", stale: "À vérifier", none: "Sans alertes", nobody: "Sans compte" };
  const accountsOf = (p) => state.accounts.filter((a) => a.role === "prestataire" && a.prestataireId === D.providerId(p));
  const alertsWired = () => !!state.alerts?.settings?.url;
  function alertCounts() {
    const devices = state.alertDevices;
    if (!devices) return null;
    const people = state.accounts.filter((a) => a.role === "prestataire" || a.role === "admin");
    const count = (role) => { const list = people.filter((a) => a.role === role); return [list.filter((a) => D.alertStatus(devices, a.id).level === "on").length, list.length]; };
    const names = (level) => [...new Set(people.filter((a) => a.role === "prestataire" && D.alertStatus(devices, a.id).level === level).map((a) => providerName(a.prestataireId) || a.id))].join(", ");
    const [provOn, provAll] = count("prestataire"), [teamOn, teamAll] = count("admin");
    return { provOn, provAll, teamOn, teamAll, missing: names("none"), stale: names("stale") };
  }
  function alertSummaryText(c) {
    return `Alertes actives : <b>${c.provOn} compte${c.provOn > 1 ? "s" : ""} prestataire sur ${c.provAll}</b>, ${c.teamOn} de l'équipe sur ${c.teamAll}.`
      + (c.missing ? ` Pas encore activées chez : ${esc(c.missing)}.` : "") + (c.stale ? ` À vérifier (appli pas ouverte depuis 2 mois) : ${esc(c.stale)}.` : "")
      + (c.provAll && c.provOn === c.provAll ? " Tous les prestataires les reçoivent." : "");
  }
  // Ce qui demande une action, en haut de la page (comme « Terminer la configuration » sur l'iPhone).
  function rgTodo() {
    const items = [];
    const health = D.robotHealth(state.robot);
    if (health.level === "alert" || health.level === "warn")
      items.push(`<button type="button" class="rg-todo-row" data-rg-open="robot"><i class="rg-dot ${RG_TONE[health.level]}" aria-hidden="true"></i><span><b>Robot des mails : ${esc(ROBOT_SHORT[health.level].toLowerCase())}</b><small>${esc(health.text)}</small></span><span class="rg-chev" aria-hidden="true">${icon("chev-r")}</span></button>`);
    const unlinked = garageRows().filter((r) => r.missing && r.count);
    if (unlinked.length)
      items.push(`<button type="button" class="rg-todo-row" data-rg-open="garages"><i class="rg-dot todo" aria-hidden="true"></i><span><b>Garages des mails à rattacher</b><small>${esc(unlinked.map((r) => r.garage).join(", "))}</small></span><span class="rg-chev" aria-hidden="true">${icon("chev-r")}</span></button>`);
    if (state.canWrite) {
      const missing = D.missingKnownPrices(state.providers, pricesOf);
      const count = missing.reduce((n, m) => n + m.add.length, 0);
      if (count) items.push(`<div class="rg-todo-row"><i class="rg-dot todo" aria-hidden="true"></i><span><b>Tarifs connus à ajouter</b><small id="t-known-text">${esc(`${plural(count, "tarif")} à ajouter pour ${missing.map((m) => m.name).join(", ")}.`)}</small></span><button type="button" class="rg-pill" id="t-known" data-rg-act="known-prices">Remplir</button></div>`);
      const toLink = D.accessMigration(state.demandes, pricesOf).length;
      const meMissing = ownAccountMissing();
      if (toLink || meMissing) items.push(`<div class="rg-todo-row" id="a-prepare"><i class="rg-dot todo" aria-hidden="true"></i><span><b>Accès à préparer</b><small id="a-prepare-text">${esc([
        toLink ? `${plural(toLink, "demande")} à rattacher à leur prestataire ou à chiffrer avec les nouveaux tarifs` : "",
        meMissing ? `ton propre accès (${state.userEmail}) à créer en équipe City-Drop` : "",
      ].filter(Boolean).join(" et ") + ".")}</small></span><button type="button" class="rg-pill" id="a-prepare-btn" data-rg-act="prepare">Préparer</button></div>`);
    }
    return items.length ? `<section class="rg-group rg-todo"><h2 class="rg-gh">À regarder</h2><div class="rg-list">${items.join("")}</div></section>` : "";
  }
  function renderSettings() {
    const root = $("#view-reglages");
    if (!root || state.providerMode) return;
    const provRows = state.providers.map((p, i) => {
      const offers = provOffers(p);
      const st = D.providerAlertStatus(state.alertDevices, state.accounts, D.providerId(p));
      const prices = pricesOf(D.providerId(p)).length;
      const sub = [i === 0 ? "Par défaut" : "", offers.length ? offers.map((f) => f.label).join(" · ") : "Aucune prestation cochée", prices ? plural(prices, "tarif") : ""].filter(Boolean).join(" · ");
      return rgRow({ open: "prov:" + p, art: offers[0]?.art || "svc-intervention", title: p, sub, cls: "rg-prov",
        value: st ? `<span class="rg-val alert-chip" title="${esc(st.title)}"><i class="rg-dot ${RG_TONE[st.level]}" aria-hidden="true"></i><span class="rg-val-t">${esc(ALERT_SHORT[st.level])}</span></span>` : "" });
    }).join("") + (state.canWrite ? `<button type="button" class="rg-row rg-add" data-rg-open="prov-new"><span class="rg-ico plus" aria-hidden="true">${icon("plus")}</span><span class="rg-txt"><b>Ajouter un prestataire</b></span></button>` : "");
    const noAddress = state.sites.filter((s) => !s.adresse).length;
    const health = D.robotHealth(state.robot);
    const counts = alertCounts();
    const alertValue = !alertsWired() && state.alerts && state.alerts.state === "off" ? rgVal("todo", "Pas branché")
      : counts ? rgVal(counts.provAll && counts.provOn === counts.provAll ? "ok" : "todo", `${counts.provOn} sur ${counts.provAll}`) : "";
    const signOut = $("#signOutBtn");
    root.innerHTML = `<header class="rg-head"><p class="rg-kicker">Équipe City-Drop</p><h1 class="rg-title">Réglages</h1></header>
      ${rgTodo()}
      <div class="rg-cols"><div class="rg-col">
        ${rgSection(`Prestataires <em>${state.providers.length}</em>`, `<div id="s-provs">${provRows}</div>`, "Le premier de la liste est choisi par défaut dans une nouvelle demande. Touche un prestataire pour ses prestations, ses tarifs HT et ses comptes.")}
      </div><div class="rg-col">
        ${rgSection("Terrain",
          rgRow({ open: "sites", art: "rg-pin", title: "Sites et adresses", value: noAddress ? rgVal("todo", `${noAddress} sans adresse`) : rgVal("", plural(state.sites.length, "site")) }) +
          rgRow({ open: "garages", art: "rg-mail", title: "Garages des mails", sub: "Prestataire et site de chaque garage", value: garagesMissing() ? rgVal("todo", `${garagesMissing()} à rattacher`) : rgVal("", plural(garageRows().length, "garage")) }) +
          rgRow({ open: "fleet", art: "rg-van", title: "Flotte", sub: "Modèles proposés dans la demande", value: rgVal("", plural(state.fleet.length, "modèle")) }))}
        ${rgSection("Accès",
          rgRow({ open: "accounts", art: "rg-key", title: "Accès à l'appli", sub: "Qui peut se connecter, et à quoi", value: rgVal("", plural(state.accounts.length, "compte")) }) +
          rgRow({ open: "alerts", art: "rg-bell", title: "Alertes sur les téléphones", sub: "Prestataires prévenus même appli fermée", value: alertValue }))}
        ${rgSection("Connexions",
          rgRow({ open: "robot", art: "rg-mail", title: "Robot des mails", sub: "Ajoute les demandes reçues par mail", value: `<span class="rg-val" id="s-robot" data-level="${health.level}"><i class="rg-dot ${RG_TONE[health.level]}" aria-hidden="true"></i>${esc(ROBOT_SHORT[health.level])}</span>` }) +
          rgRow({ open: "gsheet", art: "rg-sheet", title: "Google Sheet pare-brise", sub: "Coche « OK confirmé » des plaques", value: state.sheetUrl ? rgVal("ok", "Branché") : rgVal("off", "Pas branché") }))}
        ${signOut && !signOut.hidden ? rgSection("", `<button type="button" class="rg-row rg-danger" data-rg-open="logout"><span class="rg-ico" aria-hidden="true">${rgArt("rg-power")}</span><span class="rg-txt"><b>Se déconnecter</b>${state.userEmail ? `<small>${esc(state.userEmail)}</small>` : ""}</span></button>`) : ""}
      </div></div>`;
    refreshRgSheet();
  }

  // ----- garages des mails : chaque garage City-Drop = un prestataire de l'appli + un site -----
  const garageRows = () => D.garageList(state.demandes, state.garages, { providerNames: state.providers, sites: state.sites });
  const garagesMissing = () => garageRows().filter((r) => r.missing).length;
  const pickOptions = (values, chosen, empty) => `<option value="">${esc(empty)}</option>` + values.map((v) => `<option value="${esc(v)}" ${v === chosen ? "selected" : ""}>${esc(v)}</option>`).join("");
  function garagesSheet() {
    const w = state.canWrite, rows = garageRows();
    const list = rows.map((r, i) => `<div class="rg-row rg-static rg-site rg-garage" data-garage="${esc(r.garage)}"><span class="rg-txt">
        <b>${r.missing ? `<i class="rg-dot todo" aria-hidden="true"></i>` : ""}${esc(r.garage)}</b>${r.count ? `<small>${esc(plural(r.count, "demande"))}</small>` : ""}
        <span class="rg-form-line"><select data-garage-prov="${i}" aria-label="Prestataire de ${esc(r.garage)}" ${w ? "" : "disabled"}>${pickOptions(state.providers, r.guessProvider, "Prestataire ?")}</select>
        <select data-garage-site="${i}" aria-label="Site de ${esc(r.garage)}" ${w ? "" : "disabled"}>${pickOptions(siteNames(), r.guessSite, "Site ?")}</select></span></span>
        ${w && r.saved ? rgRemove("remove-garage", r.garage, r.garage) : ""}</div>`).join("");
    return `<div class="rg-sheet">
      ${rgSection(plural(rows.length, "garage"), `<div id="s-garages">${list || `<p class="rg-empty">Aucun garage reçu par mail pour l'instant.</p>`}</div>`)}
      ${rgForm(`<input id="g-new" placeholder="Nom du garage, comme dans le mail" aria-label="Nom du garage" autocomplete="off">
        <div class="rg-form-line"><select id="g-prov" aria-label="Prestataire">${pickOptions(state.providers, "", "Prestataire ?")}</select><select id="g-site" aria-label="Site">${pickOptions(siteNames(), "", "Site ?")}</select></div>
        ${rgAddBtn("g-add", "add-garage")}`)}</div>`;
  }
  async function saveGarage(garage, prestataire, site, message) {
    if (!requireStore()) return;
    const key = D.providerId(garage);
    const next = state.garages.filter((g) => D.providerId(g.garage) !== key).concat([{ garage, prestataire, site }]);
    try { await state.store.saveGarages(next); toast(message); } catch (err) { reportWriteError(err); }
  }

  // ----- feuilles -----
  const rgForm = (inner) => (state.canWrite ? `<div class="rg-form">${inner}</div>` : "");
  const rgAddBtn = (id, act, label = "Ajouter") => `<button type="button" class="rg-btn primary" id="${id}" data-rg-act="${act}">${icon("plus")}${label}</button>`;
  const roleShort = (role) => D.roleOf(role)?.label.split(" (")[0] || role;
  function provSheet(p) {
    const i = state.providers.indexOf(p);
    if (i < 0) return null;
    const w = state.canWrite, id = D.providerId(p), offers = provOffers(p);
    const doc = state.providerDocs.get(id);
    const flags = RG_FLAGS.map((f) => `<label class="rg-row rg-switchrow">${rgIco(f.art, "sm")}<span class="rg-txt"><b>${f.label}</b><small>${esc(f.sub)}</small></span>
        <input type="checkbox" role="switch" class="rg-switch" data-prov-flag="${f.flag}" data-prov="${esc(p)}" ${D.offers(doc, f.flag, p) ? "checked" : ""} ${w ? "" : "disabled"} aria-label="${esc(p)} : ${f.label}"></label>`).join("");
    const lines = pricesOf(id);
    const priceRows = lines.length
      ? lines.map((line, n) => `<div class="rg-row rg-static rg-price"><span class="rg-txt"><b>${esc(D.priceLineLabel(line))}</b><small>${esc(D.euros(D.withVat(+line.prixHT)))} TTC</small></span>
          <span class="rg-amount">${esc(D.euros(+line.prixHT))} <small>HT</small></span>${w ? rgRemove("remove-price", n, D.priceLineLabel(line)) : ""}</div>`).join("")
      : `<p class="rg-empty">Aucun tarif : ses demandes n'auront pas de montant.</p>`;
    const offered = new Set(offers.map((f) => f.service));
    const kinds = priceKinds().filter(([, line]) => !offered.size || offered.has(line.service));
    const accounts = accountsOf(p);
    const accRows = accounts.length
      ? accounts.map((a) => { const st = D.alertStatus(state.alertDevices, a.id); return `<div class="rg-row rg-static"><span class="rg-txt"><b class="rg-mail">${esc(a.id)}</b>${st ? `<small class="rg-sub-st"><i class="rg-dot ${RG_TONE[st.level]}" aria-hidden="true"></i>${esc(st.text)}</small>` : ""}</span>${w ? rgRemove("remove-account", a.id, a.id) : ""}</div>`; }).join("")
      : `<p class="rg-empty">Personne de chez ${esc(p)} n'a encore d'accès à l'appli.</p>`;
    const st = D.providerAlertStatus(state.alertDevices, state.accounts, id);
    return ["Prestataire", `<div class="rg-sheet">
      <div class="rg-hero">${rgIco(offers[0]?.art || "svc-intervention", "lg")}<div><b>${esc(p)}</b><small>${i === 0 ? "Choisi par défaut dans une nouvelle demande" : "Prestataire"}</small>${st ? `<small class="rg-sub-st"><i class="rg-dot ${RG_TONE[st.level]}" aria-hidden="true"></i>${esc(st.level === "on" ? "Reçoit les alertes" : st.level === "nobody" ? "Aucun compte dans l'appli" : st.level === "stale" ? "Alertes à vérifier" : "Alertes pas activées")}</small>` : ""}</div></div>
      ${rgSection("Ce qu'il fait", flags, "Une prestation décochée ne peut jamais lui être envoyée.")}
      ${rgSection("Tarifs hors taxe", `<div id="t-list">${priceRows}</div>`, "Le prix est figé sur chaque demande quand elle est enregistrée : changer un tarif ne modifie pas les demandes déjà faites. Cubage vide = toutes tailles.")}
      ${rgForm(`<select id="t-svc" aria-label="Prestation">${kinds.map(([value, line]) => `<option value="${value}">${esc(D.jobLabel(line))}</option>`).join("")}</select>
        <div class="rg-form-line"><input id="t-min" type="number" min="0" inputmode="numeric" placeholder="de m³" aria-label="Cubage minimum"><input id="t-max" type="number" min="0" inputmode="numeric" placeholder="à m³" aria-label="Cubage maximum"><input id="t-prix" inputmode="decimal" placeholder="€ HT" aria-label="Prix hors taxe"></div>
        ${rgAddBtn("t-add", "add-price", "Ajouter le tarif")}`)}
      ${rgSection("Comptes", accRows, "Crée d'abord son compte dans Firebase (Authentication), puis ajoute son adresse ici. Un prestataire ne voit que ses demandes.")}
      ${rgForm(`<input id="pa-email" type="email" placeholder="adresse e-mail" aria-label="Adresse e-mail du compte">${rgAddBtn("pa-add", "add-prov-account", "Ajouter le compte")}`)}
      ${w ? rgSection("", (i > 0 ? `<button type="button" class="rg-row rg-action" data-rg-act="make-default"><span class="rg-txt"><b>Choisir par défaut</b><small>Le mettre en premier dans la liste</small></span></button>` : "")
        + `<button type="button" class="rg-row rg-action rg-danger ${rg.armed === "prov" ? "armed" : ""}" data-rg-act="remove-provider"><span class="rg-txt"><b>${rg.armed === "prov" ? "Toucher encore pour retirer" : "Retirer ce prestataire"}</b><small>Ses demandes et ses comptes restent</small></span></button>`) : ""}
    </div>`];
  }
  function rgSheet(key) {
    const w = state.canWrite;
    if (key.startsWith("prov:")) return provSheet(key.slice(5));
    if (key === "prov-new") return ["Nouveau prestataire", `<div class="rg-sheet">
      <p class="rg-intro">Ajoute-le ici, puis coche ce qu'il fait et ses tarifs dans sa fiche. Il reçoit les lavages par défaut.</p>
      <div class="rg-form"><input id="s-newprov" placeholder="Nom du prestataire" aria-label="Nom du prestataire" autocomplete="off">${rgAddBtn("s-addprov", "add-provider")}</div></div>`];
    if (key === "sites") return ["Sites et adresses", `<div class="rg-sheet">
      <p class="rg-intro">L'adresse se remplit toute seule dans la demande quand on choisit le site.</p>
      ${rgSection(plural(state.sites.length, "site"), `<div id="s-sites">${state.sites.map((s, i) => `<div class="rg-row rg-static rg-site"><span class="rg-txt"><b>${esc(s.nom)}</b>
        <input data-site-address="${i}" value="${esc(s.adresse)}" placeholder="Adresse du site" aria-label="Adresse de ${esc(s.nom)}" ${w ? "" : "disabled"}></span>${w ? rgRemove("remove-site", i, s.nom) : ""}</div>`).join("") || `<p class="rg-empty">Aucun site.</p>`}</div>`)}
      ${rgForm(`<input id="s-newsite" placeholder="Nom du nouveau site" aria-label="Nom du nouveau site">${rgAddBtn("s-addsite", "add-site")}`)}
      ${w ? `<details class="rg-more" id="s-pastebox"><summary>${icon("list")}Coller une liste</summary>
        <p class="rg-foot">Copie les deux colonnes (nom, adresse) depuis ton tableau et colle-les ici. Les sites déjà présents gardent leur nom, leur adresse est mise à jour.</p>
        <textarea id="s-paste" rows="6" placeholder="Paris - Centre&#9;Parking Indigo, 75007 Paris" aria-label="Liste des sites à coller"></textarea>
        <button type="button" class="rg-btn primary" id="s-importsites" data-rg-act="import-sites">Importer</button></details>` : ""}</div>`];
    if (key === "garages") return ["Garages des mails", garagesSheet()];
    if (key === "fleet") return ["Flotte", `<div class="rg-sheet">
      <p class="rg-intro">Modèles proposés dans la demande. Choisir un modèle remplit le cubage.</p>
      ${rgSection(plural(state.fleet.length, "modèle"), `<div id="s-fleet">${state.fleet.map((f, i) => `<div class="rg-row rg-static"><span class="rg-txt"><b>${esc(f.modele)}</b></span>${f.cubage ? rgVal("", f.cubage + " m³") : ""}${w ? rgRemove("remove-model", i, D.fleetLabel(f)) : ""}</div>`).join("") || `<p class="rg-empty">Aucun modèle.</p>`}</div>`)}
      ${rgForm(`<div class="rg-form-line"><input id="s-newmodel" placeholder="Modèle, ex. Opel Movano 2025" aria-label="Modèle"><input id="s-newcub" type="number" min="1" inputmode="numeric" placeholder="m³" aria-label="Cubage en m³" class="rg-narrow"></div>${rgAddBtn("s-addmodel", "add-model")}`)}</div>`];
    if (key === "accounts") {
      const sorted = state.accounts.slice().sort((a, b) => a.id.localeCompare(b.id));
      const groups = D.ROLES.map((r) => [r, sorted.filter((a) => a.role === r.id)]).filter(([, list]) => list.length);
      const others = sorted.filter((a) => !D.roleOf(a.role));
      if (others.length) groups.push([{ id: "", label: "Autres" }, others]);
      const me = D.emailKey(state.userEmail);
      const row = (a) => { const st = ["prestataire", "admin"].includes(a.role) ? D.alertStatus(state.alertDevices, a.id) : null;
        return `<div class="rg-row rg-static"><span class="rg-txt"><b class="rg-mail">${esc(a.id)}${a.id === me ? ` <span class="rg-tag">Toi</span>` : ""}</b>
          <small class="rg-sub-st">${a.role === "prestataire" ? `${esc(providerName(a.prestataireId))}${st ? " · " : ""}` : ""}${st ? `<i class="rg-dot ${RG_TONE[st.level]}" aria-hidden="true"></i><span class="alert-chip" title="${esc(st.title)}">${esc(st.text)}</span>` : ""}</small></span>
          ${w && a.id !== me ? rgRemove("remove-account", a.id, a.id) : ""}</div>`; };
      return ["Accès à l'appli", `<div class="rg-sheet">
        <p class="rg-intro">Chaque personne se connecte avec sa propre adresse. Un prestataire ne voit que ses demandes ; l'équipe City-Drop voit tout ; « lecture » voit tout sans rien modifier.</p>
        <div id="a-list">${groups.map(([r, list]) => rgSection(esc(roleShort(r.id) || r.label) + ` <em>${list.length}</em>`, list.map(row).join(""))).join("") || `<p class="rg-empty">Aucun accès enregistré pour l'instant.</p>`}</div>
        ${w ? `<section class="rg-group"><h2 class="rg-gh">Ajouter un accès</h2><div class="rg-form">
          <input id="a-email" type="email" placeholder="adresse e-mail" aria-label="Adresse e-mail">
          <div class="rg-form-line"><select id="a-role" aria-label="Rôle">${D.ROLES.map((r) => `<option value="${r.id}">${esc(roleShort(r.id))}</option>`).join("")}</select>
          <select id="a-prov" aria-label="Prestataire du compte" disabled>${options(state.providers)}</select></div>
          ${rgAddBtn("a-add", "add-account")}</div>
          <p class="rg-foot">Crée d'abord son compte dans Firebase (Authentication), puis ajoute son adresse ici.</p></section>` : ""}</div>`];
    }
    if (key === "alerts") {
      const counts = alertCounts();
      const rows = state.providers.map((p) => { const st = D.providerAlertStatus(state.alertDevices, state.accounts, D.providerId(p));
        return st ? `<div class="rg-row rg-static"><span class="rg-txt"><b>${esc(p)}</b></span>${rgVal(RG_TONE[st.level], ALERT_SHORT[st.level])}</div>` : ""; }).join("");
      return ["Alertes sur les téléphones", `<div class="rg-sheet">
        <div class="rg-hero">${rgIco("rg-bell", "lg")}<div><b>${counts ? `${counts.provOn} prestataire${counts.provOn > 1 ? "s" : ""} sur ${counts.provAll}` : "Alertes appli fermée"}</b><small id="al-status" role="status">${esc(rgAlertStatus())}</small></div></div>
        ${counts ? `<p class="rg-note" id="al-who"><span id="al-who-text">${alertSummaryText(counts)}</span></p>` : ""}
        ${rows ? rgSection("Par prestataire", rows) : ""}
        <section class="rg-group"><h2 class="rg-gh">Script Google des alertes</h2>
          <p class="rg-foot">Les prestataires sont prévenus d'une nouvelle demande, et l'équipe d'un retour, même appli fermée. Le script s'installe une fois (mode d'emploi : <a href="https://github.com/fabianCITYDROP/suivi-prestations/blob/main/apps-script/LISEZMOI.md#alertes-appli-fermée" target="_blank" rel="noopener">LISEZMOI</a>), puis on colle ici son adresse.</p>
          ${rgForm(`<input id="al-url" placeholder="https://script.google.com/macros/s/…/exec" aria-label="Adresse du script des alertes" value="${esc(state.alerts?.settings?.url || "")}"><button type="button" class="rg-btn primary" id="al-save" data-rg-act="save-alerts">Enregistrer</button>`)}</section></div>`];
    }
    if (key === "robot") {
      const health = D.robotHealth(state.robot);
      return ["Robot des mails", `<div class="rg-sheet">
        <div class="rg-status ${RG_TONE[health.level]}">${rgIco("rg-mail", "lg")}<div><b><i class="rg-dot ${RG_TONE[health.level]}" aria-hidden="true"></i>${esc(ROBOT_SHORT[health.level])}</b><span class="robot-state ${health.level}">${esc(health.text)}</span></div></div>
        <section class="rg-group"><h2 class="rg-gh">Comment ça marche</h2><div class="rg-card"><p>Le robot ajoute tout seul les demandes reçues par mail. S'il s'arrête (mot de passe changé, blocage Google), un bandeau rouge s'affiche en haut de l'appli et le robot envoie un mail d'alerte quand il le peut.</p></div></section>
        <section class="rg-group"><h2 class="rg-gh">Pour le remettre en route</h2><ol class="rg-steps">
          <li>Ouvrir le script Apps Script de la boîte du robot, puis <b>Exécutions</b> pour voir l'erreur.</li>
          <li>Corriger : souvent <b>ROBOT_MOT_DE_PASSE</b> dans les Propriétés du script.</li>
          <li>Relancer <b>installer</b>.</li></ol></section></div>`];
    }
    if (key === "gsheet") return ["Google Sheet pare-brise", `<div class="rg-sheet">
      <div class="rg-hero">${rgIco("rg-sheet", "lg")}<div><b>${state.sheetUrl ? "Branché" : "Pas encore branché"}</b><small>Un bouton « Cocher dans le Google Sheet » coche la colonne « OK confirmé » des plaques confirmées.</small></div></div>
      <section class="rg-group"><h2 class="rg-gh">À installer une seule fois</h2><ol class="rg-steps">
        <li>Dans ton Google Sheet pare-brise : <b>Extensions › Apps Script</b>.</li>
        <li>Remplace tout le code par le script ci-dessous, puis enregistre.</li>
        <li>Ajuste si besoin les 3 réglages en haut du script.</li>
        <li><b>Déployer › Nouveau déploiement</b>, Application Web, exécuter en tant que <b>Moi</b>, accès <b>city-drop.com</b>.</li>
        <li>Colle ici l'URL qui finit par /exec.</li></ol></section>
      ${rgForm(`<input id="s-sheeturl" placeholder="https://script.google.com/macros/s/…/exec" aria-label="URL du script du Google Sheet" value="${esc(state.sheetUrl)}"><button type="button" class="rg-btn primary" id="s-savesheet" data-rg-act="save-sheet">Enregistrer l'URL</button>`)}
      <details class="rg-more"><summary>${icon("list")}Voir le script</summary>
        <button type="button" class="rg-btn" id="s-copyscript" data-rg-act="copy-script">${icon("copy")}Copier le script</button>
        <pre class="code" id="s-script">${esc(SHEET_SCRIPT)}</pre></details></div>`];
    if (key === "logout") return ["Se déconnecter", `<div class="rg-sheet">
      <p class="rg-intro">Tu seras déconnecté de cet appareil${state.userEmail ? ` (${esc(state.userEmail)})` : ""}. Pour revenir, il faudra ton adresse et ton mot de passe.</p>
      <button type="button" class="rg-btn danger big" data-rg-act="logout">Se déconnecter</button>
      <button type="button" class="rg-btn big" data-team-sheet-close>Annuler</button></div>`];
    return null;
  }
  const rgSheetOpen = () => teamSheet.isOpen && !!document.querySelector(".team-sheet.rg-sheet-b");
  function openRg(key) {
    rg.armed = "";
    const s = rgSheet(key);
    if (!s) return;
    rg.open = key;
    teamSheet.open(s[0], s[1], { cls: "rg-sheet-b side-sheet", closed: () => { rg.open = null; rg.armed = ""; } });
    if (key === "prov-new") setTimeout(() => $("#s-newprov")?.focus(), 380);
  }
  // Un nouvel instantané de la base redessine la feuille ouverte, sans perdre ce qui est en train d'être saisi.
  function refreshRgSheet() {
    if (!rg.open || !rgSheetOpen()) return;
    const body = teamSheet.body;
    if (body.contains(document.activeElement) && document.activeElement.matches("input, textarea, select")) return;
    const s = rgSheet(rg.open);
    if (!s) return teamSheet.close();
    const kept = [...body.querySelectorAll("input[id], select[id], textarea[id]")].map((el) => [el.id, el.value]);
    const opened = [...body.querySelectorAll("details[id]")].filter((d) => d.open).map((d) => d.id);
    teamSheet.setTitle(s[0]); body.innerHTML = s[1];
    kept.forEach(([id, value]) => { const el = body.querySelector("#" + id); if (el && value && el.value !== value && !el.disabled) el.value = value; });
    opened.forEach((id) => { const d = body.querySelector("#" + id); if (d) d.open = true; });
    syncAccountRole();
  }
  const syncAccountRole = () => { const role = $("#a-role"); if (role && $("#a-prov")) $("#a-prov").disabled = role.value !== "prestataire"; };
  const rgValue = (sel) => ($(sel)?.value || "").trim();
  const undoable = (text, undo) => toast(text, { label: "Annuler", run: undo });

  // ----- prices (HT), per provider: the provider is the one whose sheet is open -----
  const pricesProvider = () => (rg.open?.startsWith("prov:") ? rg.open.slice(5) : defaultProvider());
  // One choice per price kind: windshield, complete wash, inside wash, intervention.
  const priceKinds = () => D.SERVICES.flatMap((x) => (x.id === "lavage" ? D.WASH_KINDS.map((k) => ({ service: x.id, formule: k.id })) : [{ service: x.id }]))
    .map((line) => [[line.service, line.formule].filter(Boolean).join(":"), line]);
  async function savePrices(providerName, tarifs, message, undo) {
    if (!requireStore()) return;
    try { await state.store.saveProvider(D.providerId(providerName), { nom: providerName, tarifs }); undo ? undoable(message, undo) : toast(message); }
    catch (err) { reportWriteError(err); }
  }
  // One click fills the prices agreed with Allo and the washers (see D.KNOWN_PRICES); lines already there are kept.
  async function fillKnownPrices() {
    if (!requireStore()) return;
    const missing = D.missingKnownPrices(state.providers, pricesOf);
    try {
      for (const m of missing) await state.store.saveProvider(D.providerId(m.name), { nom: m.name, tarifs: [...pricesOf(D.providerId(m.name)), ...m.add] });
      toast(`${plural(missing.reduce((n, m) => n + m.add.length, 0), "tarif")} ajouté(s)`);
    } catch (err) { reportWriteError(err); }
  }
  function addPrice() {
    const prix = parseFloat(rgValue("#t-prix").replace(",", "."));
    if (!Number.isFinite(prix) || prix < 0) return toast("Indique le prix hors taxe, par exemple 266,67");
    const bound = (sel) => (rgValue(sel) === "" ? null : +rgValue(sel));
    const kind = priceKinds().find(([value]) => value === $("#t-svc").value)?.[1];
    if (!kind) return;
    const line = { ...kind, cubageMin: bound("#t-min"), cubageMax: bound("#t-max"), prixHT: Math.round(prix * 100) / 100 };
    if (line.cubageMin != null && line.cubageMax != null && line.cubageMin > line.cubageMax) return toast("Le cubage « de » doit être plus petit que « à »");
    const name = pricesProvider();
    ["#t-min", "#t-max", "#t-prix"].forEach((sel) => ($(sel).value = ""));
    savePrices(name, [...pricesOf(D.providerId(name)), line], "Tarif ajouté");
  }

  // ----- who can open the app -----
  const providerName = (id) => state.providers.find((p) => D.providerId(p) === id) || state.providerDocs.get(id)?.nom || id || "";
  const ownAccountMissing = () => !!state.userEmail && !state.accounts.some((a) => a.id === D.emailKey(state.userEmail));
  async function addAccount(email, role, provider) {
    email = D.emailKey(email);
    if (!D.isEmail(email)) return toast("Adresse e-mail invalide"), false;
    const fields = role === "prestataire" ? { role, prestataireId: D.providerId(provider) } : { role };
    if (role === "prestataire" && !fields.prestataireId) return toast("Choisis le prestataire de ce compte"), false;
    if (!requireStore()) return false;
    try {
      if (role === "prestataire") await state.store.saveProvider(fields.prestataireId, { nom: provider });
      await state.store.saveAccount(email, fields);
      toast("Accès enregistré"); return true;
    } catch (err) { reportWriteError(err); return false; }
  }
  async function prepareAccess() {
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
  }
  // A removed site, model or price comes back with « Annuler » in the bubble.
  // state.sites / state.fleet are replaced by each new snapshot: always splice the current list.
  function removeWithUndo(key, index, text) {
    const [item] = state[key].splice(index, 1);
    renderAll(); persistSettings();
    undoable(text, () => { const list = state[key]; list.splice(Math.min(index, list.length), 0, item); renderAll(); persistSettings("Remis"); });
  }
  async function rgAct(act, b) {
    if (act === "logout") { const out = $("#signOutBtn"); if (out) { out.classList.add("armed"); out.click(); } return; }
    if (act === "copy-script") { if (await copyText(SHEET_SCRIPT)) toast("Script copié"); return; }
    if (!state.canWrite) return toast("Accès en lecture : tu ne peux rien modifier ici");
    if (act === "known-prices") return fillKnownPrices();
    if (act === "prepare") return prepareAccess();
    if (act === "add-price") return addPrice();
    if (act === "remove-price") {
      const name = pricesProvider(), lines = pricesOf(D.providerId(name)), n = +b.dataset.i;
      return savePrices(name, lines.filter((_, i) => i !== n), "Tarif retiré", () => savePrices(name, lines, "Tarif remis"));
    }
    if (act === "add-prov-account") { if (await addAccount(rgValue("#pa-email"), "prestataire", pricesProvider()) && $("#pa-email")) { $("#pa-email").value = ""; refreshRgSheet(); } return; }
    if (act === "add-account") { if (await addAccount(rgValue("#a-email"), $("#a-role").value, $("#a-prov").value) && $("#a-email")) { $("#a-email").value = ""; refreshRgSheet(); } return; }
    if (act === "remove-account") {
      if (b.dataset.i === D.emailKey(state.userEmail)) return toast("Tu ne peux pas retirer ton propre accès");
      return requireStore() && state.store.deleteAccount(b.dataset.i).then(() => toast("Accès retiré"), reportWriteError);
    }
    if (act === "add-provider") {
      const name = rgValue("#s-newprov");
      if (!name) return toast("Indique le nom du prestataire");
      if (state.providers.includes(name)) return toast(`${name} est déjà dans la liste`);
      state.providers.push(name); renderAll(); persistSettings("Prestataire ajouté");
      return openRg("prov:" + name);
    }
    if (act === "make-default") {
      const name = pricesProvider(), i = state.providers.indexOf(name);
      if (i > 0) { state.providers.splice(i, 1); state.providers.unshift(name); renderAll(); persistSettings(`${name} est choisi par défaut`); }
      return;
    }
    if (act === "remove-provider") {
      if (rg.armed !== "prov") { rg.armed = "prov"; refreshRgSheet(); setTimeout(() => { if (rg.armed === "prov") { rg.armed = ""; refreshRgSheet(); } }, 4000); return; }
      const name = pricesProvider(), i = state.providers.indexOf(name);
      rg.armed = ""; teamSheet.close();
      if (i >= 0) { state.providers.splice(i, 1); renderAll(); persistSettings(`${name} retiré de la liste`); }
      return;
    }
    if (act === "add-site") {
      const nom = rgValue("#s-newsite");
      if (!nom) return toast("Indique le nom du site");
      if (siteNames().includes(nom)) return toast(`${nom} est déjà dans la liste`);
      $("#s-newsite").value = ""; state.sites.push({ nom, adresse: "" }); renderAll(); persistSettings("Site ajouté");
      return setTimeout(() => teamSheet.body.querySelector(`[data-site-address="${state.sites.length - 1}"]`)?.focus(), 50);
    }
    if (act === "add-garage") {
      const garage = rgValue("#g-new");
      if (!garage) return toast("Indique le nom du garage, comme dans le mail");
      if (!$("#g-prov").value || !$("#g-site").value) return toast("Choisis le prestataire et le site");
      await saveGarage(garage, $("#g-prov").value, $("#g-site").value, "Garage ajouté");
      if ($("#g-new")) $("#g-new").value = "";
      return refreshRgSheet();
    }
    if (act === "remove-garage") {
      const before = state.garages.slice(), key = D.providerId(b.dataset.i);
      if (!requireStore()) return;
      try { await state.store.saveGarages(before.filter((g) => D.providerId(g.garage) !== key)); undoable("Garage retiré", () => state.store.saveGarages(before)); }
      catch (err) { reportWriteError(err); }
      return;
    }
    if (act === "remove-site") return removeWithUndo("sites", +b.dataset.i, "Site retiré");
    if (act === "import-sites") {
      const incoming = D.parseSiteList($("#s-paste").value);
      if (!incoming.length) return toast("Aucun site reconnu : colle le nom puis l'adresse de chaque site");
      const { sites, added, updated } = D.mergeSites(state.sites, incoming);
      state.sites = sites; $("#s-paste").value = ""; $("#s-pastebox").open = false; renderAll();
      return persistSettings(added || updated ? `${plural(added, "site")} ajouté${added > 1 ? "s" : ""}, ${updated} mis à jour` : "Tous ces sites étaient déjà à jour");
    }
    if (act === "add-model") {
      const modele = rgValue("#s-newmodel");
      if (!modele) return toast("Indique le modèle");
      const cubage = +rgValue("#s-newcub") || null;
      $("#s-newmodel").value = ""; $("#s-newcub").value = "";
      state.fleet.push({ modele, cubage }); renderAll(); return persistSettings("Modèle ajouté");
    }
    if (act === "remove-model") return removeWithUndo("fleet", +b.dataset.i, "Modèle retiré");
    if (act === "save-sheet") {
      const url = rgValue("#s-sheeturl");
      if (url && !/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) return toast("L'URL doit commencer par https://script.google.com/ et finir par /exec");
      state.sheetUrl = url; persistSettings(url ? "URL enregistrée" : "Liaison retirée"); return renderAll();
    }
    if (act === "save-alerts") return saveAlertScript();
  }
  const inRg = (el) => el.closest("#view-reglages, .team-sheet.rg-sheet-b");
  document.addEventListener("click", (e) => {
    if (!inRg(e.target)) return;
    const o = e.target.closest("[data-rg-open]");
    if (o) return openRg(o.dataset.rgOpen);
    const b = e.target.closest("[data-rg-act]");
    if (b && !b.disabled) { releaseTyping(); rgAct(b.dataset.rgAct, b); }
  });
  // La feuille ne se redessine pas tant qu'on tape dans un de ses champs (pour ne rien effacer).
  // Après « Ajouter » (clic, ou Entrée, ou Safari qui laisse le curseur dans le champ), on quitte d'abord le champ :
  // sinon le nouveau site / modèle / garage était bien enregistré mais n'apparaissait qu'en rouvrant la feuille.
  function releaseTyping() {
    const el = document.activeElement;
    if (el && el.matches("input, textarea, select") && teamSheet.body?.contains(el)) el.blur();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !inRg(e.target) || !e.target.matches("input:not([type=checkbox])")) return;
    const btn = e.target.closest(".rg-form")?.querySelector("[data-rg-act]");
    if (btn) { e.preventDefault(); btn.click(); }
  });
  document.addEventListener("change", async (e) => {
    if (!inRg(e.target)) return;
    if (e.target.id === "a-role") return syncAccountRole();
    const garageRow = e.target.closest("[data-garage]");
    if (garageRow && e.target.matches("select")) {
      if (!state.canWrite) return;
      const prov = garageRow.querySelector("[data-garage-prov]").value, site = garageRow.querySelector("[data-garage-site]").value;
      return saveGarage(garageRow.dataset.garage, prov, site, prov && site ? `${garageRow.dataset.garage} : ${prov}, ${site}` : "Enregistré");
    }
    const box = e.target.closest("[data-prov-flag]");
    if (box) {
      if (!requireStore()) return;
      const nom = box.dataset.prov, flag = box.dataset.provFlag;
      const what = { hayon: "des contrôles hayon", pareBrise: "des pare-brise", lavage: "des lavages" }[flag] || "des interventions";
      try { await state.store.saveProvider(D.providerId(nom), { nom, [flag]: box.checked }); toast(box.checked ? `${nom} peut recevoir ${what}` : `${nom} ne reçoit plus ${what.replace(/^des /, "de ")}`); }
      catch (err) { box.checked = !box.checked; reportWriteError(err); }
      return;
    }
    const address = e.target.closest("[data-site-address]");
    if (address && state.sites[+address.dataset.siteAddress]) { state.sites[+address.dataset.siteAddress].adresse = address.value.trim(); persistSettings("Adresse enregistrée"); renderSettings(); }
  });
  // The red robot banner's « Que faire ? » opens the robot's sheet.
  $("#robotAlert a")?.addEventListener("click", (e) => { e.preventDefault(); show("reglages"); openRg("robot"); });

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
    const ctx = { demandes: state.demandes, vehicleOf, providerNames: state.providers, pricesOf, garages: state.garages, sites: state.sites };
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
  // Page « Contrôles hayon » façon iPhone (2026-11-21) : compteurs qui filtrent, véhicules groupés par ce qu'il faut faire
  // (à programmer, rendez-vous posés, à jour), jauge des jours restants, fiche du véhicule en feuille, liste à coller en feuille.
  const hy = { filter: "", open: null, removing: "" };
  const HY_GROUPS = [
    { id: "todo", title: "À programmer", sub: "Pas de rendez-vous et échéance dans 30 jours ou moins.", test: (r) => !r.booked && ["depasse", "urgent", "bientot", "inconnu"].includes(r.level) },
    { id: "rdv", title: "Rendez-vous posés", sub: "", test: (r) => !!r.booked },
    { id: "ok", title: "À jour", sub: "", test: (r) => !r.booked && r.level === "ok" },
  ];
  const HY_TILES = [
    { id: "red", label: "À faire vite", sub: "Dépassé ou 5 jours", lv: "urgent", test: (r) => ["depasse", "urgent"].includes(r.level) },
    { id: "orange", label: "Bientôt", sub: "30 jours ou moins", lv: "bientot", test: (r) => r.level === "bientot" },
    { id: "green", label: "À jour", sub: "Plus de 30 jours", lv: "ok", test: (r) => r.level === "ok" },
    { id: "rdv", label: "RDV posés", sub: "Contrôle à venir", lv: "rdv", test: (r) => !!r.booked },
  ];
  function hayonDaysLabel(r) {
    if (r.daysLeft == null) return "Date inconnue";
    if (r.daysLeft < 0) return `Dépassé de ${plural(-r.daysLeft, "jour")}`;
    if (r.daysLeft === 0) return "À faire aujourd'hui";
    return `Reste ${plural(r.daysLeft, "jour")}`;
  }
  const slotOf = (d) => `${D.shortDate(d.date)}${d.debut && d.debut !== D.DEFAULT_SLOT.debut ? " à " + d.debut.replace(":", "h") : ""}`;
  const hyArt = (key, size = "sm") => `<span class="svc-tile ${size}" aria-hidden="true">${self.IssueArt?.art(key, "svc-art") || ""}</span>`;
  // Jauge : la part des 180 jours qu'il reste (pleine et rouge une fois dépassé).
  const hyGauge = (r, big) => {
    const pct = r.daysLeft == null ? 0 : r.daysLeft < 0 ? 100 : Math.max(3, Math.min(100, Math.round((r.daysLeft / D.HAYON_CYCLE_DAYS) * 100)));
    return `<span class="hy-gauge${big ? " big" : ""}" role="img" aria-label="${esc(hayonDaysLabel(r))}"><i style="width:${pct}%"></i></span>`;
  };
  const hyPill = (r) => `<span class="hy-pill">${esc(hayonDaysLabel(r))}</span>`;
  const hyRowByKey = (key) => D.hayonFollowUp(state.hayons, state.demandes, today()).find((r) => D.plateKey(r.plaque) === key);
  function hayonCard(r) {
    const key = D.plateKey(r.plaque);
    const lines = [];
    if (r.booked) lines.push(`<span class="hy-rdv-line">${icon("cal")}RDV ${esc(slotOf(r.booked))}${r.booked.site ? ` · ${esc(r.booked.site)}` : ""}</span>`);
    if (r.tooSoon) lines.push(`<span class="hy-warn">${icon("alert")}Deux contrôles à ${plural(r.tooSoon.gap, "jour")} d'écart</span>`);
    if (r.notDone) lines.push(`<span class="hy-meta">Pas fait le ${esc(D.shortDate(r.notDone.date))}</span>`);
    return `<li class="hy-card lv-${r.level}"><button type="button" class="hy-open" data-hy-key="${esc(key)}">
      ${hyArt("svc-hayon")}
      <span class="hy-main">
        <span class="hy-line">${plateTag(r.plaque)}${hyPill(r)}</span>
        ${hyGauge(r)}
        <span class="hy-meta">${r.nextDue ? `À refaire avant le <b>${esc(D.numericDate(r.nextDue))}</b>` : "Date du dernier contrôle inconnue"}</span>
        ${lines.join("")}
      </span>
      <svg class="icon hy-chev" aria-hidden="true"><use href="#i-chev-r"/></svg></button></li>`;
  }
  function hayonSheetHtml(r) {
    const key = D.plateKey(r.plaque);
    const known = state.hayons.some((h) => D.plateKey(h.plaque) === key);
    const recent = r.lastRequest && D.daysBetween(r.lastRequest.date, today()) <= 30;
    const info = [
      ["Dernier contrôle", r.lastControl ? D.numericDate(r.lastControl) : "Inconnu", r.lastRequest ? `Rendez-vous du ${D.shortDate(r.lastRequest.date)}` : r.lastControl ? "Liste du prestataire" : ""],
      ["À refaire avant", r.nextDue ? D.numericDate(r.nextDue) : "—", ""],
      ["Rendez-vous", r.booked ? slotOf(r.booked) : "Aucun", r.booked?.site || ""],
      ...(r.site && !r.booked ? [["Site", r.site, ""]] : []),
    ];
    const notes = [];
    if (r.tooSoon) notes.push(`<p class="hy-sh-note warn">${icon("alert")}<span>Deux contrôles posés à ${plural(r.tooSoon.gap, "jour")} d'écart : le ${esc(D.shortDate(r.tooSoon.first.date))} et le ${esc(D.shortDate(r.tooSoon.second.date).replace(/\.$/, ""))}. L'un des deux est peut-être en trop.</span></p>`);
    if (r.notDone) notes.push(`<p class="hy-sh-note"><span>Le contrôle du ${esc(D.shortDate(r.notDone.date))} est marqué « pas fait » : le compteur reprend le contrôle d'avant.</span></p>`);
    const acts = [];
    if (r.booked) acts.push(`<button type="button" class="hy-btn primary" data-hy-act="open" data-id="${esc(r.booked.id)}">${icon("cal")}Voir le rendez-vous</button>`);
    else if (state.canWrite) acts.push(`<button type="button" class="hy-btn primary" data-hy-act="ask">${icon("plus")}Demander un contrôle</button>`);
    if (state.canWrite && recent) acts.push(`<button type="button" class="hy-btn" data-hy-act="notdone" data-id="${esc(r.lastRequest.id)}">Le contrôle du ${esc(D.shortDate(r.lastRequest.date))} n'a pas eu lieu</button>`);
    if (state.canWrite && r.notDone && !r.booked) acts.push(`<button type="button" class="hy-btn" data-hy-act="done" data-id="${esc(r.notDone.id)}">${icon("check")}Finalement fait</button>`);
    acts.push(`<button type="button" class="hy-btn" data-hy-act="history">Historique de la plaque</button>`);
    if (state.canWrite && known) acts.push(`<button type="button" class="hy-btn danger${hy.removing === key ? " confirm" : ""}" data-hy-act="remove">${icon("x")}${hy.removing === key ? "Retirer vraiment ?" : "Retirer de la liste des hayons"}</button>`);
    return `<div class="hy-sheet lv-${r.level}">
      <div class="hy-sh-hero">${hyArt("svc-hayon", "lg")}<div><p class="hy-sh-kind">DHOLLIANDA · tous les ${D.HAYON_CYCLE_DAYS} jours</p>${plateTag(r.plaque)}</div></div>
      <div class="hy-sh-gauge"><div class="hy-sh-days"><b>${r.daysLeft == null ? "?" : Math.abs(r.daysLeft)}</b><span>${r.daysLeft == null ? "date du dernier contrôle inconnue" : r.daysLeft < 0 ? `jour${-r.daysLeft > 1 ? "s" : ""} de retard` : `jour${r.daysLeft > 1 ? "s" : ""} restant${r.daysLeft > 1 ? "s" : ""} sur ${D.HAYON_CYCLE_DAYS}`}</span></div>${hyGauge(r, true)}</div>
      ${notes.join("")}
      <dl class="hy-sh-info">${info.map(([k, v, small]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}${small ? `<small>${esc(small)}</small>` : ""}</dd></div>`).join("")}</dl>
      <div class="hy-sh-acts">${acts.join("")}</div>
    </div>`;
  }
  function openHayonSheet(key) {
    const r = hyRowByKey(key);
    if (!r) return teamSheet.close();
    hy.open = key;
    teamSheet.open("Contrôle hayon", hayonSheetHtml(r), { cls: "hy-sheet-b side-sheet", closed: () => { hy.open = null; hy.removing = ""; } });
  }
  function refreshHayonSheet() {
    if (!teamSheet.isOpen || !hy.open) return;
    if (hy.open === "paste" || !teamSheet.body.querySelector(".hy-sheet")) return;
    const r = hyRowByKey(hy.open);
    r ? (teamSheet.body.innerHTML = hayonSheetHtml(r)) : teamSheet.close();
  }
  function renderHayon() {
    const rows = D.hayonFollowUp(state.hayons, state.demandes, today());
    const urgent = rows.filter((r) => !r.booked && ["depasse", "urgent"].includes(r.level)).length;
    $("#hayonBadge").hidden = !urgent; $("#hayonBadge").textContent = urgent;
    $("#hyKicker").textContent = rows.length ? `${plural(rows.length, "véhicule")} · DHOLLIANDA` : "DHOLLIANDA · tous les 180 jours";
    $("#hy-paste-open").hidden = !state.canWrite || !rows.length;
    $("#hy-kpis").innerHTML = rows.length ? HY_TILES.map((t) => {
      const n = rows.filter(t.test).length;
      return `<button type="button" class="hy-tile lv-${t.lv}" data-hy-filter="${t.id}" aria-pressed="${hy.filter === t.id}" ${n || hy.filter === t.id ? "" : "disabled"}>
        <b>${n}</b><span>${esc(t.label)}</span><small>${esc(t.sub)}</small></button>`;
    }).join("") : "";
    $("#hy-kpis").hidden = !rows.length; $(".hy-search").hidden = !rows.length;
    const tile = HY_TILES.find((t) => t.id === hy.filter);
    const query = $("#hy-q").value;
    const shown = rows.filter((r) => (!tile || tile.test(r)) && D.matchesSearch([r.plaque], query));
    let html;
    if (!rows.length) {
      html = `<div class="hy-empty">${hyArt("svc-hayon", "lg")}<b>Aucun véhicule à hayon pour l'instant</b><span>Colle la liste du prestataire (plaque et date du dernier contrôle) : le compteur des 180 jours démarre tout de suite. Chaque contrôle hayon reçu par mail s'ajoute aussi ici.</span>${state.canWrite ? `<button type="button" class="hy-btn primary" data-hy-paste>${icon("list")}Coller la liste</button>` : ""}</div>`;
    } else if (!shown.length) {
      html = `<div class="hy-empty small"><b>Aucun véhicule ne correspond</b>${tile ? `<button type="button" class="hy-link" data-hy-filter="${tile.id}">Voir tous les véhicules</button>` : ""}</div>`;
    } else {
      html = (tile ? `<div class="hy-filter-on"><span>Filtre : <b>${esc(tile.label)}</b></span><button type="button" class="hy-link" data-hy-filter="${tile.id}">Tout voir</button></div>` : "") +
        HY_GROUPS.map((g) => {
          const list = shown.filter(g.test);
          if (!list.length) return "";
          return `<section class="hy-group"><h2 class="hy-gh">${esc(g.title)} <em>${list.length}</em></h2>${g.sub && g.id === "todo" ? `<p class="hy-gsub">${esc(g.sub)}</p>` : ""}<ul class="hy-cards">${list.map(hayonCard).join("")}</ul></section>`;
        }).join("");
    }
    $("#hy-list").innerHTML = html;
    refreshHayonSheet();
  }
  $("#hy-q").addEventListener("input", renderHayon);
  // Liste du prestataire à coller : dans une feuille.
  function openHayonPaste() {
    hy.open = "paste";
    teamSheet.open("Coller la liste des hayons", `<div class="hy-paste">
      <p class="hy-gsub">Copie les colonnes « immatriculation » et « date du dernier contrôle » du tableau du prestataire, puis colle-les ici. Une plaque déjà connue prend la date collée.</p>
      <textarea id="hy-paste" placeholder="AB-123-CD&#9;12/05/2026&#10;EF-456-GH&#9;03/04/2026" aria-label="Liste des véhicules à hayon"></textarea>
      <p class="hy-preview" id="hy-preview" aria-live="polite"></p>
      <button type="button" class="hy-btn primary" id="hy-import">${icon("check")}Ajouter ces véhicules</button></div>`, { cls: "hy-sheet-b side-sheet", closed: () => (hy.open = null) });
    setTimeout(() => $("#hy-paste")?.focus(), 80);
  }
  $("#hy-paste-open").onclick = openHayonPaste;
  teamSheet.body.addEventListener("input", (e) => {
    if (e.target.id !== "hy-paste") return;
    const list = D.parseHayonList(e.target.value);
    const undated = list.filter((h) => !h.dernierControle).length;
    $("#hy-preview").textContent = list.length ? `${plural(list.length, "véhicule")} reconnu${list.length > 1 ? "s" : ""}${undated ? `, dont ${undated} sans date` : ""}` : "";
  });
  // Nouvelle demande déjà remplie : la plaque, le prestataire des hayons et « Contrôle hayon ».
  function newHayonFor(plaque) {
    newDemandeFor({ plaque });
    const prov = [...field("prest").options].find((o) => D.servicesFor(state.providerDocs.get(D.providerId(o.value)), o.value).includes("hayon"));
    if (prov) { field("prest").value = prov.value; field("prest").dispatchEvent(new Event("change", { bubbles: true })); }
    const svc = $("#svc-hayon");
    if (svc && !svc.closest("label").hidden) { svc.checked = true; svc.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  async function hayonAction(b) {
    const act = b.dataset.hyAct, key = hy.open, r = key && key !== "paste" ? hyRowByKey(key) : null;
    if (act === "open") { teamSheet.close(); return openDemande(b.dataset.id); }
    if (act === "ask" && r) { teamSheet.close(); return newHayonFor(r.plaque); }
    if (act === "history" && r) { teamSheet.close(); $("#q").value = r.plaque; show("historique"); return renderHistory(); }
    if ((act === "notdone" || act === "done") && requireStore()) {
      const missed = act === "notdone", d = demandeById(b.dataset.id);
      b.disabled = true;
      try {
        await state.store.markHayonNotDone(d, missed);
        toast(missed ? `Contrôle du ${D.shortDate(d.date)} marqué « pas fait »` : "Contrôle remis comme fait",
          { label: "Annuler", run: () => state.store.markHayonNotDone(d, !missed).catch(reportWriteError) });
      } catch (err) { reportWriteError(err); }
      finally { b.disabled = false; refreshHayonSheet(); }
      return;
    }
    if (act === "remove" && r && requireStore()) {
      if (hy.removing !== key) { hy.removing = key; return refreshHayonSheet(); }
      try { await state.store.deleteHayon(key); hy.removing = ""; teamSheet.close(); toast(`${r.plaque} retiré de la liste des hayons`); }
      catch (err) { reportWriteError(err); }
    }
  }
  teamSheet.body.addEventListener("click", async (e) => {
    if (!hy.open) return;
    if (e.target.closest("#hy-import")) {
      const list = D.parseHayonList($("#hy-paste").value);
      if (!list.length) return toast("Aucune plaque reconnue : colle une plaque et sa date par ligne");
      if (!requireStore()) return;
      try { await state.store.saveHayons(list); teamSheet.close(); toast(`${plural(list.length, "véhicule")} enregistré${list.length > 1 ? "s" : ""}`); }
      catch (err) { reportWriteError(err); }
      return;
    }
    const b = e.target.closest("[data-hy-act]");
    if (b) hayonAction(b);
  });
  $("#view-hayon").addEventListener("click", (e) => {
    const f = e.target.closest("[data-hy-filter]");
    if (f) { hy.filter = hy.filter === f.dataset.hyFilter ? "" : f.dataset.hyFilter; return renderHayon(); }
    if (e.target.closest("[data-hy-paste]")) return openHayonPaste();
    const o = e.target.closest("[data-hy-key]");
    if (o) openHayonSheet(o.dataset.hyKey);
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
    if ($("#al-status")) $("#al-status").textContent = rgAlertStatus();
    if (a?.settings?.url && $("#al-url") && !$("#al-url").value && document.activeElement !== $("#al-url")) $("#al-url").value = a.settings.url;
  }
  function rgAlertStatus() {
    const a = state.alerts;
    return !a || a.state === "off" ? (a?.settings?.url ? "" : "Pas encore branché : colle l'adresse du script.") : window.SuiviAlertes.TEXTS[a.state] || ALERT_TEAM_TEXTS[a.state] || "";
  }
  $("#notifBtn").onclick = () => {
    if (state.alerts && state.alerts.state !== "off") return state.alerts.activate().then(() => { if (state.alerts.state === "on") toast("Alertes activées : une alerte d'essai arrive"); });
    Notification.requestPermission().then((p) => { renderAnswers(); toast(p === "granted" ? "Notifications activées sur cet ordinateur" : "Notifications refusées par le navigateur"); });
  };
  async function saveAlertScript() {
    if (!requireStore()) return;
    const url = $("#al-url").value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return toast("L'adresse doit commencer par https://script.google.com/macros/s/ et finir par /exec");
    let cle = "";
    try { cle = (await (await fetch(url + "?action=cle", { cache: "no-store" })).json()).cle || ""; } catch {}
    if (!/^[\w-]{80,100}$/.test(cle)) return toast("Le script ne répond pas : vérifie qu'il est déployé en « Application Web », accès « Tout le monde »");
    try { await state.store.saveAlertSettings({ url, cle }); await state.alerts?.reload(); toast("Script des alertes branché"); renderAnswers(); renderSettings(); }
    catch (err) { reportWriteError(err); }
  }
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
    if ($("#s-robot")?.dataset.level !== health.level || rgSheetOpen()) renderSettings();
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
      onGarages: (list) => { state.garages = D.normalizeGarages(list); completeMailRequests(); renderSettings(); if (!$("#ndSites")?.closest("[hidden]")) renderChoiceTiles(); },
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
