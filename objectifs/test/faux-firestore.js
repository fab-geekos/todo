// Faux serveur Firestore REST + OAuth (remplace `fetch` dans les tests). Vérifie ce que le vrai
// vérifierait : signature du jeton, forme des requêtes et des valeurs, transactions.
import { generateKeyPairSync, verify } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { dossierTemp } from "./faux.js";

const CLES = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TYPES_VALEUR = ["nullValue", "booleanValue", "integerValue", "doubleValue", "stringValue", "timestampValue", "arrayValue", "mapValue", "referenceValue", "bytesValue", "geoPointValue"];

// Fichier de clé de service de test (signé avec une clé générée à la volée).
export function fichierCleTest() {
  const compte = {
    type: "service_account", project_id: "projet-test", private_key_id: "cle-1",
    private_key: CLES.privateKey.export({ type: "pkcs8", format: "pem" }),
    client_email: "objectifs@projet-test.iam.gserviceaccount.com", token_uri: "https://oauth2.googleapis.com/token"
  };
  const f = join(dossierTemp(), "serviceAccountKey.json");
  writeFileSync(f, JSON.stringify(compte));
  return f;
}

function verifierValeur(v, chemin) {
  const cles = Object.keys(v);
  if (cles.length !== 1 || !TYPES_VALEUR.includes(cles[0])) throw new Error(`valeur Firestore invalide en ${chemin} : ${JSON.stringify(v)}`);
  if (v.integerValue !== undefined && !/^-?\d+$/.test(v.integerValue)) throw new Error(`integerValue invalide en ${chemin}`);
  if (v.arrayValue) (v.arrayValue.values || []).forEach((x, i) => verifierValeur(x, `${chemin}[${i}]`));
  if (v.mapValue) Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => verifierValeur(x, `${chemin}.${k}`));
}

export class FauxFirestore {
  constructor() {
    this.docs = new Map();          // nom complet → champs
    this.appels = { jeton: 0, lookup: 0, lecture: 0, debut: 0, commit: 0, annulation: 0 };
    this.pannes = [];               // file : { etape, statut?, status?, reseau? } appliquées dans l'ordre
    this.comptes = { "fabien@exemple.org": "uid-1" };
    this.tx = 0;
    this.fetch = this.fetch.bind(this);
  }
  nom(chemin) { return `projects/projet-test/databases/(default)/documents/${chemin}`; }
  poser(chemin, champs) { this.docs.set(this.nom(chemin), JSON.parse(JSON.stringify(champs))); }
  champs(chemin) { return this.docs.get(this.nom(chemin)); }

  async fetch(url, options) {
    const etape = url.includes("/token") ? "jeton" : url.includes("accounts:lookup") ? "lookup"
      : url.endsWith(":batchGet") ? "lecture" : url.endsWith(":beginTransaction") ? "debut"
      : url.endsWith(":commit") ? "commit" : url.endsWith(":rollback") ? "annulation" : "?";
    this.appels[etape]++;
    const i = this.pannes.findIndex(p => p.etape === etape);
    if (i >= 0) {
      const p = this.pannes.splice(i, 1)[0];
      if (p.reseau) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
      return reponse(p.statut, { error: { code: p.statut, status: p.status, message: "panne simulée" } });
    }
    if (etape === "jeton") return this._jeton(options);
    if (options.headers.authorization !== "Bearer jeton-test") return reponse(401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    const corps = JSON.parse(options.body);
    if (etape === "lookup") return reponse(200, this.comptes[corps.email[0]] ? { users: [{ localId: this.comptes[corps.email[0]] }] } : {});
    if (etape === "lecture") return reponse(200, corps.documents.map(n => this.docs.has(n)
      ? { found: { name: n, fields: this.docs.get(n) } } : { missing: n }));
    if (etape === "debut") return reponse(200, { transaction: `tx-${++this.tx}` });
    if (etape === "annulation") return reponse(200, {});
    if (etape === "commit") {
      if (!/^tx-\d+$/.test(corps.transaction)) throw new Error("commit sans transaction");
      for (const w of corps.writes) {
        Object.entries(w.update.fields).forEach(([k, v]) => verifierValeur(v, k));
        const champs = JSON.parse(JSON.stringify(w.update.fields));
        for (const t of w.updateTransforms || []) {
          if (t.setToServerValue !== "REQUEST_TIME" || champs[t.fieldPath]) throw new Error("transformation invalide");
          champs[t.fieldPath] = { timestampValue: "2026-10-02T10:00:00.000000Z" };
        }
        this.docs.set(w.update.name, champs);
      }
      return reponse(200, { commitTime: "2026-10-02T10:00:00.000000Z" });
    }
    throw new Error(`faux Firestore : URL inattendue ${url}`);
  }

  _jeton(options) {
    const p = new URLSearchParams(options.body);
    if (p.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return reponse(400, { error: "unsupported_grant_type" });
    const [entete, corps, signature] = p.get("assertion").split(".");
    const valide = verify("RSA-SHA256", Buffer.from(`${entete}.${corps}`), CLES.publicKey, Buffer.from(signature, "base64url"));
    const c = JSON.parse(Buffer.from(corps, "base64url").toString());
    if (!valide || c.iss !== "objectifs@projet-test.iam.gserviceaccount.com" || !c.scope.includes("datastore") || c.exp - c.iat !== 3600)
      return reponse(400, { error: "invalid_grant", error_description: "jeton refusé" });
    return reponse(200, { access_token: "jeton-test", expires_in: 3600, token_type: "Bearer" });
  }
}

const reponse = (statut, json) => ({ ok: statut >= 200 && statut < 300, status: statut, text: async () => JSON.stringify(json) });
