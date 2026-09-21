// Accès à l'app Todo (Firestore, via le SDK Admin). Deux documents :
// - users/{uid}/spaces/{espace}   : le blob de l'app (même format que index.html → db.save) ;
// - users/{uid}/objectifs/{espace} : le registre des cases importées ({ mois, ids }), que l'app
//   ignore. Il permet de distinguer « supprimée dans l'app » de « jamais importée » (SPEC § 6).
import { readFileSync } from "node:fs";
import { stop } from "./erreurs.js";

const REGISTRE_VIDE = { mois: null, ids: [] };

export async function creerStore({ cleService, email, uid, espace }) {
  const { initializeApp, cert } = await import("firebase-admin/app");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  let compte;
  try { compte = JSON.parse(readFileSync(cleService, "utf8")); }
  catch { stop(`Clé Firebase illisible : ${cleService}.`, "Vérifie « firebase.cleService » dans config.local.json (chemin du fichier JSON téléchargé depuis Firebase)."); }
  const app = initializeApp({ credential: cert(compte) }, "objectifs");
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });

  let id = uid;
  if (!id) {
    const { getAuth } = await import("firebase-admin/auth");
    try { id = (await getAuth(app).getUserByEmail(email)).uid; }
    catch { stop(`Compte ${email} introuvable dans Firebase.`, "Vérifie « firebase.email » dans config.local.json (le compte Google utilisé dans l'app)."); }
  }
  return storeDepuisRefs(db.doc(`users/${id}/spaces/${espace}`), db.doc(`users/${id}/objectifs/${espace}`), db, FieldValue);
}

function storeDepuisRefs(refEspace, refRegistre, db, FieldValue) {
  const lireDocs = (a, b) => {
    if (!a.exists) stop("Espace introuvable dans Firestore.", "Vérifie « espace » et le compte dans config.local.json, et ouvre l'app une fois avec ce compte.");
    return { blob: a.data(), registre: b.exists ? { ...REGISTRE_VIDE, ...b.data() } : { ...REGISTRE_VIDE } };
  };
  return {
    async lire() {
      const [a, b] = await Promise.all([refEspace.get(), refRegistre.get()]);
      return lireDocs(a, b);
    },
    // Lecture + écriture ATOMIQUES des deux documents. `fn({ blob, registre })` est pure (Firestore
    // peut la rejouer) et renvoie { blob, registre } à écrire, ou null pour ne rien écrire.
    async transaction(fn) {
      return db.runTransaction(async tx => {
        const [a, b] = [await tx.get(refEspace), await tx.get(refRegistre)];
        const res = fn(lireDocs(a, b));
        if (!res) return false;
        // Même forme que l'app (index.html → flushFirestore) : l'app la reçoit par onSnapshot.
        tx.set(refEspace, { ...res.blob, _v: 1, _updatedAt: FieldValue.serverTimestamp() });
        tx.set(refRegistre, { mois: res.registre.mois, ids: res.registre.ids, _updatedAt: FieldValue.serverTimestamp() });
        return true;
      });
    }
  };
}
