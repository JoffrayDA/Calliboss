"use strict";

// ---------- Stockage ----------
const KEY = "calliboss.v1";

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Le programme de program.js sert de base. Un programme créé dans l'app (state.program)
// le remplace en écrasant ces clés de PROGRAM ; la partie course n'est pas concernée.
const DEFAULT_PROGRAM = clone(PROGRAM);
const PROGRAM_KEYS = ["name", "rounds", "restBetweenRounds", "warmup", "mobility", "cooldown", "exercises"];
function applyProgram(p) {
  const src = p || DEFAULT_PROGRAM;
  PROGRAM_KEYS.forEach((k) => (PROGRAM[k] = clone(src[k] !== undefined ? src[k] : DEFAULT_PROGRAM[k])));
}

// Chaque ligne de séance garde le nom et l'unité du mouvement fait ce jour-là :
// l'historique reste lisible quand le programme change.
function stampNames(s) {
  s.sessions.forEach((se) =>
    Object.keys(se.results || {}).forEach((id) => {
      const ex = PROGRAM.exercises.find((e) => e.id === id);
      const r = se.results[id];
      [r, ...(r.extras || [])].forEach((e) => {
        if (e.name) return;
        const st = ex && e.level >= 0 ? stepFor(ex, e.level, e.home) : null;
        e.name = st ? st.name : id;
        e.unit = st ? st.unit : "reps";
      });
    })
  );
}

function emptyState() {
  const levels = {};
  PROGRAM.exercises.forEach((ex) => (levels[ex.id] = 0));
  return {
    settings: { weeklyGoal: PROGRAM.weeklyGoalDefault, runGoal: PROGRAM.run.weeklyGoalDefault, kind: "cali", shareWeight: true },
    levels,
    sessions: [],
    runs: [], // { date, km, sec, rpe, mobility: [ids] }
    runDraft: { checks: {} },
    weights: [],
    levelLog: [],
    proposals: [], // exos prêts pour le palier suivant, en attente de ta réponse
    transitions: {}, // exId -> date de début : le palier suivant est ajouté en « palier en plus »
    draft: null,
    program: null, // programme créé dans l'app ; null = programme de base
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      applyProgram(null);
      return emptyState();
    }
    const s = Object.assign(emptyState(), JSON.parse(raw));
    s.settings = Object.assign(emptyState().settings, s.settings);
    applyProgram(s.program);
    PROGRAM.exercises.forEach((ex) => {
      if (typeof s.levels[ex.id] !== "number") s.levels[ex.id] = 0;
      s.levels[ex.id] = Math.min(s.levels[ex.id], ex.ladder.length - 1);
    });
    stampNames(s);
    return s;
  } catch (e) {
    applyProgram(null);
    return emptyState();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    toast("Impossible d'enregistrer les données");
  }
  schedulePublish();
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

// Palier d'un exercice, variante maison si demandée et disponible.
// Le niveau est borné pour survivre à une échelle raccourcie dans program.js.
function stepFor(ex, level, home) {
  const step = ex.ladder[Math.max(0, Math.min(level, ex.ladder.length - 1))];
  if (home && step.home) return { ...step.home, isHome: true };
  return { ...step, isHome: false };
}

// Séries toujours de longueur `rounds`, sans trous (0 = pas fait).
function dense(sets) {
  return Array.from({ length: PROGRAM.rounds }, (_, i) => (sets && sets[i]) || 0);
}
function countFilled(sets) {
  return (sets || []).filter((v) => v > 0).length;
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

// Dernière perf notée pour un exo à un palier donné (principal ou palier en plus).
function lastPerf(exId, level, home) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const r = state.sessions[i].results[exId];
    if (!r) continue;
    const e = [r, ...(r.extras || [])].find((e) => e.level === level && !!e.home === home && countFilled(e.sets) > 0);
    if (e) return { date: state.sessions[i].date, sets: dense(e.sets) };
  }
  return null;
}
function lastBonus(name) {
  const key = name.trim().toLowerCase();
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const b = (state.sessions[i].bonus || []).find((b) => b.name.trim().toLowerCase() === key);
    if (b) return { date: state.sessions[i].date, sets: dense(b.sets) };
  }
  return null;
}
function lastLine(last) {
  return last ? `<div class="last">Dernière fois (${prettyDate(last.date)}) : <b>${last.sets.join(" · ")}</b></div>` : "";
}

// ---------- Brouillon de la séance en cours ----------
// Un brouillon commencé la veille survit à minuit tant qu'il a servi dans les dernières heures.
const DRAFT_TTL = 4 * 3600 * 1000;
function getDraft() {
  const t = today();
  const d = state.draft;
  const stale =
    !d ||
    (d.date !== t && Date.now() - (d.touched || 0) > DRAFT_TTL) ||
    state.sessions.some((s) => s.date === d.date);
  if (stale) {
    state.draft = { date: t, mode: d ? d.mode : "parc", checks: {}, sets: {}, extras: {}, bonus: [], touched: Date.now() };
    seedTransitions(state.draft);
  }
  state.draft.extras = state.draft.extras || {};
  state.draft.bonus = state.draft.bonus || [];
  return state.draft;
}
function touch() {
  getDraft().touched = Date.now();
  save();
}
function hasSetData(d) {
  return (
    Object.values(d.sets).some((a) => countFilled(a) > 0) ||
    Object.values(d.extras).some((xs) => xs.some((x) => countFilled(x.sets) > 0))
  );
}

// ---------- Rendu : Séance ----------
// Deux compteurs séparés : calisthénie (pastille pleine) et course (point sous le jour).
// Semaine en cours de n'importe qui (moi ou un membre du groupe) : `done` et `ran` sont
// les dates (Set) des séances de calisthénie et des sorties.
function weekHtml(done, ran, goal, runGoal, streak) {
  const monday = mondayOf(today());
  let count = 0, runCount = 0;
  const dots = ["L", "M", "M", "J", "V", "S", "D"]
    .map((l, i) => {
      const d = addDays(monday, i);
      if (done.has(d)) count++;
      if (ran.has(d)) runCount++;
      const cls = [done.has(d) ? "done" : "", ran.has(d) ? "run" : "", d === today() ? "today" : ""].join(" ");
      return `<div class="day ${cls}"><span>${l}</span></div>`;
    })
    .join("");
  const html = `
      <div class="week-head">
        <div class="counters">
          <div><div class="big">${count}<small>/${goal}</small></div><div class="muted small">🏋️ calisthénie</div></div>
          <div><div class="big">${runCount}<small>/${runGoal}</small></div><div class="muted small">🏃 course</div></div>
        </div>
        <div class="streak">${streak > 0 ? `🔥 ${streak} sem.` : ""}</div>
      </div>
      <div class="days">${dots}</div>`;
  return { html, count, runCount };
}

function renderWeek() {
  const goal = state.settings.weeklyGoal;
  const runGoal = state.settings.runGoal;
  const { html, count, runCount } = weekHtml(sessionDates(), new Set(state.runs.map((r) => r.date)), goal, runGoal, weeksStreak());
  const both = count >= goal && runCount >= runGoal;
  return `
    <section class="card week">${html}
      ${both ? `<p class="win">Semaine complète, cali et course 💪</p>` : count >= goal ? `<p class="win">Objectif calisthénie atteint 💪</p>` : ""}
    </section>`;
}

