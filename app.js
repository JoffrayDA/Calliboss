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

// Palier d'un exercice, variante maison si demandée et disponible.
// Le niveau est borné pour survivre à une échelle raccourcie dans program.js.
function stepFor(ex, level, home) {
  const step = ex.ladder[Math.min(level, ex.ladder.length - 1)];
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
      return `<div class="extra">
        <div class="ex-head"><div>${stepHead(st, "+ ")}</div>
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
  const view = $("#view");
  const t = today();
  const doneToday = state.sessions.find((s) => s.date === t);

  if (doneToday) {
    const trainedYesterday = state.sessions.some((s) => s.date === addDays(t, -1));
    view.innerHTML =
      renderWeek() +
      `<section class="card center">
        <div class="huge">✅</div>
        <h2>Séance validée</h2>
        <p class="muted">Bien joué. Récupère, mange bien, dors.${trainedYesterday ? " Deux jours d'affilée : demain, repos." : ""}</p>
      </section>`;
    return;
  }

  const d = getDraft();
  const trainedDayBefore = state.sessions.some((s) => s.date === addDays(d.date, -1));
  view.innerHTML =
    renderWeek() +
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
      <h3>2. Circuit · ${PROGRAM.rounds} tours</h3>
      <p class="muted small">Enchaîne les exos dans l'ordre, puis recommence. ${esc(PROGRAM.restBetweenRounds)}. Note ce que tu fais à chaque tour (T1, T2, T3).</p>
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
    const extras = (d.extras[ex.id] || [])
      .map((x) => ({ level: x.level, home: x.home, sets: dense(x.sets) }))
      .filter((x) => countFilled(x.sets) > 0);
    results[ex.id] = { level: lvl, home: stepFor(ex, lvl, d.mode === "maison").isHome, sets: dense(d.sets[ex.id]), extras };
  });
  const bonus = d.bonus.map((b) => ({ name: b.name, unit: b.unit, sets: dense(b.sets) })).filter((b) => countFilled(b.sets) > 0);
  state.sessions.push({ date: d.date, mode: d.mode, complete, results, bonus });
  state.sessions.sort((a, b) => a.date.localeCompare(b.date));
  state.draft = null;

  const ups = checkLevelUps();
  save();
  renderSession();
  if (ups.length) toast("🎉 Palier suivant : " + ups.join(", "));
  else toast("Séance validée 💪");
}

// Monte d'un palier si toutes les séries ont atteint `max` sur les N dernières séances à ce palier.
// Seul le palier principal compte (pas les paliers en plus ni la variante maison).
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
    if (recent.every((s) => dense(s.results[ex.id].sets).every((v) => v >= max))) {
      state.levels[ex.id] = lvl + 1;
      ups.push(ex.ladder[lvl + 1].name);
    }
  });
  return ups;
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
        .map(({ date, e }) => `<div class="hist"><span>${prettyDate(date)}</span><span class="muted">${esc(stepFor(ex, e.level, e.home).name)}</span><b>${dense(e.sets).join(" · ")}</b></div>`)
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

  view.innerHTML =
    `<p class="muted small pad">Monte d'un palier automatiquement quand tu fais le max sur les ${PROGRAM.rounds} tours, ${PROGRAM.advanceAfter} séances de suite. Les boutons − / + ajustent à la main.</p>` +
    cards;

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

// ---------- Rendu : Historique ----------
function renderHistory() {
  const view = $("#view");
  if (!state.sessions.length) {
    view.innerHTML = `<section class="card"><p class="muted small">Rien pour l'instant. La première, c'est la plus dure.</p></section>`;
    return;
  }
  const line = (name, sets, unit, tag) =>
    `<div class="hist"><span class="grow">${esc(name)}${tag ? ` <span class="tag">${tag}</span>` : ""}</span><b>${dense(sets).join(" · ")} <small class="muted">${unitLabel(unit)}</small></b></div>`;

  const items = state.sessions
    .map((s, i) => ({ s, i }))
    .reverse()
    .map(({ s, i }, n) => {
      const lines = PROGRAM.exercises.flatMap((ex) => {
        const r = s.results[ex.id];
        if (!r) return [];
        return [r, ...(r.extras || [])]
          .filter((e) => countFilled(e.sets) > 0)
          .map((e) => {
            const st = stepFor(ex, e.level, e.home);
            return line(st.name, e.sets, st.unit, e.home ? "maison" : "");
          });
      });
      (s.bonus || []).forEach((b) => lines.push(line(b.name, b.sets, b.unit, "bonus")));
      return `<details class="card sess" ${n === 0 ? "open" : ""}>
        <summary><span>${prettyDate(s.date)}</span><span class="muted">${s.mode === "maison" ? "🏠 maison" : "🌳 parc"}</span><b class="${s.complete ? "ok" : ""}">${s.complete ? "✓ complète" : "partielle"}</b></summary>
        <div class="sess-body">${lines.join("") || `<p class="muted small">Aucune série notée.</p>`}
          <button class="ghost danger small" data-delsess="${i}">Supprimer cette séance</button></div>
      </details>`;
    })
    .join("");

  view.innerHTML = `<p class="muted small pad">${state.sessions.length} séance${state.sessions.length > 1 ? "s" : ""} · touche une séance pour voir le détail.</p>` + items;

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
const TABS = { seance: renderSession, progres: renderProgress, historique: renderHistory, poids: renderWeight, reglages: renderSettings };
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
