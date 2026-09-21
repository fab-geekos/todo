// Réglages du script, réunis en un seul endroit. La structure Notion et le projet peuvent aussi être
// remplacés dans config.local.json (clés « espace », « projet », « notion.* »).

// Structure attendue (SPEC § 4.1).
export const STRUCTURE = {
  espace: "perso",
  projet: "Objectifs du mois",
  notion: {
    cheminObjectifs: ["Dev perso", "Objectifs"],
    section: "Dans 1 mois",
    cheminArchives: ["Archives", "Dans 1 mois"]
  }
};

export const NIVEAUX_MAX = 3;                 // niveaux de cases acceptés (= MAX_TASK_DEPTH de l'app, index.html)
export const SEUIL_RESSEMBLANCE = 0.8;        // deux titres plus proches que ça sont signalés (doublon involontaire ?)
export const SAUVEGARDES_GARDEES = 2;         // sauvegardes conservées dans sauvegardes/ (les plus récentes)

export const NOTION = {
  requetesSimultanees: 3,                     // Notion accepte ~3 requêtes/s : au-delà, on ne ferait qu'attendre
  reessais: 5                                 // réessais automatiques du client officiel (limitation de débit)
};

export const FIRESTORE = {
  delaiRequeteMs: 30000,                      // une requête sans réponse au-delà est abandonnée
  essaisTransaction: 5                        // transaction rejouée en cas de conflit ou de coupure
};
