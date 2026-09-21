// Accès à l'app Todo : API REST de Firestore (HTTPS), avec les seuls outils intégrés à Node (fetch,
// crypto). Pas de bibliothèque Firebase : ses ~2 400 fichiers, analysés un à un par l'antivirus du
// PC, bloquaient parfois le lancement 20 s. Deux documents :
// - users/{uid}/spaces/{espace}   : le blob de l'app (même format que index.html → db.save) ;
// - users/{uid}/objectifs/{espace} : le registre des cases importées ({ mois, ids }), que l'app
//   ignore. Il permet de distinguer « supprimée dans l'app » de « jamais importée » (SPEC § 6).
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import { stop } from "./erreurs.js";
import { FIRESTORE } from "./parametres.js";
import { enAvance } from "./outils.js";

const PORTEES = ["https://www.googleapis.com/auth/datastore", "https://www.googleapis.com/auth/identitytoolkit"];
const URL_JETON = "https://oauth2.googleapis.com/token";

/* ---------- Conversion JS ⇄ valeurs Firestore (mêmes règles que le SDK web de l'app) ---------- */

// Valeur d'un type que l'app n'écrit jamais (horodatage, référence…) : gardée telle quelle et
// réécrite à l'identique, pour ne jamais changer une donnée par accident.
class ValeurBrute {
  constructor(v) { this.valeurFirestore = v; }
  toJSON() { return this.valeurFirestore; }
}

export function versFirestore(v) {
  if (v === null) return { nullValue: null };
  if (v instanceof ValeurBrute) return v.valeurFirestore;
  switch (typeof v) {
    case "boolean": return { booleanValue: v };
    case "string": return { stringValue: v };
    case "number":
      return Number.isSafeInteger(v) && !Object.is(v, -0) ? { integerValue: String(v) } : { doubleValue: v };
    case "object":
      if (Array.isArray(v)) {
        const values = v.filter(x => x !== undefined).map(versFirestore);
        return { arrayValue: values.length ? { values } : {} };
      }
      return { mapValue: champsNonVides(versChamps(v)) };
    default:
      throw new Error(`Valeur impossible à enregistrer dans Firestore (${typeof v}).`);
  }
}
const champsNonVides = fields => (Object.keys(fields).length ? { fields } : {});

// Objet JS → champs Firestore (les propriétés `undefined` sont ignorées, comme dans l'app).
export function versChamps(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) fields[k] = versFirestore(v);
  return fields;
}

function depuisFirestore(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(depuisFirestore);
  if ("mapValue" in v) return depuisChamps(v.mapValue.fields || {});
  return new ValeurBrute(v);
}
export function depuisChamps(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields || {})) obj[k] = depuisFirestore(v);
  return obj;
}

/* ---------- Connexion : jeton d'accès signé avec la clé de service ---------- */

const base64url = b => Buffer.from(b).toString("base64url");

function jwt(compte, maintenant) {
  const iat = Math.floor(maintenant / 1000);
  const entete = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: compte.private_key_id }));
  const corps = base64url(JSON.stringify({ iss: compte.client_email, scope: PORTEES.join(" "),
    aud: compte.token_uri || URL_JETON, iat, exp: iat + 3600 }));
  const signature = sign("RSA-SHA256", Buffer.from(`${entete}.${corps}`), compte.private_key).toString("base64url");
  return `${entete}.${corps}.${signature}`;
}

class ErreurHttp extends Error {
  constructor(statut, statutGoogle, message) {
    super(message);
    this.statut = statut;
    this.statutGoogle = statutGoogle;
  }
}

// Erreur passagère (coupure réseau, conflit, serveur surchargé) : on peut rejouer la transaction
// entière, lecture comprise, sans risque. Un refus d'accès ou une donnée refusée ne l'est jamais.
const passagere = e => !!e.reseau
  || (e instanceof ErreurHttp && ([409, 429, 500, 502, 503, 504].includes(e.statut) || e.statutGoogle === "ABORTED"));

