// Outils génériques pour les tâches en parallèle (aucune logique métier ici).

// Comme Promise.all, mais attend que TOUT soit terminé avant de signaler la première erreur :
// aucune écriture ne continue en arrière-plan après un échec (la reprise part d'un état stable).
export async function tous(promesses) {
  const r = await Promise.allSettled(promesses);
  const echec = r.find(x => x.status === "rejected");
  if (echec) throw echec.reason;
  return r.map(x => x.value);
}

// File d'attente : au plus `max` tâches en cours. Une requête n'occupe une place que le temps de son
// aller-retour (pas pendant la lecture de ses enfants) : aucun blocage possible.
export function limiteur(max) {
  let actives = 0;
  const file = [];
  const suivant = () => {
    if (actives >= max || !file.length) return;
    actives++;
    const { fn, ok, ko } = file.shift();
    fn().then(ok, ko).finally(() => { actives--; suivant(); });
  };
  return fn => new Promise((ok, ko) => { file.push({ fn, ok, ko }); suivant(); });
}

// Lance une tâche dont le résultat servira plus tard (lecture anticipée). Une erreur ressort quand on
// l'attend, sans alerte « rejet non géré » entre-temps.
export function enAvance(promesse) {
  promesse.catch(() => {});
  return promesse;
}
