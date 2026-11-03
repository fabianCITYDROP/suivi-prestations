// Shared database access. The page talks to the data only through this object.
// Layout: demandes/<id>, vehicules/<PLATEKEY>, photos/<key>, config/reglages.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./domain.js"));
  else root.SuiviStore = factory(root.SuiviDomain);
})(typeof self !== "undefined" ? self : this, function (D) {
  const MAX_PHOTOS_PER_VEHICLE = 12;

  function createStore(db) {
    const photoCache = new Map();
    const vehicleRef = (plate) => db.doc("vehicules/" + D.plateKey(plate));

    const modelRef = (key) => db.doc("modeles/" + key);

    function subscribe({ onDemandes, onVehicles, onModels, onSettings, onError }) {
      const toRows = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const unsubs = [
        db.collection("demandes").onSnapshot((s) => onDemandes(toRows(s)), onError),
        db.collection("vehicules").onSnapshot((s) => onVehicles(toRows(s)), onError),
        db.collection("modeles").onSnapshot((s) => onModels(toRows(s)), onError),
        db.doc("config/reglages").onSnapshot((s) => s.exists && onSettings(s.data()), onError),
      ];
      return () => unsubs.forEach((u) => u());
    }

    async function saveDemande(id, fields, previous) {
      const ref = id ? db.doc("demandes/" + id) : db.collection("demandes").doc();
      const now = new Date().toISOString();
      await ref.set({
        ...fields,
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

    const deleteDemande = (id) => db.doc("demandes/" + id).delete();
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

    return { subscribe, saveDemande, setStatus, deleteDemande, saveSettings, saveVehicle, updateVehicleModel, addPhoto, removePhoto, addModelPhoto, removeModelPhoto, loadPhoto, cachedPhoto: (k) => photoCache.get(k) };
  }

  return { createStore, MAX_PHOTOS_PER_VEHICLE };
});