function kindSwitch() {
  const k = state.settings.kind;
  return `<div class="seg kinds">
    <button data-kind="cali" class="${k === "cali" ? "on" : ""}">🏋️ Calisthénie</button>
    <button data-kind="run" class="${k === "run" ? "on" : ""}">🏃 Course + mobilité</button>
  </div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-kind]");
  if (!b) return;
  state.settings.kind = b.dataset.kind;
  save();
  renderSession();
});

function checkItem(key, label) {
  const d = getDraft();
  return `<label class="check ${d.checks[key] ? "on" : ""}">
    <input type="checkbox" data-check="${key}" ${d.checks[key] ? "checked" : ""}>
    <span class="box"></span><span>${esc(label)}</span></label>`;
}

function setInputs(attrs, sets, placeholder) {
  return Array.from({ length: PROGRAM.rounds }, (_, i) => {
    const v = (sets && sets[i]) || "";
    return `<label class="set"><span>T${i + 1}</span>
      <input type="number" inputmode="numeric" min="0" ${attrs} data-set="${i}" value="${v}" placeholder="${placeholder}"></label>`;
  }).join("");
}

function stepHead(step, prefix) {
  return `<div class="ex-name">${prefix}${esc(step.name)}${step.isHome ? ` <span class="tag">maison</span>` : ""}</div>
    <div class="muted">${step.min}–${step.max} ${unitLabel(step.unit)} par tour${step.tip ? " · " + esc(step.tip) : ""}</div>`;
}

function exerciseCard(ex) {
  const d = getDraft();
  const home = d.mode === "maison";
  const lvl = state.levels[ex.id];
  const step = stepFor(ex, lvl, home);
  const sets = d.sets[ex.id] || [];
  const filled = countFilled(sets);
  const complete = filled === PROGRAM.rounds;

  const extras = (d.extras[ex.id] || [])
    .map((x, j) => {
      const st = stepFor(ex, x.level, x.home);
      const trans = state.transitions[ex.id] && x.level === lvl + 1;
      return `<div class="extra">
        <div class="ex-head"><div>${stepHead(st, trans ? `<span class="tag">🔀 transition</span> ` : "+ ")}</div>
          <button class="x" data-rmextra="${ex.id}" data-idx="${j}" aria-label="Retirer">×</button></div>
        ${lastLine(lastPerf(ex.id, x.level, x.home))}
        <div class="sets">${setInputs(`data-ex="${ex.id}" data-extra="${j}"`, x.sets, st.min)}</div>
      </div>`;
    })
    .join("");

  const options = ex.ladder
    .map((_, i) => i)
    .filter((i) => i !== lvl)
    .map((i) => {
      const st = stepFor(ex, i, home);
      return `<option value="${i}">${esc(st.name)} (${st.min}–${st.max} ${unitLabel(st.unit)})</option>`;
    })
    .join("");

  return `
    <div class="ex ${complete ? "complete" : ""}" data-card="${ex.id}">
      <div class="ex-head">
        <div>${stepHead(step, "")}</div>
        <div class="ex-status">${complete ? "✓" : `${filled}/${PROGRAM.rounds}`}</div>
      </div>
      ${lastLine(lastPerf(ex.id, lvl, step.isHome))}
      <div class="sets">${setInputs(`data-ex="${ex.id}"`, sets, step.min)}</div>
      ${extras}
      ${options ? `<select class="addvar" data-addvar="${ex.id}"><option value="">+ faire aussi un autre palier</option>${options}</select>` : ""}
    </div>`;
}

function bonusSection() {
  const d = getDraft();
  const rows = d.bonus
    .map(
      (b, j) => `<div class="ex">
        <div class="ex-head"><div><div class="ex-name">${esc(b.name)}</div><div class="muted">${unitLabel(b.unit)} par tour</div></div>
          <button class="x" data-rmbonus="${j}" aria-label="Retirer">×</button></div>
        ${lastLine(lastBonus(b.name))}
        <div class="sets">${setInputs(`data-bonus="${j}"`, b.sets, "")}</div>
      </div>`
    )
    .join("");
  const names = new Set();
  PROGRAM.exercises.forEach((ex) =>
    ex.ladder.forEach((st) => {
      names.add(st.name);
      if (st.home) names.add(st.home.name);
    })
  );
  state.sessions.forEach((s) => (s.bonus || []).forEach((b) => names.add(b.name)));
  return `
    <section class="card">
      <h3>3. Bonus <span class="muted small">· optionnel</span></h3>
      <p class="muted small">Envie d'en faire plus ? Ajoute un exo, il sera gardé dans l'historique.</p>
      ${rows}
      <div class="row addbonus">
        <input type="text" id="bname" list="exnames" placeholder="Nom de l'exo" autocomplete="off">
        <select id="bunit"><option value="reps">reps</option><option value="s">s</option></select>
        <button class="primary small" id="addbonus">+</button>
      </div>
      <datalist id="exnames">${[...names].map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
    </section>`;
}

function sessionComplete() {
  const d = getDraft();
  const checksOk = ["warmup", "mobility", "cooldown"].every((k) => d.checks[k]);
  const setsOk = PROGRAM.exercises.every((ex) => countFilled(d.sets[ex.id]) === PROGRAM.rounds);
  return checksOk && setsOk;
}

function renderSession() {
  if (state.settings.kind === "run") return renderRun();
  const view = $("#view");
  const t = today();
  const doneToday = state.sessions.find((s) => s.date === t);

  if (doneToday) {
    const trainedYesterday = state.sessions.some((s) => s.date === addDays(t, -1));
    view.innerHTML =
      renderWeek() +
      kindSwitch() +
      proposalCards() +
      exportBanner() +
      `<section class="card center">
        <div class="huge">✅</div>
        <h2>Séance validée</h2>
        <p class="muted">Bien joué. Récupère, mange bien, dors.${trainedYesterday ? " Deux jours d'affilée : demain, repos." : ""}</p>
      </section>
      <section class="card">
        <h3>Ta séance du jour</h3>
        ${sessionLines(doneToday)}
        <button class="ghost" id="reopen">✏️ Modifier / compléter la séance</button>
      </section>`;
    $("#reopen").addEventListener("click", () => reopenSession(doneToday));
    return;
  }

  const d = getDraft();
  const trainedDayBefore = state.sessions.some((s) => s.date === addDays(d.date, -1));
  view.innerHTML =
    renderWeek() +
    kindSwitch() +
    proposalCards() +
    exportBanner() +
    `<section class="card">
      <div class="seg">
        <button data-mode="parc" class="${d.mode === "parc" ? "on" : ""}">🌳 Parc</button>
        <button data-mode="maison" class="${d.mode === "maison" ? "on" : ""}">🏠 Plan B maison</button>
      </div>
      ${d.date !== t ? `<p class="muted small">Séance commencée le ${prettyDate(d.date)} : elle sera enregistrée à cette date.</p>` : ""}
      ${trainedDayBefore ? `<p class="muted small">Tu t'es entraîné la veille : un jour de repos compte aussi.</p>` : ""}
    </section>

    <section class="card">
      <h3>1. Échauffement</h3>
      ${checkItem("warmup", PROGRAM.warmup[d.mode])}
      ${checkItem("mobility", PROGRAM.mobility)}
    </section>

    <section class="card">
      <h3>2. Circuit · ${PROGRAM.rounds} tour${PROGRAM.rounds > 1 ? "s" : ""}</h3>
      <p class="muted small">Enchaîne les exos dans l'ordre, puis recommence. ${esc(PROGRAM.restBetweenRounds)}. Note ce que tu fais à chaque tour (${Array.from({ length: PROGRAM.rounds }, (_, i) => `T${i + 1}`).join(", ")}).</p>
      ${PROGRAM.exercises.map(exerciseCard).join("")}
      <button class="ghost" id="rest">⏱ Repos 2:00</button>
    </section>

    ${bonusSection()}

    <section class="card">
      <h3>4. Retour au calme</h3>
      ${checkItem("cooldown", PROGRAM.cooldown[d.mode])}
    </section>

    <button class="primary" id="validate">${sessionComplete() ? "Valider la séance ✓" : "Valider la séance"}</button>`;

  view.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      const dr = getDraft();
      if (dr.mode === b.dataset.mode) return;
      if (hasSetData(dr) && !confirm("Changer de lieu efface les reps notées dans le circuit. Continuer ?")) return;
      dr.mode = b.dataset.mode;
      dr.sets = {};
      dr.extras = {};
      seedTransitions(dr);
      touch();
      renderSession();
    })
  );
  view.querySelectorAll("[data-check]").forEach((c) =>
    c.addEventListener("change", () => {
      getDraft().checks[c.dataset.check] = c.checked;
      touch();
      c.closest(".check").classList.toggle("on", c.checked);
      updateValidateLabel();
    })
  );
  view.querySelectorAll("input[data-set]").forEach((inp) =>
    inp.addEventListener("input", () => {
      const v = parseInt(inp.value, 10);
      setsOf(inp)[+inp.dataset.set] = isNaN(v) ? 0 : v;
      touch();
      if (inp.dataset.ex && inp.dataset.extra === undefined) refreshExStatus(inp.dataset.ex);
      updateValidateLabel();
    })
  );
  view.querySelectorAll("[data-addvar]").forEach((sel) =>
    sel.addEventListener("change", () => {
      if (sel.value === "") return;
      const dr = getDraft();
      const ex = PROGRAM.exercises.find((e) => e.id === sel.dataset.addvar);
      const level = +sel.value;
      (dr.extras[ex.id] = dr.extras[ex.id] || []).push({ level, home: stepFor(ex, level, dr.mode === "maison").isHome, sets: [] });
      touch();
      renderSession();
    })
  );
  view.querySelectorAll("[data-rmextra]").forEach((b) =>
    b.addEventListener("click", () => {
      getDraft().extras[b.dataset.rmextra].splice(+b.dataset.idx, 1);
      touch();
      renderSession();
    })
  );
  view.querySelectorAll("[data-rmbonus]").forEach((b) =>
    b.addEventListener("click", () => {
      getDraft().bonus.splice(+b.dataset.rmbonus, 1);
      touch();
      renderSession();
    })
  );
  $("#addbonus").addEventListener("click", () => {
    const name = $("#bname").value.trim();
    if (!name) return toast("Donne un nom à l'exo");
    getDraft().bonus.push({ name, unit: $("#bunit").value, sets: [] });
    touch();
    renderSession();
  });
  $("#rest").addEventListener("click", () => startRest(120));
  $("#validate").addEventListener("click", validateSession);
}

// Tableau de séries du brouillon visé par un champ de saisie.
function setsOf(inp) {
  const d = getDraft();
  if (inp.dataset.bonus !== undefined) return d.bonus[+inp.dataset.bonus].sets;
  if (inp.dataset.extra !== undefined) return d.extras[inp.dataset.ex][+inp.dataset.extra].sets;
  return (d.sets[inp.dataset.ex] = d.sets[inp.dataset.ex] || []);
}

function refreshExStatus(exId) {
  const filled = countFilled(getDraft().sets[exId]);
  const card = document.querySelector(`[data-card="${exId}"]`);
  const complete = filled === PROGRAM.rounds;
  card.classList.toggle("complete", complete);
  card.querySelector(".ex-status").textContent = complete ? "✓" : `${filled}/${PROGRAM.rounds}`;
}
function updateValidateLabel() {
  $("#validate").textContent = sessionComplete() ? "Valider la séance ✓" : "Valider la séance";
}

function validateSession() {
  const d = getDraft();
  const complete = sessionComplete();
  if (!complete) {
    const anything = Object.values(d.checks).some(Boolean) || hasSetData(d) || d.bonus.some((b) => countFilled(b.sets) > 0);
    if (!anything) return toast("Coche au moins l'échauffement 😉");
    if (!confirm("Séance incomplète. La valider quand même ? Une séance réduite vaut mieux que rien.")) return;
  }
  const results = {};
  PROGRAM.exercises.forEach((ex) => {
    const lvl = state.levels[ex.id];
    const named = (level, home) => {
      const st = stepFor(ex, level, home);
      return { level, home: st.isHome, name: st.name, unit: st.unit };
    };
    const extras = (d.extras[ex.id] || [])
      .map((x) => ({ ...named(x.level, x.home), sets: dense(x.sets) }))
      .filter((x) => countFilled(x.sets) > 0);
    results[ex.id] = { ...named(lvl, d.mode === "maison"), sets: dense(d.sets[ex.id]), extras };
  });
  const bonus = d.bonus.map((b) => ({ name: b.name, unit: b.unit, sets: dense(b.sets) })).filter((b) => countFilled(b.sets) > 0);
  state.sessions.push({ date: d.date, mode: d.mode, complete, checks: { ...d.checks }, results, bonus });
  state.sessions.sort((a, b) => a.date.localeCompare(b.date));
  state.draft = null;

  const ready = readyForNext();
  state.proposals = ready;
  save();
  renderSession();
  toast(ready.length ? "Séance validée 💪 · 🎯 palier suivant à portée, regarde en haut" : "Séance validée 💪");
}

// Exos où toutes les séries ont atteint `max` sur les N dernières séances au palier actuel.
// Seul le palier principal compte (pas les paliers en plus ni la variante maison).
// L'app ne monte jamais seule : elle propose, tu choisis (voir chooseNext).
function readyForNext() {
  return PROGRAM.exercises
    .filter((ex) => {
      const lvl = state.levels[ex.id];
      if (lvl >= ex.ladder.length - 1) return false;
      const max = ex.ladder[lvl].max;
      const recent = state.sessions
        .filter((s) => s.results[ex.id] && s.results[ex.id].level === lvl && !s.results[ex.id].home)
        .slice(-PROGRAM.advanceAfter);
      return recent.length === PROGRAM.advanceAfter && recent.every((s) => dense(s.results[ex.id].sets).every((v) => v >= max));
    })
    .map((ex) => ex.id);
}

// ---------- Montée de palier : proposée, progressive ----------
function nextStep(ex) {
  const lvl = state.levels[ex.id];
  return lvl < ex.ladder.length - 1 ? ex.ladder[lvl + 1] : null;
}
function stepLabel(st) {
  return `${st.name} (${st.min}–${st.max} ${unitLabel(st.unit)})`;
}

// En transition, le palier suivant est ajouté d'office en « palier en plus » à la séance.
function seedTransitions(d) {
  Object.keys(state.transitions).forEach((exId) => {
    const ex = PROGRAM.exercises.find((e) => e.id === exId);
    if (!ex || !nextStep(ex)) return;
    const level = state.levels[exId] + 1;
    const list = (d.extras[exId] = d.extras[exId] || []);
    if (!list.some((x) => x.level === level)) list.push({ level, home: stepFor(ex, level, d.mode === "maison").isHome, sets: [] });
  });
}

function levelUp(exId) {
  const ex = PROGRAM.exercises.find((e) => e.id === exId);
  if (!nextStep(ex)) return;
  const old = state.levels[exId];
  state.levels[exId]++;
  state.levelLog.push({ date: today(), exId, level: state.levels[exId] });
  delete state.transitions[exId];
  state.proposals = state.proposals.filter((id) => id !== exId);
  // Brouillon en cours : le nouveau palier devient le principal, l'ancien passe « en plus »
  const d = state.draft;
  if (d && d.sets) {
    d.extras = d.extras || {};
    const extras = (d.extras[exId] = d.extras[exId] || []);
    const i = extras.findIndex((x) => x.level === old + 1);
    const oldSets = d.sets[exId] || [];
    d.sets[exId] = i >= 0 ? extras.splice(i, 1)[0].sets : [];
    if (countFilled(oldSets) > 0) extras.unshift({ level: old, home: stepFor(ex, old, d.mode === "maison").isHome, sets: oldSets });
  }
}

function chooseNext(exId, choice) {
  const ex = PROGRAM.exercises.find((e) => e.id === exId);
  const next = nextStep(ex);
  if (choice === "up") {
    levelUp(exId);
    toast(`🎉 Nouveau palier : ${next.name}`);
  } else if (choice === "trans") {
    state.transitions[exId] = today();
    state.proposals = state.proposals.filter((id) => id !== exId);
    if (!state.sessions.some((s) => s.date === today())) seedTransitions(getDraft());
    toast(`🔀 ${next.name} ajouté en plus à chaque séance`);
  } else if (choice === "later") {
    state.proposals = state.proposals.filter((id) => id !== exId);
    toast("OK, on garde ce palier. La question reviendra.");
  } else if (choice === "stop") {
    delete state.transitions[exId];
    toast("Transition arrêtée");
  }
  save();
  TABS[tab]();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-choice]");
  if (b) chooseNext(b.dataset.ex, b.dataset.choice);
});

function proposalCards() {
  return state.proposals
    .map((exId) => {
      const ex = PROGRAM.exercises.find((e) => e.id === exId);
      const next = ex && nextStep(ex);
      if (!next) return "";
      const cur = ex.ladder[state.levels[exId]];
      const inTransition = !!state.transitions[exId];
      return `<section class="card banner propose">
        <h3>🎯 ${esc(ex.name)} : prêt pour la suite ?</h3>
        <p class="small">Max sur les ${PROGRAM.rounds} tours, ${PROGRAM.advanceAfter} séances de suite en ${esc(cur.name)}. Palier suivant : <b>${esc(stepLabel(next))}</b>.</p>
        <div class="choices">
          <button class="primary small" data-ex="${exId}" data-choice="up">Passer</button>
          ${inTransition ? "" : `<button class="ghost" data-ex="${exId}" data-choice="trans">Y aller progressivement</button>`}
          <button class="ghost" data-ex="${exId}" data-choice="later">Pas encore</button>
        </div>
        ${inTransition ? "" : `<p class="muted small">Progressivement : tu gardes ${esc(cur.name)} et on ajoute ${esc(next.name)} en plus à chaque séance. Tu passes quand tu te sens prêt.</p>`}
      </section>`;
    })
    .join("");
}

// Rouvre la séance du jour en brouillon pour la compléter. Les paliers reviennent à ceux
// de la séance : la revalidation refera la montée si elle est toujours méritée.
function reopenSession(s) {
  const d = {
    date: s.date,
    mode: s.mode,
    checks: s.checks || (s.complete ? { warmup: true, mobility: true, cooldown: true } : {}),
    sets: {},
    extras: {},
    bonus: (s.bonus || []).map((b) => ({ ...b, sets: [...b.sets] })),
    touched: Date.now(),
  };
  PROGRAM.exercises.forEach((ex) => {
    const r = s.results[ex.id];
    if (!r) return;
    // level < 0 : palier retiré du programme depuis, on garde le palier actuel
    if (r.level >= 0) state.levels[ex.id] = Math.min(r.level, ex.ladder.length - 1);
    d.sets[ex.id] = [...r.sets];
    d.extras[ex.id] = (r.extras || []).filter((x) => x.level >= 0).map((x) => ({ level: x.level, home: x.home, sets: [...x.sets] }));
  });
  state.levelLog = state.levelLog.filter((l) => l.date !== s.date);
  state.proposals = [];
  state.sessions = state.sessions.filter((x) => x !== s);
  state.draft = d;
  save();
  renderSession();
  window.scrollTo(0, 0);
}

// ---------- Course + mobilité ----------
const RUN = PROGRAM.run;
function runsInWeek(monday) {
  const end = addDays(monday, 7);
  return state.runs.filter((r) => r.date >= monday && r.date < end);
}
function fmtKm(km) {
  return String(parseFloat(km.toFixed(2))).replace(".", ",");
}
function fmtPace(secPerKm) {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function paceOf(r) {
  return r.sec / r.km;
}
function longest(runs) {
  return runs.length ? Math.max(...runs.map((r) => r.km)) : 0;
}

// Blocs de RUN.blockDays jours depuis RUN.blockStart (les blocs d'avant ont un numéro négatif).
function blockOf(date) {
  return Math.floor((dayNum(date) - dayNum(RUN.blockStart)) / RUN.blockDays);
}
function blockRange(b) {
  const start = addDays(RUN.blockStart, b * RUN.blockDays);
  return [start, addDays(start, RUN.blockDays - 1)];
}
function runsBetween(from, to, exceptDate) {
  return state.runs.filter((r) => r.date >= from && r.date <= to && r.date !== exceptDate);
}

// Limite d'une sortie à la date donnée : growth × plus longue sortie du bloc précédent, plafonnée.
// Bloc précédent vide : pas de hausse, on reprend la plus longue des 4 semaines d'avant.
function runLimit(date) {
  // Avant le démarrage du plan, on affiche déjà la limite du premier bloc.
  const b = Math.max(0, blockOf(date));
  const [start, end] = blockRange(b);
  const [ps, pe] = blockRange(b - 1);
  const prev = longest(runsBetween(ps, pe));
  let km, base, hold = false;
  if (prev) {
    base = prev;
    km = prev * RUN.growth;
  } else {
    base = longest(runsBetween(addDays(start, -28), addDays(start, -1)));
    if (!base) return null;
    km = base;
    hold = true;
  }
  km = Math.min(RUN.capKm, Math.round(km * 10) / 10);
  return { km, base, hold, start, end, capped: km >= RUN.capKm };
}

// Alertes du coach pour une sortie (date, km, sec/km) avant enregistrement.
function runWarnings(date, km, pace) {
  const w = [];
  const lim = date >= RUN.blockStart ? runLimit(date) : null; // sorties d'avant le plan : pas de limite
  if (lim && km > lim.km + 0.05) w.push(`Au-dessus de ta limite du bloc : ${fmtKm(lim.km)} km max.`);
  const recent = runsBetween(addDays(date, -14), addDays(date, -1), date);
  const month = runsBetween(addDays(date, -30), addDays(date, -1), date);
  if (recent.length && month.length && km > longest(recent) && pace < Math.min(...month.map(paceOf)))
    w.push("Distance ET vitesse en hausse en même temps : une seule à la fois.");
  return w;
}

function coachCard() {
  const t = today();
  const lim = runLimit(t);
  if (!lim)
    return `<section class="card banner coach"><h3>🎯 Coach course</h3>
      <p class="small">Pas encore de repère. Enregistre ta dernière sortie, même ancienne (choisis sa date) : l'app calculera ta limite.</p></section>`;
  const [bs, be] = [lim.start, lim.end];
  const thisBlock = longest(runsBetween(bs, be));
  const nextStart = addDays(be, 1);
  return `<section class="card banner coach">
    <h3>🎯 Limite : ${fmtKm(lim.km)} km par sortie</h3>
    <p class="small">Bloc du ${prettyDate(bs)} au ${prettyDate(be)} · ${
      lim.capped
        ? `plafond de ${RUN.capKm} km atteint, garde ce volume`
        : lim.hold
        ? `pas de sortie au bloc précédent : pas de hausse, on reprend ${fmtKm(lim.base)} km`
        : `ta plus longue du bloc précédent (${fmtKm(lim.base)} km) × ${String(RUN.growth).replace(".", ",")}`
    }</p>
    <p class="small">Plus longue ce bloc : <b>${thisBlock ? fmtKm(thisBlock) + " km" : "aucune"}</b>${
      lim.capped ? "" : ` · prochaine hausse possible le ${prettyDate(nextStart)}`
    }</p>
    <p class="muted small">Allure où tu peux parler. Une seule chose augmente à la fois : distance OU vitesse. Douleur au tibia, genou ou tendon d'Achille : tu restes sur place.</p>
  </section>`;
}

function renderRun() {
  const view = $("#view");
  const t = today();
  const d = state.runDraft;
  const todayRun = state.runs.find((r) => r.date === t);
  const recent = [...state.runs]
    .reverse()
    .slice(0, 5)
    .map(
      (r) => `<div class="hist"><span>${prettyDate(r.date)}</span><span class="grow"><b>${fmtKm(r.km)} km</b> · ${fmtPace(paceOf(r))}/km${
        r.rpe != null ? ` · effort ${r.rpe}/10` : ""
      }</span><button class="x" data-delrun="${r.date}" aria-label="Supprimer">×</button></div>`
    )
    .join("");

  view.innerHTML =
    renderWeek() +
    kindSwitch() +
    exportBanner() +
    coachCard() +
    (todayRun
      ? `<section class="card center"><div class="huge">✅</div><h2>Sortie enregistrée</h2>
          <p class="muted">${fmtKm(todayRun.km)} km · ${fmtPace(paceOf(todayRun))}/km. Pense à la mobilité si ce n'est pas fait.</p></section>`
      : "") +
    `<section class="card">
      <h3>1. Ta sortie</h3>
      <div class="runform">
        <label>Date<input type="date" id="rdate" value="${t}"></label>
        <label>Distance (km)<input type="text" inputmode="decimal" id="rkm" placeholder="4,5"></label>
        <label>Durée<span class="dur"><input type="number" inputmode="numeric" id="rmin" placeholder="min" min="0"><span>:</span><input type="number" inputmode="numeric" id="rsec" placeholder="s" min="0" max="59"></span></label>
        <label>Effort ressenti (optionnel)<select id="rrpe"><option value="">—</option>${Array.from({ length: 11 }, (_, i) => `<option value="${i}">${i}${i === 0 ? " (repos)" : i === 10 ? " (max)" : ""}</option>`).join("")}</select></label>
      </div>
      <p class="pace" id="rpace"></p>
      <div id="rwarn"></div>
    </section>
    <section class="card">
      <h3>2. Mobilité après la course <span class="muted small">· ~15 min</span></h3>
      <p class="muted small">Après la course, jamais juste avant une séance de calisthénie.</p>
      ${RUN.mobility
        .map(
          (m) => `<label class="check ${d.checks[m.id] ? "on" : ""}"><input type="checkbox" data-mob="${m.id}" ${d.checks[m.id] ? "checked" : ""}>
            <span class="box"></span><span>${esc(m.text)}</span></label>`
        )
        .join("")}
    </section>
    <button class="primary" id="saverun">Enregistrer la sortie</button>
    <section class="card"><h3>Dernières sorties</h3>${recent || `<p class="muted small">Pas encore de sortie.</p>`}</section>`;

  const readForm = () => {
    const km = parseFloat($("#rkm").value.replace(",", "."));
    const sec = (parseInt($("#rmin").value, 10) || 0) * 60 + (parseInt($("#rsec").value, 10) || 0);
    return { date: $("#rdate").value || t, km, sec };
  };
  const refresh = () => {
    const { date, km, sec } = readForm();
    const ok = km > 0 && sec > 0;
    $("#rpace").innerHTML = ok ? `Allure : <b>${fmtPace(sec / km)}/km</b>` : "";
    const w = km > 0 ? runWarnings(date, km, ok ? sec / km : Infinity) : [];
    $("#rwarn").innerHTML = w.map((x) => `<p class="warn">⚠️ ${esc(x)}</p>`).join("");
  };
  ["#rdate", "#rkm", "#rmin", "#rsec"].forEach((s) => $(s).addEventListener("input", refresh));

  view.querySelectorAll("[data-mob]").forEach((c) =>
    c.addEventListener("change", () => {
      state.runDraft.checks[c.dataset.mob] = c.checked;
      save();
      c.closest(".check").classList.toggle("on", c.checked);
    })
  );
  $("#saverun").addEventListener("click", () => {
    const { date, km, sec } = readForm();
    if (!(km > 0 && km < 100)) return toast("Distance invalide");
    if (!(sec > 0)) return toast("Durée manquante");
    const w = runWarnings(date, km, sec / km);
    if (w.length && !confirm(`${w.join("\n")}\n\nEnregistrer quand même ?`)) return;
    if (state.runs.some((r) => r.date === date) && !confirm(`Remplacer la sortie du ${prettyDate(date)} ?`)) return;
    const rpe = $("#rrpe").value;
    const prevBest = longest(state.runs);
    state.runs = state.runs.filter((r) => r.date !== date);
    state.runs.push({
      date,
      km: Math.round(km * 100) / 100,
      sec,
      rpe: rpe === "" ? null : +rpe,
      mobility: Object.keys(state.runDraft.checks).filter((k) => state.runDraft.checks[k]),
    });
    state.runs.sort((a, b) => a.date.localeCompare(b.date));
    state.runDraft = { checks: {} };
    save();
    renderRun();
    toast(prevBest && km > prevBest ? `🏅 Record de distance : ${fmtKm(km)} km` : "Sortie enregistrée 🏃");
  });
  view.querySelectorAll("[data-delrun]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Supprimer cette sortie ?")) return;
      state.runs = state.runs.filter((r) => r.date !== b.dataset.delrun);
      save();
      renderRun();
    })
  );
}