// Accès bas niveau (jeton + requêtes) : utilisé par creerStore, et par les essais en bac à sable
// pour préparer puis effacer un espace de test.
export async function connecter(compte, { fetch: f = fetch, maintenant = Date.now } = {}) {
  // Toutes les requêtes sont des POST : soit un formulaire (jeton), soit du JSON authentifié.
  const appel = async (url, { corps, jeton, formulaire }) => {
    let r;
    try {
      r = await f(url, {
        method: "POST",
        headers: formulaire ? { "content-type": "application/x-www-form-urlencoded" }
          : { "content-type": "application/json", authorization: `Bearer ${jeton}` },
        body: formulaire ? new URLSearchParams(formulaire).toString() : JSON.stringify(corps),
        signal: AbortSignal.timeout(FIRESTORE.delaiRequeteMs)
      });
    } catch (e) {
      throw Object.assign(new Error(`Firebase injoignable (${e.cause && e.cause.code || e.message}).`), { reseau: true });
    }
    const texte = await r.text();
    let json = {};
    try { json = texte ? JSON.parse(texte) : {}; } catch { json = { error: { message: texte.slice(0, 200) } }; }
    if (!r.ok) {
      const err = json.error || {};
      if (r.status === 401 || r.status === 403 || err === "invalid_grant")
        stop("Firebase refuse l'accès avec cette clé de service.", "La clé a peut-être été révoquée : regénère-la (README, étape 3) et remplace serviceAccountKey.json.");
      throw new ErreurHttp(r.status, err.status, `Firebase a répondu ${r.status} ${err.status || ""} ${err.message || err.error_description || ""}`.trim());
    }
    return json;
  };

  const { access_token: jeton } = await appel(compte.token_uri || URL_JETON, {
    formulaire: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt(compte, maintenant()) }
  });
  const racine = `projects/${compte.project_id}/databases/(default)/documents`;
  const url = suite => `https://firestore.googleapis.com/v1/${racine}${suite}`;
  const nom = chemin => `${racine}/${chemin}`;

  return {
    nom,
    // Lit plusieurs documents d'un coup (instantané cohérent) → { chemin: champs | null }.
    async lire(chemins, transaction) {
      const reponses = await appel(url(":batchGet"), { jeton, corps: { documents: chemins.map(nom), ...(transaction ? { transaction } : {}) } });
      const parNom = new Map();
      for (const x of reponses) {
        if (x.found) parNom.set(x.found.name, x.found.fields || {});
        else if (x.missing) parNom.set(x.missing, null);
      }
      return Object.fromEntries(chemins.map(c => [c, parNom.has(nom(c)) ? parNom.get(nom(c)) : null]));
    },
    async commencer() {
      return (await appel(url(":beginTransaction"), { jeton, corps: { options: { readWrite: {} } } })).transaction;
    },
    async valider(transaction, ecritures) {
      await appel(url(":commit"), { jeton, corps: { transaction, writes: ecritures } });
    },
    async annuler(transaction) {
      try { await appel(url(":rollback"), { jeton, corps: { transaction } }); } catch { /* elle expirera seule */ }
    },
    // Identifiant Firebase d'un compte à partir de son email (null si inconnu).
    async uidParEmail(email) {
      const r = await appel(`https://identitytoolkit.googleapis.com/v1/projects/${compte.project_id}/accounts:lookup`, { jeton, corps: { email: [email] } });
      return r.users && r.users[0] ? r.users[0].localId : null;
    }
  };
}

/* ---------- Le store : lire() et transaction(fn), utilisés par les commandes ---------- */

