// Business rules of the tracker. Pure functions only: no DOM, no database.
// Loaded in the page as window.SuiviDomain and in Node tests via require().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SuiviDomain = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SERVICES = [
    { id: "pare-brise", label: "Pare-brise", title: "remplacement pare-brise" },
    { id: "lavage", label: "Lavage", title: "lavage véhicule" },
    // Any other job on a vehicle (check, bulb, oil, AdBlue…), only for the providers who do them.
    { id: "intervention", label: "Intervention", title: "intervention véhicule", onRequest: true },
  ];
  const TASK_SUGGESTIONS = ["Vérification du véhicule", "Changer une ampoule", "Niveau d'huile", "AdBlue", "Pression des pneus"];
  const isIntervention = (d) => d.service === "intervention";
  // Services offered by a provider: windshield and washing for all, interventions when enabled in Réglages.
  const servicesFor = (providerDoc) => SERVICES.filter((s) => !s.onRequest || !!providerDoc?.interventions).map((s) => s.id);
  const STATUSES = [
    { id: "a_envoyer", label: "À envoyer" },
    { id: "envoyee", label: "Envoyée" },
    { id: "confirmee", label: "Confirmée" },
    { id: "realisee", label: "Réalisée" },
    { id: "annulee", label: "Annulée" },
  ];
  const CLOSED_STATUSES = ["realisee", "annulee"];
  const NO_SITE = "Site non précisé";
  const DEFAULT_PROVIDERS = ["ALLO pare-brise 78"];
  const DEFAULT_SITES = ["Saint-Cloud", "La Défense", "Aulnay", "Coignières", "Paris-Centre"].map((nom) => ({ nom, adresse: "" }));
  // CityDrop fleet as listed by the team on 2026-11-01; editable in Réglages.
  const DEFAULT_FLEET = [
    ["Renault Master 2023", 20], ["Renault Master 2025", 20],
    ["Opel Movano 2023", 12], ["Opel Movano 2023", 17], ["Opel Movano 2024", 20], ["Opel Movano 2025", 12], ["Opel Movano 2026", 20],
    ["Opel Vivaro 2023", 5], ["Opel Vivaro 2025", 5], ["Opel Combo", 3],
    ["Citroën Jumper", 17], ["Toyota ProAce", 17], ["Maxus", 12], ["Maxus", 20], ["Iveco Daily", 20], ["MAN TGE", 20],
  ].map(([modele, cubage]) => ({ modele, cubage }));
  const SITE_RENAMES = { "Paris-Saint-Cloud": "Saint-Cloud", "Paris-Aulnay": "Aulnay", "Paris-Coignières": "Coignières" };

  // ---------- dates (ISO "YYYY-MM-DD" strings, local time) ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const toIsoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const parseIsoDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d || 1); };
  const addDays = (iso, days) => { const d = parseIsoDate(iso); d.setDate(d.getDate() + days); return toIsoDate(d); };
  const mondayOf = (iso) => addDays(iso, -((parseIsoDate(iso).getDay() + 6) % 7));
  const formatDate = (iso, options) => (iso ? parseIsoDate(iso).toLocaleDateString("fr-FR", options) : "");
  const longDate = (iso) => formatDate(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dayLabel = (iso) => formatDate(iso, { weekday: "long", day: "numeric", month: "long" });
  const shortDate = (iso) => formatDate(iso, { weekday: "short", day: "numeric", month: "short" });
  const numericDate = (iso) => formatDate(iso);
  const monthLabel = (yearMonth) => formatDate(yearMonth + "-01", { month: "long", year: "numeric" });

  const hourLabel = (time) => (time ? time.replace(":", "h") : "");
  function timeSlotLabel({ debut, fin }) {
    if (debut && fin) return `de ${hourLabel(debut)} à ${hourLabel(fin)}`;
    if (debut) return `à partir de ${hourLabel(debut)}`;
    if (fin) return `avant ${hourLabel(fin)}`;
    return "toute la journée";
  }
  function defaultEndTime(start) {
    const [h, m] = start.split(":").map(Number);
    return `${pad2(Math.min(h + 3, 23))}:${pad2(m)}`;
  }

  // ---------- availability window (date .. dateFin) ----------
  const lastDay = (d) => d.dateFin || d.date;
  // Opening hours of the sites: a new request is available all day unless the team narrows it.
  const DEFAULT_SLOT = { debut: "08:30", fin: "19:30" };
  const isMultiDay = (d) => !!d.date && lastDay(d) !== d.date;
  const isAvailableOn = (d, iso) => !!d.date && d.date <= iso && iso <= lastDay(d);
  function availabilityLabel(d) {
    if (!d.date) return "…";
    return isMultiDay(d) ? `du ${dayLabel(d.date)} au ${dayLabel(lastDay(d))}` : `le ${longDate(d.date)}`;
  }

  // ---------- plates ----------
  const plateKey = (plate) => String(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function normalizePlate(plate) {
    const key = plateKey(plate);
    const siv = key.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
    return siv ? `${siv[1]}-${siv[2]}-${siv[3]}` : String(plate || "").toUpperCase().trim();
  }
  // SIV plates (AB-123-CD) and old FNI plates (123 ABC 45) found in free text.
  const PLATE_IN_TEXT = /\b[A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2}\b|\b\d{1,4}[\s-]?[A-Z]{2,3}[\s-]?\d{2}\b/g;
  const platesInText = (text) => (String(text || "").toUpperCase().match(PLATE_IN_TEXT) || []).map(plateKey);

  // ---------- fleet & sites ----------
  const fleetLabel = ({ modele, cubage }) => [modele, cubage ? `${cubage} m³` : ""].filter(Boolean).join(" – ");
  // A fleet entry is "Opel Movano 2023": the brand + model is picked first, then the cubage.
  // The year is shown only where the cubage alone is ambiguous (e.g. Vivaro 5 m³ 2023 / 2025).
  const YEAR_SUFFIX = /\s+((?:19|20)\d{2})$/;
  const baseModel = (modele) => String(modele || "").replace(YEAR_SUFFIX, "").trim();
  const modelYear = (modele) => (String(modele || "").match(YEAR_SUFFIX) || [])[1] || "";
  const fleetBases = (fleet) => [...new Set(fleet.map((f) => baseModel(f.modele)).filter(Boolean))];
  function fleetVariants(fleet, base) {
    const entries = fleet.map((f, index) => ({ ...f, index })).filter((f) => baseModel(f.modele) === base);
    const sameCubage = (f) => entries.filter((g) => +g.cubage === +f.cubage).length > 1;
    return entries
      .sort((a, b) => (+a.cubage || 0) - (+b.cubage || 0) || modelYear(a.modele).localeCompare(modelYear(b.modele)))
      .map((f) => ({
        index: f.index,
        label: [f.cubage ? `${f.cubage} m³` : "cubage non précisé", sameCubage(f) && modelYear(f.modele)].filter(Boolean).join(" · "),
      }));
  }
  // Windshield photos belong to a fleet model (same windshield for every van of that model).
  const modelKey = (v) => (v && v.modele ? plateKey(`${v.modele} ${v.cubage ?? ""}`) : "");
  function uniqueModels(list) {
    const seen = new Set();
    return list.filter((v) => { const k = modelKey(v); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  }
  const fleetIndex = (fleet, v) => fleet.findIndex((f) => f.modele === v.modele && +f.cubage === +v.cubage);
  function normalizeSites(raw) {
    const list = (Array.isArray(raw) ? raw : []).map((s) => (typeof s === "string" ? { nom: s, adresse: "" } : { nom: s.nom || "", adresse: s.adresse || "" }));
    return list.filter((s) => s.nom).map((s) => ({ ...s, nom: SITE_RENAMES[s.nom] || s.nom }));
  }
  const siteAddress = (sites, name) => sites.find((s) => s.nom === name)?.adresse || "";

  // ---------- labels ----------
  const serviceOf = (id) => SERVICES.find((s) => s.id === id) || SERVICES[0];
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
  const isWindshield = (d) => (d.service || "pare-brise") === "pare-brise";
  const isActive = (d) => d.statut !== "annulee";
  const isOpen = (d) => !CLOSED_STATUSES.includes(d.statut);
  const siteOf = (d) => d.site || NO_SITE;
  const vehicleLabel = (v) => fleetLabel(v);
  const serviceSuffix = (d) => (isWindshield(d) ? "" : ` (${serviceOf(d.service).label.toLowerCase()})`);
  const byStartTime = (a, b) => (a.debut || "99").localeCompare(b.debut || "99");
  const byDateThenTime = (a, b) => (a.date || "").localeCompare(b.date || "") || byStartTime(a, b);

  // ---------- grouping ----------
  function groupBy(items, keyOf) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    return groups;
  }
  function groupBySite(demandes, siteNames) {
    const order = [...siteNames, NO_SITE];
    const rank = (site) => { const i = order.indexOf(site); return i < 0 ? order.length : i; };
    return [...groupBy(demandes, siteOf).entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([site, items]) => [site, items.slice().sort(byStartTime)]);
  }
  const vehiclesOnDay = (demandes, iso, provider) =>
    demandes.filter((d) => isAvailableOn(d, iso) && isActive(d) && (!provider || d.prestataire === provider));

  // ---------- validation & status history ----------
  function missingFields(d) {
    const missing = [];
    if (!d.plaque) missing.push("l'immatriculation");
    if (!d.date) missing.push("la date de disponibilité");
    if (d.date && d.dateFin && d.dateFin < d.date) missing.push("une date de fin après la date de début");
    if (!d.site && !d.adresse) missing.push("le site");
    if (!d.prestataire) missing.push("le prestataire");
    if (isIntervention(d) && !d.tache) missing.push("ce qu'il faut faire");
    return missing;
  }
  const SENT_OR_LATER = ["envoyee", "confirmee", "realisee"];
  const CONFIRMED_OR_LATER = ["confirmee", "realisee"];
  function statusTimestamps(previous, status, nowIso) {
    return {
      sentAt: previous?.sentAt || (SENT_OR_LATER.includes(status) ? nowIso : null),
      confirmedAt: previous?.confirmedAt || (CONFIRMED_OR_LATER.includes(status) ? nowIso : null),
      doneAt: status === "realisee" ? previous?.doneAt || nowIso : null,
    };
  }

  // ---------- messages (WhatsApp and Slack both render *bold*) ----------
  // One message for one vehicle, or for a group of vehicles sharing the same site and window (washes go 2 to 5 at a time).
  function requestMessage(d, photoCount, others = []) {
    const group = others.length > 0;
    const count = others.length + 1;
    const all = [d, ...others];
    const sameSlot = all.every((v) => timeSlotLabel(v) === timeSlotLabel(d));
    const lines = group
      ? [
          `*Demande ${serviceOf(d.service).title} – ${count} véhicules*`,
          `Disponibles ${availabilityLabel(d)}${sameSlot ? `, ${timeSlotLabel(d)}` : ""}`,
          `Site : ${d.site || "…"}${d.adresse ? ` – ${d.adresse}` : ""}`,
          ...(d.tache ? [`À faire : *${d.tache}*`] : []),
          "",
          ...all.map((v) => `• *${v.plaque || "…"}* – ${vehicleLabel(v) || "modèle à préciser"}${sameSlot ? "" : ` – ${timeSlotLabel(v)}`}`),
        ]
      : [
          `*Demande ${serviceOf(d.service).title}*`,
          `Immatriculation : *${d.plaque || "…"}*`,
          `Véhicule : ${vehicleLabel(d) || "…"}`,
          `Disponible ${availabilityLabel(d)}, ${timeSlotLabel(d)}`,
          `Site : ${d.site || "…"}${d.adresse ? ` – ${d.adresse}` : ""}`,
          ...(d.tache ? [`À faire : *${d.tache}*`] : []),
        ];
    if (d.notes) lines.push(group ? "" : null, `Remarque : ${d.notes}`);
    if (isWindshield(d)) lines.push(photoCount ? `Photo${photoCount > 1 ? "s" : ""} du pare-brise ci-jointe${photoCount > 1 ? "s" : ""}.` : "Photo du pare-brise à suivre.");
    lines.push("", group ? "Merci de confirmer le passage pour chaque véhicule." : "Merci de confirmer le passage.");
    return lines.filter((l) => l !== null).join("\n");
  }

  // Plates typed twice in a group, so the same car is not sent twice.
  function duplicatePlates(plates) {
    const seen = new Set();
    return plates.filter((p) => { const k = plateKey(p); if (!k) return false; if (seen.has(k)) return true; seen.add(k); return false; });
  }

  // An open request that already asks the same thing for the same vehicle on an overlapping day
  // (same plate, same service, same task for an intervention). Sending it twice is useless.
  function existingDuplicate(candidate, demandes, ignoreIds = []) {
    const key = plateKey(candidate.plaque);
    if (!key || !candidate.date) return null;
    return demandes.find((d) => !ignoreIds.includes(d.id)
      && !["annulee", "realisee"].includes(d.statut)
      && plateKey(d.plaque) === key
      && (d.service || "pare-brise") === (candidate.service || "pare-brise")
      && (!isIntervention(candidate) || (d.tache || "").trim().toLowerCase() === (candidate.tache || "").trim().toLowerCase())
      && d.date <= lastDay(candidate) && candidate.date <= lastDay(d)) || null;
  }

  function dayVehicleLine(d, date, siteAddressText) {
    const parts = [`*${d.plaque}*`, vehicleLabel(d) || "véhicule", timeSlotLabel(d)];
    if (d.adresse && d.adresse !== siteAddressText) parts.push(d.adresse);
    if (isMultiDay(d)) parts.push(`dispo jusqu'au ${shortDate(lastDay(d))}`);
    return `• ${parts.join(" – ")}${serviceSuffix(d)}${d.notes ? `\n   ${d.notes}` : ""}`;
  }

  function dayListMessage(demandes, { date, provider, sites }) {
    const items = vehiclesOnDay(demandes, date, provider);
    const count = items.length;
    if (!count) return `Aucun véhicule prévu le ${dayLabel(date)}.`;
    const lines = [`*Véhicules à faire – ${dayLabel(date)}*`, `${count} véhicule${count > 1 ? "s" : ""}${provider ? ` pour ${provider}` : ""} :`];
    groupBySite(items, sites.map((s) => s.nom)).forEach(([site, siteItems]) => {
      const address = siteAddress(sites, site);
      lines.push("", `*${site}*${address ? ` – ${address}` : ""}`, ...siteItems.map((d) => dayVehicleLine(d, date, address)));
    });
    if (items.some(isWindshield)) lines.push("", "Photos des pare-brises envoyées à la suite.");
    return lines.join("\n");
  }

  function verificationMessage(demandes, { provider, kind, siteNames }) {
    if (!demandes.length) return "Aucun véhicule sur la période choisie.";
    const greeting = `Bonjour${provider ? " " + provider : ""}, `;
    const lines = [kind === "rdv"
      ? greeting + "pouvez-vous nous confirmer les rendez-vous suivants ?"
      : greeting + "pouvez-vous nous confirmer les pare-brises remplacés parmi ces véhicules ?"];
    groupBy(demandes.slice().sort(byDateThenTime), (d) => d.date).forEach((items, date) => {
      lines.push("", `*${dayLabel(date)}*`);
      groupBySite(items, siteNames).forEach(([site, siteItems]) =>
        siteItems.forEach((d) => lines.push(`• ${d.plaque} – ${site}${serviceSuffix(d)}`)));
    });
    lines.push("", kind === "rdv" ? "Merci de nous indiquer ceux qui sont OK." : "Merci de nous indiquer ceux qui sont faits et ceux qui restent à faire.");
    return lines.join("\n");
  }

  // WhatsApp click-to-chat: a number opens that chat, no number lets the user pick one.
  // "app" opens the installed WhatsApp directly, "web" opens WhatsApp Web, "page" goes through the wa.me choice page.
  const WHATSAPP_TARGETS = ["app", "web", "page"];
  function whatsappLink(text, phone, target = "page") {
    const digits = String(phone || "").replace(/\D/g, "").replace(/^0(\d{9})$/, "33$1");
    const query = `${digits ? `phone=${digits}&` : ""}text=${encodeURIComponent(text)}`;
    if (target === "app") return `whatsapp://send?${query}`;
    if (target === "web") return `https://web.whatsapp.com/send?${query}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  // Photo sheet: lays out every photo in one image, each tile captioned with its plate.
  // WhatsApp shrinks a pasted image so that its longest side is about 1600 px. Pick how many photos go
  // on each row so that each photo keeps the most pixels after that shrink (2 photos: one above the other).
  function squareSheetOptions(groups, base, longSide = 1600) {
    const ratios = groups.flatMap((g) => g.ratios).map((r) => (r > 0 ? r : 4 / 3));
    const count = ratios.length || 1;
    const average = ratios.reduce((sum, r) => sum + r, 0) / count;
    const inner = base.width - 2 * base.pad;
    let best = { perRow: 1, size: 0 };
    for (let perRow = 1; perRow <= count; perRow++) {
      const tileWidth = (inner - base.gap * (perRow - 1)) / perRow;
      const rows = Math.ceil(count / perRow);
      const height = 2 * base.pad + groups.length * (base.header + base.gap) + rows * (tileWidth / average + base.gap);
      const size = tileWidth * Math.min(1, longSide / Math.max(base.width, height));
      if (size > best.size) best = { perRow, size };
    }
    const rowHeight = Math.floor((inner - base.gap * (best.perRow - 1)) / (best.perRow * average));
    return { ...base, targetHeight: rowHeight + 1, maxHeight: rowHeight };
  }

  // Photo sheet: one header per model, then its photos in justified rows that keep each photo's
  // proportions (nothing is cropped) and fill the width without empty cells.
  function photoSheetLayout(groups, { width = 1600, pad = 24, gap = 12, header = 72, targetHeight = 440, maxHeight = 640 } = {}) {
    const inner = width - 2 * pad;
    const headers = [];
    const tiles = [];
    let y = pad;
    groups.forEach((group, g) => {
      headers.push({ label: group.label, x: pad, y, width: inner, height: header });
      y += header + gap;
      let row = [];
      const flush = (isLast) => {
        const ratioSum = row.reduce((sum, item) => sum + item.ratio, 0);
        const fullHeight = (inner - gap * (row.length - 1)) / ratioSum;
        const height = Math.round(isLast ? Math.min(fullHeight, maxHeight) : fullHeight);
        const rowWidth = row.reduce((sum, item) => sum + item.ratio * height, 0) + gap * (row.length - 1);
        let x = pad + Math.round((inner - rowWidth) / 2);
        row.forEach((item) => {
          const w = Math.round(item.ratio * height);
          tiles.push({ group: g, index: item.index, x, y, width: w, height });
          x += w + gap;
        });
        y += height + gap;
        row = [];
      };
      group.ratios.forEach((ratio, index) => {
        row.push({ ratio: ratio > 0 ? ratio : 4 / 3, index });
        const ratioSum = row.reduce((sum, item) => sum + item.ratio, 0);
        if ((inner - gap * (row.length - 1)) / ratioSum <= targetHeight) flush(false);
      });
      if (row.length) flush(true);
      y += gap;
    });
    return { width, height: Math.round(y - gap + pad - gap), headers, tiles };
  }

  // ---------- monthly report ----------
  function tally(demandes, todayIso) {
    const done = demandes.filter((d) => d.statut === "realisee");
    const pending = demandes.filter(isOpen);
    return {
      requested: demandes.length,
      done: done.length,
      cancelled: demandes.filter((d) => d.statut === "annulee").length,
      overdue: pending.filter((d) => lastDay(d) < todayIso).length,
      upcoming: pending.filter((d) => lastDay(d) >= todayIso).length,
      amount: done.reduce((sum, d) => sum + (+d.montant || 0), 0),
    };
  }
  function monthlyReport(demandes, { month, provider, todayIso }) {
    const rows = demandes.filter((d) => d.date && d.date.slice(0, 7) === month && (!provider || d.prestataire === provider));
    const tallyBy = (keyOf) => [...groupBy(rows, keyOf).entries()]
      .map(([key, items]) => [key, tally(items, todayIso)])
      .sort((a, b) => b[1].requested - a[1].requested);
    return { rows, total: tally(rows, todayIso), byProvider: tallyBy((d) => d.prestataire || "—"), bySite: tallyBy(siteOf), byModel: tallyBy((d) => vehicleLabel(d) || "Modèle non précisé") };
  }
  function monthlySummaryMessage(report, { month, provider }) {
    const t = report.total;
    return [
      `*Bilan prestations – ${monthLabel(month)}${provider ? " – " + provider : ""}*`,
      `Demandés : ${t.requested}`, `Réalisés : ${t.done}`, `Annulés : ${t.cancelled}`,
      `Non réalisés / à confirmer : ${t.overdue + t.upcoming}`,
      "", "Par prestataire :",
      ...report.byProvider.map(([k, a]) => `• ${k} : ${a.done} réalisés sur ${a.requested} demandés`),
      "", "Par site :",
      ...report.bySite.map(([k, a]) => `• ${k} : ${a.done} / ${a.requested}`),
    ].join("\n");
  }
  const EXPORT_HEADER = ["Dispo du", "Dispo au", "Immatriculation", "Modèle", "Cubage (m³)", "Prestation", "Site", "Adresse", "Prestataire", "Statut", "Envoyée le", "Réalisée le"];
  function exportRow(d) {
    return [numericDate(d.date), numericDate(lastDay(d)), d.plaque, d.modele, d.cubage ?? "", serviceOf(d.service).label,
      d.site, d.adresse, d.prestataire, statusOf(d.statut).label,
      d.sentAt ? numericDate(d.sentAt.slice(0, 10)) : "", d.doneAt ? numericDate(d.doneAt.slice(0, 10)) : ""];
  }
  function toTsv(rows) {
    const clean = (v) => String(v ?? "").replace(/[\t\r\n]/g, " ");
    return rows.map((r) => r.map(clean).join("\t")).join("\n");
  }
  function toCsv(rows) {
    const quote = (v) => { const s = String(v ?? ""); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return "﻿" + rows.map((r) => r.map(quote).join(";")).join("\r\n");
  }


  // ---------- requests imported from City-Drop's "Prise de rendez-vous" mails ----------
  // The mail names the garage as City-Drop writes it ("Du sol au toit 78&92"): match it to a provider of the app.
  function providerFromGarage(garage, providerNames) {
    const g = providerId(garage);
    if (!g) return "";
    const hits = providerNames.filter((name) => { const p = providerId(name); return p && (g === p || g.startsWith(p + "-") || p.startsWith(g + "-")); });
    return hits.sort((a, b) => providerId(b).length - providerId(a).length)[0] || "";
  }
  // What the team app adds to a mail request: the provider (so the provider sees it), the fleet model known for the
  // plate, the site of the plate's last request, and the price. Returns null when there is nothing (more) to add.
  function mailCompletion(d, { demandes, vehicleOf, providerNames, pricesOf }) {
    if (d.source !== "mail") return null;
    const patch = {};
    if (!d.prestataire) { const p = providerFromGarage(d.garageMail, providerNames); if (p) patch.prestataire = p; }
    const vehicle = vehicleOf(d.plaque);
    if (!d.modele && vehicle?.modele) { patch.modele = vehicle.modele; patch.cubage = vehicle.cubage ?? null; }
    if (!d.site && !d.adresse) {
      const last = demandes.filter((o) => o.id !== d.id && plateKey(o.plaque) === plateKey(d.plaque) && (o.site || o.adresse))
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      if (last) { patch.site = last.site || ""; patch.adresse = last.adresse || ""; }
    }
    const merged = { ...d, ...patch };
    if (merged.prestataire && (!d.prestataireId || d.prixHT == null)) {
      const { prestataireId, prixHT } = providerFields(merged, null, pricesOf);
      if (prestataireId !== d.prestataireId) patch.prestataireId = prestataireId;
      if (prixHT != null && prixHT !== d.prixHT) patch.prixHT = prixHT;
    }
    return Object.keys(patch).length ? patch : null;
  }

  // ---------- providers, accounts and prices (multi-provider access) ----------
  // A provider's id is derived from its name, so existing requests (which store the name) can be linked without a lookup.
  const providerId = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ROLES = [
    { id: "admin", label: "Équipe City-Drop (tout voir, tout faire)" },
    { id: "prestataire", label: "Prestataire (ses demandes seulement)" },
    { id: "lecture", label: "Lecture (rapport, sans modifier)" },
    { id: "robot", label: "Robot des mails (ajoute les demandes reçues par mail)" },
  ];
  const roleOf = (id) => ROLES.find((r) => r.id === id) || null;
  const emailKey = (email) => String(email || "").trim().toLowerCase();
  const isEmail = (email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailKey(email));
  const VAT_RATE = 0.2;
  const roundCents = (n) => Math.round(n * 100) / 100;
  const withVat = (ht) => (ht == null ? null : roundCents(ht * (1 + VAT_RATE)));
  const euros = (n) => (n == null ? "" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));

  // A price line applies to one service, optionally to a cubage range (bounds included).
  const priceMatches = (line, d) => {
    if ((line.service || "pare-brise") !== (d.service || "pare-brise")) return false;
    const cubage = d.cubage == null || d.cubage === "" ? null : +d.cubage;
    if (line.cubageMin == null && line.cubageMax == null) return true;
    if (cubage == null) return false;
    return (line.cubageMin == null || cubage >= +line.cubageMin) && (line.cubageMax == null || cubage <= +line.cubageMax);
  };
  const boundCount = (line) => (line.cubageMin != null) + (line.cubageMax != null);
  const rangeWidth = (line) => (line.cubageMax ?? Infinity) - (line.cubageMin ?? -Infinity);
  const bySpecificity = (a, b) => boundCount(b) - boundCount(a) || rangeWidth(a) - rangeWidth(b);
  // The most specific matching line wins (a 12–20 m³ price beats an "all sizes" price).
  function priceFor(prices, d) {
    const matches = (prices || []).filter((line) => priceMatches(line, d) && Number.isFinite(+line.prixHT));
    if (!matches.length) return null;
    return +matches.sort(bySpecificity)[0].prixHT;
  }
  function priceLineLabel(line) {
    const { cubageMin: min, cubageMax: max } = line;
    const range = min != null && max != null ? `${min} à ${max} m³` : min != null ? `${min} m³ et plus` : max != null ? `jusqu'à ${max} m³` : "toutes tailles";
    return `${serviceOf(line.service).label} · ${range}`;
  }

  // Fields stored on each request so access rules and invoices never depend on a later price change:
  // the provider id, and the price frozen when the request is first saved (kept while provider, service and cubage stay the same).
  function providerFields(fields, previous, pricesOf) {
    const prestataireId = providerId(fields.prestataire);
    const same = previous && previous.prestataireId === prestataireId && (previous.service || "pare-brise") === (fields.service || "pare-brise")
      && String(previous.cubage ?? "") === String(fields.cubage ?? "");
    const prixHT = same && previous.prixHT != null ? previous.prixHT : priceFor(pricesOf(prestataireId), fields);
    return { prestataireId, prixHT };
  }

  // What has to change so that requests created before multi-provider access can be read by the new rules.
  // Also fills the price of requests saved before their provider had prices (prices can be entered later, e.g. by Jérôme).
  function accessMigration(demandes, pricesOf) {
    return demandes
      .filter((d) => d.prestataire)
      .map((d) => {
        const prestataireId = providerId(d.prestataire);
        const prixHT = d.prixHT != null ? d.prixHT : priceFor(pricesOf(prestataireId), d);
        return { id: d.id, prestataireId, prixHT, changed: d.prestataireId !== prestataireId || d.prixHT !== prixHT };
      })
      .filter((u) => u.changed)
      .map(({ changed, ...u }) => u);
  }


  // ---------- provider answers (field "retour" on a request, written by the provider) ----------
  // retour = {etat, at, par, note?, date?, debut?, preuve?}; the team marks it {vu: true} once read,
  // and {applique: true} once the request status follows it (done -> réalisée, taken -> confirmée).
  const ANSWERS = [
    { id: "confirme", label: "Pris en charge", team: "a confirmé le passage" },
    { id: "fait", label: "Fait", team: "a fait" },
    { id: "absent", label: "Véhicule absent", team: "n'a pas trouvé le véhicule" },
    { id: "autre-date", label: "Autre date proposée", team: "propose une autre date pour" },
    { id: "refuse", label: "Pas possible", team: "ne peut pas faire" },
  ];
  const answerOf = (id) => ANSWERS.find((a) => a.id === id) || null;
  // A request shows on the provider's screen as soon as it is saved: the app is the channel,
  // the WhatsApp message is optional. Only cancelled requests are hidden.
  const isForProvider = (d) => d.statut !== "annulee";
  const isDoneByProvider = (d) => d.retour?.etat === "fait" || d.statut === "realisee";
  const doneDay = (d) => (d.retour?.etat === "fait" ? d.retour.at : d.doneAt || "")?.slice(0, 10) || d.date || "";

  // Provider screen. A new request is first accepted (or answered with another date / not possible);
  // once accepted it shows on every day the vehicle is on site, so it can be done early.
  const isAccepted = (d) => d.statut === "confirmee" || d.retour?.etat === "confirme";
  function providerLists(demandes, todayIso) {
    const mine = demandes.filter(isForProvider);
    const open = mine.filter((d) => !isDoneByProvider(d));
    const accepted = open.filter(isAccepted);
    return {
      validate: open.filter((d) => !isAccepted(d)).sort(byDateThenTime),
      today: accepted.filter((d) => d.date && d.date <= todayIso).sort(byDateThenTime),
      upcoming: accepted.filter((d) => !d.date || d.date > todayIso).sort(byDateThenTime),
      done: mine.filter(isDoneByProvider).sort((a, b) => doneDay(b).localeCompare(doneDay(a))),
    };
  }
  const isLate = (d, todayIso) => !!d.date && lastDay(d) < todayIso;
  // Vehicles done this month and this year, for the provider's own count.
  function providerCounts(demandes, todayIso) {
    const done = demandes.filter((d) => isForProvider(d) && isDoneByProvider(d)).map(doneDay);
    return { month: done.filter((day) => day.slice(0, 7) === todayIso.slice(0, 7)).length, year: done.filter((day) => day.slice(0, 4) === todayIso.slice(0, 4)).length };
  }
  function answerSummary(r) {
    if (!r) return "";
    const when = r.date ? ` : ${shortDate(r.date)}${r.debut ? " à " + hourLabel(r.debut) : ""}` : "";
    return `${answerOf(r.etat)?.label || r.etat}${when}${r.note ? ` – ${r.note}` : ""}`;
  }
  // What the team's app writes when it sees a provider answer it has not applied yet (closes the request automatically).
  function statusFromAnswer(d) {
    const r = d.retour;
    if (!r || r.applique) return null;
    if (r.etat === "fait" && d.statut !== "realisee") return "realisee";
    if (r.etat === "confirme" && ["a_envoyer", "envoyee"].includes(d.statut)) return "confirmee";
    return null;
  }
  // Answers the team has not looked at yet, newest first.
  // Every answer already seen, newest first: the "Déjà vus" list of the Retours page.
  const seenAnswers = (demandes, limit = 40) => demandes.filter((d) => d.retour?.vu).sort((a, b) => (b.retour.at || "").localeCompare(a.retour.at || "")).slice(0, limit);
  const unseenAnswers = (demandes) => demandes.filter((d) => d.retour && !d.retour.vu).sort((a, b) => (b.retour.at || "").localeCompare(a.retour.at || ""));

  // ---------- search ----------
  // ----- site list pasted from a spreadsheet: « Nom<TAB>"adresse sur plusieurs lignes" » -----
  const siteKey = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const oneLineAddress = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
  function parseSiteList(text) {
    const src = String(text || "").replace(/\r/g, "");
    const quoted = [...src.matchAll(/"([^"]*)"/g)];
    if (!quoted.length) {
      return src.split("\n").map((line) => line.split("\t")).filter((cells) => cells[0].trim())
        .map(([nom, ...rest]) => ({ nom: nom.trim(), adresse: oneLineAddress(rest.join("\n")) }));
    }
    let from = 0;
    return quoted.map((m) => {
      const before = src.slice(from, m.index).split("\n").map((l) => l.split("\t")[0].trim()).filter(Boolean);
      from = m.index + m[0].length;
      return { nom: before[before.length - 1] || "", adresse: oneLineAddress(m[1]) };
    }).filter((site) => site.nom && site.adresse);
  }
  // Same site under a longer name (« Paris - La Défense » for « La Défense »): keep the existing name,
  // because saved requests refer to it.
  function sameSite(a, b) {
    const [x, y] = [siteKey(a), siteKey(b)];
    return x === y || (y.length >= 4 && x.endsWith(y)) || (x.length >= 4 && y.endsWith(x));
  }
  function mergeSites(existing, incoming) {
    const sites = existing.map((s) => ({ ...s }));
    let added = 0, updated = 0;
    for (const site of incoming) {
      const match = sites.find((s) => sameSite(site.nom, s.nom));
      if (!match) { sites.push({ nom: site.nom, adresse: site.adresse }); added++; }
      else if (match.adresse !== site.adresse) { match.adresse = site.adresse; updated++; }
    }
    return { sites, added, updated };
  }

  const searchKey = (s) => String(s || "").toLowerCase().replace(/[-\s]/g, "");
  const matchesSearch = (fields, query) => !query || searchKey(fields.join(" ")).includes(searchKey(query));

  return {
    DEFAULT_SLOT, TASK_SUGGESTIONS, existingDuplicate, isIntervention, servicesFor,
    SERVICES, STATUSES, NO_SITE, DEFAULT_PROVIDERS, DEFAULT_SITES, DEFAULT_FLEET,
    toIsoDate, parseIsoDate, addDays, mondayOf, longDate, dayLabel, shortDate, numericDate, monthLabel, timeSlotLabel, defaultEndTime,
    lastDay, isMultiDay, isAvailableOn, availabilityLabel,
    plateKey, normalizePlate, platesInText,
    fleetLabel, fleetIndex, modelKey, uniqueModels, baseModel, fleetBases, fleetVariants, normalizeSites, siteAddress, parseSiteList, mergeSites,
    serviceOf, statusOf, isWindshield, isActive, isOpen, siteOf, vehicleLabel, byStartTime, byDateThenTime,
    groupBy, groupBySite, vehiclesOnDay, missingFields, statusTimestamps,
    requestMessage, duplicatePlates, dayListMessage, verificationMessage, whatsappLink, WHATSAPP_TARGETS, photoSheetLayout, squareSheetOptions,
    monthlyReport, monthlySummaryMessage, EXPORT_HEADER, exportRow, toTsv, toCsv,
    matchesSearch,
    providerId, ROLES, roleOf, emailKey, isEmail, VAT_RATE, withVat, euros, priceFor, priceLineLabel, providerFields, accessMigration,
    providerFromGarage, mailCompletion,
    ANSWERS, answerOf, isForProvider, isAccepted, isLate, providerLists, providerCounts, answerSummary, statusFromAnswer, unseenAnswers, seenAnswers,
  };
});
