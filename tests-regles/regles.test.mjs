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
  robot: { email: "robot-mails@city-drop.com", role: "robot" },
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

const mail = { source: "mail", mailId: "mail-1", statut: "envoyee", service: "lavage", plaque: "GS-487-PR", modeleMail: "M20H-DVL", km: 119570,
  date: "2026-11-12", debut: "18:30", dateFin: "2026-11-12", fin: "22:00", tache: "Lavage extérieur + Lavage intérieur",
  garageMail: "Du sol au toit 78&92", sentAt: "2026-11-10T10:00:00Z", createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z" };

test("le robot des mails ajoute une demande lue dans un mail, une seule fois", async () => {
  const db = as("robot");
  await assertSucceeds(setDoc(doc(db, "demandes/mail-1"), mail));
  await assertFails(setDoc(doc(db, "demandes/mail-1"), mail), "le même mail ne s'ajoute pas deux fois");
});

test("le robot des mails ne lit rien et ne peut rien changer d'autre", async () => {
  const db = as("robot");
  await assertFails(getDoc(doc(db, "demandes/d1")));
  await assertFails(getDocs(collection(db, "demandes")));
  await assertFails(getDoc(doc(db, "prestataires", ALLO)));
  await assertFails(getDoc(doc(db, "config/reglages")));
  await assertFails(getDoc(doc(db, "vehicules/AB123CD")));
  await assertFails(updateDoc(doc(db, "demandes/d1"), { statut: "annulee" }));
  await assertFails(deleteDoc(doc(db, "demandes/d1")));
  await assertFails(setDoc(doc(db, "comptes", people.robot.email), { role: "admin" }));
  await assertFails(setDoc(doc(db, "demandes/m2"), { ...mail, prestataireId: ALLO, prixHT: 1 }), "ne choisit ni prestataire ni prix");
  await assertFails(setDoc(doc(db, "demandes/m3"), { ...mail, statut: "realisee" }), "ne marque rien comme fait");
  await assertFails(setDoc(doc(db, "demandes/m4"), { ...mail, source: "app" }));
  await assertFails(setDoc(doc(db, "demandes/m5"), { ...mail, retour: { etat: "fait" } }));
});

test("le robot annule ou replanifie seulement une demande venue d'un mail", async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "demandes/mail-1"), { ...mail, prestataire: "Khalid", prestataireId: KHALID, prixHT: 37 }));
  const db = as("robot");
  await assertFails(updateDoc(doc(db, "demandes/mail-1"), { statut: "envoyee", plaque: "AA-000-AA" }), "pas de replanification d'une demande non annulée");
  await assertFails(updateDoc(doc(db, "demandes/mail-1"), { statut: "annulee", prixHT: 0 }), "l'annulation ne touche que le statut");
  await assertSucceeds(updateDoc(doc(db, "demandes/mail-1"), { statut: "annulee", annuleeAt: "2026-11-10", updatedAt: "2026-11-10" }));
  await assertFails(updateDoc(doc(db, "demandes/mail-1"), { statut: "envoyee", plaque: "AA-000-AA" }), "même plaque obligatoire");
  await assertSucceeds(updateDoc(doc(db, "demandes/mail-1"), { statut: "envoyee", fin: "21:00", updatedAt: "2026-11-11" }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { statut: "annulee" }), "une demande saisie dans l'appli reste intouchable");
});

test("contrôles hayon : l'équipe gère la liste, Jérôme la lit, personne d'autre n'y touche", async () => {
  await assertSucceeds(setDoc(doc(as("fabian"), "hayons/AB123CD"), { plaque: "AB-123-CD", dernierControle: "2026-06-01" }));
  await assertSucceeds(getDocs(collection(as("jerome"), "hayons")));
  await assertFails(setDoc(doc(as("jerome"), "hayons/AB123CD"), { plaque: "AB-123-CD", dernierControle: "2026-11-01" }));
  for (const who of ["allo", "khalid", "robot", "inconnu"]) {
    await assertFails(getDoc(doc(as(who), "hayons/AB123CD")));
    await assertFails(setDoc(doc(as(who), "hayons/AB123CD"), { plaque: "AB-123-CD", dernierControle: "2026-11-01" }));
  }
  await assertSucceeds(setDoc(doc(as("robot"), "demandes/mail-h"), { ...mail, service: "hayon" }), "le robot importe aussi les mails de contrôle hayon");
});

