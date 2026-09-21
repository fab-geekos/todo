// Sauvegardes locales avant écriture (SPEC § 9) + plan de clôture en cours (reprise).
// Tout est dans objectifs/sauvegardes/, exclu de Git (données réelles).
import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SAUVEGARDES_GARDEES } from "./parametres.js";

const MOTIF = /^(\d{4}-\d{2}-\d{2}_\d{6})_[a-z]+_(todo-[a-z-]+|notion)\.json$/;

// Même format que l'export JSON de l'app (index.html → downloadBlob) : réimportable par le menu ⋯.
function exportApp(blob, espace, maintenant) {
  return {
    _app: "todo", _version: 1, _espace: espace, _exportedAt: new Date(maintenant).toISOString(),
    tasks: blob.tasks || [], projects: blob.projects || [], contacts: blob.contacts || [],
    birthDate: blob.birthDate || null, vaccineDone: blob.vaccineDone || null,
    labels: blob.labels || [], notes: blob.notes || [], mit: blob.mit || { text: "", date: null }
  };
}

const horodatage = d => {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Écrit une sauvegarde (app + section Notion) puis ne garde que les plus récentes.
export function sauvegarder(dossier, { commande, espace, blob, notion, maintenant }) {
  mkdirSync(dossier, { recursive: true });
  let stamp = horodatage(new Date(maintenant));
  while (readdirSync(dossier).some(f => f.startsWith(stamp))) stamp = horodatage(new Date(maintenant += 1000));
  const fichierApp = join(dossier, `${stamp}_${commande}_todo-${espace}.json`);
  writeFileSync(fichierApp, JSON.stringify(exportApp(blob, espace, maintenant), null, 2));
  writeFileSync(join(dossier, `${stamp}_${commande}_notion.json`), JSON.stringify(notion, null, 2));
  const stamps = [...new Set(readdirSync(dossier).map(f => (f.match(MOTIF) || [])[1]).filter(Boolean))].sort();
  for (const vieux of stamps.slice(0, Math.max(0, stamps.length - SAUVEGARDES_GARDEES))) {
    for (const f of readdirSync(dossier)) if (f.startsWith(vieux + "_") && MOTIF.test(f)) rmSync(join(dossier, f));
  }
  return fichierApp;
}

const PLAN = "cloture-en-cours.json";
export const planCloture = {
  lire(dossier) {
    const f = join(dossier, PLAN);
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  },
  ecrire(dossier, plan) {
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, PLAN), JSON.stringify(plan, null, 2));
  },
  effacer(dossier) {
    rmSync(join(dossier, PLAN), { force: true });
  }
};