// `cache` (facultatif) mémorise l'identifiant Firebase du compte : évite de le rechercher par email
// à chaque lancement (il ne change jamais pour un même compte Google).
export async function creerStore({ cleService, email, uid, espace, cache = null, fetch: f, maintenant }) {
  let compte;
  try { compte = JSON.parse(readFileSync(cleService, "utf8")); }
  catch { stop(`Clé Firebase illisible : ${cleService}.`, "Vérifie « firebase.cleService » dans config.local.json (chemin du fichier JSON téléchargé depuis Firebase)."); }
  if (!compte.client_email || !compte.private_key || !compte.project_id)
    stop("La clé Firebase est incomplète.", "Regénère-la depuis la console Firebase (README, étape 3).");
  const api = await connecter(compte, { fetch: f, maintenant });

  const memo = cache && cache.lire("firebase");
  let id = uid || (memo && memo.email === email ? memo.uid : null);
  if (!id) {
    id = await api.uidParEmail(email);
    if (!id) stop(`Compte ${email} introuvable dans Firebase.`, "Vérifie « firebase.email » dans config.local.json (le compte Google utilisé dans l'app).");
    if (cache) cache.ecrire("firebase", { email, uid: id });
  }
  return storeDepuisApi(api, `users/${id}/spaces/${espace}`, `users/${id}/objectifs/${espace}`);
}

function storeDepuisApi(api, cheminEspace, cheminRegistre) {
  const lireDocs = docs => {
    if (!docs[cheminEspace]) stop("Espace introuvable dans Firestore.", "Vérifie « espace » et le compte dans config.local.json, et ouvre l'app une fois avec ce compte. Si l'email a changé, supprime aussi config.local.cache.json.");
    // Forme garantie au reste du script : blob.tasks et registre.ids sont toujours des tableaux.
    const { _updatedAt, ...blob } = depuisChamps(docs[cheminEspace]);   // horodatage serveur, réécrit à chaque écriture
    if (!Array.isArray(blob.tasks)) blob.tasks = [];
    const reg = docs[cheminRegistre] ? depuisChamps(docs[cheminRegistre]) : {};
    return { blob, registre: { mois: reg.mois ?? null, ids: Array.isArray(reg.ids) ? reg.ids : [] } };
  };
  // Document entier réécrit (comme `set` dans l'app) + horodatage posé par le serveur.
  const ecriture = (chemin, donnees) => ({
    update: { name: api.nom(chemin), fields: versChamps(donnees) },
    updateTransforms: [{ fieldPath: "_updatedAt", setToServerValue: "REQUEST_TIME" }]
  });
  return {
    async lire() {
      return lireDocs(await api.lire([cheminEspace, cheminRegistre]));
    },
    // Lecture + écriture ATOMIQUES des deux documents. `fn({ blob, registre })` est pure (elle peut
    // être rejouée si Firestore signale un conflit) et renvoie { blob, registre } à écrire, ou null.
    async transaction(fn) {
      for (let essai = 1; ; essai++) {
        let tx = null;
        try {
          tx = await api.commencer();
          const docs = await api.lire([cheminEspace, cheminRegistre], tx);
          let res;
          try { res = fn(lireDocs(docs)); }
          catch (e) { e.duCalcul = true; throw e; }  // erreur métier (ex. plan modifié) : jamais rejouée
          if (!res) { await api.annuler(tx); return false; }
          const { _updatedAt, ...blob } = res.blob;
          await api.valider(tx, [
            ecriture(cheminEspace, { ...blob, _v: 1 }),     // même forme que l'app (index.html → flushFirestore)
            ecriture(cheminRegistre, { mois: res.registre.mois, ids: res.registre.ids })
          ]);
          return true;
        } catch (e) {
          if (tx) await api.annuler(tx);
          if (e.duCalcul || essai >= FIRESTORE.essaisTransaction || !passagere(e)) throw e;
          await new Promise(r => setTimeout(r, 200 * 2 ** essai));   // puis on relit tout et on recalcule
        }
      }
    }
  };
}

// Store utilisable tout de suite, connecté en arrière-plan : la connexion à Firebase se fait
// pendant la lecture de Notion. Une erreur de connexion ressort au premier usage.
export function storeDiffere(promesse) {
  enAvance(promesse);
  return {
    lire: async () => (await promesse).lire(),
    transaction: async fn => (await promesse).transaction(fn)
  };
}
