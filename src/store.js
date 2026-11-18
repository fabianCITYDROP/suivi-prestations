// Shared database access. The page talks to the data only through this object.
// Layout: demandes/<id>, vehicules/<PLATEKEY>, photos/<key>, config/reglages,
//         hayons/<PLATEKEY> {plaque, dernierControle}, prestataires/<providerId> {nom, tarifs:[{service, cubageMin, cubageMax, prixHT}]}, comptes/<email> {role, prestataireId}.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./domain.js"));
  else root.SuiviStore = factory(root.SuiviDomain);
})(typeof self !== "undefined" ? self : this, function (D) {
  const MAX_PHOTOS_PER_VEHICLE = 12;

  function createStore(db) {
    const photoCache = new Map();
    const vehicleRef = (plate) => db.doc("vehicules/" + D.plateKey(plate));

    const modelRef = (key) => db.doc("modeles/" + key);

    function subscribe({ onDemandes, onVehicles, onModels, onSettings, onProviders, onAccounts, onHayons, onProblems, onError }) {
      const toRows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const unsubs = [
        db.collection("demandes").onSnapshot((s) => onDemandes(toRows(s)), onError),
        db.collection("vehicules").onSnapshot((s) => onVehicles(toRows(s)), onError),
        db.collection("modeles").onSnapshot((s) => onModels(toRows(s)), onError),
        db.doc("config/reglages").onSnapshot((s) => s.exists && onSettings(s.data()), onError),
        db.collection("prestataires").onSnapshot((s) => onProviders(toRows(s)), onError),
      ];
      // Before the rules allowing it are published, this list simply stays empty.
      if (onHayons) unsubs.push(db.collection("hayons").onSnapshot((s) => onHayons(toRows(s)), () => onHayons([])));
      if (onProblems) unsubs.push(db.collection("signalements").onSnapshot((s) => onProblems(toRows(s)), () => onProblems([])));
      // Only the team may list accounts: for anyone else this one simply stays empty.
      if (onAccounts) unsubs.push(db.collection("comptes").onSnapshot((s) => onAccounts(toRows(s)), () => onAccounts([])));
      return () => unsubs.forEach((u) => u());
    }

    async function saveDemande(id, fields, previous) {
      const ref = id ? db.doc("demandes/" + id) : db.collection("demandes").doc();
      const now = new Date().toISOString();
      await ref.set({
        ...fields,
        ...(previous?.retour ? { retour: previous.retour } : {}), // the provider's answer survives an edit by the team
        ...(previous?.source === "mail" ? D.mailMarkers(previous) : {}), // an imported request stays cancellable by a later mail
        ...D.statusTimestamps(previous, fields.statut, now),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      });
      return ref.id;
    }

    async function setStatus(demande, status) {
      const now = new Date().toISOString();
      await db.doc("demandes/" + demande.id).update({ statut: status, ...D.statusTimestamps(demande, status, now), updatedAt: now });
    }

    // The team app completing a request imported from a mail (provider, model, site, price).
    const completeDemande = (id, fields) => db.doc("demandes/" + id).update({ ...fields, updatedAt: new Date().toISOString() });

    const deleteDemande = (id) => db.doc("demandes/" + id).delete();

    // ----- providers, prices and accounts -----
    const saveProvider = (id, fields) => db.doc("prestataires/" + id).set({ ...fields, updatedAt: new Date().toISOString() }, { merge: true });
    const saveAccount = (email, fields) => db.doc("comptes/" + D.emailKey(email)).set({ ...fields, email: D.emailKey(email), updatedAt: new Date().toISOString() });
    const deleteAccount = (email) => db.doc("comptes/" + D.emailKey(email)).delete();
    async function getAccount(email) {
      if (!email) return null;
      try { const snap = await db.doc("comptes/" + D.emailKey(email)).get(); return snap.exists ? snap.data() : null; }
      catch { return null; }
    }
    // ----- provider side: only its own requests (the rules refuse an unfiltered list) -----
    function subscribeProvider(prestataireId, { onDemandes, onModels, onProblems, onError }) {
      const toRows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const unsubs = [
        db.collection("demandes").where("prestataireId", "==", prestataireId).onSnapshot((s) => onDemandes(toRows(s)), onError),
        db.collection("modeles").onSnapshot((s) => onModels(toRows(s)), onError),
      ];
      // Its own problem reports, so it does not report the same thing twice. Empty until the rules are published.
      if (onProblems) unsubs.push(db.collection("signalements").where("prestataireId", "==", prestataireId).onSnapshot((s) => onProblems(toRows(s)), () => onProblems([])));
      return () => unsubs.forEach((u) => u());
    }
    const getProvider = (id) => db.doc("prestataires/" + id).get().then((snap) => (snap.exists ? snap.data() : null));
    async function answer(demande, retour) {
      const now = new Date().toISOString();
      await db.doc("demandes/" + demande.id).update({ retour: { ...retour, at: now }, updatedAt: now });
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
    }
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
      await db.doc("demandes/" + demande.id).update({ statut: status, ...done, retour: { ...demande.retour, applique: true }, updatedAt: now });
    }
    const markAnswerSeen = (demande) => db.doc("demandes/" + demande.id).update({ retour: { ...demande.retour, vu: true } });
    // Accepting the provider's date also confirms the request: it moves to the provider's planning.
    function acceptProposedDate(demande) {
      const now = new Date().toISOString();
      return db.doc("demandes/" + demande.id).update({
        date: demande.retour.date, dateFin: demande.retour.date, debut: demande.retour.debut || demande.debut || "",
        statut: "confirmee", ...D.statusTimestamps(demande, "confirmee", now),
        retour: { ...demande.retour, vu: true }, updatedAt: now,
      });
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
      return db.doc("demandes/" + demande.id).update({ statut, nonFait: notDone, ...D.statusTimestamps(demande, statut, now), ...(notDone ? { annuleeAt: now } : {}), updatedAt: now });
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

    return { reportProblem, markProblemHandled, saveHayons, deleteHayon, markHayonNotDone, subscribeProvider, getProvider, answer, loadProof, applyAnswer, markAnswerSeen, completeDemande, acceptProposedDate, saveProvider, saveAccount, deleteAccount, getAccount, linkRequests, subscribe, saveDemande, setStatus, deleteDemande, saveSettings, saveVehicle, updateVehicleModel, addPhoto, removePhoto, addModelPhoto, removeModelPhoto, loadPhoto, cachedPhoto: (k) => photoCache.get(k) };
  }

  return { createStore, MAX_PHOTOS_PER_VEHICLE };
});