// ---------- Minuteur de repos ----------
// Calé sur l'heure de fin : reste juste même si le téléphone met la page en veille.
let restTimer = null;
function startRest(seconds) {
  const bar = $("#restbar");
  const end = Date.now() + seconds * 1000;
  clearInterval(restTimer);
  bar.innerHTML = `<span id="restleft"></span><button id="reststop">Stop</button>`;
  $("#reststop").onclick = stopRest;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("#restleft").textContent = `Repos ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (left <= 0) {
      stopRest();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      toast("C'est reparti !");
    }
  };
  bar.classList.add("show");
  tick();
  restTimer = setInterval(tick, 250);
}
function stopRest() {
  clearInterval(restTimer);
  $("#restbar").classList.remove("show");
}

// ---------- Graphiques ----------
function dayNum(dateStr) {
  return Math.round(parseYmd(dateStr).getTime() / 864e5);
}
function shortDate(dateStr) {
  return parseYmd(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "numeric" });
}
// Graduations « rondes » couvrant [lo, hi], environ 3 intervalles.
function niceScale(lo, hi, integer) {
  const raw = (hi - lo || Math.max(1, Math.abs(hi) * 0.02)) / 3;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = Math.max(integer ? 1 : 0, steps.map((m) => m * mag).find((s) => s >= raw));
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step || step, step };
}

// Courbe SVG d'une seule série. points : [{ date, y, seg, tip }]. La ligne se coupe à chaque
// changement de `seg` (nouveau palier) avec un repère vertical étiqueté par labels[seg].
function lineChart(points, { from0 = false, integer = true, labels = {}, fmtY = null } = {}) {
  const W = 320, H = 150, L = 34, R = 12, T = 20, B = 22;
  const xs = points.map((p) => dayNum(p.date));
  const ys = points.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const sc = niceScale(from0 ? 0 : Math.min(...ys), Math.max(...ys), integer);
  const sx = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y) => T + (1 - (y - sc.lo) / (sc.hi - sc.lo)) * (H - T - B);
  const fmt = fmtY || ((v) => (Number.isInteger(v) ? v : v.toFixed(1)));

  let svg = "";
  for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) {
    const y = sy(v).toFixed(1);
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 6}" y="${y}" dy="4" text-anchor="end">${fmt(v)}</text>`;
  }
  svg += `<text class="axis" x="${L}" y="${H - 4}">${shortDate(points[0].date)}</text>`;
  if (points.length > 1) svg += `<text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">${shortDate(points[points.length - 1].date)}</text>`;

  // Segments par palier, repère au début de chaque nouveau palier
  let lastLabelX = -Infinity;
  let path = "";
  points.forEach((p, i) => {
    const x = sx(xs[i]).toFixed(1), y = sy(p.y).toFixed(1);
    const newSeg = i === 0 || p.seg !== points[i - 1].seg;
    if (newSeg && i > 0) svg += `<line class="mark" x1="${x}" x2="${x}" y1="${T - 4}" y2="${H - B}"/>`;
    if (newSeg && labels[p.seg] && x - lastLabelX > 44) {
      svg += `<text class="axis" x="${Math.min(x, W - R - 40)}" y="${T - 8}">${esc(labels[p.seg])}</text>`;
      lastLabelX = x;
    }
    path += `${newSeg ? "M" : "L"}${x} ${y}`;
  });
  svg += `<path class="line" d="${path}"/>`;
  points.forEach((p, i) => {
    const x = sx(xs[i]), y = sy(p.y);
    svg += `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`;
    svg += `<circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" data-tip="${esc(p.tip)}" data-px="${((x / W) * 100).toFixed(1)}" data-py="${((y / H) * 100).toFixed(1)}"/>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${svg}</svg><div class="tip" hidden></div></div>`;
}

// Bulle d'info au toucher d'un point
document.addEventListener("click", (e) => {
  document.querySelectorAll(".chart .tip").forEach((t) => (t.hidden = true));
  const hit = e.target.closest && e.target.closest(".chart [data-tip]");
  if (!hit) return;
  const tip = hit.closest(".chart").querySelector(".tip");
  tip.textContent = hit.dataset.tip;
  tip.style.left = `${Math.min(Math.max(+hit.dataset.px, 20), 80)}%`;
  tip.style.top = `${hit.dataset.py}%`;
  tip.hidden = false;
});

// Volume par séance du palier principal d'un exo (total des 3 tours).
function exerciseChart(ex) {
  const points = state.sessions
    .filter((s) => s.results[ex.id] && countFilled(s.results[ex.id].sets) > 0)
    .map((s) => {
      const r = s.results[ex.id];
      const sets = r.sets;
      const total = sets.reduce((a, b) => a + b, 0);
      return {
        date: s.date,
        y: total,
        seg: `${r.level}${r.home ? "h" : ""}`,
        tip: `${prettyDate(s.date)} · ${r.name} · ${sets.join("·")} = ${total} ${unitLabel(r.unit)}`,
      };
    });
  if (points.length < 2) return "";
  const labels = {};
  points.forEach((p) => {
    const lvl = parseInt(p.seg, 10);
    labels[p.seg] = lvl < 0 ? "ancien" : `P${lvl + 1}${p.seg.endsWith("h") ? " maison" : ""}`;
  });
  const unit = unitLabel(ex.ladder[0].unit);
  return `<p class="muted small chart-title">Total par séance (${unit}), palier principal</p>` + lineChart(points, { from0: true, labels });
}

// Journal : première séance, premières fois à chaque palier (même en « palier en plus »), paliers débloqués.
function milestones() {
  const ev = [];
  if (state.sessions.length) ev.push({ date: state.sessions[0].date, icon: "🚀", text: "Première séance" });
  PROGRAM.exercises.forEach((ex) =>
    ex.ladder.forEach((st, lvl) => {
      if (lvl === 0) return;
      const label = `${st.name} (${st.min}–${st.max} ${unitLabel(st.unit)})`;
      const first = state.sessions.find((s) => {
        const r = s.results[ex.id];
        return r && [r, ...(r.extras || [])].some((e) => e.level === lvl && !e.home && countFilled(e.sets) > 0);
      });
      if (first) ev.push({ date: first.date, icon: "⭐", text: `Première fois : ${label}` });
      state.levelLog
        .filter((l) => l.date && l.exId === ex.id && l.level === lvl)
        .forEach((l) => ev.push({ date: l.date, icon: "🎉", text: `Palier débloqué : ${label}` }));
      if (state.transitions[ex.id] && state.levels[ex.id] + 1 === lvl)
        ev.push({ date: state.transitions[ex.id], icon: "🔀", text: `Transition commencée : ${label}` });
    })
  );
  // Course : première sortie, puis chaque record de distance
  let best = 0;
  state.runs.forEach((r, i) => {
    if (i === 0) ev.push({ date: r.date, icon: "🏃", text: `Première sortie enregistrée : ${fmtKm(r.km)} km` });
    else if (r.km > best) ev.push({ date: r.date, icon: "🏅", text: `Record de distance : ${fmtKm(r.km)} km` });
    best = Math.max(best, r.km);
  });
  return ev.sort((a, b) => b.date.localeCompare(a.date));
}

// Carte course de l'onglet Progrès : distance et allure par sortie.
function runProgressCard() {
  if (!state.runs.length) return "";
  const pts = (y, tip) => state.runs.map((r) => ({ date: r.date, y: y(r), seg: "r", tip: tip(r) }));
  const tip = (r) => `${prettyDate(r.date)} · ${fmtKm(r.km)} km · ${fmtPace(paceOf(r))}/km`;
  const lim = runLimit(today());
  return `<section class="card">
    <h3>🏃 Course</h3>
    <p class="small">${lim ? `Limite actuelle : <b>${fmtKm(lim.km)} km</b> par sortie · ` : ""}plus longue : <b>${fmtKm(longest(state.runs))} km</b> · plafond ${RUN.capKm} km</p>
    ${
      state.runs.length > 1
        ? `<p class="muted small chart-title">Distance par sortie (km)</p>${lineChart(pts((r) => r.km, tip), { from0: true, integer: false })}
           <p class="muted small chart-title">Allure (min/km) · plus bas = plus rapide</p>${lineChart(pts((r) => paceOf(r) / 60, tip), { integer: false, fmtY: (v) => fmtPace(v * 60) })}`
        : `<p class="muted small">Les courbes apparaissent dès la 2e sortie.</p>`
    }
  </section>`;
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
        .flatMap((s) => {
          const r = s.results[ex.id];
          return r ? [r, ...(r.extras || [])].filter((e) => countFilled(e.sets) > 0).map((e) => ({ date: s.date, e })) : [];
        })
        .slice(-4)
        .reverse()
        .map(({ date, e }) => `<div class="hist"><span>${prettyDate(date)}</span><span class="muted">${esc(e.name)}</span><b>${e.sets.join(" · ")}</b></div>`)
        .join("");
      return `<section class="card">
        <div class="ex-head"><h3>${esc(ex.name)}</h3>
          <div class="lvl-btns"><button data-down="${ex.id}" ${lvl === 0 ? "disabled" : ""}>−</button><button data-up="${ex.id}" ${lvl >= ex.ladder.length - 1 ? "disabled" : ""}>+</button></div>
        </div>
        <ol class="ladder">${steps}</ol>
        ${
          state.transitions[ex.id] && nextStep(ex)
            ? `<div class="transition">
                <p class="small">🔀 En transition vers <b>${esc(nextStep(ex).name)}</b> depuis le ${prettyDate(state.transitions[ex.id])}, ajouté en plus à chaque séance.</p>
                <div class="choices">
                  <button class="primary small" data-ex="${ex.id}" data-choice="up">Passer maintenant</button>
                  <button class="ghost" data-ex="${ex.id}" data-choice="stop">Arrêter la transition</button>
                </div></div>`
            : nextStep(ex)
            ? `<button class="ghost small-btn" data-ex="${ex.id}" data-choice="trans">🔀 Commencer ${esc(nextStep(ex).name)} progressivement</button>`
            : ""
        }
        ${exerciseChart(ex)}
        ${last ? `<div class="hist-list">${last}</div>` : `<p class="muted small">Pas encore de séance.</p>`}
      </section>`;
    })
    .join("");

  const journal = milestones()
    .map((m) => `<div class="hist"><span>${prettyDate(m.date)}</span><span class="grow">${m.icon} ${esc(m.text)}</span></div>`)
    .join("");

  view.innerHTML =
    `<p class="muted small pad">Quand tu fais le max sur les ${PROGRAM.rounds} tours, ${PROGRAM.advanceAfter} séances de suite, l'app te propose le palier suivant : direct ou progressivement. C'est toi qui décides. Les boutons − / + ajustent à la main.</p>` +
    `<section class="card"><h3>🏅 Journal</h3>${journal || `<p class="muted small">Tes premières fois apparaîtront ici.</p>`}</section>` +
    runProgressCard() +
    cards;

  view.querySelectorAll("[data-up]").forEach((b) =>
    b.addEventListener("click", () => {
      levelUp(b.dataset.up);
      save();
      renderProgress();
    })
  );
  view.querySelectorAll("[data-down]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.dataset.down;
      state.levels[id]--;
      delete state.transitions[id];
      state.proposals = state.proposals.filter((x) => x !== id);
      save();
      renderProgress();
    })
  );
}

