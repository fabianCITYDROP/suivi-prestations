// Each test signs in as one kind of person and checks what Firestore lets them do.
import { test, before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, writeBatch, Timestamp, deleteField } from "firebase/firestore";

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
  await assertSucceeds(setDoc(doc(db, "comptes/nouveau@exemple.fr"), { role: "prestataire", prestataireId: KHALID }));
  await assertSucceeds(updateDoc(doc(db, "prestataires", ALLO), { tarifs: [] }));
  await assertSucceeds(setDoc(doc(db, "config/reglages"), { prestataires: [] }));
  await assertSucceeds(setDoc(doc(db, "config/garages"), { liste: [{ garage: "Du sol au toit", prestataire: "Khalid", site: "La Défense" }] }));
});

test("les garages des mails : seule l'équipe les modifie", async () => {
  for (const who of ["khalid", "robot"]) {
    await assertFails(getDoc(doc(as(who), "config/garages")));
    await assertFails(setDoc(doc(as(who), "config/garages"), { liste: [] }));
  }
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
  await assertFails(updateDoc(doc(db, "demandes/d2"), { statut: "annulee" }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { statut: "a_envoyer" }));
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
  await assertSucceeds(setDoc(doc(db, "demandes/mail-c"), { ...mail, notes: "Faire un diag : voyant allumé" }), "le commentaire du mail suit la demande");
  await assertFails(setDoc(doc(db, "demandes/mail-d"), { ...mail, notes: "x".repeat(501) }), "commentaire trop long");
  await assertFails(setDoc(doc(db, "demandes/mail-e"), { ...mail, notes: 12 }), "commentaire en texte seulement");
});

test("le robot lit les demandes (pour les alertes) mais ne peut rien changer d'autre", async () => {
  const db = as("robot");
  await assertSucceeds(getDoc(doc(db, "demandes/d1")));
  await assertSucceeds(getDocs(collection(db, "demandes")));
  await assertFails(getDoc(doc(db, "prestataires", ALLO)));
  await assertFails(getDocs(collection(db, "comptes")));
  await assertFails(updateDoc(doc(db, "demandes/d1"), { notifie: { demande: ALLO }, statut: "realisee" }), "la marque des alertes seule");
  await assertFails(updateDoc(doc(db, "demandes/d1"), { notifie: { demande: ALLO, prixHT: 1 } }));
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

test("un « fait » ou une acceptation du prestataire change le statut tout seul, et rien d'autre", async () => {
  const db = as("khalid");
  const at = "2026-11-19T10:00:00.000Z";
  const fait = { etat: "fait", at, par: people.khalid.email };
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, etat: "absent" }, statut: "realisee" }), "un véhicule absent ne clôt rien");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: fait, statut: "annulee" }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: fait, statut: "realisee", doneAt: "2026-10-01T10:00:00.000Z" }), "pas de date de passage inventée");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: fait, statut: "realisee", prixHT: 99 }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, etat: "confirme" }, statut: "realisee" }));
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, etat: "confirme" }, statut: "confirmee", sentAt: at, confirmedAt: at, updatedAt: at }));
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { retour: fait, statut: "realisee", doneAt: at, updatedAt: at }));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "demandes/d5"), { ...lavage, statut: "annulee" }));
  await assertFails(updateDoc(doc(db, "demandes/d5"), { retour: fait, statut: "realisee", doneAt: at }), "une demande annulée reste annulée");
  await assertFails(updateDoc(doc(as("allo"), "demandes/d2"), { retour: { ...fait, par: people.allo.email }, statut: "realisee", doneAt: at }), "pas chez un autre prestataire");
});

