"use strict";

// ---------- Stockage ----------
const KEY = "calliboss.v1";

function emptyState() {
  const levels = {};
  PROGRAM.exercises.forEach((ex) => (levels[ex.id] = 0));
  return {
    settings: { weeklyGoal: PROGRAM.weeklyGoalDefault },
    levels,
    sessions: [],
    weights: [],
    draft: null,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = Object.assign(emptyState(), JSON.parse(raw));
    PROGRAM.exercises.forEach((ex) => {
      if (typeof s.levels[ex.id] !== "number") s.levels[ex.id] = 0;
      s.levels[ex.id] = Math.min(s.levels[ex.id], ex.ladder.length - 1);
    });
    return s;
  } catch (e) {
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    toast("Impossible d'enregistrer les données");
  }
}

let state = load();

// ---------- Dates ----------
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseYmd(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function today() {
  return ymd(new Date());
}
function mondayOf(dateStr) {
  const d = parseYmd(dateStr);
  const shift = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - shift);
  return ymd(d);
}
function addDays(dateStr, n) {
  const d = parseYmd(dateStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function prettyDate(dateStr) {
  return parseYmd(dateStr).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

// ---------- Helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function $(sel) {
  return document.querySelector(sel);
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 3500);
}
function unitLabel(u) {
  return u === "s" ? "s" : "reps";
}

// Palier effectif d'un exercice selon le mode (parc / maison)
function currentStep(ex, mode) {
  const step = ex.ladder[state.levels[ex.id]];
  if (mode === "maison" && step.home) return { ...step.home, isHome: true };
  return { ...step, isHome: false };
}

function sessionDates() {
  return new Set(state.sessions.map((s) => s.date));
}
function sessionsInWeek(monday) {
  const end = addDays(monday, 7);
  return state.sessions.filter((s) => s.date >= monday && s.date < end);
}
function weeksStreak() {
  // Semaines consécutives où l'objectif est atteint (la semaine en cours compte si déjà atteinte).
  const goal = state.settings.weeklyGoal;
  let monday = mondayOf(today());
  let streak = 0;
  if (sessionsInWeek(monday).length >= goal) streak++;
  monday = addDays(monday, -7);
  while (sessionsInWeek(monday).length >= goal) {
    streak++;
    monday = addDays(monday, -7);
  }
  return streak;
}

// ---------- Brouillon de la séance du jour ----------
function getDraft() {
  const t = today();
  if (!state.draft || state.draft.date !== t) {
    state.draft = { date: t, mode: state.draft ? state.draft.mode : "parc", checks: {}, sets: {} };
  }
  return state.draft;
}

// ---------- Rendu : Séance ----------
function renderWeek() {
  const monday = mondayOf(today());
  const done = sessionDates();
  const goal = state.settings.weeklyGoal;
  const count = sessionsInWeek(monday).length;
  const days = ["L", "M", "M", "J", "V", "S", "D"];
  const dots = days
    .map((l, i) => {
      const d = addDays(monday, i);
      const cls = [done.has(d) ? "done" : "", d === today() ? "today" : ""].join(" ");
      return `<div class="day ${cls}"><span>${l}</span></div>`;
    })
    .join("");
  const streak = weeksStreak();
  return `
    <section class="card week">
      <div class="week-head">
        <div><div class="big">${count}<small>/${goal}</small></div><div class="muted">séances cette semaine</div></div>
        <div class="streak">${streak > 0 ? `🔥 ${streak} sem.` : ""}</div>
      </div>
      <div class="days">${dots}</div>
      ${count >= goal ? `<p class="win">Objectif de la semaine atteint 💪</p>` : ""}
    </section>`;
}

function checkItem(key, label) {
  const d = getDraft();
  return `<label class="check ${d.checks[key] ? "on" : ""}">
    <input type="checkbox" data-check="${key}" ${d.checks[key] ? "checked" : ""}>
    <span class="box"></span><span>${esc(label)}</span></label>`;
}

function exerciseCard(ex) {
  const d = getDraft();
  const step = currentStep(ex, d.mode);
  const sets = d.sets[ex.id] || [];
  const filled = sets.filter((v) => v > 0).length;
  const complete = filled === PROGRAM.rounds;
  const inputs = Array.from({ length: PROGRAM.rounds }, (_, i) => {
    const v = sets[i] || "";
    return `<label class="set"><span>T${i + 1}</span>
      <input type="number" inputmode="numeric" min="0" data-ex="${ex.id}" data-set="${i}" value="${v}" placeholder="${step.min}"></label>`;
  }).join("");
  return `
    <div class="ex ${complete ? "complete" : ""}">
      <div class="ex-head">
        <div>
          <div class="ex-name">${esc(step.name)}${step.isHome ? ` <span class="tag">maison</span>` : ""}</div>
          <div class="muted">${step.min}–${step.max} ${unitLabel(step.unit)} par tour${step.tip ? " · " + esc(step.tip) : ""}</div>
        </div>
        <div class="ex-status">${complete ? "✓" : `${filled}/${PROGRAM.rounds}`}</div>
      </div>
      <div class="sets">${inputs}</div>
    </div>`;
}

function sessionComplete() {
  const d = getDraft();
  const checksOk = ["warmup", "mobility", "cooldown"].every((k) => d.checks[k]);
  const setsOk = PROGRAM.exercises.every((ex) => (d.sets[ex.id] || []).filter((v) => v > 0).length === PROGRAM.rounds);
  return checksOk && setsOk;
}

function renderSession() {
  const view = $("#view");
  const t = today();
  const doneToday = state.sessions.find((s) => s.date === t);

  if (doneToday) {
    const yesterday = state.sessions.find((s) => s.date === addDays(t, -1));
    view.innerHTML =
      renderWeek() +
      `<section class="card center">
        <div class="huge">✅</div>
        <h2>Séance validée</h2>
        <p class="muted">Bien joué. Récupère, mange bien, dors.${yesterday ? "" : " Demain peut être un jour de repos."}</p>
      </section>`;
    return;
  }

  const d = getDraft();
  const prevToday = state.sessions.find((s) => s.date === addDays(t, -1));
  view.innerHTML =
    renderWeek() +
    `<section class="card">
      <div class="seg">
        <button data-mode="parc" class="${d.mode === "parc" ? "on" : ""}">🌳 Parc</button>
        <button data-mode="maison" class="${d.mode === "maison" ? "on" : ""}">🏠 Plan B maison</button>
      </div>
      ${prevToday ? `<p class="muted small">Tu t'es entraîné hier : un jour de repos compte aussi.</p>` : ""}
    </section>

    <section class="card">
      <h3>1. Échauffement</h3>
      ${checkItem("warmup", PROGRAM.warmup[d.mode])}
      ${checkItem("mobility", PROGRAM.mobility)}
    </section>

    <section class="card">
      <h3>2. Circuit · ${PROGRAM.rounds} tours</h3>
      <p class="muted small">Enchaîne les exos dans l'ordre, puis recommence. ${esc(PROGRAM.restBetweenRounds)}. Note ce que tu fais à chaque tour (T1, T2, T3).</p>
      ${PROGRAM.exercises.map(exerciseCard).join("")}
      <button class="ghost" id="rest">⏱ Repos 2:00</button>
    </section>

    <section class="card">
      <h3>3. Retour au calme</h3>
      ${checkItem("cooldown", PROGRAM.cooldown[d.mode])}
    </section>

    <button class="primary" id="validate">${sessionComplete() ? "Valider la séance ✓" : "Valider la séance"}</button>`;

  view.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      getDraft().mode = b.dataset.mode;
      getDraft().sets = {};
      save();
      renderSession();
    })
  );
  view.querySelectorAll("[data-check]").forEach((c) =>
    c.addEventListener("change", () => {
      getDraft().checks[c.dataset.check] = c.checked;
      save();
      c.closest(".check").classList.toggle("on", c.checked);
      updateValidateLabel();
    })
  );
  view.querySelectorAll("[data-ex]").forEach((inp) =>
    inp.addEventListener("input", () => {
      const dr = getDraft();
      const arr = dr.sets[inp.dataset.ex] || [];
      const v = parseInt(inp.value, 10);
      arr[+inp.dataset.set] = isNaN(v) ? 0 : v;
      dr.sets[inp.dataset.ex] = arr;
      save();
      refreshExStatus(inp.dataset.ex);
      updateValidateLabel();
    })
  );
  $("#rest").addEventListener("click", () => startRest(120));
  $("#validate").addEventListener("click", validateSession);
}

function refreshExStatus(exId) {
  const sets = getDraft().sets[exId] || [];
  const filled = sets.filter((v) => v > 0).length;
  const card = document.querySelector(`[data-ex="${exId}"]`).closest(".ex");
  const complete = filled === PROGRAM.rounds;
  card.classList.toggle("complete", complete);
  card.querySelector(".ex-status").textContent = complete ? "✓" : `${filled}/${PROGRAM.rounds}`;
}
function updateValidateLabel() {
  $("#validate").textContent = sessionComplete() ? "Valider la séance ✓" : "Valider la séance";
}

function validateSession() {
  const d = getDraft();
  if (!sessionComplete()) {
    const anything = Object.values(d.checks).some(Boolean) || Object.values(d.sets).some((a) => a.some((v) => v > 0));
    if (!anything) return toast("Coche au moins l'échauffement 😉");
    if (!confirm("Séance incomplète. La valider quand même ? Une séance réduite vaut mieux que rien.")) return;
  }
  const results = {};
  PROGRAM.exercises.forEach((ex) => {
    const step = currentStep(ex, d.mode);
    results[ex.id] = { level: state.levels[ex.id], home: step.isHome, sets: (d.sets[ex.id] || []).map((v) => v || 0) };
  });
  state.sessions.push({ date: d.date, mode: d.mode, complete: sessionComplete(), results });
  state.draft = null;

  const ups = checkLevelUps();
  save();
  renderSession();
  if (ups.length) toast("🎉 Palier suivant : " + ups.join(", "));
  else toast("Séance validée 💪");
}

// Monte d'un palier si toutes les séries ont atteint `max` sur les N dernières séances à ce palier.
function checkLevelUps() {
  const ups = [];
  PROGRAM.exercises.forEach((ex) => {
    const lvl = state.levels[ex.id];
    if (lvl >= ex.ladder.length - 1) return;
    const max = ex.ladder[lvl].max;
    const recent = state.sessions
      .filter((s) => s.results[ex.id] && s.results[ex.id].level === lvl && !s.results[ex.id].home)
      .slice(-PROGRAM.advanceAfter);
    if (recent.length < PROGRAM.advanceAfter) return;
    const ok = recent.every((s) => {
      const sets = s.results[ex.id].sets;
      return sets.length === PROGRAM.rounds && sets.every((v) => v >= max);
    });
    if (ok) {
      state.levels[ex.id] = lvl + 1;
      ups.push(ex.ladder[lvl + 1].name);
    }
  });
  return ups;
}

// ---------- Minuteur de repos ----------
let restTimer = null;
function startRest(seconds) {
  const bar = $("#restbar");
  let left = seconds;
  clearInterval(restTimer);
  const tick = () => {
    const m = Math.floor(left / 60);
    const s = String(left % 60).padStart(2, "0");
    bar.innerHTML = `<span>Repos ${m}:${s}</span><button id="reststop">Stop</button>`;
    $("#reststop").onclick = stopRest;
    if (left <= 0) {
      stopRest();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      toast("C'est reparti !");
    }
    left--;
  };
  bar.classList.add("show");
  tick();
  restTimer = setInterval(tick, 1000);
}
function stopRest() {
  clearInterval(restTimer);
  $("#restbar").classList.remove("show");
}

// ---------- Rendu : Progrès ----------
function renderProgress() {
  const view = $("#view");
  const cards = PROGRAM.exercises
    .map((ex) => {
      const lvl = state.levels[ex.id];
      const steps = ex.ladder
        .map((st, i) => {
          const cls = i < lvl ? "passed" : i === lvl ? "current" : "";
          return `<li class="${cls}">${i < lvl ? "✓ " : i === lvl ? "▶ " : ""}${esc(st.name)} <span class="muted">${st.min}–${st.max} ${unitLabel(st.unit)}</span></li>`;
        })
        .join("");
      const last = state.sessions
        .filter((s) => s.results[ex.id] && s.results[ex.id].sets.some((v) => v > 0))
        .slice(-4)
        .reverse()
        .map((s) => {
          const r = s.results[ex.id];
          const name = r.home && ex.ladder[r.level].home ? ex.ladder[r.level].home.name : ex.ladder[r.level].name;
          return `<div class="hist"><span>${prettyDate(s.date)}</span><span class="muted">${esc(name)}</span><b>${r.sets.join(" · ")}</b></div>`;
        })
        .join("");
      return `<section class="card">
        <div class="ex-head"><h3>${esc(ex.name)}</h3>
          <div class="lvl-btns"><button data-down="${ex.id}" ${lvl === 0 ? "disabled" : ""}>−</button><button data-up="${ex.id}" ${lvl >= ex.ladder.length - 1 ? "disabled" : ""}>+</button></div>
        </div>
        <ol class="ladder">${steps}</ol>
        ${last ? `<div class="hist-list">${last}</div>` : `<p class="muted small">Pas encore de séance.</p>`}
      </section>`;
    })
    .join("");

  const history = [...state.sessions]
    .reverse()
    .slice(0, 20)
    .map((s) => `<div class="hist"><span>${prettyDate(s.date)}</span><span class="muted">${s.mode === "maison" ? "🏠 maison" : "🌳 parc"}</span><b>${s.complete ? "✓" : "partielle"}</b></div>`)
    .join("");

  view.innerHTML =
    `<p class="muted small pad">Monte d'un palier automatiquement quand tu fais le max sur les ${PROGRAM.rounds} tours, ${PROGRAM.advanceAfter} séances de suite. Les boutons − / + ajustent à la main.</p>` +
    cards +
    `<section class="card"><h3>Historique · ${state.sessions.length} séance${state.sessions.length > 1 ? "s" : ""}</h3>${history || `<p class="muted small">Rien pour l'instant. La première, c'est la plus dure.</p>`}</section>`;

  view.querySelectorAll("[data-up]").forEach((b) =>
    b.addEventListener("click", () => {
      state.levels[b.dataset.up]++;
      save();
      renderProgress();
    })
  );
  view.querySelectorAll("[data-down]").forEach((b) =>
    b.addEventListener("click", () => {
      state.levels[b.dataset.down]--;
      save();
      renderProgress();
    })
  );
}

// ---------- Rendu : Poids ----------
function renderWeight() {
  const view = $("#view");
  const t = today();
  const isMonday = new Date().getDay() === 1;
  const weighedToday = state.weights.some((w) => w.date === t);
  const sorted = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const fmt = (n) => (n > 0 ? "+" : "") + n.toFixed(1);
  const rows = sorted
    .map((w, i) => {
      const prev = sorted[i - 1];
      const delta = prev ? w.kg - prev.kg : null;
      return { w, delta };
    })
    .reverse()
    .map(
      ({ w, delta }) => `<div class="hist"><span>${prettyDate(w.date)}</span><b>${w.kg.toFixed(1)} kg</b>
        <span class="${delta === null ? "muted" : delta <= 0 ? "down" : "up"}">${delta === null ? "départ" : fmt(delta)}</span>
        <button class="x" data-del="${w.date}" aria-label="Supprimer">×</button></div>`
    )
    .join("");

  view.innerHTML = `
    ${isMonday && !weighedToday ? `<section class="card banner">C'est lundi : pèse-toi au réveil, avant de manger ⚖️</section>` : ""}
    ${
      first && last && sorted.length > 1
        ? `<section class="card center"><div class="big">${fmt(last.kg - first.kg)} <small>kg</small></div><div class="muted">depuis le ${prettyDate(first.date)}</div></section>`
        : ""
    }
    <section class="card">
      <h3>Nouvelle pesée</h3>
      <div class="row">
        <input type="number" inputmode="decimal" step="0.1" id="kg" placeholder="kg">
        <input type="date" id="wdate" value="${t}">
        <button class="primary small" id="addw">OK</button>
      </div>
      <p class="muted small">Chaque lundi matin, même conditions. Le poids bouge aussi avec ce que tu manges.</p>
    </section>
    <section class="card"><h3>Historique</h3>${rows || `<p class="muted small">Pas encore de pesée.</p>`}</section>`;

  $("#addw").addEventListener("click", () => {
    const kg = parseFloat($("#kg").value.replace(",", "."));
    const date = $("#wdate").value || t;
    if (!(kg > 20 && kg < 400)) return toast("Poids invalide");
    state.weights = state.weights.filter((w) => w.date !== date);
    state.weights.push({ date, kg });
    save();
    renderWeight();
  });
  view.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Supprimer cette pesée ?")) return;
      state.weights = state.weights.filter((w) => w.date !== b.dataset.del);
      save();
      renderWeight();
    })
  );
}

// ---------- Rendu : Réglages ----------
function renderSettings() {
  const view = $("#view");
  const goal = state.settings.weeklyGoal;
  view.innerHTML = `
    <section class="card">
      <h3>Objectif par semaine</h3>
      <div class="seg">${[3, 4, 5].map((n) => `<button data-goal="${n}" class="${goal === n ? "on" : ""}">${n} séances</button>`).join("")}</div>
    </section>
    <section class="card">
      <h3>Rappel</h3>
      <p class="muted small">Règle une alarme récurrente dans l'app Horloge d'Android (ex. lun · mer · ven) avec le nom « Calliboss ». Change l'heure quand ton emploi du temps change.</p>
    </section>
    <section class="card">
      <h3>Sauvegarde</h3>
      <p class="muted small">Tes données restent sur ce téléphone. Exporte-les de temps en temps.</p>
      <div class="row">
        <button class="ghost" id="export">Exporter</button>
        <label class="ghost file">Importer<input type="file" id="import" accept="application/json"></label>
      </div>
    </section>
    <section class="card">
      <h3>Programme</h3>
      <p class="muted small">${esc(PROGRAM.name)} · ${PROGRAM.exercises.map((e) => esc(e.name)).join(", ")}. Modifiable dans <code>program.js</code>.</p>
      <button class="ghost danger" id="reset">Tout effacer</button>
    </section>`;

  view.querySelectorAll("[data-goal]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.weeklyGoal = +b.dataset.goal;
      save();
      renderSettings();
    })
  );
  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `calliboss-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.sessions)) throw new Error();
      if (!confirm("Remplacer les données actuelles par ce fichier ?")) return;
      localStorage.setItem(KEY, JSON.stringify(data));
      state = load();
      toast("Données importées");
      renderSettings();
    } catch (err) {
      toast("Fichier invalide");
    }
  });
  $("#reset").addEventListener("click", () => {
    if (!confirm("Effacer TOUTES les données (séances, paliers, poids) ?")) return;
    state = emptyState();
    save();
    toast("Données effacées");
    renderSettings();
  });
}

// ---------- Navigation ----------
const TABS = { seance: renderSession, progres: renderProgress, poids: renderWeight, reglages: renderSettings };
let tab = "seance";
function show(name) {
  tab = name;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  TABS[name]();
  window.scrollTo(0, 0);
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));

// Recharge la vue si l'app reste ouverte après minuit
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") TABS[tab]();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

show("seance");