// ---------- Rendu : Historique ----------
// Détail d'une séance : une ligne par palier travaillé, puis les bonus.
// Sous forme de données ({ name, unit, sets, tag }) : c'est aussi ce qui est partagé au groupe.
function sessionEntries(s) {
  // Exos du programme actuel d'abord, puis ceux retirés depuis.
  const ids = PROGRAM.exercises.map((ex) => ex.id);
  Object.keys(s.results).forEach((id) => ids.includes(id) || ids.push(id));
  const entries = ids.flatMap((id) => {
    const r = s.results[id];
    if (!r) return [];
    return [r, ...(r.extras || [])]
      .filter((e) => countFilled(e.sets) > 0)
      .map((e) => ({ name: e.name, unit: e.unit, sets: e.sets, tag: e.home ? "maison" : "" }));
  });
  (s.bonus || []).forEach((b) => entries.push({ name: b.name, unit: b.unit, sets: b.sets, tag: "bonus" }));
  return entries;
}
function entryLines(entries) {
  return (
    entries
      .map(
        (e) =>
          `<div class="hist"><span class="grow">${esc(e.name)}${e.tag ? ` <span class="tag">${esc(e.tag)}</span>` : ""}</span><b>${(e.sets || []).map(Number).join(" · ")} <small class="muted">${unitLabel(e.unit)}</small></b></div>`
      )
      .join("") || `<p class="muted small">Aucune série notée.</p>`
  );
}
function sessionLines(s) {
  return entryLines(sessionEntries(s));
}