test("chacun inscrit ses propres appareils aux alertes, avec son vrai rôle", async () => {
  const jeton = "0123456789abcdef0123456789abcdef";
  const app = { endpoint: "https://fcm.googleapis.com/fcm/send/x", jeton, appareil: "Android", createdAt: "t", updatedAt: "t" };
  const khalid = as("khalid");
  await assertSucceeds(setDoc(doc(khalid, "abonnements/a1"), { ...app, email: people.khalid.email, role: "prestataire", prestataireId: KHALID }));
  await assertFails(setDoc(doc(khalid, "abonnements/a2"), { ...app, email: people.khalid.email, role: "prestataire", prestataireId: ALLO }), "pas les alertes d'Allo");
  await assertFails(setDoc(doc(khalid, "abonnements/a3"), { ...app, email: people.khalid.email, role: "admin" }), "pas les alertes de l'équipe");
  await assertFails(setDoc(doc(khalid, "abonnements/a4"), { ...app, email: people.allo.email, role: "prestataire", prestataireId: ALLO }));
  await assertFails(setDoc(doc(khalid, "abonnements/a5"), { ...app, email: people.khalid.email, role: "prestataire", prestataireId: KHALID, jeton: "court" }));
  await assertSucceeds(getDoc(doc(khalid, "abonnements/a1")));
  await assertSucceeds(setDoc(doc(as("fabian"), "abonnements/f1"), { ...app, email: people.fabian.email, role: "admin" }));
  await assertFails(getDoc(doc(khalid, "abonnements/f1")), "le jeton d'un autre reste secret");
  await assertFails(getDocs(collection(khalid, "abonnements")));
  await assertFails(setDoc(doc(as("allo"), "abonnements/a1"), { ...app, email: people.allo.email, role: "prestataire", prestataireId: ALLO }), "on ne reprend pas l'appareil d'un autre");
  await assertFails(setDoc(doc(as("inconnu"), "abonnements/i1"), { ...app, email: "inconnu@exemple.fr", role: "admin" }));
  await assertSucceeds(getDocs(collection(as("robot"), "abonnements")));
  await assertSucceeds(getDocs(collection(as("fabian"), "abonnements")), "l'équipe voit qui a activé ses alertes");
  await assertFails(getDocs(collection(as("jerome"), "abonnements")), "la lecture seule ne voit pas les appareils");
  await assertSucceeds(deleteDoc(doc(as("robot"), "abonnements/a1")), "le robot retire un appareil désinscrit");
  await assertSucceeds(deleteDoc(doc(as("fabian"), "abonnements/f1")));
});

