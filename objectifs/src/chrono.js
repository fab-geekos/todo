// Mesure du temps passé par étape (option --temps), pour savoir où part le temps.
const secondes = ms => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// → fonction mesure(nom, fn) : exécute fn et, en mode détaillé, affiche sa durée.
export function creerChrono({ detail = false, ecrire = () => {} } = {}) {
  const debut = Date.now();
  const mesure = async (nom, fn) => {
    const t0 = Date.now();
    try { return await fn(); }
    finally { if (detail) ecrire(`   ⏱  ${nom} : ${secondes(Date.now() - t0)}`); }
  };
  mesure.total = () => secondes(Date.now() - debut);
  return mesure;
}

// Sans --temps (et dans les tests) : exécute simplement.
export const sansMesure = Object.assign((nom, fn) => fn(), { total: () => "" });
