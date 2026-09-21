#!/usr/bin/env node
// Point d'entrée : « objectifs cloture » / « objectifs import [--adoption] » (cf. SPEC.md, README.md).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ErreurObjectifs, Abandon } from "./erreurs.js";
import { chargerConfig } from "./config.js";
import { adaptateurNotion } from "./notion.js";
import { creerStore, storeDiffere } from "./store.js";
import { ouvrirCache } from "./cache.js";
import { creerChrono } from "./chrono.js";
import { creerUI } from "./ui.js";
import { commandeImport } from "./import.js";
import { commandeCloture } from "./cloture.js";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

const AIDE = `
Objectifs du mois : Notion → app Todo

Chaque mois, dans cet ordre :
  objectifs cloture           archive le mois écoulé dans Notion, remet « Dans 1 mois » à zéro,
                              retire les objectifs de l'app (premiers jours du mois)
  (tu écris les nouveaux objectifs dans Notion)
  objectifs import            recopie les objectifs de Notion dans l'app

Une seule fois, au tout premier lancement :
  objectifs import --adoption reconnaît les objectifs déjà saisis à la main dans l'app

Options :
  --temps                     affiche la durée de chaque étape
  --config <fichier>          autre fichier de configuration (défaut : config.local.json)
`;

function lireArgs(argv) {
  const args = { commande: null, adoption: false, temps: false, config: join(RACINE, "config.local.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--adoption") args.adoption = true;
    else if (a === "--temps") args.temps = true;
    else if (a === "--config") args.config = argv[++i];
    else if (a.startsWith("--")) args.inconnue = a;
    else if (!args.commande) args.commande = a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    else args.inconnue = a;
  }
  return args;
}

async function main() {
  const args = lireArgs(process.argv.slice(2));
  if (!args.commande || args.commande === "aide" || args.commande === "help" || args.inconnue
    || !["import", "cloture"].includes(args.commande) || (args.adoption && args.commande !== "import")) {
    console.log(AIDE);
    return args.commande && args.commande !== "aide" && args.commande !== "help" ? 1 : 0;
  }
  const mesure = creerChrono({ detail: args.temps, ecrire: t => console.log(t) });
  const config = chargerConfig(args.config);
  // Mémo local à côté de la config (config.local.json → config.local.cache.json, exclu de Git).
  const cache = ouvrirCache(args.config.replace(/\.json$/i, "") + ".cache.json");
  const { Client } = await import("@notionhq/client");
  const notion = adaptateurNotion(new Client({ auth: config.notion.token, retry: { maxRetries: 5 } }));
  // Connexion à Firebase lancée en arrière-plan : elle se fait pendant la lecture de Notion.
  const store = storeDiffere(mesure("Connexion à Firebase", () => creerStore({ ...config.firebase, espace: config.espace, cache })));
  const contexte = { notion, store, ui: creerUI(), config, maintenant: Date.now(), mesure, cache };
  if (args.commande === "import") await commandeImport({ ...contexte, adoption: args.adoption });
  else await commandeCloture(contexte);
  console.log(`\n⏱  Terminé en ${mesure.total()}${args.temps ? ` (${notion.requetes} requêtes Notion)` : ""}.`);
  return 0;
}

// Erreurs de l'API Notion les plus probables, traduites.
function messageNotion(e) {
  if (e.code === "unauthorized") return ["Notion refuse le jeton d'accès.", "Vérifie « notion.token » dans config.local.json."];
  if (e.code === "object_not_found" || e.code === "restricted_resource")
    return ["Notion refuse l'accès à la page.", "Dans Notion, ouvre la page → menu ⋯ → Connexions → ajoute ton intégration, puis relance."];
  return null;
}

main().then(code => process.exit(code), e => {
  if (e instanceof Abandon) { console.log(`\n${e.message}`); process.exit(0); }
  const connu = e instanceof ErreurObjectifs ? [e.message, e.conseil] : messageNotion(e);
  if (connu) {
    console.log(`\n❌ ${connu[0]}`);
    if (connu[1]) console.log(`→ ${connu[1]}`);
  } else {
    console.log(`\n❌ Erreur inattendue : ${e && e.message ? e.message : e}`);
    console.log("→ Relance la même commande : elle reprend là où elle s'est arrêtée. Les sauvegardes sont dans objectifs/sauvegardes.");
    if (process.env.OBJECTIFS_DEBUG) console.log(e.stack);
  }
  process.exit(1);
});