test("le robot ne pose que sa marque « déjà annoncé » ; l'adresse des alertes est lisible par les comptes, modifiable par l'équipe", async () => {
  await assertSucceeds(updateDoc(doc(as("robot"), "demandes/d2"), { notifie: { demande: KHALID, annulee: false, retour: "t" } }));
  await assertFails(updateDoc(doc(as("khalid"), "demandes/d2"), { notifie: {} }), "le prestataire ne touche pas à la marque");
  await assertSucceeds(setDoc(doc(as("fabian"), "public/notifications"), { url: "https://script.google.com/macros/s/x/exec", cle: "BAx" }));
  await assertSucceeds(getDoc(doc(as("khalid"), "public/notifications")));
  await assertFails(setDoc(doc(as("khalid"), "public/notifications"), { url: "https://pirate.fr" }));
  await assertFails(getDoc(doc(as("inconnu"), "public/notifications")));
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

test("« Signaler » : un prestataire remonte ce qu'il voit sur n'importe quel véhicule, sans rien lire des autres", async () => {
  const khalid = as("khalid");
  const field = { demandeId: "", source: "terrain", plaque: "ZZ-999-ZZ", prestataireId: KHALID, type: "autre", quoi: ["Véhicule sale", "Pneu avant"],
    texte: "Véhicule sale, Pneu avant", statut: "nouveau", at: "2026-11-20T10:00:00Z", par: people.khalid.email };
  await assertSucceeds(setDoc(doc(khalid, "signalements/t1"), field), "un véhicule qui n'est dans aucune de ses demandes");
  await assertSucceeds(setDoc(doc(khalid, "signalements/t2"), { ...field, quoi: [], texte: "Rétro gauche pendant", photo: "sig_ZZ999ZZ_x" }));
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, prestataireId: ALLO }), "jamais au nom d'un autre");
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, par: people.allo.email }));
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, statut: "traite" }));
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, plaque: "AB" }), "plaque trop courte");
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, quoi: "sale" }));
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, demandeId: "d1" }), "pas de rattachement à la demande d'un autre");
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, source: "autre" }));
  await assertFails(setDoc(doc(khalid, "signalements/t3"), { ...field, champ: "x" }));
  await assertFails(setDoc(doc(as("jerome"), "signalements/t3"), { ...field, prestataireId: "" }), "l'équipe en lecture n'écrit pas");
  await assertFails(getDoc(doc(as("allo"), "signalements/t1")), "un autre prestataire ne le voit pas");
  // Its author changes it while the team has not handled it; nobody else, and never the status or the name.
  await assertSucceeds(updateDoc(doc(khalid, "signalements/t1"), { plaque: "ZZ-998-ZZ", quoi: ["Pare-brise"], texte: "Pare-brise", photo: "", modifieAt: "2026-11-21T10:00:00Z" }));
  await assertFails(updateDoc(doc(khalid, "signalements/t1"), { statut: "traite" }));
  await assertFails(updateDoc(doc(khalid, "signalements/t1"), { prestataireId: ALLO, modifieAt: "x" }));
  await assertFails(updateDoc(doc(khalid, "signalements/t1"), { plaque: "AB", modifieAt: "x" }));
  await assertFails(updateDoc(doc(as("allo"), "signalements/t1"), { texte: "x", modifieAt: "x" }));
  await assertSucceeds(updateDoc(doc(as("fabian"), "signalements/t1"), { statut: "traite", traiteAt: "2026-11-21T11:00:00Z", traitePar: people.fabian.email }));
  await assertFails(updateDoc(doc(khalid, "signalements/t1"), { texte: "trop tard", modifieAt: "x" }), "déjà traité : plus de modification");
  await assertFails(deleteDoc(doc(khalid, "signalements/t1")), "déjà traité : plus de suppression");
  await assertSucceeds(deleteDoc(doc(khalid, "signalements/t2")), "pas encore traité : il le supprime");
  await assertSucceeds(getDocs(collection(as("jerome"), "signalements")));
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
  // The team reads everything; only an admin marks it handled, and only that.
  await assertSucceeds(getDocs(collection(as("jerome"), "signalements")));
  await assertFails(updateDoc(doc(as("jerome"), "signalements/s1"), { statut: "traite" }));
  await assertSucceeds(updateDoc(doc(as("fabian"), "signalements/s1"), { statut: "traite", traiteAt: "2026-11-18T11:00:00Z", traitePar: people.fabian.email }));
  await assertFails(updateDoc(doc(as("fabian"), "signalements/s1"), { texte: "réécrit" }));
  await assertFails(deleteDoc(doc(khalid, "signalements/s1")), "déjà traité : plus de suppression");
  await assertFails(deleteDoc(doc(as("allo"), "signalements/s2")), "jamais celui d'un autre");
  await assertSucceeds(deleteDoc(doc(khalid, "signalements/s2")), "envoyé par erreur, pas encore traité : il le supprime");
  await assertFails(setDoc(doc(as("robot"), "signalements/s9"), report));
  await assertFails(updateDoc(doc(khalid, "signalements/s2"), { texte: "Rayure, pas le pneu", modifieAt: "2026-11-18T10:10:00Z" }), "pas de correction : il en renvoie un");
  // The robot reads the reports (to alert the team's phones) but never changes them.
  await assertSucceeds(getDocs(collection(as("robot"), "signalements")));
  await assertFails(updateDoc(doc(as("robot"), "signalements/s1"), { statut: "traite" }));
  await assertFails(deleteDoc(doc(as("robot"), "signalements/s1")));
});