test("un prestataire signale un problème sur ses véhicules, et seulement les siens", async () => {
  const khalid = as("khalid");
  const report = { demandeId: "d2", plaque: "EF-456-GH", prestataireId: KHALID, type: "pneu", texte: "Pneu avant lisse", statut: "nouveau", at: "2026-11-18T10:00:00Z", par: people.khalid.email };
  await assertSucceeds(setDoc(doc(khalid, "signalements/s1"), report));
  await assertSucceeds(setDoc(doc(khalid, "signalements/s2"), { ...report, photo: "sig_EF456GH_x" }));
  // Not on another provider's request, not in another provider's name, not for someone else, not already "handled".
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, demandeId: "d1", plaque: "AB-123-CD" }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, prestataireId: ALLO }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, par: people.allo.email }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, statut: "traite" }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, plaque: "ZZ-999-ZZ" }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, type: "inconnu" }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, texte: "x".repeat(501) }));
  await assertFails(setDoc(doc(khalid, "signalements/s3"), { ...report, demandeId: "absente" }));
  // Read only its own, change nothing afterwards.
  await assertSucceeds(getDocs(query(collection(khalid, "signalements"), where("prestataireId", "==", KHALID))));
  await assertFails(getDocs(collection(khalid, "signalements")));
  await assertFails(getDoc(doc(as("allo"), "signalements/s1")));
  await assertFails(updateDoc(doc(khalid, "signalements/s1"), { texte: "autre chose" }));
  await assertFails(updateDoc(doc(khalid, "signalements/s1"), { statut: "traite" }));
  await assertFails(deleteDoc(doc(khalid, "signalements/s1")));
  // The team reads everything; only an admin marks it handled, and only that.
  await assertSucceeds(getDocs(collection(as("jerome"), "signalements")));
  await assertFails(updateDoc(doc(as("jerome"), "signalements/s1"), { statut: "traite" }));
  await assertSucceeds(updateDoc(doc(as("fabian"), "signalements/s1"), { statut: "traite", traiteAt: "2026-11-18T11:00:00Z", traitePar: people.fabian.email }));
  await assertFails(updateDoc(doc(as("fabian"), "signalements/s1"), { texte: "réécrit" }));
  await assertFails(setDoc(doc(as("robot"), "signalements/s9"), report));
});

test("le robot laisse sa trace dans robot/etat, l'équipe la lit, personne d'autre n'y touche", async () => {
  const trace = { passage: "2026-11-18T12:00:00Z", dernierMail: "2026-11-18T09:12:00Z", erreur: null, erreurDepuis: null, nonCompris: "Prise de rendez-vous XX", nonComprisLe: "2026-11-18T11:00:00Z" };
  const robot = as("robot");
  await assertSucceeds(setDoc(doc(robot, "robot/etat"), trace));
  await assertSucceeds(setDoc(doc(robot, "robot/etat"), { ...trace, erreur: "Connexion du robot refusée", erreurDepuis: "2026-11-18T12:05:00Z" }));
  await assertFails(getDoc(doc(robot, "robot/etat")), "le robot ne lit toujours rien");
  await assertFails(setDoc(doc(robot, "robot/autre"), trace), "un seul document");
  await assertFails(setDoc(doc(robot, "robot/etat"), { ...trace, role: "admin" }), "seulement les champs de la trace");
  await assertFails(setDoc(doc(robot, "robot/etat"), { ...trace, erreur: "x".repeat(301) }));
  await assertFails(deleteDoc(doc(robot, "robot/etat")));
  await assertSucceeds(getDoc(doc(as("fabian"), "robot/etat")));
  await assertSucceeds(getDoc(doc(as("jerome"), "robot/etat")));
  await assertFails(getDoc(doc(as("khalid"), "robot/etat")));
  await assertFails(setDoc(doc(as("khalid"), "robot/etat"), trace));
  await assertFails(setDoc(doc(as("jerome"), "robot/etat"), trace));
});
