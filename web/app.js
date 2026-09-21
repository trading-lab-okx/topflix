"use strict";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const state = { feed: null, onlyMine: false, q: "", media: "all", view: "watch", agenda: null };

// preferencias recordadas
try { state.onlyMine = localStorage.getItem("topflix_onlyMine") === "1"; } catch (_) {}
try {
  const m = localStorage.getItem("topflix_media");
  if (m === "movie" || m === "tv" || m === "all") state.media = m;
} catch (_) {}
$("#onlyMine").checked = state.onlyMine;
setSeg(state.media);

// PWA: registra el service worker (necesario para que el navegador
// ofrezca "instalar" el sitio como app)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

fetch("data/feed.json", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(feed => { state.feed = feed; render(); })
  .catch(err => {
    app.innerHTML = `<p class="loading">Todavía no hay datos (${err.message}).<br>
      Se generan solos cuando corre la tarea de GitHub Actions.</p>`;
  });

$("#q").addEventListener("input", e => { state.q = e.target.value.trim().toLowerCase(); render(); });
$("#onlyMine").addEventListener("change", e => {
  state.onlyMine = e.target.checked;
  try { localStorage.setItem("topflix_onlyMine", state.onlyMine ? "1" : "0"); } catch (_) {}
  render();
});

$("#mediaSeg").addEventListener("click", e => {
  const b = e.target.closest("button[data-m]");
  if (!b) return;
  state.media = b.dataset.m;
  try { localStorage.setItem("topflix_media", state.media); } catch (_) {}
  setSeg(state.media);
  render();
});
function setSeg(m) {
  document.querySelectorAll("#mediaSeg button").forEach(b =>
    b.classList.toggle("on", b.dataset.m === m));
}

// una seccion puede ser solo de peliculas o solo de series
function sectionVisible(sec) {
  if (state.media === "all") return true;
  if (!sec.media || sec.media === "all") return true;
  return sec.media === state.media;
}

function matches(it) {
  if (state.media !== "all" && it.media_type !== state.media) return false;
  if (state.onlyMine && !(it.providers && it.providers.on_mine)) return false;
  if (state.q) {
    const hay = (it.title + " " + it.original_title + " " + (it.genres || []).join(" ")).toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function render() {
  const feed = state.feed;
  if (!feed) return;

  const stamp = new Date(feed.generated_at);
  $("#meta").textContent =
    `Región ${feed.region} · ${feed.mis_plataformas.length} plataformas tuyas · ` +
    `actualizado ${stamp.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`;
  $("#stamp").textContent = feed.plataformas_sin_coincidencia.length
    ? "Sin emparejar: " + feed.plataformas_sin_coincidencia.join(", ")
    : "";

  app.innerHTML = "";
  let shown = 0;
  for (const sec of feed.sections) {
    if (!sectionVisible(sec)) continue;
    const items = sec.items.filter(matches);
    if (!items.length) continue;
    shown += items.length;
    const row = document.createElement("section");
    row.className = "row";
    row.innerHTML = `<h2>${esc(sec.title)}</h2><p class="sub">${esc(sec.subtitle || "")}</p>`;
    const strip = document.createElement("div");
    strip.className = "strip";
    const step = 20;
    const first = sec.paged ? Math.min(step, items.length) : items.length;
    for (let i = 0; i < first; i++) strip.appendChild(cardEl(items[i]));
    if (sec.paged && first < items.length) lazyStrip(strip, items, first, step);
    row.appendChild(strip);
    app.appendChild(row);
  }
  if (!shown) {
    app.innerHTML = `<p class="loading">Nada que mostrar con el filtro actual.</p>`;
  }
}

// revela mas tarjetas al acercarse al final del scroll lateral
function lazyStrip(strip, items, shownCount, step) {
  let shown = shownCount;
  const onScroll = () => {
    if (strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 500) return;
    const next = Math.min(shown + step, items.length);
    for (let i = shown; i < next; i++) strip.appendChild(cardEl(items[i]));
    shown = next;
    if (shown >= items.length) strip.removeEventListener("scroll", onScroll);
  };
  strip.addEventListener("scroll", onScroll, { passive: true });
}

function cardEl(it) {
  const c = document.createElement("article");
  c.className = "card";
  const pw = it.poster
    ? `<img loading="lazy" src="${it.poster}" alt="">`
    : `<div class="noimg">${esc(it.title)}</div>`;
  const rating = it.vote_average
    ? `<span class="badge">★ ${it.vote_average.toFixed(1)}</span>` : "";
  const mine = it.providers && it.providers.on_mine ? `<span class="mine-dot" title="En una plataforma tuya"></span>` : "";
  c.innerHTML = `
    <div class="pw">${pw}${rating}${mine}</div>
    <div class="info">
      <div class="t">${esc(it.title)}</div>
      <div class="yr">${it.media_type === "tv" ? "Serie" : "Película"}${it.year ? " · " + it.year : ""}</div>
    </div>`;
  c.addEventListener("click", () => openModal(it));
  return c;
}

/* ---------- modal ---------- */
const modal = $("#modal");
const modalBody = $("#modalBody");
let modalHist = false;   // ¿metimos una entrada de historial al abrir?
$(".x", modal).addEventListener("click", () => closeModal());
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
// boton "atras" del telefono: cierra el modal en vez de salir del sitio
window.addEventListener("popstate", () => { if (!modal.hidden) closeModal(true); });

function openModal(it) {
  const hero = it.trailer
    ? `<iframe src="${it.trailer.embed}" title="Tráiler" allow="autoplay; encrypted-media" allowfullscreen></iframe>`
    : (it.backdrop || it.poster ? `<img src="${it.backdrop || it.poster}" alt="">` : "");

  const pblock = provHtml(it.providers);
  const rt = it.runtime ? ` · ${it.runtime} min` : "";
  modalBody.innerHTML = `
    <div class="m-hero">${hero}</div>
    <div class="m-body">
      <h3>${esc(it.title)}</h3>
      <div class="m-sub">
        ${it.media_type === "tv" ? "Serie" : "Película"}${it.year ? " · " + it.year : ""}${rt}
        ${it.vote_average ? ` · <span class="star">★ ${it.vote_average.toFixed(1)}</span> (${it.vote_count})` : ""}
      </div>
      ${it.genres && it.genres.length ? `<div class="chips">${it.genres.map(g => `<span class="chip">${esc(g)}</span>`).join("")}</div>` : ""}
      <p class="ov">${esc(it.overview || "Sin sinopsis disponible.")}</p>
      ${pblock}
      <div class="m-links">
        ${it.trailer ? `<a href="${it.trailer.youtube}" target="_blank" rel="noopener">Ver tráiler en YouTube</a>` : ""}
        <a class="ghost" href="${it.tmdb_url}" target="_blank" rel="noopener">Ficha en TMDB</a>
      </div>
    </div>`;
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  if (!modalHist) {
    try { history.pushState({ modal: true }, ""); modalHist = true; } catch (_) {}
  }
}
function closeModal(fromBack) {
  modal.hidden = true;
  modalBody.innerHTML = "";   // detiene el video del iframe
  document.body.style.overflow = "";
  if (modalHist) {
    modalHist = false;
    if (!fromBack) { try { history.back(); } catch (_) {} }
  }
}

function provHtml(p) {
  if (!p) return "";
  const group = (label, arr) => {
    if (!arr || !arr.length) return "";
    const items = arr.map(x =>
      `<span class="p${x.mine ? " mine" : ""}">${x.logo ? `<img src="${x.logo}" alt="">` : ""}${esc(x.name)}</span>`
    ).join("");
    return `<h4>${label}</h4><div class="list">${items}</div>`;
  };
  const body = group("Incluido en suscripción", p.flatrate) + group("Alquiler", p.rent) + group("Compra", p.buy);
  if (!body) return `<div class="prov"><h4>Disponibilidad</h4><p class="ov">Sin datos de plataformas para tu región.</p></div>`;
  return `<div class="prov">${body}</div>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ================= Deportes ================= */
const sportsApp = $("#sportsApp");
const watchTools = $("#watchTools");

try {
  const v = localStorage.getItem("topflix_view");
  if (v === "sports" || v === "watch") state.view = v;
} catch (_) {}

$("#viewSeg").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]");
  if (!b) return;
  state.view = b.dataset.v;
  try { localStorage.setItem("topflix_view", state.view); } catch (_) {}
  applyView(state.view);
});

function applyView(v) {
  document.querySelectorAll("#viewSeg button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  const isSports = v === "sports";
  sportsApp.hidden = !isSports;
  app.hidden = isSports;
  watchTools.hidden = isSports;
  if (isSports) renderSports(); else render();
}
applyView(state.view);

fetch("data/agenda.json", { cache: "no-store" })
  .then(r => r.ok ? r.json() : null)
  .then(agenda => {
    state.agenda = agenda;
    if (state.view === "sports") renderSports();
  })
  .catch(() => { state.agenda = null; if (state.view === "sports") renderSports(); });

// evita el clasico corrimiento de un dia: "2026-09-21" se interpreta como
// fecha local, no como UTC medianoche
function localDateFromISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function sportsMetaText(agenda) {
  if (!agenda || !agenda.generated_at) return "Hora de Ciudad de México (UTC-6 fijo)";
  const stamp = new Date(agenda.generated_at);
  return `Hora de Ciudad de México (UTC-6 fijo) · actualizado ` +
    stamp.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function renderSports() {
  const agenda = state.agenda;
  $("#meta").textContent = sportsMetaText(agenda);

  if (!agenda) {
    sportsApp.innerHTML = `<p class="loading">Todavía no hay agenda deportiva.<br>
      Se genera sola cuando corre la tarea de GitHub Actions.</p>`;
    return;
  }
  if (agenda.error === "sin_configurar") {
    sportsApp.innerHTML = `<p class="loading">Falta configurar la llave de API-Sports
      (secret <code>API_SPORTS_KEY</code>) para activar la agenda deportiva.</p>`;
    return;
  }
  if (agenda.error) {
    sportsApp.innerHTML = `<p class="loading">No se pudo armar la agenda ahora mismo (${esc(agenda.error)}).</p>`;
    return;
  }
  if (!agenda.days || !agenda.days.length) {
    sportsApp.innerHTML = `<p class="loading">No hay datos disponibles ahora mismo.</p>`;
    return;
  }

  sportsApp.innerHTML = "";
  for (const day of agenda.days) {
    const sec = document.createElement("section");
    sec.className = "day";
    const d = localDateFromISO(day.date);
    const fecha = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    sec.innerHTML = `<h2>${esc(day.label)} · ${esc(fecha)}</h2>`;

    if (!day.events.length) {
      sec.innerHTML += `<p class="sub">Sin partidos relevantes.</p>`;
      sportsApp.appendChild(sec);
      continue;
    }

    let curLeague = null, group = null;
    for (const ev of day.events) {
      const lk = ev.league + "|" + (ev.league_country || "");
      if (lk !== curLeague) {
        curLeague = lk;
        group = document.createElement("div");
        group.className = "league-group";
        const flag = ev.league_logo ? `<img class="lg" src="${ev.league_logo}" alt="">` : "";
        const country = ev.league_country ? `<span class="lc">${esc(ev.league_country)}</span>` : "";
        group.innerHTML = `<div class="league-head">${flag}<span>${esc(ev.league)}</span>${country}</div>`;
        sec.appendChild(group);
      }
      group.appendChild(matchEl(ev));
    }
    sportsApp.appendChild(sec);
  }
}

function matchEl(ev) {
  const row = document.createElement("div");
  row.className = "match";
  const hasScore = ev.home_score != null && ev.away_score != null &&
    (ev.status === "en_vivo" || ev.status === "finalizado");
  let mid;
  if (ev.status === "en_vivo") {
    mid = `<span class="status live">● EN VIVO</span>` +
      (hasScore ? `<span class="score">${ev.home_score} - ${ev.away_score}</span>` : "");
  } else if (ev.status === "finalizado") {
    mid = `<span class="status ft">Final</span>` +
      (hasScore ? `<span class="score">${ev.home_score} - ${ev.away_score}</span>` : "");
  } else if (ev.status === "suspendido") {
    mid = `<span class="status susp">Aplazado</span>`;
  } else {
    mid = `<span class="time">${esc(ev.time_local)}</span>`;
  }
  const team = (name, logo, side) => `
    <div class="team ${side}">
      ${logo ? `<img src="${logo}" alt="">` : ""}
      <span>${esc(name || "?")}</span>
    </div>`;
  row.innerHTML = `${team(ev.home, ev.home_logo, "home")}<div class="mid">${mid}</div>${team(ev.away, ev.away_logo, "away")}`;
  return row;
}
