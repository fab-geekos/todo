// Lecture de config.local.json (jamais versionné : il contient les clés).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stop } from "./erreurs.js";
import { STRUCTURE } from "./parametres.js";

export function chargerConfig(chemin) {
  if (!existsSync(chemin)) stop(`Fichier de configuration introuvable : ${chemin}.`,
    "Copie config.exemple.json en config.local.json et remplis-le (voir README.md).");
  let brut;
  try { brut = JSON.parse(readFileSync(chemin, "utf8")); }
  catch (e) { stop(`config.local.json n'est pas un JSON valide (${e.message}).`, "Corrige le fichier (virgules, guillemets), puis relance."); }

  const c = { ...STRUCTURE, ...brut, notion: { ...STRUCTURE.notion, ...(brut.notion || {}) }, firebase: { ...(brut.firebase || {}) } };
  const manque = [];
  if (!c.notion.token) manque.push("notion.token");
  if (!c.notion.page) manque.push("notion.page");
  if (!c.firebase.cleService) manque.push("firebase.cleService");
  if (!c.firebase.email && !c.firebase.uid) manque.push("firebase.email");
  if (manque.length) stop(`config.local.json incomplet : ${manque.join(", ")}.`, "Complète ces champs (voir README.md), puis relance.");
  const racine = dirname(resolve(chemin));
  c.firebase.cleService = resolve(racine, c.firebase.cleService);
  c.dossierSauvegardes = resolve(racine, c.dossierSauvegardes || "sauvegardes");
  return c;
}
