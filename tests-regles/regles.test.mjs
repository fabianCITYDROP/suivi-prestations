// Each test signs in as one kind of person and checks what Firestore lets them do.
import { test, before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";

let env;
const ALLO = "allo-pare-brise-78";
const KHALID = "khalid";
const people = {
  fabian: { email: "fabian@city-drop.com", role: "admin" },
  jerome: { email: "jerome@city-drop.com", role: "lecture" },
  allo: { email: "contact@allo-pb.fr", role: "prestataire", prestataireId: ALLO },
  khalid: { email: "khalid@lavage.fr", role: "prestataire", prestataireId: KHALID },
};
const as = (who) => env.authenticatedContext(who, { email: people[who]?.email || `${who}@exemple.fr` }).firestore();
const allo = { prestataire: "ALLO pare-brise 78", prestataireId: ALLO, plaque: "AB-123-CD", statut: "envoyee", prixHT: 300 };
const lavage = { prestataire: "Khalid", prestataireId: KHALID, plaque: "EF-456-GH", statut: "envoyee", prixHT: 37 };

before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-suivi", firestore: { rules: readFileSync(new URL("../src/firestore.rules", import.meta.url), "utf8") } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const p of Object.values(people)) await setDoc(doc(db, "comptes", p.email), p);
    await setDoc(doc(db, "demandes/d1"), allo);
    await setDoc(doc(db, "demandes/d2"), lavage);
    await setDoc(doc(db, "prestataires", ALLO), { nom: "ALLO pare-brise 78", tarifs: [{ service: "pare-brise", prixHT: 300 }] });
    await setDoc(doc(db, "prestataires", KHALID), { nom: "Khalid", tarifs: [{ service: "lavage", prixHT: 37 }] });
    await setDoc(doc(db, "config/reglages"), { prestataires: ["ALLO pare-brise 78", "Khalid"] });
    await setDoc(doc(db, "modeles/OPELMOVANO202312"), { modele: "Opel Movano 2023", photos: [] });
    await setDoc(doc(db, "vehicules/AB123CD"), { plaque: "AB-123-CD" });
  });
});
after(() => env.cleanup());

test("l'équipe CityDrop voit et modifie tout", async () => {
  const db = as("fabian");
  await assertSucceeds(getDocs(collection(db, "demandes")));
  await assertSucceeds(setDoc(doc(db, "demandes/d3"), allo));
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { statut: "realisee" }));
  await assertSucceeds(deleteDoc(doc(db, "demandes/d3")));
  await assertSucceeds(setDoc(doc(db, "comptes/nouveau@exemple.fr"), { role: "prestataire", prestataireId: KHALID }));
  await assertSucceeds(updateDoc(doc(db, "prestataires", ALLO), { tarifs: [] }));
  await assertSucceeds(setDoc(doc(db, "config/reglages"), { prestataires: [] }));
});

test("Khalid ne voit ni les demandes ni les tarifs d'Allo Pare-Brise", async () => {
  const db = as("khalid");
  await assertFails(getDoc(doc(db, "demandes/d1")));
  await assertFails(getDocs(collection(db, "demandes")));
  await assertFails(getDocs(query(collection(db, "demandes"), where("prestataireId", "==", ALLO))));
  await assertFails(getDoc(doc(db, "prestataires", ALLO)));
  await assertFails(getDoc(doc(db, "config/reglages")));
  await assertFails(getDoc(doc(db, "vehicules/AB123CD")));
  await assertFails(getDoc(doc(db, "comptes", people.allo.email)));
  await assertFails(updateDoc(doc(db, "demandes/d1"), { retour: { etat: "fait" } }));
});

test("un prestataire voit ses demandes, sa fiche et les photos des modèles", async () => {
  const db = as("khalid");
  await assertSucceeds(getDoc(doc(db, "demandes/d2")));
  await assertSucceeds(getDocs(query(collection(db, "demandes"), where("prestataireId", "==", KHALID))));
  await assertSucceeds(getDoc(doc(db, "prestataires", KHALID)));
  await assertSucceeds(getDoc(doc(db, "comptes", people.khalid.email)));
  await assertSucceeds(getDoc(doc(db, "modeles/OPELMOVANO202312")));
});