function renderHistory() {
  const view = $("#view");
  if (!state.sessions.length && !state.runs.length) {
    view.innerHTML = `<section class="card"><p class="muted small">Rien pour l'instant. La première, c'est la plus dure.</p></section>`;
    return;
  }
  const mobText = (id) => (RUN.mobility.find((m) => m.id === id) || { text: id }).text;
  const entries = [
    ...state.sessions.map((s, i) => ({ date: s.date, kind: 0, s, i })),
    ...state.runs.map((r) => ({ date: r.date, kind: 1, r })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.kind - a.kind);
  const items = entries
    .map((e, n) => {
      if (e.r) {
        const r = e.r;
        return `<details class="card sess" ${n === 0 ? "open" : ""}>
          <summary><span>${prettyDate(r.date)}</span><span class="muted">🏃 course</span><b>${fmtKm(r.km)} km</b></summary>
          <div class="sess-body">
            <div class="hist"><span class="grow">Allure</span><b>${fmtPace(paceOf(r))}/km</b></div>
            <div class="hist"><span class="grow">Durée</span><b>${fmtPace(r.sec)}</b></div>
            ${r.rpe != null ? `<div class="hist"><span class="grow">Effort ressenti</span><b>${r.rpe}/10</b></div>` : ""}
            <div class="hist"><span class="grow">Mobilité</span><b>${(r.mobility || []).length}/${RUN.mobility.length}</b></div>
            ${(r.mobility || []).map((id) => `<p class="muted small">✓ ${esc(mobText(id))}</p>`).join("")}
          </div>
        </details>`;
      }
      const s = e.s;
      return `<details class="card sess" ${n === 0 ? "open" : ""}>
        <summary><span>${prettyDate(s.date)}</span><span class="muted">${s.mode === "maison" ? "🏠 maison" : "🌳 parc"}</span><b class="${s.complete ? "ok" : ""}">${s.complete ? "✓ complète" : "partielle"}</b></summary>
        <div class="sess-body">${sessionLines(s)}
          <button class="ghost danger small" data-delsess="${e.i}">Supprimer cette séance</button></div>
      </details>`;
    })
    .join("");

  const nS = state.sessions.length, nR = state.runs.length;
  view.innerHTML =
    `<p class="muted small pad">${nS} séance${nS > 1 ? "s" : ""} · ${nR} sortie${nR > 1 ? "s" : ""} · touche une ligne pour voir le détail.</p>` + items;

  view.querySelectorAll("[data-delsess]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!confirm("Supprimer cette séance ? Les paliers ne sont pas recalculés (ajuste-les dans Progrès si besoin).")) return;
      state.sessions.splice(+b.dataset.delsess, 1);
      save();
      renderHistory();
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
    ${
      sorted.length > 1
        ? `<section class="card"><h3>Évolution <span class="muted small">· kg</span></h3>${lineChart(
            sorted.map((w) => ({ date: w.date, y: w.kg, seg: "w", tip: `${prettyDate(w.date)} · ${w.kg.toFixed(1)} kg` })),
            { integer: false }
          )}</section>`
        : ""
    }
    <section class="card">
      <h3>Nouvelle pesée</h3>
      <div class="row">
        <input type="text" inputmode="decimal" id="kg" placeholder="kg">
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
      <p class="muted small">🏋️ Calisthénie</p>
      <div class="seg">${[3, 4, 5].map((n) => `<button data-goal="${n}" class="${goal === n ? "on" : ""}">${n} séances</button>`).join("")}</div>
      <p class="muted small">🏃 Course + mobilité</p>
      <div class="seg">${[1, 2, 3].map((n) => `<button data-rungoal="${n}" class="${state.settings.runGoal === n ? "on" : ""}">${n} sortie${n > 1 ? "s" : ""}</button>`).join("")}</div>
    </section>
    <section class="card">
      <h3>Rappel</h3>
      <p class="muted small">Règle une alarme récurrente dans l'app Horloge d'Android (ex. lun · mer · ven) avec le nom « Calliboss ». Change l'heure quand ton emploi du temps change.</p>
    </section>
    <section class="card">
      <h3>Sauvegarde</h3>
      <p class="muted small">Tes données restent sur ce téléphone. Exporte-les de temps en temps.
        ${state.settings.lastExport ? `Dernier export : ${prettyDate(state.settings.lastExport)}.` : "Jamais exporté."}</p>
      <div class="row">
        <button class="ghost" data-export>Exporter</button>
        <label class="ghost file">Importer<input type="file" id="import" accept="application/json"></label>
      </div>
    </section>
    <section class="card">
      <h3>Programme</h3>
      <p class="muted small">${esc(PROGRAM.name)}${state.program ? " (perso)" : ""} · ${PROGRAM.exercises.map((e) => esc(e.name)).join(", ")}.</p>
      <button class="ghost" id="editprog">✏️ Créer / modifier mon programme</button>
      <button class="ghost danger" id="reset">Tout effacer</button>
    </section>`;

  $("#editprog").addEventListener("click", openProgramEditor);

  view.querySelectorAll("[data-goal]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.weeklyGoal = +b.dataset.goal;
      save();
      renderSettings();
    })
  );
  view.querySelectorAll("[data-rungoal]").forEach((b) =>
    b.addEventListener("click", () => {
      state.settings.runGoal = +b.dataset.rungoal;
      save();
      renderSettings();
    })
  );
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
    if (!confirm("Effacer TOUTES les données (séances, paliers, poids, programme perso) ?")) return;
    applyProgram(null);
    state = emptyState();
    save();
    toast("Données effacées");
    renderSettings();
  });
}

// ---------- Éditeur de programme ----------
// Copie de travail du programme : rien n'est appliqué avant « Enregistrer ».
// `_from` retient l'ancien rang de chaque palier pour recaler les niveaux et l'historique.
let progEdit = null;
function newStep() {
  return { name: "", min: 5, max: 10, unit: "reps", tip: "" };
}
function openProgramEditor() {
  progEdit = {};
  PROGRAM_KEYS.forEach((k) => (progEdit[k] = clone(PROGRAM[k])));
  progEdit.exercises.forEach((ex) => ex.ladder.forEach((st, i) => (st._from = i)));
  renderProgramEditor();
  window.scrollTo(0, 0);
}

function edField(path, value, { num = false, ph = "" } = {}) {
  return `<input type="${num ? "number" : "text"}" ${num ? `inputmode="numeric" min="1" data-num` : ""} data-p="${path}" value="${esc(value == null ? "" : value)}" placeholder="${esc(ph)}" autocomplete="off">`;
}
function edStepFields(path, st) {
  return `<div class="ed-grid">
    ${edField(`${path}.name`, st.name, { ph: "Nom du mouvement" })}
    <div class="ed-range">${edField(`${path}.min`, st.min, { num: true, ph: "min" })}<span>à</span>${edField(`${path}.max`, st.max, { num: true, ph: "max" })}
      <select data-p="${path}.unit"><option value="reps" ${st.unit === "s" ? "" : "selected"}>reps</option><option value="s" ${st.unit === "s" ? "selected" : ""}>secondes</option></select></div>
    ${edField(`${path}.tip`, st.tip, { ph: "Conseil (optionnel)" })}
  </div>`;
}
function edButtons(kind, i, j, count) {
  const at = `data-i="${i}"${j === null ? "" : ` data-j="${j}"`}`;
  const pos = j === null ? i : j;
  return `<div class="ed-btns">
    <button data-act="${kind}up" ${at} ${pos === 0 ? "disabled" : ""} aria-label="Monter">↑</button>
    <button data-act="${kind}down" ${at} ${pos === count - 1 ? "disabled" : ""} aria-label="Descendre">↓</button>
    <button data-act="rm${kind}" ${at} ${count === 1 ? "disabled" : ""} aria-label="Retirer">×</button>
  </div>`;
}
function edExercise(ex, i) {
  const steps = ex.ladder
    .map((st, j) => {
      const p = `exercises.${i}.ladder.${j}`;
      return `<div class="ed-step">
        <div class="ex-head"><b class="small">Palier ${j + 1}</b>${edButtons("step", i, j, ex.ladder.length)}</div>
        ${edStepFields(p, st)}
        ${
          st.home
            ? `<div class="extra"><div class="ex-head"><span class="tag">🏠 variante maison</span><button class="x" data-act="rmhome" data-i="${i}" data-j="${j}" aria-label="Retirer">×</button></div>${edStepFields(`${p}.home`, st.home)}</div>`
            : `<button class="ghost small-btn" data-act="addhome" data-i="${i}" data-j="${j}">+ variante maison</button>`
        }
      </div>`;
    })
    .join("");
  return `<section class="card ed">
    <div class="ex-head">${edField(`exercises.${i}.name`, ex.name, { ph: "Nom de l'exercice" })}${edButtons("ex", i, null, progEdit.exercises.length)}</div>
    ${steps}
    <button class="ghost" data-act="addstep" data-i="${i}">+ Ajouter un palier</button>
  </section>`;
}

function renderProgramEditor() {
  const view = $("#view");
  const p = progEdit;
  const text = (label, path, value) => `<label class="ed-label">${label}${edField(path, value)}</label>`;
  view.innerHTML = `
    <section class="card ed">
      <h3>✏️ Mon programme</h3>
      <p class="muted small">Change ce que tu veux, ou vide tout pour partir de zéro. Rien n'est appliqué avant « Enregistrer ».</p>
      ${text("Nom du programme", "name", p.name)}
      <p class="muted small">Tours du circuit</p>
      <div class="seg">${[1, 2, 3, 4, 5].map((n) => `<button data-rounds="${n}" class="${p.rounds === n ? "on" : ""}">${n}</button>`).join("")}</div>
      ${text("Repos entre les tours", "restBetweenRounds", p.restBetweenRounds)}
    </section>
    <section class="card ed">
      <h3>Échauffement et retour au calme</h3>
      ${text("Échauffement 🌳 parc", "warmup.parc", p.warmup.parc)}
      ${text("Échauffement 🏠 maison", "warmup.maison", p.warmup.maison)}
      ${text("Mobilité", "mobility", p.mobility)}
      ${text("Retour au calme 🌳 parc", "cooldown.parc", p.cooldown.parc)}
      ${text("Retour au calme 🏠 maison", "cooldown.maison", p.cooldown.maison)}
    </section>
    <p class="muted small pad">Exercices du circuit, dans l'ordre. Chaque exercice a un ou plusieurs paliers, du plus facile au plus dur : l'app propose le suivant quand tu fais le max partout, ${PROGRAM.advanceAfter} séances de suite.</p>
    ${p.exercises.map(edExercise).join("")}
    <button class="ghost wide" data-act="addex">+ Ajouter un exercice</button>
    <button class="primary" id="progsave">Enregistrer le programme</button>
    <div class="ed-actions">
      <button class="ghost" id="progcancel">Annuler</button>
      <button class="ghost" data-act="clear">Tout vider</button>
      ${state.program ? `<button class="ghost danger" id="progreset">Revenir au programme de base</button>` : ""}
    </div>`;

  view.querySelectorAll("[data-p]").forEach((inp) =>
    inp.addEventListener("input", () => {
      const keys = inp.dataset.p.split(".");
      const last = keys.pop();
      const v = inp.dataset.num !== undefined ? parseInt(inp.value, 10) || 0 : inp.value;
      keys.reduce((o, k) => o[k], p)[last] = v;
    })
  );
  view.querySelectorAll("[data-rounds]").forEach((b) =>
    b.addEventListener("click", () => {
      p.rounds = +b.dataset.rounds;
      renderProgramEditor();
    })
  );
  const swap = (a, i, j) => ([a[i], a[j]] = [a[j], a[i]]);
  const acts = {
    addex: () => p.exercises.push({ id: "x" + Date.now().toString(36), name: "", ladder: [newStep()] }),
    rmex: (i) => confirm("Retirer cet exercice du programme ? Son historique reste visible.") && p.exercises.splice(i, 1),
    exup: (i) => swap(p.exercises, i, i - 1),
    exdown: (i) => swap(p.exercises, i, i + 1),
    addstep: (i) => p.exercises[i].ladder.push(newStep()),
    rmstep: (i, j) => p.exercises[i].ladder.splice(j, 1),
    stepup: (i, j) => swap(p.exercises[i].ladder, j, j - 1),
    stepdown: (i, j) => swap(p.exercises[i].ladder, j, j + 1),
    addhome: (i, j) => (p.exercises[i].ladder[j].home = newStep()),
    rmhome: (i, j) => delete p.exercises[i].ladder[j].home,
    clear: () => {
      if (!confirm("Retirer tous les exercices pour partir de zéro ?")) return;
      p.name = "Mon programme";
      p.exercises = [{ id: "x" + Date.now().toString(36), name: "", ladder: [newStep()] }];
    },
  };
  view.querySelectorAll("[data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      acts[b.dataset.act](+b.dataset.i, +b.dataset.j);
      renderProgramEditor();
    })
  );
  $("#progsave").addEventListener("click", saveProgram);
  $("#progcancel").addEventListener("click", () => show("reglages"));
  if (state.program)
    $("#progreset").addEventListener("click", () => {
      if (!confirm("Revenir au programme de base ? Ton programme perso sera supprimé, l'historique reste.")) return;
      state.program = null;
      applyProgram(null);
      PROGRAM.exercises.forEach((ex) => (state.levels[ex.id] = Math.min(state.levels[ex.id] || 0, ex.ladder.length - 1)));
      state.transitions = {};
      state.proposals = [];
      state.draft = null;
      save();
      show("reglages");
      toast("Programme de base rétabli");
    });
}

// Première erreur de saisie du programme en cours d'édition, ou "" si tout est bon.
function programError(p) {
  if (!p.exercises.length) return "Ajoute au moins un exercice";
  for (let i = 0; i < p.exercises.length; i++) {
    const ex = p.exercises[i];
    if (!ex.name.trim()) return `Exercice ${i + 1} : donne-lui un nom`;
    for (let j = 0; j < ex.ladder.length; j++) {
      const st = ex.ladder[j];
      for (const [s, where] of [[st, ""], [st.home, " (variante maison)"]]) {
        if (!s) continue;
        const at = `${ex.name.trim()}, palier ${j + 1}${where}`;
        if (!s.name.trim()) return `${at} : nom du mouvement manquant`;
        if (!(s.min >= 1)) return `${at} : le minimum doit être au moins 1`;
        if (!(s.max >= s.min)) return `${at} : le maximum doit être ≥ au minimum`;
      }
    }
  }
  return "";
}

function saveProgram() {
  const p = progEdit;
  const err = programError(p);
  if (err) return toast(err);
  p.name = p.name.trim() || "Mon programme";

  // Ancien rang -> nouveau rang de chaque palier (−1 : palier retiré).
  const maps = {};
  p.exercises.forEach((ex) => {
    ex.name = ex.name.trim();
    const m = (maps[ex.id] = {});
    ex.ladder.forEach((st, j) => {
      if (st._from !== undefined) m[st._from] = j;
      delete st._from;
    });
  });
  const mapped = (id, lvl) => (maps[id][lvl] !== undefined ? maps[id][lvl] : -1);

  state.sessions.forEach((s) =>
    Object.keys(s.results).forEach((id) => {
      if (!maps[id]) return;
      const r = s.results[id];
      [r, ...(r.extras || [])].forEach((e) => (e.level = mapped(id, e.level)));
    })
  );
  p.exercises.forEach((ex) => {
    const old = state.levels[ex.id];
    const m = typeof old === "number" ? mapped(ex.id, old) : 0;
    const lvl = m >= 0 ? m : Math.min(old, ex.ladder.length - 1);
    if (state.transitions[ex.id] && mapped(ex.id, old + 1) !== lvl + 1) delete state.transitions[ex.id];
    state.levels[ex.id] = lvl;
  });
  Object.keys(state.transitions).forEach((id) => maps[id] || delete state.transitions[id]);
  state.levelLog = state.levelLog
    .map((l) => (maps[l.exId] ? { ...l, level: mapped(l.exId, l.level) } : l))
    .filter((l) => l.level >= 0);
  if (state.draft && state.draft.extras)
    Object.keys(state.draft.extras).forEach((id) => {
      if (!maps[id]) return;
      state.draft.extras[id] = state.draft.extras[id].map((x) => ({ ...x, level: mapped(id, x.level) })).filter((x) => x.level >= 0);
    });

  state.program = clone(p);
  applyProgram(state.program);
  state.proposals = state.proposals.filter((id) => {
    const ex = PROGRAM.exercises.find((e) => e.id === id);
    return ex && nextStep(ex);
  });
  save();
  show("reglages");
  toast("Programme enregistré 💪");
}

// ---------- Sauvegarde ----------
const EXPORT_EVERY = 30; // jours
function exportData() {
  state.settings.lastExport = today();
  save();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `calliboss-${today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
// Rappel d'export dès qu'il y a quelque chose à perdre et que le dernier date d'un mois.
function exportBanner() {
  if (state.sessions.length + state.runs.length < 3) return "";
  const last = state.settings.lastExport;
  const days = last ? dayNum(today()) - dayNum(last) : null;
  if (days !== null && days < EXPORT_EVERY) return "";
  return `<section class="card banner export">
    <span class="small">💾 ${last ? `Dernier export il y a ${days} jours.` : "Tes séances ne sont sauvegardées que sur ce téléphone."}</span>
    <button class="ghost" data-export>Exporter</button></section>`;
}
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("[data-export]")) return;
  exportData();
  toast("Fichier exporté : garde-le hors du téléphone (Drive, mail…)");
  TABS[tab]();
});

// ---------- Groupe ----------
// Les données restent sur le téléphone. Ce résumé (semaine, dernières séances et sorties,
// poids si partagé) est la seule chose envoyée, et seulement aux groupes rejoints.
const SHARE_LAST = 20;
function sharePayload() {
  return JSON.stringify({
    goals: { cali: state.settings.weeklyGoal, run: state.settings.runGoal },
    streak: weeksStreak(),
    program: PROGRAM.name,
    sessions: state.sessions.slice(-SHARE_LAST).map((s) => ({ date: s.date, mode: s.mode, complete: !!s.complete, lines: sessionEntries(s) })),
    runs: state.runs.slice(-SHARE_LAST).map((r) => ({ date: r.date, km: r.km, sec: r.sec })),
    weights: state.settings.shareWeight
      ? [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-SHARE_LAST)
      : null,
  });
}
// Appelé à chaque enregistrement ; Cloud.publish n'envoie que si le résumé a changé.
// Hors ligne l'envoi échoue en silence et repart au prochain enregistrement ou retour dans l'app.
let publishTimer = null;
function schedulePublish() {
  if (typeof Cloud === "undefined" || !Cloud.account || !Cloud.account.groups.length) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => Cloud.publish(sharePayload()).catch(() => {}), 1500);
}