test("historique : on ajoute une trace avec la modification, personne ne peut la changer ni l'effacer", async () => {
  const entry = (who, extra = {}) => ({ demandeId: "d1", plaque: "AB-123-CD", action: "modification", changes: [{ champ: "prixHT", avant: 300, apres: 320 }],
    par: people[who].email, at: serverTimestamp(), ...extra });
  // L'équipe change le prix : la demande et sa trace partent ensemble.
  const fabian = as("fabian");
  const batch = writeBatch(fabian);
  batch.update(doc(fabian, "demandes/d1"), { prixHT: 320 });
  batch.set(doc(fabian, "historique/h1"), entry("fabian"));
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDocs(collection(as("jerome"), "historique")));
  // Une trace écrite ne bouge plus, même pour un administrateur.
  await assertFails(updateDoc(doc(fabian, "historique/h1"), { changes: [] }));
  await assertFails(deleteDoc(doc(fabian, "historique/h1")));
  // Pas de fausse signature ni d'heure inventée.
  await assertFails(setDoc(doc(fabian, "historique/h2"), entry("fabian", { par: people.jerome.email })));
  await assertFails(setDoc(doc(fabian, "historique/h3"), entry("fabian", { at: "2026-01-01T00:00:00Z" })));
  await assertFails(setDoc(doc(fabian, "historique/h4"), entry("fabian", { action: "paiement" })));
  // Jérôme lit sans écrire ; les prestataires, le robot et les inconnus ne lisent pas l'historique.
  await assertFails(setDoc(doc(as("jerome"), "historique/h5"), entry("jerome")));
  for (const who of ["allo", "khalid", "robot", "inconnu"]) await assertFails(getDoc(doc(as(who), "historique/h1")));
});

test("historique : un prestataire ne trace que ses propres réponses", async () => {
  const answer = (who, demandeId, action = "reponse") => ({ demandeId, plaque: "AB-123-CD", action, changes: [{ champ: "reponse", avant: "", apres: "fait" }],
    par: people[who].email, at: serverTimestamp() });
  await assertSucceeds(setDoc(doc(as("allo"), "historique/a1"), answer("allo", "d1")));
  await assertFails(setDoc(doc(as("allo"), "historique/a2"), answer("allo", "d2")), "pas sur la demande d'un autre prestataire");
  await assertFails(setDoc(doc(as("allo"), "historique/a3"), answer("allo", "d1", "modification")), "pas de fausse modification de prix");
  await assertFails(updateDoc(doc(as("allo"), "historique/a1"), { changes: [] }));
  await assertFails(deleteDoc(doc(as("allo"), "historique/a1")));
  await assertFails(setDoc(doc(as("robot"), "historique/r1"), answer("robot", "d1")));
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

// Corbeille : « Supprimer » range la demande 20 jours, l'équipe peut la remettre, puis elle part pour de bon.
const toTrash = (db, id, data, extra = {}) => {
  const batch = writeBatch(db);
  batch.set(doc(db, "corbeille", id), { demande: data, supprimeLe: serverTimestamp(), supprimePar: people.fabian.email, ...extra });
  batch.delete(doc(db, "demandes", id));
  return batch.commit();
};

test("corbeille : une demande ne s'efface plus directement, elle part à la corbeille avec sa copie exacte", async () => {
  const fabian = as("fabian");
  await assertFails(deleteDoc(doc(fabian, "demandes/d1")), "pas d'effacement direct");
  await assertFails(toTrash(fabian, "d1", { ...allo, prixHT: 1 }), "la copie doit être celle de la demande");
  await assertFails(toTrash(fabian, "d1", allo, { supprimePar: people.jerome.email }), "pas de fausse signature");
  await assertFails(toTrash(fabian, "d1", allo, { supprimeLe: Timestamp.fromDate(new Date("2026-01-01")) }), "pas d'heure inventée");
  await assertSucceeds(toTrash(fabian, "d1", allo));
  await assertSucceeds(getDocs(collection(as("jerome"), "corbeille")));
  for (const who of ["allo", "khalid", "robot", "inconnu"]) await assertFails(getDoc(doc(as(who), "corbeille/d1")));
  await assertFails(toTrash(as("jerome"), "d2", lavage), "la lecture seule ne supprime pas");
  await assertFails(deleteDoc(doc(as("robot"), "demandes/d2")));
  await assertFails(deleteDoc(doc(as("khalid"), "demandes/d2")));
  // Rien ne change dans la corbeille, et rien ne s'en efface avant 20 jours.
  await assertFails(updateDoc(doc(fabian, "corbeille/d1"), { "demande.prixHT": 1 }));
  await assertFails(deleteDoc(doc(fabian, "corbeille/d1")));
});

test("corbeille : l'équipe restaure une demande, la corbeille se vide seule après 20 jours", async () => {
  const fabian = as("fabian");
  await assertSucceeds(toTrash(fabian, "d1", allo));
  // Restaurer : la demande revient dans la même opération que sa sortie de la corbeille.
  const restore = (db) => { const b = writeBatch(db); b.set(doc(db, "demandes/d1"), allo); b.delete(doc(db, "corbeille/d1")); return b.commit(); };
  await assertFails(restore(as("jerome")));
  await assertSucceeds(restore(fabian));
  await assertSucceeds(getDoc(doc(fabian, "demandes/d1")));
  // Après 20 jours, l'équipe peut l'effacer pour de bon (l'appli le fait à l'ouverture) ; avant, non.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const ago = (days) => Timestamp.fromMillis(Date.now() - days * 86400000);
    await setDoc(doc(db, "corbeille/vieille"), { demande: lavage, supprimeLe: ago(21), supprimePar: people.fabian.email });
    await setDoc(doc(db, "corbeille/recente"), { demande: lavage, supprimeLe: ago(19), supprimePar: people.fabian.email });
  });
  await assertFails(deleteDoc(doc(as("jerome"), "corbeille/vieille")));
  await assertSucceeds(deleteDoc(doc(fabian, "corbeille/vieille")));
  await assertFails(deleteDoc(doc(fabian, "corbeille/recente")));
  // La trace « restauration » est acceptée dans l'historique.
  await assertSucceeds(setDoc(doc(fabian, "historique/r1"), { demandeId: "d1", plaque: "AB-123-CD", action: "restauration", changes: [], par: people.fabian.email, at: serverTimestamp() }));
});

