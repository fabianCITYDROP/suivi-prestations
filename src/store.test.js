// What the apps read at opening (free plan: 50,000 reads a day): a fake database records every live query.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("./store.js");

const ROWS = [
  { id: "recent", prestataireId: "allo", service: "pare-brise", date: "2026-11-10", statut: "realisee" },
  { id: "oldOpen", prestataireId: "allo", service: "lavage", date: "2026-05-01", statut: "envoyee" },
  { id: "oldDone", prestataireId: "allo", service: "lavage", date: "2026-05-02", statut: "realisee" },
  { id: "hayonYear", prestataireId: "dho", service: "hayon", date: "2026-03-01", statut: "realisee" },
  { id: "hayonOld", prestataireId: "dho", service: "hayon", date: "2025-01-01", statut: "realisee" },
];
const OPS = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, in: (a, b) => b.includes(a) };
// missing: list of field pairs whose composite index "does not exist" (the query fails like Firestore does).
function fakeDb({ missing = [] } = {}) {
  const listened = [];
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]]),
    onSnapshot(next, fail) {
      const fields = [...new Set(filters.map(([f]) => f))];
      listened.push(filters.map((x) => x.join(" ")).join(" & ") || name);
      setTimeout(() => {
        if (fields.length > 1 && missing.some((pair) => pair.every((f) => fields.includes(f)))) return fail({ code: "failed-precondition", message: "index" });
        const rows = name === "demandes" ? ROWS.filter((r) => filters.every(([f, op, v]) => OPS[op](r[f], v))) : [];
        next({ docs: rows.map((r) => ({ id: r.id, data: () => r })), exists: false });
      });
      return () => {};
    },
  });
  return { listened, collection: (name) => query(name, []), doc: () => ({ onSnapshot: () => () => {} }) };
}
const firstList = (start) => new Promise((resolve) => start(resolve));
const ids = (rows) => rows.map((r) => r.id).sort().join(" ");
const noop = () => {};
const team = (db) => firstList((onDemandes) => createStore(db).subscribe({ onDemandes, onVehicles: noop, onModels: noop, onSettings: noop, onProviders: noop, onError: assert.fail,
  recentFrom: "2026-10-10", hayonFrom: "2025-11-19" }));

test("team opening: last 40 days, open requests, tailgate controls of the year", async () => {
  const db = fakeDb();
  assert.equal(ids(await team(db)), "hayonYear oldOpen recent");
});
test("team: without the (service, date) index, every tailgate control as before", async () => {
  const db = fakeDb({ missing: [["service", "date"]] });
  assert.equal(ids(await team(db)), "hayonOld hayonYear oldOpen recent");
  assert.ok(db.listened.includes("service == hayon"));
});

const provider = (store) => firstList((onDemandes) => store.subscribeProvider("allo", { onDemandes, onModels: noop, onError: assert.fail, recentFrom: "2026-10-10" }));
test("provider opening: its last 40 days and its open requests; an older month on demand", async () => {
  const store = createStore(fakeDb());
  let latest = [];
  const first = await firstList((resolve) => store.subscribeProvider("allo", { onDemandes: (r) => { latest = r; resolve(r); }, onModels: noop, onError: assert.fail, recentFrom: "2026-10-10" }));
  assert.equal(ids(first), "oldOpen recent");
  await store.loadProviderMonth("2026-05-01");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ids(latest), "oldDone oldOpen recent");
});
test("provider: without its indexes, all its requests as before (one wide read, not two)", async () => {
  const db = fakeDb({ missing: [["prestataireId", "date"], ["prestataireId", "statut"]] });
  assert.equal(ids(await provider(createStore(db))), "oldDone oldOpen recent");
  assert.equal(db.listened.filter((q) => q === "prestataireId == allo").length, 1);
});
test("team: problem reports keep their own 40-day window when the requests window is shorter", async () => {
  const db = fakeDb();
  await firstList((onDemandes) => createStore(db).subscribe({ onDemandes, onVehicles: noop, onModels: noop, onSettings: noop, onProviders: noop, onProblems: noop, onError: assert.fail,
    recentFrom: "2026-11-04", hayonFrom: "2026-03-24", problemsFrom: "2026-10-10" }));
  assert.ok(db.listened.includes("date >= 2026-11-04"));
  assert.ok(db.listened.includes("at >= 2026-10-10"));
});

test("« Valider le lavage » écrit la demande acceptée et range le signalement ensemble", async () => {
  const writes = [];
  let n = 0;
  const ref = (path) => ({ path, id: path.split("/").pop() });
  const db = {
    collection: (name) => ({ doc: () => ref(name + "/new" + ++n) }),
    doc: (path) => ref(path),
    batch: () => ({ set: (r, d) => writes.push(["set", r.path, d]), update: (r, d) => writes.push(["update", r.path, d]), commit: async () => {} }),
  };
  const store = createStore(db, { email: () => "micha@city-drop.com" });
  const id = await store.validateWash({ id: "s9" }, { plaque: "GS-487-PR", service: "lavage", prestataire: "Du Sol au Toit", prestataireId: "du-sol-au-toit", date: "2026-11-23", signalementId: "s9" }, "micha@city-drop.com");
  assert.equal(id, "new1");
  const demande = writes.find((w) => w[1] === "demandes/new1")[2];
  assert.equal(demande.statut, "confirmee");
  assert.ok(demande.sentAt && demande.confirmedAt && !demande.doneAt);
  assert.equal(demande.signalementId, "s9");
  assert.deepEqual(writes.find((w) => w[1] === "signalements/s9").slice(0, 2), ["update", "signalements/s9"]);
  assert.equal(writes.find((w) => w[1] === "signalements/s9")[2].statut, "traite");
  assert.ok(writes.some((w) => w[1].startsWith("historique/")), "la création entre dans l'historique");
});
