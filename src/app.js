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
  };
  const today = () => D.toIsoDate(new Date());
  const siteNames = () => state.sites.map((s) => s.nom);
  const defaultProvider = () => state.providers[0] || "";

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
  function toast(text) {
    const el = $("#toast");
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3200);
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

  // One image holding every photo, each captioned with its plate and model, so photos never get mixed up.
  async function buildPhotoSheet(entries, type = "image/png") {
    const layout = D.collageLayout(entries.length);
    const canvas = document.createElement("canvas");
    canvas.width = layout.width; canvas.height = layout.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const images = await Promise.all(entries.map((e) => state.store.loadPhoto(e.key).then(loadImage)));
    layout.tiles.forEach((tile, i) => {
      const { plate, label } = entries[i];
      ctx.fillStyle = "#12212b"; ctx.fillRect(tile.x, tile.y, tile.width, tile.caption);
      ctx.fillStyle = "#ffffff"; ctx.font = "600 30px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle";
      ctx.fillText(plate, tile.x + 16, tile.y + tile.caption / 2);
      ctx.font = "500 22px 'IBM Plex Sans', sans-serif"; ctx.textAlign = "right";
      ctx.fillText(label, tile.x + tile.width - 16, tile.y + tile.caption / 2, tile.width * 0.55);
      ctx.textAlign = "left";
      drawCover(ctx, images[i], tile.x, tile.y + tile.caption, tile.width, tile.height);
    });
    return canvasToBlob(canvas, type, 0.85);
  }
  function drawCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  }
  const photoEntries = (plates) => plates.flatMap((plate) => {
    const vehicle = vehicleOf(plate);
    return (vehicle?.photos || []).map((p) => ({ key: p.key, plate: vehicle.plaque, label: D.vehicleLabel(vehicle) }));
  });

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
  const MAX_PHOTO_CHARS = 240000; // keeps each photo document under the 256 KiB store limit
  async function prepareImage(file) {
    for (const [side, quality] of [[1400, 0.72], [1000, 0.6], [800, 0.5]]) {
      const full = await shrinkImage(file, side, quality);
      if (full.length <= MAX_PHOTO_CHARS) return { full, thumb: await shrinkImage(file, 200, 0.6) };
    }
    throw new Error("too_big");
  }

  // ================= vehicles & photos =================
  const vehicleOf = (plate) => state.vehicles.get(D.plateKey(plate));
  const photosOf = (plate) => vehicleOf(plate)?.photos || [];
  const photoFileName = (plate, index) => `${D.plateKey(plate)}-pare-brise-${index + 1}.jpg`;

  let pendingPhotoPlate = null;
  function pickPhotosFor(plate) {
    if (!D.plateKey(plate)) return toast("Saisis d'abord la plaque du véhicule");
    pendingPhotoPlate = D.normalizePlate(plate);
    $("#photoInput").click();
  }
  async function addPhotoFiles(plate, files) {
    if (!requireStore() || !D.plateKey(plate)) return;
    let added = 0;
    for (const file of files) {
      try {
        await state.store.addPhoto(vehicleOf(plate), plate, await prepareImage(file));
        added++;
      } catch (err) {
        if (err instanceof Error) toast("Cette image n'a pas pu être lue");
        else { reportWriteError(err); break; }
      }
    }
    if (added) toast(`${plural(added, "photo")} ajoutée${added > 1 ? "s" : ""} à ${plate}`);
  }
  $("#photoInput").addEventListener("change", async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    if (pendingPhotoPlate && files.length) await addPhotoFiles(pendingPhotoPlate, files);
  });
  document.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (!file) return;
    if (!$("#view-demande").hidden) addPhotoFiles(D.normalizePlate($("#f-plaque").value), [file]);
    else if (!$("#view-photos").hidden && state.openVehicleKey) addPhotoFiles(state.vehicles.get(state.openVehicleKey).plaque, [file]);
  });

  // ================= share block (text + WhatsApp + photos) =================
  let shareCount = 0;
  const shareRegistry = new Map(); // block id -> plates whose photos it sends
  // Two buttons only: a WhatsApp link can carry text but never photos, so the text and the photo image are pasted one after the other.
  function shareBlock({ text, plates = [] }) {
    const id = "share-" + ++shareCount;
    const entries = photoEntries(plates);
    shareRegistry.set(id, plates);
    const copy = `<button type="button" class="primary big" data-copy="#${id}">${icon("copy")}Copier le texte</button>`;
    const photos = entries.length
      ? `<button type="button" class="primary big" data-copy-sheet="${id}">${icon("image")}${entries.length > 1 ? `Copier les ${entries.length} photos d'un coup` : "Copier la photo"}</button>`
      : "";
    return `<div class="share">
      <pre class="msg" id="${id}">${esc(text)}</pre>
      <div class="actions">${copy}${photos}</div>
      ${entries.length ? `<p class="small muted">Colle le texte (Ctrl+V), puis les photos (Ctrl+V). Chaque photo porte sa plaque.</p>
      <div class="photo-strip">${entries.map((e) => photoMini(e)).join("")}</div>` : ""}
    </div>`;
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
  const sheetName = () => `photos-pare-brise-${today()}.jpg`;
  // Capture phase: read the text before a re-render triggered by the same click replaces it.
  document.addEventListener("click", (e) => {
    const target = (sel) => e.target.closest(sel);
    let el;
    if ((el = target("[data-copy]"))) { copyText($(el.dataset.copy).textContent).then((ok) => ok && toast("Texte copié, prêt à coller")); return; }
    if ((el = target("[data-copy-sheet]"))) { const entries = photoEntries(shareRegistry.get(el.dataset.copySheet) || []); copyImage(() => buildPhotoSheet(entries), sheetName(), () => buildPhotoSheet(entries, "image/jpeg")); return; }
    if ((el = target("[data-save-sheet]"))) { saveBlob(buildPhotoSheet(photoEntries(shareRegistry.get(el.dataset.saveSheet) || []), "image/jpeg"), sheetName()); return; }
    if ((el = target("[data-copy-photo]"))) { const key = el.dataset.copyPhoto; copyImage(() => singlePhotoPng(key), el.dataset.name, () => singlePhotoJpeg(key)); return; }
    if ((el = target("[data-save-photo]"))) { saveBlob(singlePhotoJpeg(el.dataset.savePhoto), el.dataset.name); return; }
    if ((el = target("[data-zoom]"))) openLightbox(el.dataset.zoom, el.src);
  }, true);
  async function openLightbox(key, fallbackSrc) {
    $("#lightImg").src = fallbackSrc; $("#lightbox").hidden = false;
    const full = state.store ? await state.store.loadPhoto(key).catch(() => null) : null;
    if (full && !$("#lightbox").hidden) $("#lightImg").src = safeImageSrc(full);
  }
  $("#lightbox").onclick = () => ($("#lightbox").hidden = true);

  // ================= Google Sheet link =================
  function sheetLink(plates) {
    if (!/^https:\/\/script\.google\.com\//.test(state.sheetUrl) || !plates.length) return "";
    const href = state.sheetUrl + (state.sheetUrl.includes("?") ? "&" : "?") + "plaques=" + encodeURIComponent(plates.map(D.plateKey).join(","));
    return `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${icon("list")}Cocher dans le Google Sheet (${plates.length})</a>`;
  }

  // ================= navigation =================
  const VIEWS = ["planning", "demande", "photos", "verif", "bilan", "historique", "reglages"];
  function show(view) {
    if (!VIEWS.includes(view)) view = "planning";
    VIEWS.forEach((v) => { $("#view-" + v).hidden = v !== view; $("#tab-" + v).setAttribute("aria-selected", String(v === view)); });
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
  }
  document.querySelectorAll("nav.tabs button").forEach((tab) => tab.addEventListener("click", () => {
    if (tab.dataset.view === "demande" && !state.editingId) resetForm();
    show(tab.dataset.view);
  }));
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
    $("#provRow").hidden = state.providers.length < 2;
    document.querySelectorAll("#form .m-base").forEach((base) => {
      setSelectOptions(base, baseOptions());
      fillVariants(base, variantSelectOf(base));
    });
    setSelectOptions($("#f-site"), `<option value="">Choisir un site…</option>` + options(siteNames()));
    setSelectOptions($("#h-site"), `<option value="">Tous les sites</option>` + options(siteNames()));
  }
  $("#h-statut").innerHTML = `<option value="">Tous les statuts</option><option value="ouvert">En cours (hors réalisées / annulées)</option>` + D.STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  $("#h-svc").innerHTML = `<option value="">Toutes prestations</option>` + D.SERVICES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");
  $("#svcSeg").innerHTML = D.SERVICES.map((s, i) => `<label><input type="radio" name="svc" id="svc-${s.id}" value="${s.id}" ${i === 0 ? "checked" : ""}><span>${s.label}</span></label>`).join("");

  // ================= planning =================
  function renderPlanning() {
    const { day, providerFilter } = state;
    $("#dayTitle").textContent = (day === today() ? "Aujourd'hui · " : "") + D.dayLabel(day);
    $("#dayPick").value = day;
    renderWeekStrip();
    const ofDay = state.demandes.filter((d) => D.isAvailableOn(d, day) && (!providerFilter || d.prestataire === providerFilter));
    $("#dayList").innerHTML = ofDay.length
      ? D.groupBySite(ofDay, siteNames()).map(([site, items]) => siteBlockHtml(site, items)).join("")
      : `<div class="empty"><b>Aucun véhicule prévu ce jour-là.</b><span>Les véhicules disponibles ce jour apparaissent ici, classés par site, avec la liste prête à envoyer.</span></div>`;
    const active = ofDay.filter(D.isActive);
    $("#dayShare").innerHTML = active.length
      ? shareBlock({ text: D.dayListMessage(state.demandes, { date: day, provider: providerFilter, sites: state.sites }), provider: providerFilter || defaultProvider(), plates: active.filter(D.isWindshield).map((d) => d.plaque) })
      : `<p class="muted">Rien à envoyer pour ce jour.</p>`;
  }
  function renderWeekStrip() {
    const monday = D.mondayOf(state.day);
    $("#strip").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const iso = D.addDays(monday, i);
      const date = D.parseIsoDate(iso);
      const count = D.vehiclesOnDay(state.demandes, iso, state.providerFilter).length;
      return `<button data-day="${iso}" aria-current="${iso === state.day}" class="${iso === today() ? "today" : ""}"><small>${date.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</small><b>${date.getDate()}</b><span class="cnt">${count ? count + " véh." : ""}</span></button>`;
    }).join("");
  }
  function siteBlockHtml(site, items) {
    const address = D.siteAddress(state.sites, site);
    return `<section class="site-block"><div class="site-head"><h3>${esc(site)}</h3>${address ? `<span class="addr">${icon("pin")}${esc(address)}</span>` : ""}<span class="count">${plural(items.filter(D.isActive).length, "véhicule")}</span></div>
      ${items.map(vehicleRow).join("")}</section>`;
  }
  function vehicleRow(d) {
    const thumb = photosOf(d.plaque)[0]?.thumb;
    const sub = [d.adresse !== D.siteAddress(state.sites, d.site) ? d.adresse : "", D.isMultiDay(d) ? `dispo ${D.availabilityLabel(d)}` : "", d.notes].filter(Boolean).join(" · ");
    return `<button class="veh-row ${D.isActive(d) ? "" : "cancel"}" data-open="${esc(d.id)}">
      ${plateTag(d.plaque)}
      <span class="what"><span class="model">${esc(D.vehicleLabel(d) || "Modèle non précisé")}${D.isWindshield(d) ? "" : ` <span class="tag">${esc(D.serviceOf(d.service).label)}</span>`}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</span>
      <span class="right"><span class="time">${esc(D.timeSlotLabel(d))}</span>${statusChip(d.statut)}${thumb ? `<img class="thumb" src="${safeImageSrc(thumb)}" alt="">` : ""}</span>
    </button>`;
  }
  const goToDay = (day) => { state.day = day; renderPlanning(); };
  $("#strip").addEventListener("click", (e) => { const b = e.target.closest("[data-day]"); if (b) goToDay(b.dataset.day); });
  $("#prevDay").onclick = () => goToDay(D.addDays(state.day, -1));
  $("#nextDay").onclick = () => goToDay(D.addDays(state.day, 1));
  $("#todayBtn").onclick = () => goToDay(today());
  $("#dayPick").onchange = (e) => e.target.value && goToDay(e.target.value);
  $("#provFilter").onchange = (e) => {
    state.providerFilter = e.target.value;
    try { localStorage.setItem("suivi.provFilter", state.providerFilter); } catch {}
    renderPlanning();
  };
  $("#newOnDay").onclick = () => { resetForm(); setAvailability(state.day); renderFormSide(); show("demande"); };
  $("#dayList").addEventListener("click", (e) => { const row = e.target.closest("[data-open]"); if (row) openDemande(row.dataset.open); });

  // ================= request form =================
  const field = (name) => $("#f-" + name);
  function selectedFleetModel() {
    const index = field("modele").value;
    return index === "" ? { modele: "", cubage: null } : state.fleet[+index];
  }
  function readForm() {
    const model = selectedFleetModel();
    return {
      service: document.querySelector('input[name="svc"]:checked')?.value || "pare-brise",
      plaque: D.normalizePlate(field("plaque").value),
      modele: model.modele,
      cubage: model.cubage,
      site: field("site").value,
      adresse: field("adresse").value.trim(),
      date: field("date").value,
      dateFin: field("dateFin").value || field("date").value,
      debut: field("debut").value,
      fin: field("fin").value,
      prestataire: field("prest").value || defaultProvider(),
      notes: field("notes").value.trim(),
    };
  }
  // ----- model picker: brand + model first, then cubage (year shown only when the cubage is ambiguous) -----
  const baseOptions = () => `<option value="">Choisir le modèle…</option>` + options(D.fleetBases(state.fleet));
  const variantSelectOf = (base) => base.closest(".grid, .extra-veh").querySelector(".m-var");
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
    row.innerHTML = `<span class="num"></span>
      <label class="field"><span>Immatriculation</span><input class="x-plaque plate-input" placeholder="AB-123-CD" list="dl-plaques" value="${esc(v.plaque || "")}"></label>
      <label class="field"><span>Modèle</span><select class="x-base m-base">${baseOptions()}</select></label>
      <label class="field"><span>Cubage</span><select class="x-modele m-var"></select></label>
      <label class="field"><span>De</span><input type="time" class="x-debut" step="900" value="${esc(v.debut ?? field("debut").value)}"></label>
      <label class="field"><span>À</span><input type="time" class="x-fin" step="900" value="${esc(v.fin ?? field("fin").value)}"></label>
      <button type="button" class="ghost danger" data-remove-veh aria-label="Retirer ce véhicule">${icon("x")}</button>`;
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
      try { await state.store.deleteDemande(row.dataset.id); toast("Véhicule retiré de la demande"); }
      catch (err) { reportWriteError(err); return; }
    }
    row.remove(); renumberExtraRows(); renderFormSide();
  });

  function setAvailability(start, end) { field("date").value = start; field("dateFin").value = end || start; }
  function fillForm(d) {
    (document.getElementById("svc-" + d.service) || document.getElementById("svc-pare-brise")).checked = true;
    ["plaque", "adresse", "debut", "fin", "notes"].forEach((k) => (field(k).value = d[k] || ""));
    setAvailability(d.date, d.dateFin);
    if (d.prestataire && !state.providers.includes(d.prestataire)) state.providers.push(d.prestataire);
    if (d.site && !siteNames().includes(d.site)) state.sites.push({ nom: d.site, adresse: "" });
    renderSelects();
    field("base").value = ""; fillVariants(field("base"), field("modele")); if (d.modele) selectFleetModel(d);
    field("site").value = d.site || "";
    field("prest").value = d.prestataire || defaultProvider();
    $("#notesBox").open = !!d.notes;
    $("#extraVeh").innerHTML = "";
    state.groupe = d.groupe || "";
    if (d.groupe) state.demandes.filter((x) => x.groupe === d.groupe && x.id !== d.id).sort(D.byStartTime).forEach(addExtraRow);
  }

  function renderFormSide() {
    const d = readForm();
    const others = readExtras().map((x) => groupMember(d, x));
    const photos = photosOf(d.plaque);
    const plates = D.isWindshield(d) ? [d, ...others].map((v) => v.plaque).filter(D.plateKey) : [];
    const photoCount = plates.reduce((n, plate) => n + photosOf(plate).length, 0);
    $("#photosSet").hidden = !D.isWindshield(d);
    $("#msgTitle").textContent = others.length ? `Envoyer la demande (${others.length + 1} véhicules)` : "Envoyer la demande";
    $("#formShare").innerHTML = shareBlock({ text: D.requestMessage(d, photoCount, others), provider: d.prestataire, plates });
    $("#formPhotos").innerHTML = photos.map((p, i) => `<img src="${safeImageSrc(p.thumb)}" data-zoom="${esc(p.key)}" alt="Photo ${i + 1} du pare-brise">`).join("")
      + `<button type="button" class="drop" data-add-photo>${icon("plus")}Ajouter une photo</button>`;
    const vehicle = vehicleOf(d.plaque);
    $("#vehHint").textContent = vehicle && D.plateKey(d.plaque) ? `Véhicule connu : modèle et ${plural(photos.length, "photo")} repris automatiquement.` : "";
    const current = state.demandes.find((x) => x.id === state.editingId);
    $("#formSheet").innerHTML = current && ["confirmee", "realisee"].includes(current.statut) ? sheetLink([d.plaque]) : "";
  }
  function fillFromVehicle() {
    field("plaque").value = D.normalizePlate(field("plaque").value);
    const vehicle = vehicleOf(field("plaque").value);
    if (vehicle?.modele) selectFleetModel(vehicle);
    renderFormSide();
  }
  $("#form").addEventListener("input", (e) => { if (e.target.id !== "f-plaque") renderFormSide(); });
  $("#form").addEventListener("change", renderFormSide);
  field("plaque").addEventListener("change", fillFromVehicle);
  field("site").addEventListener("change", () => { field("adresse").value = D.siteAddress(state.sites, field("site").value); renderFormSide(); });
  field("date").addEventListener("change", () => {
    if (!field("dateFin").value || field("dateFin").value < field("date").value) field("dateFin").value = field("date").value;
    renderFormSide();
  });
  field("debut").addEventListener("change", () => {
    if (field("debut").value && !field("fin").value) { field("fin").value = D.defaultEndTime(field("debut").value); renderFormSide(); }
  });
  $("#formPhotos").addEventListener("click", (e) => { if (e.target.closest("[data-add-photo]")) pickPhotosFor(field("plaque").value); });

  function resetForm() {
    state.editingId = null;
    $("#form").reset();
    $("#extraVeh").innerHTML = "";
    fillVariants(field("base"), field("modele"));
    state.groupe = "";
    setAvailability(D.addDays(today(), 1));
    field("prest").value = state.providerFilter || defaultProvider();
    $("#notesBox").open = false;
    $("#formTitle").textContent = "Nouvelle demande";
    $("#formStatusChip").hidden = true;
    $("#saveBtn").textContent = "Enregistrer la demande";
    $("#delZone").innerHTML = "";
    renderFormSide();
  }
  $("#resetBtn").onclick = resetForm;

  function openDemande(id) {
    const d = state.demandes.find((x) => x.id === id);
    if (!d) return;
    state.editingId = id;
    fillForm(d);
    showSavedHeader(d);
    renderFormSide(); show("demande"); window.scrollTo({ top: 0 });
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
    $("#saveBtn").textContent = "Enregistrer les modifications";
    $("#delZone").innerHTML = state.canWrite ? `<button type="button" class="ghost danger" data-delete>Supprimer</button>` : "";
  }

  // Status is not edited in the form: a new request starts "à envoyer" and becomes "envoyée" once copied or opened in WhatsApp.
  async function saveForm({ markSent = false } = {}) {
    if (!requireStore()) return false;
    const nextStatus = (previous) => {
      const current = previous?.statut || "a_envoyer";
      return markSent && current === "a_envoyer" ? "envoyee" : current;
    };
    const previous = state.demandes.find((x) => x.id === state.editingId) || null;
    const extras = readExtras();
    const main = readForm();
    const missing = D.missingFields(main);
    if (missing.length) { toast("Il manque " + missing.join(", ")); return false; }
    const twice = D.duplicatePlates([main.plaque, ...extras.map((x) => x.plaque)]);
    if (twice.length) { toast(`La plaque ${D.normalizePlate(twice[0])} est saisie deux fois`); return false; }
    if (extras.length && !state.groupe) state.groupe = previous?.groupe || "g" + Date.now().toString(36);
    const groupe = state.groupe || "";
    try {
      state.editingId = await state.store.saveDemande(state.editingId, { ...main, groupe, statut: nextStatus(previous) }, previous);
      await state.store.saveVehicle(vehicleOf(main.plaque), main);
      for (const extra of extras) {
        const before = state.demandes.find((x) => x.id === extra.id) || null;
        const member = { ...groupMember(main, extra), groupe, statut: nextStatus(before) };
        extra.row.dataset.id = await state.store.saveDemande(extra.id || null, member, before);
        await state.store.saveVehicle(vehicleOf(member.plaque), member);
      }
      showSavedHeader(main);
      return true;
    } catch (err) { reportWriteError(err); return false; }
  }
  $("#form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await saveForm()) { toast(extraRows().length ? "Demande groupée enregistrée" : "Demande enregistrée"); state.day = field("date").value || state.day; }
  });
  $("#formShare").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-copy]")) return;
    const wasNew = !state.editingId || state.demandes.find((x) => x.id === state.editingId)?.statut === "a_envoyer";
    if (await saveForm({ markSent: true }) && wasNew) toast("Demande enregistrée et passée en « Envoyée »");
  });
  $("#delZone").addEventListener("click", async (e) => {
    if (e.target.closest("[data-delete]")) {
      $("#delZone").innerHTML = `<span class="row">Supprimer définitivement ? <button type="button" class="danger" data-delete-yes>Oui, supprimer</button><button type="button" class="ghost" data-delete-no>Non</button></span>`;
    } else if (e.target.closest("[data-delete-no]")) {
      $("#delZone").innerHTML = `<button type="button" class="ghost danger" data-delete>Supprimer</button>`;
    } else if (e.target.closest("[data-delete-yes]") && state.editingId && requireStore()) {
      const ids = [state.editingId, ...extraRows().map((row) => row.dataset.id).filter(Boolean)];
      try { await Promise.all(ids.map((id) => state.store.deleteDemande(id))); toast(ids.length > 1 ? "Demande groupée supprimée" : "Demande supprimée"); resetForm(); show("planning"); }
      catch (err) { reportWriteError(err); }
    }
  });

  // ================= photo library =================
  function renderPhotoLibrary() {
    const query = $("#p-q").value;
    const vehicles = [...state.vehicles.values()]
      .filter((v) => D.matchesSearch([v.plaque, D.vehicleLabel(v)], query))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    $("#p-list").innerHTML = vehicles.length
      ? `<div class="veh-grid">${vehicles.map(vehicleCard).join("")}</div>`
      : `<div class="empty"><b>${state.vehicles.size ? "Aucun véhicule ne correspond." : "La photothèque est vide."}</b><span>Chaque véhicule saisi dans une demande arrive ici avec ses photos de pare-brise. Tu peux aussi ajouter une plaque en haut à droite.</span></div>`;
    renderVehicleDetail();
  }
  function vehicleCard(v) {
    const key = D.plateKey(v.plaque);
    const photos = v.photos || [];
    const thumbs = Array.from({ length: 4 }, (_, i) => photos[i] ? `<img src="${safeImageSrc(photos[i].thumb)}" alt="">` : "<span></span>").join("");
    return `<button class="veh-card" data-vehicle="${esc(key)}" aria-current="${key === state.openVehicleKey}">
      <span class="row">${plateTag(v.plaque)}<span class="muted small">${plural(photos.length, "photo")}</span></span>
      <span>${esc(D.vehicleLabel(v) || "Modèle non renseigné")}</span>
      <span class="thumbs">${thumbs}</span></button>`;
  }
  function renderVehicleDetail() {
    const v = state.vehicles.get(state.openVehicleKey);
    if (!v) { $("#p-detail").innerHTML = ""; return; }
    const photos = v.photos || [];
    const history = state.demandes.filter((d) => D.plateKey(d.plaque) === state.openVehicleKey).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    $("#p-detail").innerHTML = `<div class="panel" style="margin-bottom:24px">
      <div class="panel-head"><h2>${plateTag(v.plaque)}</h2><button type="button" class="ghost" data-close-vehicle aria-label="Fermer">${icon("x")}</button></div>
      <div class="row"><label class="field" style="flex:1 1 280px"><span>Modèle et cubage</span><select id="pv-modele">${fleetOptions()}</select></label>
        <button type="button" class="primary" data-new-for-vehicle style="align-self:flex-end">${icon("plus")}Nouvelle demande pour ce véhicule</button></div>
      <h3>Photos du pare-brise · ${photos.length}/${MAX_PHOTOS_PER_VEHICLE}</h3>
      <div class="ph-grid">${photos.map((p, i) => photoTile(v.plaque, p, i)).join("")}<button type="button" class="drop" style="width:auto;height:auto;min-height:150px" data-add-vehicle-photo>${icon("plus")}Ajouter des photos</button></div>
      ${history.length ? `<h3>Demandes · ${history.length}</h3><div class="tablewrap"><table><tbody>${history.map((d) => `<tr class="click" data-open="${esc(d.id)}"><td class="date">${esc(D.shortDate(d.date))}</td><td>${esc(D.siteOf(d))}</td><td>${esc(d.prestataire)}</td><td>${statusChip(d.statut)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>`;
    $("#pv-modele").value = String(D.fleetIndex(state.fleet, v));
  }
  $("#p-q").addEventListener("input", renderPhotoLibrary);
  $("#p-add").onclick = async () => {
    const plate = D.normalizePlate($("#p-newplate").value);
    if (!D.plateKey(plate) || !requireStore()) return;
    try {
      if (!vehicleOf(plate)) await state.store.saveVehicle(null, { plaque: plate });
      state.openVehicleKey = D.plateKey(plate); $("#p-newplate").value = "";
      renderPhotoLibrary();
    } catch (err) { reportWriteError(err); }
  };
  $("#p-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-vehicle]");
    if (card) { state.openVehicleKey = card.dataset.vehicle; renderPhotoLibrary(); window.scrollTo({ top: 0 }); }
  });
  $("#p-detail").addEventListener("change", async (e) => {
    const v = state.vehicles.get(state.openVehicleKey);
    if (e.target.id !== "pv-modele" || !v || !requireStore()) return;
    const model = e.target.value === "" ? { modele: "", cubage: null } : state.fleet[+e.target.value];
    try { await state.store.updateVehicleModel(v, model); toast("Modèle enregistré"); } catch (err) { reportWriteError(err); }
  });
  $("#p-detail").addEventListener("click", async (e) => {
    const v = state.vehicles.get(state.openVehicleKey);
    if (!v) return;
    if (e.target.closest("[data-close-vehicle]")) { state.openVehicleKey = null; renderPhotoLibrary(); }
    else if (e.target.closest("[data-add-vehicle-photo]")) pickPhotosFor(v.plaque);
    else if (e.target.closest("[data-new-for-vehicle]")) newDemandeFor(v);
    else if (e.target.closest("[data-open]")) openDemande(e.target.closest("[data-open]").dataset.open);
    else if (e.target.closest("[data-remove-photo]")) confirmPhotoRemoval(e.target.closest("[data-remove-photo]"), v);
  });
  async function confirmPhotoRemoval(button, vehicle) {
    if (button.dataset.armed !== "1") { button.dataset.armed = "1"; button.textContent = "Confirmer"; return; }
    try { await state.store.removePhoto(vehicle, button.dataset.removePhoto); toast("Photo supprimée"); }
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
    $("#v-share").innerHTML = shareBlock({ text: D.verificationMessage(rows, { provider, kind, siteNames: siteNames() }), provider: provider || defaultProvider() });
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
    const report = currentReport();
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
      <div class="two">${tallyTable("Par prestataire", report.byProvider)}${tallyTable("Par site", report.bySite)}${tallyTable("Par modèle", report.byModel)}</div>
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
    const rows = state.demandes.filter((d) =>
      (!provider || d.prestataire === provider) && (!service || d.service === service) && (!site || d.site === site) && statusFilter(d) &&
      D.matchesSearch([d.plaque, D.vehicleLabel(d), d.site, d.adresse, d.notes, d.prestataire], query)
    ).sort((a, b) => (b.date || "").localeCompare(a.date || "") || D.byStartTime(a, b));
    if (!rows.length) {
      $("#histWrap").innerHTML = `<div class="empty"><b>${state.demandes.length ? "Aucune demande ne correspond à ces filtres." : "Aucune demande enregistrée pour l'instant."}</b><span>Chaque demande saisie dans « Nouvelle demande » est listée ici, avec la date à laquelle elle a été envoyée.</span></div>`;
      return;
    }
    $("#histWrap").innerHTML = `<div class="tablewrap"><table class="wide"><thead><tr><th>Dispo</th><th>Créneau</th><th>Plaque</th><th>Modèle</th><th>Site</th><th>Prestataire</th><th>Statut</th><th>Envoyée le</th></tr></thead><tbody>${rows.map(historyLine).join("")}</tbody></table></div>`;
  }
  function historyLine(d) {
    const span = D.isMultiDay(d) ? `${D.shortDate(d.date)} → ${D.shortDate(D.lastDay(d))}` : D.shortDate(d.date);
    return `<tr class="click" data-open="${esc(d.id)}"><td class="date">${esc(span)}</td><td class="date">${esc(D.timeSlotLabel(d))}</td><td>${plateTag(d.plaque)}</td>
      <td>${esc(D.vehicleLabel(d))}${D.isWindshield(d) ? "" : ` <span class="tag">${esc(D.serviceOf(d.service).label)}</span>`}</td><td>${esc(D.siteOf(d))}</td><td>${esc(d.prestataire)}</td>
      <td>${statusChip(d.statut)}</td><td class="date muted">${d.sentAt ? esc(D.shortDate(d.sentAt.slice(0, 10))) : "—"}</td></tr>`;
  }
  ["#q", "#h-prest", "#h-statut", "#h-svc", "#h-site"].forEach((s) => $(s).addEventListener("input", renderHistory));
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
    $("#s-provs").innerHTML = state.providers.map((p, i) => `<div class="item"><b>${esc(p)}</b>
      <span></span>${removeButton("data-remove-provider", i, p)}</div>`).join("");
    $("#s-sheeturl").value = state.sheetUrl;
  }
  function addFromInput(input, list, make, message) {
    const value = $(input).value.trim();
    if (!value) return;
    list.push(make(value)); $(input).value = ""; renderAll(); persistSettings(message);
  }
  $("#s-addsite").onclick = () => !siteNames().includes($("#s-newsite").value.trim()) && addFromInput("#s-newsite", state.sites, (nom) => ({ nom, adresse: "" }), "Site ajouté");
  $("#s-addprov").onclick = () => !state.providers.includes($("#s-newprov").value.trim()) && addFromInput("#s-newprov", state.providers, (p) => p, "Prestataire ajouté");
  $("#s-addmodel").onclick = () => {
    const cubage = +$("#s-newcub").value || null;
    addFromInput("#s-newmodel", state.fleet, (modele) => ({ modele, cubage }), "Modèle ajouté");
    $("#s-newcub").value = "";
  };
  function removeAt(list, index) { list.splice(index, 1); renderAll(); persistSettings(); }
  $("#view-reglages").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-site], [data-remove-model], [data-remove-provider]");
    if (!b) return;
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

  // ================= render & boot =================
  function renderAll() {
    shareRegistry.clear();
    renderSelects();
    renderPlanning(); renderPhotoLibrary(); renderVerification(); renderReport(); renderHistory(); renderSettings();
    $("#dl-plaques").innerHTML = [...state.vehicles.values()].map((v) => `<option value="${esc(v.plaque)}">${esc(D.vehicleLabel(v))}</option>`).join("");
    renderFormSide();
  }

  function applySettings(settings) {
    if (Array.isArray(settings.sites)) state.sites = D.normalizeSites(settings.sites);
    if (Array.isArray(settings.flotte)) state.fleet = settings.flotte.slice();
    if (Array.isArray(settings.prestataires)) state.providers = settings.prestataires.slice();
    state.contacts = settings.contacts || {};
    state.sheetUrl = settings.sheetUrl || "";
  }
  function setSync(text, ok) { $("#sync").textContent = text; $("#sync").classList.toggle("off", !ok); }

  async function connect() {
    const db = window.claude?.use ? await window.claude.use("db").catch(() => null) : null;
    if (!db) {
      setSync("Hors ligne", false);
      banner("La base de données n'est pas encore branchée : rien ne peut être enregistré pour l'instant.");
      return;
    }
    state.store = createStore(db);
    window.claude.use("downloads").then((d) => { state.downloads = d; $("#b-csv").hidden = !d; }).catch(() => {});
    const user = await window.claude.use("user").catch(() => null);
    if ((await user?.can("data.write")) === false) {
      state.canWrite = false; $("#saveBtn").disabled = true;
      banner("Tu as accès en lecture seule : tu vois le planning mais tu ne peux pas saisir de demandes.");
    }
    state.store.subscribe({
      onDemandes: (rows) => { state.demandes = rows; renderAll(); setSync(`${plural(rows.length, "demande")} · synchronisé`, true); },
      onVehicles: (rows) => { state.vehicles = new Map(rows.map((v) => [D.plateKey(v.plaque || v.id), v])); renderAll(); },
      onSettings: (settings) => { applySettings(settings); renderAll(); },
      onError: () => setSync("Synchronisation interrompue, recharge la page", false),
    });
  }

  try { state.providerFilter = localStorage.getItem("suivi.provFilter") || ""; } catch {}

  renderSelects(); resetForm(); renderAll(); show(location.hash.slice(1) || "planning");
  connect();
})();