test("« Corriger » : le prestataire reprend son « fait » pendant 10 minutes, et rien d'autre", async () => {
  const db = as("khalid");
  const at = "2026-11-20T10:00:00.000Z";
  const fait = { etat: "fait", at, par: people.khalid.email };
  const erreur = { etat: "erreur", at, par: people.khalid.email };
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, le: Timestamp.fromMillis(0) }, statut: "realisee", doneAt: at }), "heure du serveur obligatoire");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...erreur, le: serverTimestamp() }, statut: "realisee", doneAt: at }));
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, le: serverTimestamp() }, statut: "realisee", doneAt: at, updatedAt: at }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: { ...fait, le: serverTimestamp() }, updatedAt: at }), "pas de nouveau départ des 10 minutes");
  await assertFails(updateDoc(doc(as("allo"), "demandes/d2"), { retour: { ...erreur, par: people.allo.email }, statut: "confirmee", doneAt: deleteField() }), "pas chez un autre prestataire");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: erreur, statut: "confirmee", doneAt: deleteField(), prixHT: 1 }), "rien d'autre");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: erreur, statut: "annulee", doneAt: deleteField() }));
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: erreur, statut: "confirmee" }), "la date de passage s'efface");
  await assertFails(updateDoc(doc(db, "demandes/d2"), { retour: erreur, updatedAt: at }), "une erreur sans remettre à faire n'a pas de sens");
  await assertSucceeds(updateDoc(doc(db, "demandes/d2"), { retour: erreur, statut: "confirmee", doneAt: deleteField(), updatedAt: at }));
  // a « fait » of a colleague on the same provider account, or one older than 10 minutes, stays
  await env.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore();
    await setDoc(doc(admin, "demandes/d6"), { ...lavage, statut: "realisee", retour: { ...fait, par: "collegue@lavage.fr", le: Timestamp.now() } });
    await setDoc(doc(admin, "demandes/d7"), { ...lavage, statut: "realisee", retour: { ...fait, le: Timestamp.fromMillis(Date.now() - 11 * 60000) } });
    await setDoc(doc(admin, "demandes/d8"), { ...lavage, statut: "realisee", retour: fait });
  });
  await assertFails(updateDoc(doc(db, "demandes/d6"), { retour: erreur, statut: "confirmee" }), "celui qui a fait le « OK » seulement");
  await assertFails(updateDoc(doc(db, "demandes/d7"), { retour: erreur, statut: "confirmee" }), "plus de 10 minutes");
  await assertFails(updateDoc(doc(db, "demandes/d8"), { retour: erreur, statut: "confirmee" }), "ancien « fait » sans heure du serveur");
});