const groupView = { code: null, members: null, error: "", busy: false };
// Lance une action réseau ; l'écran n'est redessiné qu'en cas de succès pour ne pas perdre la saisie.
async function cloudDo(fn, okMsg) {
  if (groupView.busy) return;
  groupView.busy = true;
  toast("Un instant…");
  let ok = false;
  try {
    ok = (await fn()) !== null;
    if (ok) toast(okMsg);
  } catch (e) {
    toast(Cloud.message(e));
  }
  groupView.busy = false;
  if (ok && tab === "groupe") renderGroup();
}
async function loadMembers() {
  const code = groupView.code;
  let members = null, error = "";
  try {
    members = await Cloud.members(code);
  } catch (e) {
    error = Cloud.message(e);
  }
  if (groupView.code !== code) return;
  if (members) groupView.members = members;
  groupView.error = error;
  if (tab === "groupe") renderGroup(false);
}

function memberCard(m) {
  const d = m.data;
  const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x.date === "string") : []);
  const sessions = list(d.sessions), runs = list(d.runs), weights = list(d.weights);
  const goals = d.goals || {};
  const week = weekHtml(new Set(sessions.map((s) => s.date)), new Set(runs.map((r) => r.date)), +goals.cali || 0, +goals.run || 0, +d.streak || 0);
  const me = m.uid === Cloud.account.uid;

  const sess = sessions
    .slice(-5)
    .reverse()
    .map(
      (s) => `<p class="small member-date"><b>${esc(prettyDate(s.date))}</b> <span class="muted">· ${s.mode === "maison" ? "🏠 maison" : "🌳 parc"} · ${s.complete ? "complète" : "partielle"}</span></p>
        ${entryLines(Array.isArray(s.lines) ? s.lines : [])}`
    )
    .join("");
  const runLines = runs
    .slice(-5)
    .reverse()
    .map((r) => {
      const km = +r.km || 0, sec = +r.sec || 0;
      return `<div class="hist"><span>${esc(prettyDate(r.date))}</span><span class="grow"><b>${fmtKm(km)} km</b>${km > 0 && sec > 0 ? ` · ${fmtPace(sec / km)}/km` : ""}</span></div>`;
    })
    .join("");
  let weight = "";
  if (weights.length) {
    const first = +weights[0].kg || 0, last = +weights[weights.length - 1].kg || 0;
    const delta = last - first;
    weight = `<div class="hist"><span class="grow">⚖️ Poids</span><b>${last.toFixed(1)} kg${
      weights.length > 1 ? ` <small class="muted">${delta > 0 ? "+" : ""}${delta.toFixed(1)} depuis le ${esc(prettyDate(weights[0].date))}</small>` : ""
    }</b></div>`;
  }

  return `<section class="card">
    <p class="member-name"><b>${esc(m.pseudo)}</b>${me ? ` <span class="tag">toi</span>` : ""}
      <span class="muted small">${d.program ? `· ${esc(d.program)} ` : ""}${m.updated ? `· à jour le ${esc(prettyDate(ymd(new Date(m.updated))))}` : ""}</span></p>
    ${week.html}
    ${weight}
    <details class="sess member-more"><summary><span>Séances et sorties</span></summary>
      <div class="sess-body">
        ${sess || `<p class="muted small">Pas encore de séance.</p>`}
        ${runLines ? `<p class="small member-date"><b>🏃 Sorties</b></p>${runLines}` : ""}
      </div>
    </details>
  </section>`;
}