test("un prestataire peut seulement répondre à sa demande, pas changer le reste", async () => {
  const db = as("khalid");
  const answer = { etat: "fait", at: "2026-11-04T10:00:00Z", par: people.khalid.email, preuve: "p1" };
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { retour: answer, updatedAt: "2026-11-04T10:00:00Z" }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...answer, vu: true } }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...answer, etat: "payé" } }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...answer, par: people.allo.email } }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { prixHT: 999 }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { statut: "realisee" }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { prestataireId: ALLO }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { site: "Aulnay" }));
  await assertFails(setDoc(doc(db, "demandes/d9"), lavage));
  await assertFails(deleteDoc(doc(db, "demandes/d2")));
  await assertFails(updateDoc(doc(db, "prestataires", KHALID), { tarifs: [{ service: "lavage", prixHT: 99 }] }));
  await assertFails(setDoc(doc(db, "comptes", people.khalid.email), { role: "admin" }));
  await assertFails(setDoc(doc(db, "modeles/OPELMOVANO202312"), { modele: "x" }));
});

test("les photos de preuve restent chez leur prestataire et l'équipe", async () => {
  const khalid = as("khalid");
  await assertSucceeds(setDoc(doc(khalid, "preuves/p1"), { prestataireId: KHALID, demandeId: "d2", data: "x" }));
  await assertFails(setDoc(doc(khalid, "preuves/p2"), { prestataireId: ALLO, demandeId: "d1", data: "x" }));
  await assertSucceeds(getDoc(doc(khalid, "preuves/p1")));
  await assertFails(deleteDoc(doc(khalid, "preuves/p1")));
  await assertFails(getDoc(doc(as("allo"), "preuves/p1")));
  await assertSucceeds(getDoc(doc(as("fabian"), "preuves/p1")));
  await assertSucceeds(getDoc(doc(as("jerome"), "preuves/p1")));
});

test("Jérôme lit tout mais ne modifie rien", async () => {
  const db = as("jerome");
  await assertSucceeds(getDocs(collection(db, "demandes")));
  await assertSucceeds(getDocs(collection(db, "prestataires")));
  await assertFails(updateDoc(doc(db, "demandes/d1"), { statut: "realisee" }));
  await assertFails(updateDoc(doc(db, "prestataires", ALLO), { tarifs: [] }));
  await assertFails(getDocs(collection(db, "comptes")));
});

test("un compte connecté mais pas enregistré ne voit rien", async () => {
  const db = as("inconnu");
  await assertFails(getDoc(doc(db, "demandes/d1")));
  await assertFails(getDoc(doc(db, "modeles/OPELMOVANO202312")));
  await assertFails(getDoc(doc(db, "photos/x")));
  await assertFails(setDoc(doc(db, "comptes/inconnu@exemple.fr"), { role: "admin" }));
});

test("sans connexion, rien n'est accessible", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "demandes/d1")));
  await assertFails(getDoc(doc(db, "comptes", people.fabian.email)));
});

test("un prestataire ne peut pas se donner plus de droits", async () => {
  const db = as("khalid");
  await assertFails(updateDoc(doc(db, "comptes", people.khalid.email), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "comptes", people.khalid.email), { prestataireId: ALLO }));
  await assertFails(setDoc(doc(db, "comptes/complice@exemple.fr"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "prestataires", KHALID), { tarifs: [{ service: "lavage", prixHT: 999 }] }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { prixHT: 999 }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { etat: "fait", at: "2026-11-05", par: "quelquun@autre.fr" } }));
  await assertFails(setDoc(doc(db, "preuves/p9"), { prestataireId: ALLO }));
});
