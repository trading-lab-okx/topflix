"use strict";

const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const state = { feed: null, onlyMine: false, q: "", media: "all" };

// preferencias recordadas
try { state.onlyMine = localStorage.getItem("topflix_onlyMine") === "1"; } catch (_) {}
try {
  const m = localStorage.getItem("topflix_media");
  if (m === "movie" || m === "tv" || m === "all") state.media = m;
} catch (_) {}
$("#onlyMine").checked = state.onlyMine;
setSeg(state.media);

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
$(".x", modal).addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

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
}
function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = "";
  document.body.style.overflow = "";
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
