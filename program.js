// Programme débutant V0 — modifiable librement.
// Chaque exercice a une échelle de paliers. On monte d'un palier quand
// toutes les séries atteignent `max` sur `advanceAfter` séances de suite.
// `home` = variante plan B maison (si absente, on fait le palier normal).
// `unit` : "reps" (répétitions) ou "s" (secondes).

const PROGRAM = {
  name: "Débutant V0",
  weeklyGoalDefault: 3,
  advanceAfter: 2,

  warmup: {
    parc: "Course jusqu'au parc, très facile, tu peux parler (≈12 min)",
    maison: "5 min de corde à sauter ou jumping jacks",
  },
  mobility: "Mobilité : cercles de bras, épaules, poignets, hanches + 2×8 scap pulls à la barre (4 min)",
  rounds: 3,
  restBetweenRounds: "1 min 30 à 2 min de repos entre chaque tour",
  cooldown: {
    parc: "Retour en marchant/trottinant + étirements (5 min)",
    maison: "Étirements (5 min)",
  },

  // Séance course + mobilité (compteur hebdo séparé).
  // Progression par blocs de `blockDays` jours : dans un bloc, une sortie ne dépasse pas
  // min(capKm, growth × plus longue sortie du bloc précédent). Voir la recherche du 30/09.
  run: {
    weeklyGoalDefault: 2,
    blockStart: "2026-10-01",
    blockDays: 14,
    growth: 1.3,
    capKm: 10,
    // Après la course, jamais juste avant la calisthénie (l'étirement statique baisse la force).
    mobility: [
      { id: "ankle", text: "Chevilles : genou au mur 2×10 par jambe, puis tenir 30 s" },
      { id: "squat", text: "Squat profond tenu 3×30 s (tiens un poteau si besoin)" },
      { id: "wrist", text: "Poignets : rotations + bascules à quatre pattes 2×10" },
      { id: "shoulder", text: "Épaules : étirement doux vers l'arrière, mains sur un banc derrière toi 2×30 s" },
      { id: "hang", text: "Suspension passive à la barre 3×20–30 s" },
      { id: "cossack", text: "Cossack squat 2×6 par côté" },
    ],
  },

  exercises: [
    {
      id: "pull",
      name: "Tractions",
      ladder: [
        { name: "Tractions australiennes", min: 4, max: 8, unit: "reps", tip: "Corps gainé, le plus lentement possible", home: { name: "Superman au sol", min: 8, max: 12, unit: "reps", tip: "Allongé ventre, lever bras + jambes, tenir 2 s" } },
        { name: "Tractions négatives", min: 3, max: 5, unit: "reps", tip: "Saute en haut, descends en 5 s", home: { name: "Superman au sol", min: 10, max: 15, unit: "reps", tip: "Tenir 2 s en haut" } },
        { name: "Tractions", min: 1, max: 5, unit: "reps", tip: "Menton au-dessus de la barre, descente contrôlée", home: { name: "Superman au sol", min: 12, max: 15, unit: "reps", tip: "Tenir 3 s en haut" } },
        { name: "Tractions", min: 5, max: 10, unit: "reps", tip: "Amplitude complète", home: { name: "Superman au sol", min: 15, max: 20, unit: "reps", tip: "Tenir 3 s en haut" } },
      ],
    },
    {
      id: "push",
      name: "Pompes",
      ladder: [
        { name: "Pompes inclinées (mains sur banc)", min: 5, max: 12, unit: "reps", tip: "Corps droit, poitrine jusqu'au banc" },
        { name: "Pompes classiques", min: 3, max: 8, unit: "reps", tip: "Descente lente, coudes à 45°" },
        { name: "Pompes classiques", min: 8, max: 15, unit: "reps", tip: "Amplitude complète" },
        { name: "Pompes déclinées (pieds sur banc)", min: 5, max: 12, unit: "reps", tip: "Gainage serré" },
      ],
    },
    {
      id: "dips",
      name: "Dips",
      ladder: [
        { name: "Dips sur banc", min: 5, max: 12, unit: "reps", tip: "Jambes pliées, descendre à 90°" },
        { name: "Dips négatifs (barres parallèles)", min: 3, max: 5, unit: "reps", tip: "Descends en 5 s", home: { name: "Dips sur chaise", min: 10, max: 15, unit: "reps", tip: "Jambes tendues si trop facile" } },
        { name: "Dips (barres parallèles)", min: 3, max: 8, unit: "reps", tip: "Épaules basses, descente contrôlée", home: { name: "Dips sur chaise, jambes tendues", min: 12, max: 20, unit: "reps", tip: "" } },
      ],
    },
    {
      id: "legs",
      name: "Squats → pistol squat",
      ladder: [
        { name: "Squats", min: 10, max: 20, unit: "reps", tip: "Talons au sol, cuisses parallèles au sol" },
        { name: "Squats bulgares (pied arrière sur banc)", min: 6, max: 10, unit: "reps", tip: "Par jambe", home: { name: "Squats bulgares (pied sur chaise)", min: 6, max: 10, unit: "reps", tip: "Par jambe" } },
        { name: "Pistol squat assisté (tenir un poteau)", min: 3, max: 6, unit: "reps", tip: "Par jambe, aide des bras au minimum", home: { name: "Pistol squat assisté (tenir un cadre de porte)", min: 3, max: 6, unit: "reps", tip: "Par jambe" } },
        { name: "Pistol squat sur banc", min: 3, max: 6, unit: "reps", tip: "Par jambe, descends t'asseoir sur le banc et remonte", home: { name: "Pistol squat sur chaise", min: 3, max: 6, unit: "reps", tip: "Par jambe" } },
        { name: "Pistol squat", min: 1, max: 5, unit: "reps", tip: "Par jambe, jambe libre tendue devant" },
      ],
    },
    {
      id: "abs",
      name: "Abdos",
      ladder: [
        { name: "Gainage planche", min: 20, max: 45, unit: "s", tip: "Fesses serrées, dos plat" },
        { name: "Relevés de genoux allongé", min: 8, max: 15, unit: "reps", tip: "Bas du dos collé au sol" },
        { name: "Relevés de genoux suspendu", min: 5, max: 12, unit: "reps", tip: "Sans balancer", home: { name: "Relevés de jambes allongé", min: 8, max: 15, unit: "reps", tip: "Jambes tendues, lentement" } },
      ],
    },
    {
      id: "rope",
      name: "Corde à sauter",
      ladder: [
        { name: "Corde à sauter", min: 30, max: 60, unit: "s", tip: "Petits sauts, rythme régulier" },
        { name: "Corde à sauter", min: 60, max: 90, unit: "s", tip: "" },
        { name: "Corde à sauter", min: 90, max: 120, unit: "s", tip: "" },
      ],
    },
  ],
};