function renderGroup(fetch = true) {
  const view = $("#view");
  if (!Cloud.enabled) {
    view.innerHTML = `<section class="card"><h3>👥 Groupe</h3>
      <p class="muted small">Les groupes ne sont pas encore activés sur cette version de l'app (voir « Activer les groupes » dans le README).</p></section>`;
    return;
  }
  const acc = Cloud.account;
  if (!acc) {
    view.innerHTML = `<section class="card ed">
      <h3>👥 Rejoins tes potes</h3>
      <p class="muted small">Un pseudo et un code à 4 chiffres, c'est tout. Pas de mail. Nouveau pseudo : le compte est créé. Pseudo existant : tu te reconnectes avec ton code.</p>
      <label class="ed-label">Pseudo<input type="text" id="lpseudo" maxlength="20" autocomplete="username" autocapitalize="off" spellcheck="false"></label>
      <label class="ed-label">Code à 4 chiffres<input type="text" id="lpin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••"></label>
      <button class="primary" id="login">Entrer</button>
      <p class="muted small">Tes données restent sur ton téléphone. Une fois dans un groupe, ses membres voient ta semaine, le détail de tes dernières séances et sorties, et ton poids (désactivable). Retiens ton code : sans mail, il ne peut pas être récupéré.</p>
    </section>`;
    $("#login").addEventListener("click", () =>
      cloudDo(async () => {
        const a = await Cloud.login($("#lpseudo").value, $("#lpin").value.trim(), (name) =>
          confirm(`Pas de compte « ${name} » avec ce code.\n\nCréer ce pseudo avec ce code ?`)
        );
        if (a) schedulePublish();
        return a;
      }, "Connecté 👋")
    );
    return;
  }

  if (!acc.groups.some((g) => g.code === groupView.code)) {
    groupView.code = acc.groups.length ? acc.groups[0].code : null;
    groupView.members = null;
    groupView.error = "";
  }
  const group = acc.groups.find((g) => g.code === groupView.code);
  // Saisie en cours à conserver quand la liste des membres arrive
  const typed = ["#gcode", "#gname"].map((s) => ($(s) ? $(s).value : ""));

  const week = (m) => {
    const d = new Set((Array.isArray(m.data.sessions) ? m.data.sessions : []).map((s) => s && s.date));
    const monday = mondayOf(today());
    return [0, 1, 2, 3, 4, 5, 6].filter((i) => d.has(addDays(monday, i))).length;
  };
  const members = groupView.members
    ? [...groupView.members].sort((a, b) => (b.uid === acc.uid) - (a.uid === acc.uid) || week(b) - week(a) || a.pseudo.localeCompare(b.pseudo))
    : null;

  view.innerHTML =
    `<section class="card">
      <div class="ex-head"><b>👤 ${esc(acc.pseudo)}</b><button class="ghost" id="logout">Se déconnecter</button></div>
      <label class="check plain ${state.settings.shareWeight ? "on" : ""}"><input type="checkbox" id="sharew" ${state.settings.shareWeight ? "checked" : ""}>
        <span class="box"></span><span>Partager mon poids avec mes groupes</span></label>
    </section>` +
    (acc.groups.length > 1
      ? `<div class="seg kinds">${acc.groups.map((g) => `<button data-group="${esc(g.code)}" class="${g.code === groupView.code ? "on" : ""}">${esc(g.name)}</button>`).join("")}</div>`
      : "") +
    (group
      ? `<section class="card">
          <h3>👥 ${esc(group.name)}</h3>
          <p class="small">Code du groupe : <b class="code">${esc(group.code)}</b> <span class="muted">· à donner à tes potes</span></p>
          <div class="choices">
            <button class="primary small" id="ginvite">Inviter</button>
            <button class="ghost" id="grefresh">Actualiser</button>
            <button class="ghost danger" id="gleave">Quitter</button>
          </div>
        </section>` +
        (groupView.error ? `<section class="card"><p class="warn">⚠️ ${esc(groupView.error)}</p></section>` : "") +
        (members ? members.map(memberCard).join("") : groupView.error ? "" : `<p class="muted small pad">Chargement des membres…</p>`)
      : "") +
    `<section class="card ed">
      <h3>${acc.groups.length ? "Un autre groupe" : "Ton premier groupe"}</h3>
      <p class="muted small">Rejoins avec le code d'un pote, ou crée un groupe et donne-lui le code.</p>
      <div class="row"><input type="text" id="gcode" maxlength="6" placeholder="Code du groupe" autocapitalize="characters" autocomplete="off" spellcheck="false"><button class="primary small" id="gjoin">Rejoindre</button></div>
      <div class="row"><input type="text" id="gname" maxlength="40" placeholder="Nom d'un nouveau groupe" autocomplete="off"><button class="primary small" id="gcreate">Créer</button></div>
    </section>`;

  $("#gcode").value = typed[0];
  $("#gname").value = typed[1];

  $("#logout").addEventListener("click", () => {
    if (!confirm("Te déconnecter ? Tes séances restent sur ce téléphone et tu restes membre de tes groupes.")) return;
    cloudDo(() => Cloud.logout(), "Déconnecté");
  });
  $("#sharew").addEventListener("change", (e) => {
    state.settings.shareWeight = e.target.checked;
    save();
    e.target.closest(".check").classList.toggle("on", e.target.checked);
  });
  view.querySelectorAll("[data-group]").forEach((b) =>
    b.addEventListener("click", () => {
      groupView.code = b.dataset.group;
      groupView.members = null;
      groupView.error = "";
      renderGroup();
    })
  );
  const joined = (g) => {
    groupView.code = g.code;
    groupView.members = null;
    $("#gcode").value = $("#gname").value = "";
  };
  $("#gjoin").addEventListener("click", () => cloudDo(async () => joined(await Cloud.joinGroup($("#gcode").value, sharePayload())), "Groupe rejoint 🎉"));
  $("#gcreate").addEventListener("click", () => cloudDo(async () => joined(await Cloud.createGroup($("#gname").value, sharePayload())), "Groupe créé 🎉"));
  if (!group) return;

  $("#ginvite").addEventListener("click", async () => {
    const text = `Rejoins mon groupe « ${group.name} » sur Calliboss : ${location.origin}${location.pathname} → onglet Groupe, code ${group.code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Invitation copiée");
      }
    } catch (e) {}
  });
  $("#grefresh").addEventListener("click", () => {
    schedulePublish();
    loadMembers();
  });
  $("#gleave").addEventListener("click", () => {
    if (!confirm(`Quitter « ${group.name} » ? Les autres ne verront plus tes séances.`)) return;
    cloudDo(() => Cloud.leaveGroup(group.code), "Groupe quitté");
  });
  if (fetch) loadMembers();
}

// ---------- Navigation ----------
const TABS = { seance: renderSession, progres: renderProgress, historique: renderHistory, groupe: renderGroup, poids: renderWeight, reglages: renderSettings };
let tab = "seance";
function show(name) {
  tab = name;
  progEdit = null;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  TABS[name]();
  window.scrollTo(0, 0);
}
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));

// Recharge la vue si l'app reste ouverte après minuit. Pas l'éditeur ni l'onglet Groupe :
// on y revient souvent d'une autre app (copier un code) avec une saisie en cours.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  schedulePublish();
  if (!progEdit && tab !== "groupe") TABS[tab]();
});

// Session du compte : vérifiée en arrière-plan, sans bloquer l'app ni exiger de réseau.
if (Cloud.enabled && Cloud.account)
  Cloud.sync()
    .then(() => {
      schedulePublish();
      if (tab === "groupe") renderGroup();
    })
    .catch(() => {});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  // Nouvelle version installée pendant que l'app est ouverte : on recharge pour ne pas
  // mélanger ancien et nouveau code. La séance en cours est déjà enregistrée à chaque saisie.
  if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

show("seance");
