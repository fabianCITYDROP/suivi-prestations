// Business rules of the tracker. Pure functions only: no DOM, no database.
// Loaded in the page as window.SuiviDomain and in Node tests via require().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SuiviDomain = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SERVICES = [
    { id: "pare-brise", label: "Pare-brise", title: "remplacement pare-brise" },
    { id: "lavage", label: "Lavage", title: "lavage véhicule" },
  ];
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
          "",
          ...all.map((v) => `• *${v.plaque || "…"}* – ${vehicleLabel(v) || "modèle à préciser"}${sameSlot ? "" : ` – ${timeSlotLabel(v)}`}`),
        ]
      : [
          `*Demande ${serviceOf(d.service).title}*`,
          `Immatriculation : *${d.plaque || "…"}*`,
          `Véhicule : ${vehicleLabel(d) || "…"}`,
          `Disponible ${availabilityLabel(d)}, ${timeSlotLabel(d)}`,
          `Site : ${d.site || "…"}${d.adresse ? ` – ${d.adresse}` : ""}`,
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
  function collageLayout(count, { tileWidth = 640, tileHeight = 480, caption = 56, gap = 12 } = {}) {
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : 3;
    const rows = Math.ceil(count / columns);
    const cellHeight = caption + tileHeight;
    return {
      width: columns * tileWidth + (columns + 1) * gap,
      height: rows * cellHeight + (rows + 1) * gap,
      tiles: Array.from({ length: count }, (_, i) => ({
        x: gap + (i % columns) * (tileWidth + gap),
        y: gap + Math.floor(i / columns) * (cellHeight + gap),
        width: tileWidth, height: tileHeight, caption,
      })),
    };
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

  // ---------- search ----------
  const searchKey = (s) => String(s || "").toLowerCase().replace(/[-\s]/g, "");
  const matchesSearch = (fields, query) => !query || searchKey(fields.join(" ")).includes(searchKey(query));

  return {
    SERVICES, STATUSES, NO_SITE, DEFAULT_PROVIDERS, DEFAULT_SITES, DEFAULT_FLEET,
    toIsoDate, parseIsoDate, addDays, mondayOf, longDate, dayLabel, shortDate, numericDate, monthLabel, timeSlotLabel, defaultEndTime,
    lastDay, isMultiDay, isAvailableOn, availabilityLabel,
    plateKey, normalizePlate, platesInText,
    fleetLabel, fleetIndex, modelKey, uniqueModels, baseModel, fleetBases, fleetVariants, normalizeSites, siteAddress,
    serviceOf, statusOf, isWindshield, isActive, isOpen, siteOf, vehicleLabel, byStartTime, byDateThenTime,
    groupBy, groupBySite, vehiclesOnDay, missingFields, statusTimestamps,
    requestMessage, duplicatePlates, dayListMessage, verificationMessage, whatsappLink, WHATSAPP_TARGETS, collageLayout,
    monthlyReport, monthlySummaryMessage, EXPORT_HEADER, exportRow, toTsv, toCsv,
    matchesSearch,
  };
});
