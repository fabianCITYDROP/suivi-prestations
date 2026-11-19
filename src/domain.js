// Business rules of the tracker. Pure functions only: no DOM, no database.
// Loaded in the page as window.SuiviDomain and in Node tests via require().
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SuiviDomain = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SERVICES = [
    // Windshields only go to the providers ticked "Pare-brise" in Réglages (ALLO pare-brise 78 by default).
    { id: "pare-brise", label: "Pare-brise", title: "remplacement pare-brise", onRequest: "pareBrise" },
    { id: "lavage", label: "Lavage", title: "lavage véhicule" },
    // Any other job on a vehicle (check, bulb, oil, AdBlue…), only for the providers who do them.
    { id: "intervention", label: "Intervention", title: "intervention véhicule", onRequest: "interventions" },
    // Tailgate inspection (every 180 days), only for the providers who do them (Dhollianda).
    { id: "hayon", label: "Contrôle hayon", title: "contrôle hayon", onRequest: "hayon" },
  ];
  // Small jobs the team asks washers for (Fabian, 2026-11-10); the text can be completed by hand.
  const TASK_SUGGESTIONS = ["Monter la roue de secours", "Vérifier les pneus", "AdBlue + éteindre le voyant", "Déplacer le véhicule",
    "Vérifier les ampoules", "Niveau d'huile", "Vérification du véhicule"];
  const isIntervention = (d) => d.service === "intervention";
  // Services offered by a provider: washing for all; windshield, interventions and tailgate controls when ticked in Réglages.
  // Before the "Pare-brise" box existed only ALLO did windshields: a provider never ticked/unticked keeps that rule.
  const offers = (providerDoc, flag, name) => {
    const value = providerDoc?.[flag];
    if (value === undefined && flag === "pareBrise") return providerId(name || providerDoc?.nom) === providerId(DEFAULT_PROVIDERS[0]);
    return !!value;
  };
  const servicesFor = (providerDoc, name) => SERVICES.filter((s) => !s.onRequest || offers(providerDoc, s.onRequest, name)).map((s) => s.id);
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
  // A wash is complete (outside and inside) unless the request says inside only; each has its own price.
  const WASH_KINDS = [{ id: "complet", label: "Lavage complet" }, { id: "interieur", label: "Lavage intérieur" }];
  const washKindOf = (d) => WASH_KINDS.find((k) => k.id === d.formule) || WASH_KINDS[0];
  const isWash = (d) => d.service === "lavage";
  const jobLabel = (d) => (isWash(d) ? washKindOf(d).label : serviceOf(d.service).label);
  const jobTitle = (d) => (isWash(d) ? washKindOf(d).label.toLowerCase() : serviceOf(d.service).title);
  const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
  const isWindshield = (d) => (d.service || "pare-brise") === "pare-brise";
  const isActive = (d) => d.statut !== "annulee";
  const isOpen = (d) => !CLOSED_STATUSES.includes(d.statut);
  const siteOf = (d) => d.site || NO_SITE;
  const vehicleLabel = (v) => fleetLabel(v);
  const serviceSuffix = (d) => (isWindshield(d) ? "" : ` (${jobLabel(d).toLowerCase()})`);
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
          `*Demande ${jobTitle(d)} – ${count} véhicules*`,
          `Disponibles ${availabilityLabel(d)}${sameSlot ? `, ${timeSlotLabel(d)}` : ""}`,
          `Site : ${d.site || "…"}${d.adresse ? ` – ${d.adresse}` : ""}`,
          ...(d.tache ? [`À faire : *${d.tache}*`] : []),
          "",
          ...all.map((v) => `• *${v.plaque || "…"}* – ${vehicleLabel(v) || "modèle à préciser"}${sameSlot ? "" : ` – ${timeSlotLabel(v)}`}`),
        ]
      : [
          `*Demande ${jobTitle(d)}*`,
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
    return [numericDate(d.date), numericDate(lastDay(d)), d.plaque, d.modele, d.cubage ?? "", jobLabel(d),
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
  // Names differ ("DSAT (du sol au toit)" in the app, "Du sol au toit 78&92" in the mail): match on the distinctive words.
  const GENERIC_WORDS = new Set(["lavage", "garage", "auto", "autos", "services", "service", "du", "au", "de", "des", "la", "le", "les", "et", "sarl", "sas"]);
  const nameWords = (name) => providerId(name).split("-").filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC_WORDS.has(w));
  function providerFromGarage(garage, providerNames) {
    const words = new Set(nameWords(garage));
    if (!words.size) return "";
    const scored = providerNames.map((name) => ({ name, score: nameWords(name).filter((w) => words.has(w)).length })).filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return "";
    return scored[0].name;
  }
  const MAIL_MARKERS = ["source", "mailId", "garageMail", "modeleMail", "km"];
  const mailMarkers = (d) => Object.fromEntries(MAIL_MARKERS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
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
    if (isWash(line) && washKindOf(line).id !== washKindOf(d).id) return false;
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
    return `${jobLabel(line)} · ${range}`;
  }

  // Prices HT agreed with the providers (Fabian and Jérôme, 2026-11), filled in one click from Réglages › Tarifs.
  // Matched on a distinctive word of the provider's name; a line already there (same job and sizes) is never added twice.
  // DHOLLIANDA (hayon) is paid by the month and Wash and Check depends on minibus plates: neither is here.
  const WASH = (formule, prixHT) => ({ service: "lavage", formule, cubageMin: null, cubageMax: null, prixHT });
  const KNOWN_PRICES = [
    { words: ["allo"], lines: [
      { service: "pare-brise", cubageMin: null, cubageMax: 11, prixHT: 320 },
      { service: "pare-brise", cubageMin: 12, cubageMax: null, prixHT: 360 },
      WASH("complet", 37), WASH("interieur", 25)] },
    { words: ["khalid"], lines: [WASH("complet", 42), WASH("interieur", 25)] },
    { words: ["dsat", "toit"], lines: [WASH("complet", 42), WASH("interieur", 25)] },
    { words: ["asg"], lines: [WASH("complet", 42), WASH("interieur", 25)] },
  ];
  const sameKind = (a, b) => (a.service || "pare-brise") === (b.service || "pare-brise") && washKindOf(a).id === washKindOf(b).id
    && (a.cubageMin ?? null) === (b.cubageMin ?? null) && (a.cubageMax ?? null) === (b.cubageMax ?? null);
  // [{name, add: [lines]}] for each provider of the app that is missing some of the agreed prices.
  function missingKnownPrices(providerNames, pricesOf) {
    return providerNames.map((name) => {
      const words = providerId(name).split("-");
      const known = KNOWN_PRICES.find((k) => k.words.some((w) => words.includes(w)));
      if (!known) return null;
      const current = pricesOf(providerId(name)) || [];
      const add = known.lines.filter((line) => !current.some((c) => sameKind(c, line)));
      return add.length ? { name, add } : null;
    }).filter(Boolean);
  }

  // Fields stored on each request so access rules and invoices never depend on a later price change:
  // the provider id, and the price frozen when the request is first saved (kept while provider, service, wash kind and cubage stay the same).
  function providerFields(fields, previous, pricesOf) {
    const prestataireId = providerId(fields.prestataire);
    const same = previous && previous.prestataireId === prestataireId && (previous.service || "pare-brise") === (fields.service || "pare-brise")
      && String(previous.cubage ?? "") === String(fields.cubage ?? "") && washKindOf(previous).id === washKindOf(fields).id;
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
  // ---------- problems seen on a vehicle (collection "signalements", written by the provider) ----------
  // {demandeId, plaque, prestataireId, type, texte, photo?, statut "nouveau"|"traite", at, par, traiteAt?, traitePar?}
  // A provider often sees a shock, a worn tyre or a warning light before City-Drop does: one tap tells the team.
  const PROBLEMS = [
    { id: "choc", label: "Choc / carrosserie" },
    { id: "pneu", label: "Pneu" },
    { id: "voyant", label: "Voyant allumé" },
    { id: "autre", label: "Autre" },
  ];
  const PROBLEM_TEXT_MAX = 500;
  const problemOf = (id) => PROBLEMS.find((p) => p.id === id) || null;
  // Older reports carry a type (choc, pneu, voyant); new ones are only words.
  const problemSummary = (s) => (!s.type || s.type === "autre") && s.texte ? s.texte : [problemOf(s.type)?.label || "Problème", s.texte].filter(Boolean).join(" – ");
  // The document a provider writes: a few words (required) and an optional photo. Returns {error} when the words are missing.
  // The provider no longer picks a type (Fabian, 2026-11-19: « juste écrire »): new reports are type "autre".
  function problemReport(demande, { type = "autre", texte, photo } = {}, email, nowIso) {
    const text = String(texte || "").trim().slice(0, PROBLEM_TEXT_MAX);
    if (!problemOf(type)) return { error: "Type de problème inconnu" };
    if (!text) return { error: "Dis en quelques mots ce que tu as vu" };
    return {
      demandeId: demande.id, plaque: demande.plaque, prestataireId: demande.prestataireId,
      type, texte: text, ...(photo ? { photo } : {}), statut: "nouveau", at: nowIso, par: email,
    };
  }
  // Problems can still be reported on a vehicle done in the last days (the provider may notice it afterwards).
  const PROBLEM_AFTER_DONE_DAYS = 7;
  const canReportAfterDone = (doneIso, todayIso) => !!doneIso && daysBetween(doneIso.slice(0, 10), todayIso) <= PROBLEM_AFTER_DONE_DAYS;
  const byNewest = (a, b) => (b.at || "").localeCompare(a.at || "");
  const openProblems = (list) => list.filter((s) => s.statut !== "traite").sort(byNewest);
  const handledProblems = (list, limit = 40) => list.filter((s) => s.statut === "traite").sort(byNewest).slice(0, limit);
  const problemsOfRequest = (list, demandeId) => list.filter((s) => s.demandeId === demandeId).sort(byNewest);
  const problemsOfPlate = (list, plate) => list.filter((s) => plateKey(s.plaque) === plateKey(plate)).sort(byNewest);

  // What a provider's answer writes. A "fait" or an acceptance also moves the request's status right away, so the
  // request is closed even when nobody of the team has the app open (the access rules allow exactly this).
  function answerPatch(d, retour, nowIso) {
    const r = { ...retour, at: nowIso };
    const patch = { retour: r, updatedAt: nowIso };
    const status = d.statut === "annulee" ? null : statusFromAnswer({ ...d, retour: r });
    if (!status) return patch;
    patch.statut = status;
    if (!d.sentAt) patch.sentAt = nowIso;
    if (!d.confirmedAt) patch.confirmedAt = nowIso;
    if (status === "realisee") patch.doneAt = nowIso;
    return patch;
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

  // ---------- tailgate (hayon) controls: one every 180 days per vehicle ----------
  // The provider sends no report we can rely on, so a booked control counts as done once its day has passed,
  // unless the team cancelled it or marked it "pas fait". The starting point of each vehicle is the date of its
  // last control taken from the provider's sheet: hayons/<PLATEKEY> {plaque, dernierControle}.
  const HAYON_CYCLE_DAYS = 180;
  const HAYON_TOO_SOON_DAYS = 7;
  // Levels (2026-11-18). On screen only three colours: red = past due or 5 days or less, orange = 30 days or less, green = fine.
  const HAYON_LEVELS = [
    { id: "depasse", label: "Dépassé", upTo: -1 },
    { id: "urgent", label: "5 jours ou moins", upTo: 5 },
    { id: "bientot", label: "30 jours ou moins", upTo: 30 },
    { id: "ok", label: "À jour", upTo: Infinity },
  ];
  const isHayon = (d) => d.service === "hayon";
  const daysBetween = (fromIso, toIso) => Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / 86400000);
  const hayonLevel = (daysLeft) => (daysLeft == null ? "inconnu" : HAYON_LEVELS.find((l) => daysLeft <= l.upTo).id);
  const isBookedHayon = (d) => isHayon(d) && !!d.date && d.statut !== "annulee";
  const hayonDone = (d, todayIso) => isBookedHayon(d) && (d.statut === "realisee" || d.date < todayIso);
  // What the team app writes on its own: a sent or confirmed control whose day has passed is done.
  const hayonAutoClose = (d, todayIso) => isBookedHayon(d) && ["envoyee", "confirmee"].includes(d.statut) && d.date < todayIso;
  const latest = (dates) => dates.filter(Boolean).sort().pop() || "";

  function hayonFollowUp(hayons, demandes, todayIso) {
    const vehicles = new Map();
    const entry = (plate) => {
      const key = plateKey(plate);
      if (!vehicles.has(key)) vehicles.set(key, { plaque: normalizePlate(plate), base: null, requests: [] });
      return vehicles.get(key);
    };
    hayons.filter((h) => plateKey(h.plaque)).forEach((h) => (entry(h.plaque).base = h));
    demandes.filter((d) => isHayon(d) && plateKey(d.plaque)).forEach((d) => entry(d.plaque).requests.push(d));
    return [...vehicles.values()].map(({ plaque, base, requests }) => {
      const doneRequests = requests.filter((d) => hayonDone(d, todayIso));
      const lastControl = latest([base?.dernierControle, ...doneRequests.map((d) => d.date)]);
      const lastRequest = doneRequests.sort((a, b) => b.date.localeCompare(a.date))[0] || null;
      const nextDue = lastControl ? addDays(lastControl, HAYON_CYCLE_DAYS) : "";
      const daysLeft = nextDue ? daysBetween(todayIso, nextDue) : null;
      const booked = requests.filter((d) => isBookedHayon(d) && !hayonDone(d, todayIso)).sort(byDateThenTime)[0] || null;
      const notDone = requests.filter((d) => d.nonFait && d.date > lastControl).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
      return { plaque, lastControl, lastRequest: lastRequest?.date === lastControl ? lastRequest : null, nextDue, daysLeft,
        level: hayonLevel(daysLeft), booked, notDone, tooSoon: hayonTooSoonPair(requests), site: booked?.site || lastRequest?.site || "" };
    }).sort((a, b) => (a.daysLeft ?? -Infinity) - (b.daysLeft ?? -Infinity) || a.plaque.localeCompare(b.plaque));
  }
  // Two controls of the same vehicle less than a week apart: one is probably a mistake (it happened once, 2026-11).
  // Sometimes it is on purpose (a problem on the tailgate), so the app warns and never blocks.
  function hayonTooSoon(candidate, demandes, ignoreIds = []) {
    const key = plateKey(candidate.plaque);
    if (!key || !candidate.date) return null;
    return demandes.filter((d) => !ignoreIds.includes(d.id) && isBookedHayon(d) && plateKey(d.plaque) === key)
      .map((d) => ({ other: d, gap: Math.abs(daysBetween(d.date, candidate.date)) }))
      .filter((x) => x.gap < HAYON_TOO_SOON_DAYS).sort((a, b) => a.gap - b.gap)[0] || null;
  }
  function hayonTooSoonPair(requests) {
    const booked = requests.filter(isBookedHayon).sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < booked.length; i++) {
      const gap = daysBetween(booked[i - 1].date, booked[i].date);
      if (gap < HAYON_TOO_SOON_DAYS) return { first: booked[i - 1], second: booked[i], gap };
    }
    return null;
  }
  // Warnings shown before saving a new tailgate control (never blocking).
  function hayonWarnings(candidate, demandes, hayons, todayIso, ignoreIds = []) {
    if (!isHayon(candidate) || !plateKey(candidate.plaque)) return [];
    const warnings = [];
    const close = hayonTooSoon(candidate, demandes, ignoreIds);
    if (close) warnings.push(`Un contrôle hayon est déjà posé pour ${normalizePlate(candidate.plaque)} le ${shortDate(close.other.date)}${close.gap ? `, à ${close.gap} jour${close.gap > 1 ? "s" : ""} de celui-ci` : ", le même jour"}.`);
    const others = demandes.filter((d) => !ignoreIds.includes(d.id));
    const row = hayonFollowUp(hayons, others, todayIso).find((r) => plateKey(r.plaque) === plateKey(candidate.plaque));
    if (!close && row?.nextDue && candidate.date && daysBetween(candidate.date, row.nextDue) > 30) {
      warnings.push(`Dernier contrôle le ${shortDate(row.lastControl)} : le prochain n'est dû que le ${shortDate(row.nextDue)} (dans ${row.daysLeft} jours).`);
    }
    return warnings;
  }
  // Provider sheet pasted from Google Sheets: each line holds a plate and, optionally, the date of the last control.
  const DATE_IN_TEXT = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/;
  function dateInText(text) {
    const m = String(text || "").match(DATE_IN_TEXT);
    if (!m) return "";
    const [y, mo, d] = m[4] ? [+m[4], +m[5], +m[6]] : [+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  function parseHayonList(text) {
    const seen = new Map();
    String(text || "").replace(/\r/g, "").split("\n").forEach((line) => {
      const plate = platesInText(line)[0];
      if (!plate) return;
      const date = dateInText(line.toUpperCase().replace(PLATE_IN_TEXT, " "));
      const previous = seen.get(plate);
      if (!previous || date > previous.dernierControle) seen.set(plate, { plaque: normalizePlate(plate), dernierControle: date });
    });
    return [...seen.values()];
  }

  // ---------- what the team app keeps loaded (free Firestore plan: every request read counts) ----------
  // Always loaded: requests whose day is in the current month or the two before, every open request,
  // every tailgate control (they set the 180-day due dates). Older ones are loaded only when a page asks for them.
  const RECENT_MONTHS = 2;
  const OLDEST_DAY = "0000-01-01";
  const monthStart = (iso) => iso.slice(0, 7) + "-01";
  const nextMonthStart = (iso) => { const d = parseIsoDate(monthStart(iso)); d.setMonth(d.getMonth() + 1); return toIsoDate(d); };
  const recentWindowStart = (todayIso, months = RECENT_MONTHS) => { const d = parseIsoDate(monthStart(todayIso)); d.setMonth(d.getMonth() - months); return toIsoDate(d); };
  // The part of [from, to) that lies before the loaded window, or null when the window already holds it all.
  function olderPart(from, to, recentFrom) {
    if (!from || from >= recentFrom) return null;
    return { from, to: !to || to > recentFrom ? recentFrom : to };
  }
  // Same request seen in several loaded slices: keep the most recently changed copy.
  function mergeSlices(slices) {
    const all = new Map();
    slices.forEach((rows) => rows.forEach((row) => {
      const kept = all.get(row.id);
      if (!kept || (row.updatedAt || "") >= (kept.updatedAt || "")) all.set(row.id, row);
    }));
    return [...all.values()];
  }

  // ---------- change history (historique/<auto id>): who changed what on a request, for a disagreement over an invoice ----------
  // One entry per save: {demandeId, plaque, action, changes:[{champ, avant, apres}], par: e-mail, at: server time, auto?}.
  // Nobody can change or delete an entry once written (see firestore.rules).
  const HISTORY_FIELDS = [
    ["statut", "Statut"], ["prixHT", "Prix HT"], ["date", "Date"], ["dateFin", "Date de fin"], ["debut", "Heure"], ["fin", "Heure de fin"],
    ["prestataire", "Prestataire"], ["service", "Prestation"], ["formule", "Formule"], ["plaque", "Plaque"], ["modele", "Modèle"],
    ["cubage", "Cubage"], ["site", "Site"], ["adresse", "Adresse"], ["tache", "Travail demandé"], ["notes", "Remarque"],
  ];
  const HISTORY_LABELS = { ...Object.fromEntries(HISTORY_FIELDS), reponse: "Réponse du prestataire", note: "Note du prestataire", dateProposee: "Date proposée" };
  const plainValue = (v) => (v == null ? "" : typeof v === "number" ? v : String(v).slice(0, 300));
  // Fields that really changed between the request before and the fields being written ("" for empty).
  function changesBetween(before, after) {
    return HISTORY_FIELDS.map(([champ]) => champ)
      .filter((champ) => after && champ in after && String(plainValue(after[champ])) !== String(plainValue(before?.[champ])))
      .map((champ) => ({ champ, avant: plainValue(before?.[champ]), apres: plainValue(after[champ]) }));
  }
  // What a provider answered, as history lines.
  const answerChanges = (retour) => [
    { champ: "reponse", avant: "", apres: retour.etat },
    ...(retour.date ? [{ champ: "dateProposee", avant: "", apres: retour.date + (retour.debut ? " " + retour.debut : "") }] : []),
    ...(retour.note ? [{ champ: "note", avant: "", apres: plainValue(retour.note) }] : []),
  ];
  function historyValue(champ, v) {
    if (v === "" || v == null) return "vide";
    if (champ === "statut") return statusOf(v).label;
    if (champ === "prixHT") return Number.isFinite(+v) ? `${String(+v).replace(".", ",")} € HT` : String(v);
    if (champ === "date" || champ === "dateFin") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? numericDate(v) : String(v);
    if (champ === "dateProposee") { const [day, time] = String(v).split(" "); return /^\d{4}-\d{2}-\d{2}$/.test(day) ? numericDate(day) + (time ? " à " + time : "") : String(v); }
    if (champ === "cubage") return `${v} m³`;
    if (champ === "service") return SERVICES.find((x) => x.id === v)?.label || String(v);
    if (champ === "reponse") return answerOf(v)?.label || String(v);
    return String(v);
  }
  const ACTION_LABELS = { creation: "Création", modification: "Modification", statut: "Changement de statut", reponse: "Réponse du prestataire", suppression: "Suppression" };
  // Firestore time (Timestamp) or ISO text -> Date.
  const historyTime = (at) => (at?.toDate ? at.toDate() : at?.seconds != null ? new Date(at.seconds * 1000) : at ? new Date(at) : null);
  function historyWhen(at) {
    const t = historyTime(at);
    return t && !isNaN(t) ? `${pad2(t.getDate())}/${pad2(t.getMonth() + 1)}/${t.getFullYear()} à ${pad2(t.getHours())}h${pad2(t.getMinutes())}` : "";
  }
  // Newest first, ready to show. Requests saved before the history existed get one line from their creation date.
  function historyLines(entries, demande) {
    const lines = (entries || []).map((e) => ({
      time: historyTime(e.at)?.getTime() || 0,
      when: historyWhen(e.at),
      who: e.auto ? `Appli (automatique, ouverte par ${e.par})` : e.par || "",
      action: ACTION_LABELS[e.action] || e.action,
      changes: (e.changes || []).map((c) => ({
        label: HISTORY_LABELS[c.champ] || c.champ,
        avant: e.action === "creation" || c.champ === "reponse" || c.champ === "note" || c.champ === "dateProposee" ? null : historyValue(c.champ, c.avant),
        apres: e.action === "suppression" ? historyValue(c.champ, c.avant) : historyValue(c.champ, c.apres),
      })),
    }));
    if (demande?.createdAt && !(entries || []).some((e) => e.action === "creation")) {
      lines.push({ time: historyTime(demande.createdAt)?.getTime() || 0, when: historyWhen(demande.createdAt), who: demande.source === "mail" ? "mail City-Drop" : "",
        action: "Création", changes: [] });
    }
    return lines.sort((a, b) => b.time - a.time);
  }

  // ---------- health of the mail robot (apps-script/import-mails.js writes robot/etat) ----------
  // robot/etat: {passage, dernierMail, erreur, erreurDepuis, nonCompris, nonComprisLe} (ISO dates).
  // The robot leaves a trace at least every 30 minutes. When it stops (password changed, Google block, error),
  // the team app is the one that notices, since a stopped robot cannot warn anyone itself.
  const ROBOT_LATE_MINUTES = 120;  // Google sometimes runs a 5-minute trigger late: two hours without a trace is a real stop.
  const ROBOT_QUIET_DAYS = 4;      // no City-Drop mail at all for that long: the box may no longer receive them.
  function robotHealth(etat, now = new Date()) {
    if (!etat || !etat.passage) return { level: "off", text: "Le robot des mails n'est pas encore installé (ou n'a encore jamais tourné)." };
    const at = (iso) => { const d = new Date(iso); return `${numericDate(toIsoDate(d))} à ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`; };
    const minutes = (now - new Date(etat.passage)) / 60000;
    if (minutes > ROBOT_LATE_MINUTES)
      return { level: "alert", text: `Le robot des mails ne tourne plus depuis le ${at(etat.passage)} : les demandes reçues par mail depuis n'arrivent plus dans l'appli.` };
    if (etat.erreur)
      return { level: "alert", text: `Le robot des mails a un problème depuis le ${at(etat.erreurDepuis || etat.passage)} : ${etat.erreur}` };
    if (etat.nonCompris && etat.nonComprisLe && (now - new Date(etat.nonComprisLe)) / 86400000 <= 3)
      return { level: "warn", text: `Le robot n'a pas su lire le mail « ${etat.nonCompris} » (le ${at(etat.nonComprisLe)}) : cette demande n'est pas dans l'appli, saisis-la à la main.` };
    if (etat.dernierMail && (now - new Date(etat.dernierMail)) / 86400000 > ROBOT_QUIET_DAYS)
      return { level: "warn", text: `Aucun mail de City-Drop reçu depuis le ${at(etat.dernierMail)}. Normal s'il n'y a eu aucun rendez-vous, sinon la boîte du robot ne reçoit peut-être plus les mails du groupe.` };
    return { level: "ok", text: `Le robot des mails tourne bien : dernier passage le ${at(etat.passage)}${etat.dernierMail ? `, dernier mail reçu le ${at(etat.dernierMail)}` : ""}.` };
  }

  const searchKey = (s) => String(s || "").toLowerCase().replace(/[-\s]/g, "");
  const matchesSearch = (fields, query) => !query || searchKey(fields.join(" ")).includes(searchKey(query));

  // ---------- plate search (Planning) ----------
  // For each plate containing the typed letters: what is on today, the next one to come, the last one before today.
  // Cancelled requests are left out. At least 3 letters or digits, so one keystroke does not list the whole fleet.
  const PLATE_SEARCH_MIN = 3;
  function plateLookup(demandes, query, todayIso, limit = 5) {
    const q = plateKey(query);
    if (q.length < PLATE_SEARCH_MIN) return { query: q, plates: [], more: 0 };
    const byPlate = new Map();
    for (const d of demandes) {
      const key = plateKey(d.plaque);
      if (!key || !key.includes(q) || d.statut === "annulee") continue;
      if (!byPlate.has(key)) byPlate.set(key, []);
      byPlate.get(key).push(d);
    }
    const plates = [...byPlate].map(([key, list]) => {
      const upcoming = list.filter((d) => d.date > todayIso).sort(byDateThenTime);
      const past = list.filter((d) => d.date && lastDay(d) < todayIso)
        .sort((a, b) => lastDay(b).localeCompare(lastDay(a)) || byStartTime(b, a));
      return {
        key, plaque: normalizePlate(list[0].plaque), vehicle: list.find((d) => d.modele) || list[0],
        today: list.filter((d) => isAvailableOn(d, todayIso)).sort(byStartTime),
        next: upcoming[0] || null, moreUpcoming: Math.max(0, upcoming.length - 1),
        last: past[0] || null, exact: key === q,
      };
    }).sort((a, b) => (b.exact - a.exact) || a.key.localeCompare(b.key));
    return { query: q, plates: plates.slice(0, limit), more: Math.max(0, plates.length - limit) };
  }
  // A full plate (SIV AB-123-CD or old 123 ABC 45): worth one targeted read of its older requests.
  const isFullPlate = (text) => /^[A-Z]{2}\d{3}[A-Z]{2}$|^\d{1,4}[A-Z]{2,3}\d{2}$/.test(plateKey(text));

  return {
    DEFAULT_SLOT, TASK_SUGGESTIONS, existingDuplicate, isIntervention, servicesFor, offers,
    SERVICES, STATUSES, NO_SITE, DEFAULT_PROVIDERS, DEFAULT_SITES, DEFAULT_FLEET,
    toIsoDate, parseIsoDate, addDays, mondayOf, longDate, dayLabel, shortDate, numericDate, monthLabel, timeSlotLabel, defaultEndTime,
    lastDay, isMultiDay, isAvailableOn, availabilityLabel,
    plateKey, normalizePlate, platesInText, PLATE_SEARCH_MIN, plateLookup, isFullPlate,
    fleetLabel, fleetIndex, modelKey, uniqueModels, baseModel, fleetBases, fleetVariants, normalizeSites, siteAddress, parseSiteList, mergeSites,
    serviceOf, WASH_KINDS, washKindOf, jobLabel, jobTitle, statusOf, isWindshield, isActive, isOpen, siteOf, vehicleLabel, byStartTime, byDateThenTime,
    groupBy, groupBySite, vehiclesOnDay, missingFields, statusTimestamps,
    requestMessage, duplicatePlates, dayListMessage, verificationMessage, whatsappLink, WHATSAPP_TARGETS, photoSheetLayout, squareSheetOptions,
    monthlyReport, monthlySummaryMessage, EXPORT_HEADER, exportRow, toTsv, toCsv,
    matchesSearch, RECENT_MONTHS, OLDEST_DAY, monthStart, nextMonthStart, recentWindowStart, olderPart, mergeSlices,
    providerId, ROLES, roleOf, emailKey, isEmail, VAT_RATE, withVat, euros, priceFor, priceLineLabel, KNOWN_PRICES, missingKnownPrices, providerFields, accessMigration,
    providerFromGarage, mailCompletion, mailMarkers, robotHealth, ROBOT_LATE_MINUTES, ROBOT_QUIET_DAYS,
    HAYON_CYCLE_DAYS, HAYON_LEVELS, isHayon, daysBetween, hayonLevel, hayonDone, hayonAutoClose, hayonFollowUp, hayonTooSoon, hayonWarnings, parseHayonList, dateInText,
    HISTORY_FIELDS, changesBetween, answerChanges, historyValue, historyLines, historyWhen,
    ANSWERS, answerOf, isForProvider, isAccepted, isLate, providerLists, providerCounts, answerSummary, statusFromAnswer, answerPatch, unseenAnswers, seenAnswers,
    PROBLEMS, PROBLEM_TEXT_MAX, problemOf, problemSummary, problemReport, PROBLEM_AFTER_DONE_DAYS, canReportAfterDone, openProblems, handledProblems, problemsOfRequest, problemsOfPlate,
  };
});
