// Shared database access. The page talks to the data only through this object.
// Layout: demandes/<id>, corbeille/<id> (deleted requests, 20 days), vehicules/<PLATEKEY>, photos/<key>, config/reglages,
//         hayons/<PLATEKEY> {plaque, dernierControle}, prestataires/<providerId> {nom, tarifs:[{service, cubageMin, cubageMax, prixHT}]}, comptes/<email> {role, prestataireId},
//         robot/etat {passage, dernierMail, erreur, erreurDepuis, nonCompris, nonComprisLe} written by the mail robot.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./domain.js"));
  else root.SuiviStore = factory(root.SuiviDomain);
})(typeof self !== "undefined" ? self : this, function (D) {
  const MAX_PHOTOS_PER_VEHICLE = 12;

  // options.email(): e-mail of the person signed in, written in the change history.
  function createStore(db, options = {}) {
    const photoCache = new Map();
    const signedInEmail = () => D.emailKey(options.email ? options.email() : "");

    // ----- change history: historique/<auto id>, written in the same batch as the change itself -----
    // The time comes from the server, so nobody can back-date an entry. Before the new access rules are
    // published the history is refused: the change itself is then saved alone, as before.
    const serverTime = () => (typeof firebase !== "undefined" && firebase.firestore?.FieldValue ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString());
    function historyEntry(demande, action, changes, { auto = false } = {}) {
      if (!changes.length && action !== "suppression" && action !== "restauration") return null;
      return { demandeId: demande.id, plaque: String(demande.plaque || "").slice(0, 20), action, changes: changes.slice(0, 30),
        par: signedInEmail(), at: serverTime(), ...(auto ? { auto: true } : {}) };
    }
    const runWrite = (target, ref, op, data) => (op === "delete" ? target.delete(ref) : target[op](ref, data));
    async function writeWithHistory(ref, op, data, entry) {
      const alone = () => (op === "delete" ? ref.delete() : ref[op](data));
      if (!entry) return alone();
      if (!db.batch) { await alone(); return db.collection("historique").add(entry).catch(() => {}); }
      const batch = db.batch();
      runWrite(batch, ref, op, data);
      batch.set(db.collection("historique").doc(), entry);
      try { await batch.commit(); }
      catch (err) { if (err?.code === "permission-denied") await alone(); else throw err; }
    }
    async function loadHistory(demandeId) {
      const snap = await db.collection("historique").where("demandeId", "==", demandeId).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    const demandeRef = (id) => db.doc("demandes/" + id);
    const vehicleRef = (plate) => db.doc("vehicules/" + D.plateKey(plate));

    const modelRef = (key) => db.doc("modeles/" + key);

    // ----- requests: several live "slices" merged into one list -----
    // Reading the whole collection at every opening would eat the free plan's daily reads (50,000) as the history grows,
    // so the apps listen only to the last 40 days, the open requests and the tailgate controls of the year; older ones
    // are added on demand. Nothing is deleted. A slice that needs a composite index the database does not have yet
    // falls back to its wider query (as before) until the index is created, so the app never breaks.
    let demandesFeed = null;
    const toRows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    function createFeed(onRows, onError) {
      const slices = new Map(); // key -> {rows, loaded, ready, unsub}
      const base = new Set();
      let pending = null;
      const emit = () => {
        pending = null;
        if (![...base].every((k) => slices.get(k)?.loaded)) return; // first list only once every base slice is in
        onRows(D.mergeSlices([...slices.values()].map((s) => s.rows)));
      };
      const scheduleEmit = () => { if (!pending) pending = setTimeout(emit, 0); };
      function add(key, query, { isBase = false, fallback = null } = {}) {
        if (isBase) base.add(key);
        if (slices.has(key)) return slices.get(key).ready;
        const slice = { rows: [], loaded: false };
        slices.set(key, slice);
        slice.ready = new Promise((resolve, reject) => {
          slice.unsub = query.onSnapshot((snap) => {
            slice.rows = toRows(snap);
            slice.loaded = true; resolve(); scheduleEmit();
          }, (err) => {
            if (fallback && err?.code === "failed-precondition") { // index missing: the message holds the link that creates it
              console.warn("Index Firestore manquant, lecture plus large en attendant :", err.message);
              slices.delete(key); base.delete(key);
              add(fallback.key, fallback.query, { isBase }).then(resolve, reject);
              return;
            }
            if (isBase) { onError(err); return; }
            slices.delete(key); reject(err); // an older period that failed can be asked again
          });
        });
        return slice.ready;
      }
      const stop = () => { slices.forEach((s) => s.unsub && s.unsub()); slices.clear(); base.clear(); };
      return { add, stop };
    }
    const OPEN_STATUSES = ["a_envoyer", "envoyee", "confirmee"];

    function subscribe({ onDemandes, onVehicles, onModels, onSettings, onProviders, onAccounts, onHayons, onProblems, onRobot, onDevices, onError, recentFrom, hayonFrom, problemsFrom }) {
      const requests = db.collection("demandes");
      demandesFeed = createFeed(onDemandes, onError);
      const canQuery = typeof requests.where === "function" && recentFrom;
      if (canQuery) {
        demandesFeed.add("recent", requests.where("date", ">=", recentFrom), { isBase: true });
        demandesFeed.add("open", requests.where("statut", "in", OPEN_STATUSES), { isBase: true });
        const hayons = requests.where("service", "==", "hayon");
        // Index demandes (service, date). Without it: every tailgate control, as before.
        demandesFeed.add("hayon", hayonFrom ? hayons.where("date", ">=", hayonFrom) : hayons,
          { isBase: true, fallback: hayonFrom ? { key: "hayon:all", query: hayons } : null });
      } else {
        demandesFeed.add("all", requests, { isBase: true }); // a database without queries: everything, as before
        demandesFeed = { ...demandesFeed, everything: true };
      }
      const unsubs = [
        () => demandesFeed && demandesFeed.stop(),
        db.collection("vehicules").onSnapshot((s) => onVehicles(toRows(s)), onError),
        db.collection("modeles").onSnapshot((s) => onModels(toRows(s)), onError),
        db.doc("config/reglages").onSnapshot((s) => s.exists && onSettings(s.data()), onError),
        db.collection("prestataires").onSnapshot((s) => onProviders(toRows(s)), onError),
      ];
      // Before the rules allowing it are published, this list simply stays empty.
      if (onHayons) unsubs.push(db.collection("hayons").onSnapshot((s) => onHayons(toRows(s)), () => onHayons([])));
      // Problem reports: the ones still to handle, plus those of the last 40 days (handled ones older than that stay saved).
      if (onProblems) {
        const reports = db.collection("signalements");
        if (canQuery) {
          const problemsFeed = createFeed(onProblems, () => onProblems([]));
          problemsFeed.add("nouveau", reports.where("statut", "==", "nouveau"), { isBase: true });
          problemsFeed.add("recent", reports.where("at", ">=", problemsFrom || recentFrom), { isBase: true });
          unsubs.push(problemsFeed.stop);
        } else unsubs.push(reports.onSnapshot((s) => onProblems(toRows(s)), () => onProblems([])));
      }
      // Only the team may list accounts: for anyone else this one simply stays empty.
      if (onAccounts) unsubs.push(db.collection("comptes").onSnapshot((s) => onAccounts(toRows(s)), () => onAccounts([])));
      // Devices registered for alerts (team only): kept without their address and secret token, which the page never needs.
      if (onDevices) unsubs.push(db.collection("abonnements").onSnapshot(
        (s) => onDevices(toRows(s).map(({ email, role, prestataireId, appareil, createdAt, updatedAt }) => ({ email, role, prestataireId, appareil, createdAt, updatedAt }))),
        () => onDevices(null)));
      // Trace left by the mail robot: refused until the new rules are published, then simply "not installed".
      if (onRobot) unsubs.push(db.doc("robot/etat").onSnapshot((s) => onRobot(s.exists ? s.data() : null), () => onRobot(null)));
      return () => unsubs.forEach((u) => u());
    }

    async function saveDemande(id, fields, previous) {
      const ref = id ? db.doc("demandes/" + id) : db.collection("demandes").doc();
      const now = new Date().toISOString();
      const entry = historyEntry({ id: ref.id, plaque: fields.plaque }, previous ? "modification" : "creation",
        D.changesBetween(previous || {}, fields).filter((c) => previous || c.apres !== ""));
      await writeWithHistory(ref, "set", {
        ...fields,
        ...(previous?.retour ? { retour: previous.retour } : {}), // the provider's answer survives an edit by the team
        ...(previous?.source === "mail" ? D.mailMarkers(previous) : {}), // an imported request stays cancellable by a later mail
        ...(previous?.notifie ? { notifie: previous.notifie } : {}), // what the alerts already announced: never twice
        ...D.statusTimestamps(previous, fields.statut, now),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      }, entry);
      changed();
      return ref.id;
    }

    async function setStatus(demande, status, opts = {}) {
      const now = new Date().toISOString();
      await writeWithHistory(demandeRef(demande.id), "update", { statut: status, ...D.statusTimestamps(demande, status, now), updatedAt: now },
        historyEntry(demande, "statut", D.changesBetween(demande, { statut: status }), opts));
      changed();
    }

    // The team app completing a request imported from a mail (provider, model, site, price).
    const completeDemande = (demande, fields) => writeWithHistory(demandeRef(demande.id), "update", { ...fields, updatedAt: new Date().toISOString() },
      historyEntry(demande, "modification", D.changesBetween(demande, fields), { auto: true })).then(changed);

    // ----- trash: corbeille/<request id> {demande, supprimeLe, supprimePar} -----
    // « Supprimer » moves the request to the trash for 20 days instead of erasing it (the weekly backup alone could lose
    // one deleted by mistake). Copy, removal and history go in one transaction, from the request as saved on the server.
    // The access rules refuse to delete a request that is not in the trash: before they are published nothing is deleted.
    const TRASH_DAYS = 20;
    const trashRef = (id) => db.doc("corbeille/" + id);
    const isoOf = (t) => (t && typeof t.toDate === "function" ? t.toDate().toISOString() : t || "");
    const notReady = (err) => (err?.code === "permission-denied" ? Object.assign(new Error("trash_not_ready"), { code: "trash_not_ready" }) : err);
    async function deleteDemande(demande) {
      const ref = demandeRef(demande.id);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return; // already gone (deleted on another device)
          const saved = snap.data();
          tx.set(trashRef(demande.id), { demande: saved, supprimeLe: serverTime(), supprimePar: signedInEmail() });
          tx.delete(ref);
          // The history keeps what the request was (plate, date, provider, price, status).
          tx.set(db.collection("historique").doc(), historyEntry({ ...saved, id: demande.id }, "suppression",
            D.changesBetween(saved, Object.fromEntries(D.HISTORY_FIELDS.map(([f]) => [f, ""]))).map((c) => ({ ...c, apres: "" }))));
        });
      } catch (err) { throw notReady(err); }
      changed();
    }
    // Everything in the trash (a few small documents: no photos), read when the Corbeille page opens.
    async function loadTrash() {
      const snap = await db.collection("corbeille").get();
      return snap.docs.map((doc) => { const t = doc.data(); return { id: doc.id, demande: t.demande || {}, supprimeLe: isoOf(t.supprimeLe), supprimePar: t.supprimePar || "" }; });
    }
    // Put requests back exactly as they were (a grouped wash comes back whole). Refused if the id is in use again.
    async function restoreDemandes(ids) {
      await db.runTransaction(async (tx) => {
        const items = await Promise.all(ids.map(async (id) => ({ id, trash: await tx.get(trashRef(id)), live: await tx.get(demandeRef(id)) })));
        if (items.some((it) => it.live.exists)) throw Object.assign(new Error("already_exists"), { code: "already_exists" });
        for (const { id, trash } of items) {
          if (!trash.exists) continue; // restored meanwhile on another device
          const saved = trash.data().demande || {};
          tx.set(demandeRef(id), saved);
          tx.delete(trashRef(id));
          tx.set(db.collection("historique").doc(), historyEntry({ ...saved, id }, "restauration", []));
        }
      });
      changed();
    }
    // Erase for good what has been in the trash 20 days. Run by the team app at opening (no paid server needed); the
    // rules refuse it earlier, so a wrong clock can never empty the trash too soon. Refusals are simply ignored.
    async function purgeTrash() {
      const limit = new Date(Date.now() - TRASH_DAYS * 86400000 - 3600000); // one hour of margin for the device's clock
      const expired = await db.collection("corbeille").where("supprimeLe", "<", limit).get().catch(() => null);
      if (!expired) return 0;
      const done = await Promise.all(expired.docs.map((doc) => doc.ref.delete().then(() => 1, () => 0)));
      return done.reduce((a, b) => a + b, 0);
    }

    // Requests whose day falls in [from, to) (to excluded), kept live once asked for. Resolves when they are in the list.
    function loadDemandesBetween(from, to) {
      if (!demandesFeed || demandesFeed.everything) return Promise.resolve();
      let query = db.collection("demandes");
      if (from && from > D.OLDEST_DAY) query = query.where("date", ">=", from);
      if (to) query = query.where("date", "<", to);
      return demandesFeed.add(`range:${from || ""}|${to || ""}`, query);
    }

    // One plate's requests of every period (plate search on the Planning): a few reads instead of the whole history.
    function loadDemandesOfPlate(plate) {
      if (!demandesFeed || demandesFeed.everything || !D.plateKey(plate)) return Promise.resolve();
      // Plates are saved as AB-123-CD by the app; a mail may carry AB123CD or AB 123 CD.
      const dashed = D.normalizePlate(plate);
      const forms = [...new Set([dashed, D.plateKey(plate), dashed.replace(/-/g, " ")])];
      return demandesFeed.add("plate:" + D.plateKey(plate), db.collection("demandes").where("plaque", "in", forms));
    }

    // ----- providers, prices and accounts -----
    const saveProvider = (id, fields) => db.doc("prestataires/" + id).set({ ...fields, updatedAt: new Date().toISOString() }, { merge: true });
    const saveAccount = (email, fields) => db.doc("comptes/" + D.emailKey(email)).set({ ...fields, email: D.emailKey(email), updatedAt: new Date().toISOString() });
    // Removing an access also removes that person's alert devices: a former provider gets no more alerts.
    async function deleteAccount(email) {
      await db.doc("comptes/" + D.emailKey(email)).delete();
      try {
        const devices = await db.collection("abonnements").where("email", "==", D.emailKey(email)).get();
        await Promise.all(devices.docs.map((d) => d.ref.delete()));
      } catch {}
    }
    // ----- alerts on closed apps (apps-script/notifications.js) -----
    let changed = () => {};
    const onChange = (fn) => { changed = fn; };
    const getAlertSettings = () => db.doc("public/notifications").get().then((s) => (s.exists ? s.data() : null)).catch(() => null);
    const saveAlertSettings = (fields) => db.doc("public/notifications").set({ ...fields, updatedAt: new Date().toISOString() });
    const saveDevice = (id, fields) => db.doc("abonnements/" + id).set(fields);
    async function getAccount(email) {
      if (!email) return null;
      try { const snap = await db.doc("comptes/" + D.emailKey(email)).get(); return snap.exists ? snap.data() : null; }
      catch { return null; }
    }
    // ----- provider side: only its own requests (the rules refuse an unfiltered list) -----
    // At opening: its requests of the last 40 days and its open ones; older ones only when it asks (« Faits » tab).
    // Indexes demandes (prestataireId, date) and (prestataireId, statut). Without them: all its requests, as before.
    let providerFeed = null;
    function subscribeProvider(prestataireId, { onDemandes, onModels, onProblems, onError, recentFrom }) {
      const mine = db.collection("demandes").where("prestataireId", "==", prestataireId);
      const all = { key: "all", query: mine };
      providerFeed = createFeed(onDemandes, onError);
      if (recentFrom) {
        providerFeed.add("recent", mine.where("date", ">=", recentFrom), { isBase: true, fallback: all });
        providerFeed.add("open", mine.where("statut", "in", OPEN_STATUSES), { isBase: true, fallback: all });
      } else providerFeed.add("all", mine, { isBase: true });
      providerFeed.mine = mine; providerFeed.recentFrom = recentFrom;
      const unsubs = [
        () => providerFeed && providerFeed.stop(),
        db.collection("modeles").onSnapshot((s) => onModels(toRows(s)), onError),
      ];
      // Its own problem reports, so it does not report the same thing twice. Empty until the rules are published.
      if (onProblems) unsubs.push(db.collection("signalements").where("prestataireId", "==", prestataireId).onSnapshot((s) => onProblems(toRows(s)), () => onProblems([])));
      return () => unsubs.forEach((u) => u());
    }
    // One month of the provider's requests, asked for from its « Faits » tab (« Voir un ancien mois »).
    // Read from the month before: a job planned at the end of a month is sometimes done early the next one.
    function loadProviderMonth(firstDay) {
      if (!providerFeed?.recentFrom) return Promise.resolve();
      const from = D.monthStart(D.addDays(firstDay, -1)), to = D.nextMonthStart(firstDay);
      if (from >= providerFeed.recentFrom) return Promise.resolve(); // already loaded at opening
      return providerFeed.add(`month:${firstDay}`, providerFeed.mine.where("date", ">=", from).where("date", "<", to), { fallback: { key: "all", query: providerFeed.mine } });
    }
    const getProvider = (id) => db.doc("prestataires/" + id).get().then((snap) => (snap.exists ? snap.data() : null));
    async function answer(demande, retour) {
      const now = new Date().toISOString();
      const patch = D.answerPatch(demande, retour, now);
      const entry = historyEntry(demande, "reponse", D.answerChanges(retour));
      // A « fait » that closes the request carries the server's time: the provider can take it back for a few minutes.
      if (patch.statut === "realisee" && retour.etat === "fait") {
        try { await writeWithHistory(demandeRef(demande.id), "update", { ...patch, retour: { ...patch.retour, le: serverTime() } }, entry); }
        catch (err) {
          if (err?.code !== "permission-denied") throw err;
          await writeWithHistory(demandeRef(demande.id), "update", patch, entry); // access rules not republished yet: as before
        }
      } else await writeWithHistory(demandeRef(demande.id), "update", patch, entry);
      changed();
    }
    // « Corriger »: the provider takes back its « fait » (the access rules allow it 10 minutes).
    async function undoDone(demande, email, note = "") {
      const now = new Date().toISOString();
      const remove = typeof firebase !== "undefined" && firebase.firestore?.FieldValue ? firebase.firestore.FieldValue.delete() : null;
      const patch = { ...D.undoDonePatch(demande, email, now, note), ...(remove ? { doneAt: remove } : {}) };
      await writeWithHistory(demandeRef(demande.id), "update", patch, historyEntry(demande, "reponse", D.undoDoneChanges(note)));
      changed(); // the alert script looks at once: the team is told even with the app closed
    }
    // A problem seen on a vehicle: the photo (optional) goes in preuves/<key> like a proof, then the report itself.
    async function reportProblem(demande, fields, photoFull) {
      let photo = "";
      if (photoFull) {
        photo = `sig_${D.plateKey(demande.plaque)}_${Date.now().toString(36)}`;
        await db.doc("preuves/" + photo).set({ prestataireId: demande.prestataireId, plaque: demande.plaque, data: photoFull, at: new Date().toISOString() });
        photoCache.set("preuve:" + photo, photoFull);
      }
      const report = D.problemReport(demande, { ...fields, photo }, fields.par, new Date().toISOString());
      if (report.error) throw { code: "invalid", message: report.error };
      await db.collection("signalements").doc().set(report);
      changed(); // the alert script looks at once: the team is told even with the app closed
    }
    // Field report on any vehicle (« Signaler » tab), not tied to a request: same collection, same photo place.
    async function reportField(prestataireId, fields, photoFull) {
      let photo = "";
      const plaque = D.normalizePlate(fields.plaque);
      if (photoFull) {
        photo = `sig_${D.plateKey(plaque)}_${Date.now().toString(36)}`;
        await db.doc("preuves/" + photo).set({ prestataireId, plaque, data: photoFull, at: new Date().toISOString() });
        photoCache.set("preuve:" + photo, photoFull);
      }
      const report = D.fieldReport({ ...fields, photo }, prestataireId, fields.par, new Date().toISOString());
      if (report.error) throw { code: "invalid", message: report.error };
      await db.collection("signalements").doc().set(report);
      changed(); // the alert script looks at once: the team is told even with the app closed
    }
    // Its author takes back a report sent by mistake (the access rules allow it until the team has handled it).
    const deleteProblem = (id) => db.doc("signalements/" + id).delete();
    const markProblemHandled = (report, email, handled = true) => db.doc("signalements/" + report.id).update(
      handled ? { statut: "traite", traiteAt: new Date().toISOString(), traitePar: email || "" } : { statut: "nouveau", traiteAt: "", traitePar: "" });
    async function loadProof(key) {
      const cacheKey = "preuve:" + key;
      if (!photoCache.has(cacheKey)) {
        const snap = await db.doc("preuves/" + key).get();
        if (snap.exists) photoCache.set(cacheKey, snap.data().data);
      }
      return photoCache.get(cacheKey);
    }
    // ----- team side: follow the answers -----
    async function applyAnswer(demande, status) {
      const now = new Date().toISOString();
      const done = status === "realisee" && demande.retour?.at ? { ...D.statusTimestamps(demande, status, now), doneAt: demande.retour.at } : D.statusTimestamps(demande, status, now);
      await writeWithHistory(demandeRef(demande.id), "update", { statut: status, ...done, retour: { ...demande.retour, applique: true }, updatedAt: now },
        historyEntry(demande, "statut", D.changesBetween(demande, { statut: status }), { auto: true }));
    }
    const markAnswerSeen = (demande) => db.doc("demandes/" + demande.id).update({ retour: { ...demande.retour, vu: true } });
    // Accepting the provider's date also confirms the request: it moves to the provider's planning.
    function acceptProposedDate(demande) {
      const now = new Date().toISOString();
      const fields = { date: demande.retour.date, dateFin: demande.retour.date, debut: demande.retour.debut || demande.debut || "", statut: "confirmee" };
      return writeWithHistory(demandeRef(demande.id), "update", {
        ...fields, ...D.statusTimestamps(demande, "confirmee", now),
        retour: { ...demande.retour, vu: true }, updatedAt: now,
      }, historyEntry(demande, "modification", D.changesBetween(demande, fields)));
    }

    // One-off preparation before the access rules are published: link every request to its provider.
    async function linkRequests(updates) {
      if (!db.batch) { for (const { id, ...fields } of updates) await db.doc("demandes/" + id).update(fields); return; }
      for (let i = 0; i < updates.length; i += 400) {
        const batch = db.batch();
        updates.slice(i, i + 400).forEach(({ id, ...fields }) => batch.update(db.doc("demandes/" + id), fields));
        await batch.commit();
      }
    }
    // ----- tailgate controls: hayons/<PLATEKEY> {plaque, dernierControle} -----
    async function saveHayons(list) {
      const now = new Date().toISOString();
      const write = (h) => db.doc("hayons/" + D.plateKey(h.plaque)).set({ plaque: h.plaque, dernierControle: h.dernierControle || "", updatedAt: now });
      if (!db.batch) { for (const h of list) await write(h); return; }
      for (let i = 0; i < list.length; i += 400) {
        const batch = db.batch();
        list.slice(i, i + 400).forEach((h) => batch.set(db.doc("hayons/" + D.plateKey(h.plaque)), { plaque: h.plaque, dernierControle: h.dernierControle || "", updatedAt: now }));
        await batch.commit();
      }
    }
    const deleteHayon = (plate) => db.doc("hayons/" + D.plateKey(plate)).delete();
    // "Pas fait": the control did not happen, so it does not restart the 180 days. "Finalement fait" undoes it.
    function markHayonNotDone(demande, notDone) {
      const now = new Date().toISOString();
      const statut = notDone ? "annulee" : "realisee";
      return writeWithHistory(demandeRef(demande.id), "update", { statut, nonFait: notDone, ...D.statusTimestamps(demande, statut, now), ...(notDone ? { annuleeAt: now } : {}), updatedAt: now },
        historyEntry(demande, "statut", D.changesBetween(demande, { statut })));
    }

    const saveSettings = (settings) => db.doc("config/reglages").set(settings);

    // Vehicle sheet: fleet model from the latest request, plus its windshield photos.
    async function saveVehicle(vehicle, identity) {
      const body = {
        plaque: identity.plaque,
        modele: identity.modele || vehicle?.modele || "",
        cubage: identity.cubage ?? vehicle?.cubage ?? null,
        photos: vehicle?.photos || [],
        updatedAt: new Date().toISOString(),
      };
      await vehicleRef(identity.plaque).set(body);
      return body;
    }

    const updateVehicleModel = (vehicle, { modele, cubage }) =>
      vehicleRef(vehicle.plaque).update({ modele, cubage, updatedAt: new Date().toISOString() });

    async function addPhoto(vehicle, plate, { full, thumb }) {
      const photos = vehicle?.photos || [];
      if (photos.length >= MAX_PHOTOS_PER_VEHICLE) throw { code: "too_many_photos" };
      const key = `${D.plateKey(plate)}_${Date.now().toString(36)}`;
      await db.doc("photos/" + key).set({ plaque: plate, data: full });
      photoCache.set(key, full);
      const entry = { key, thumb, addedAt: new Date().toISOString() };
      if (vehicle) await vehicleRef(plate).update({ photos: [...photos, entry], updatedAt: entry.addedAt });
      else await vehicleRef(plate).set({ plaque: plate, modele: "", cubage: null, photos: [entry], updatedAt: entry.addedAt });
      return entry;
    }

    async function removePhoto(vehicle, key) {
      await vehicleRef(vehicle.plaque).update({ photos: vehicle.photos.filter((p) => p.key !== key), updatedAt: new Date().toISOString() });
      await db.doc("photos/" + key).delete();
      photoCache.delete(key);
    }

    // Model album: modeles/<modelKey> {modele, cubage, photos:[{key, thumb, addedAt}]}, full images in photos/<key>.
    async function addModelPhoto(album, model, { full, thumb }) {
      const photos = album?.photos || [];
      if (photos.length >= MAX_PHOTOS_PER_VEHICLE) throw { code: "too_many_photos" };
      const albumKey = D.modelKey(model);
      const key = `${albumKey}_${Date.now().toString(36)}`;
      await db.doc("photos/" + key).set({ modele: model.modele, cubage: model.cubage ?? null, data: full });
      photoCache.set(key, full);
      const entry = { key, thumb, addedAt: new Date().toISOString() };
      await modelRef(albumKey).set({ modele: model.modele, cubage: model.cubage ?? null, photos: [...photos, entry], updatedAt: entry.addedAt });
      return entry;
    }

    async function removeModelPhoto(album, key) {
      await modelRef(D.modelKey(album)).update({ photos: album.photos.filter((p) => p.key !== key), updatedAt: new Date().toISOString() });
      await db.doc("photos/" + key).delete();
      photoCache.delete(key);
    }

    async function loadPhoto(key) {
      if (!photoCache.has(key)) {
        const snap = await db.doc("photos/" + key).get();
        if (snap.exists) photoCache.set(key, snap.data().data);
      }
      return photoCache.get(key);
    }

    return { onChange, getAlertSettings, saveAlertSettings, saveDevice, loadDemandesBetween, loadDemandesOfPlate, olderOnDemand: () => !!demandesFeed && !demandesFeed.everything, loadHistory, reportProblem, reportField, deleteProblem, markProblemHandled, saveHayons, deleteHayon, markHayonNotDone, subscribeProvider, loadProviderMonth, getProvider, answer, undoDone, loadProof, applyAnswer, markAnswerSeen, completeDemande, acceptProposedDate, saveProvider, saveAccount, deleteAccount, getAccount, linkRequests, subscribe, saveDemande, setStatus, deleteDemande, loadTrash, restoreDemandes, purgeTrash, saveSettings, saveVehicle, updateVehicleModel, addPhoto, removePhoto, addModelPhoto, removeModelPhoto, loadPhoto, cachedPhoto: (k) => photoCache.get(k) };
  }

  return { createStore, MAX_PHOTOS_PER_VEHICLE };
});
