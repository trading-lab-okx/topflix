/*
 * topflix — agenda deportiva del día (solo informativa, uso personal).
 *
 * La página consulta directo, desde el navegador, fuentes públicas que NO
 * piden registro ni llave (por eso no caduca):
 *   - ESPN (marcadores públicos): fútbol, NFL y NBA
 *   - TheSportsDB (llave pública gratuita "123"): box
 *
 * Para agregar o quitar ligas, edita la lista LIGAS de abajo.
 * Se usa en dos lugares:
 *   - pestaña "⚽ Deportes" de topflix (index.html)
 *   - página sola deportes.html (enlace fijo para la app Play)
 */
(function () {
  "use strict";

  const TZ = "America/Mexico_City";
  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/";
  const SPORTSDB = "https://www.thesportsdb.com/api/v1/json/123/";

  // Orden en que se muestran. "id" es el código de ESPN de cada liga.
  const LIGAS = [
    // fútbol
    { dep: "futbol", id: "soccer/mex.1", nombre: "Liga MX" },
    { dep: "futbol", id: "soccer/concacaf.champions", nombre: "Concacaf Champions Cup" },
    { dep: "futbol", id: "soccer/uefa.champions", nombre: "Champions League" },
    { dep: "futbol", id: "soccer/uefa.europa", nombre: "Europa League" },
    { dep: "futbol", id: "soccer/eng.1", nombre: "Premier League" },
    { dep: "futbol", id: "soccer/esp.1", nombre: "LaLiga" },
    { dep: "futbol", id: "soccer/ita.1", nombre: "Serie A" },
    { dep: "futbol", id: "soccer/ger.1", nombre: "Bundesliga" },
    { dep: "futbol", id: "soccer/fra.1", nombre: "Ligue 1" },
    { dep: "futbol", id: "soccer/usa.1", nombre: "MLS" },
    { dep: "futbol", id: "soccer/fifa.world", nombre: "Mundial" },
    { dep: "futbol", id: "soccer/fifa.worldq.concacaf", nombre: "Eliminatorias Concacaf" },
    { dep: "futbol", id: "soccer/concacaf.nations.league", nombre: "Liga de Naciones Concacaf" },
    { dep: "futbol", id: "soccer/concacaf.gold", nombre: "Copa Oro" },
    { dep: "futbol", id: "soccer/fifa.friendly", nombre: "Amistosos de selecciones" },
    // americanos
    { dep: "nfl", id: "football/nfl", nombre: "NFL" },
    { dep: "nba", id: "basketball/nba", nombre: "NBA" },
    // box (TheSportsDB, liga 4445)
    { dep: "box", sportsdb: "4445", nombre: "Box" },
  ];

  const DEPORTES = [
    { k: "todo", t: "Todo" },
    { k: "futbol", t: "⚽ Fútbol" },
    { k: "nfl", t: "🏈 NFL" },
    { k: "nba", t: "🏀 NBA" },
    { k: "box", t: "🥊 Box" },
  ];
  const DIAS = [{ o: -1, t: "Ayer" }, { o: 0, t: "Hoy" }, { o: 1, t: "Mañana" }];

  // ---------- utilidades de fecha (siempre hora de Ciudad de México) ----------
  const fmtKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtHora = new Intl.DateTimeFormat("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const keyMX = d => fmtKey.format(d); // "2026-11-25"
  function addDays(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  async function getJSON(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // ---------- ESPN ----------
  function espnEvento(e, liga, logoLiga) {
    const comp = (e.competitions || [])[0] || {};
    const cs = comp.competitors || [];
    const home = cs.find(c => c.homeAway === "home") || cs[0] || {};
    const away = cs.find(c => c.homeAway === "away") || cs[1] || {};
    const st = (e.status && e.status.type) || {};
    const nombreSt = String(st.name || "").toUpperCase();
    let status = "programado";
    if (/POSTPONED|CANCELED|CANCELLED|SUSPENDED|ABANDONED|DELAYED/.test(nombreSt)) status = "suspendido";
    else if (st.state === "in") status = "en_vivo";
    else if (st.state === "post") status = "finalizado";
    const fecha = new Date(e.date);
    const team = c => (c.team && (c.team.shortDisplayName || c.team.displayName)) || "?";
    const nota = (comp.notes || []).map(n => n.headline).filter(Boolean)[0] || "";
    return {
      dep: liga.dep, liga: liga.nombre, ligaLogo: logoLiga, orden: LIGAS.indexOf(liga),
      ts: fecha.getTime(), dia: keyMX(fecha), hora: fmtHora.format(fecha),
      local: team(home), localLogo: home.team && home.team.logo,
      visita: team(away), visitaLogo: away.team && away.team.logo,
      golesL: home.score, golesV: away.score,
      status, detalle: st.shortDetail || "", nota,
    };
  }

  async function cargarESPN(liga, diaMX) {
    // ESPN agrupa por día de EE. UU. (Este); el día de México puede caer en dos de esos días
    const fechas = [diaMX, addDays(diaMX, 1)].map(d => d.replace(/-/g, ""));
    const out = [];
    for (const f of fechas) {
      const j = await getJSON(`${ESPN}${liga.id}/scoreboard?dates=${f}&lang=es&region=mx`);
      const lg = (j.leagues || [])[0] || {};
      const logo = (lg.logos || [])[0] && lg.logos[0].href;
      for (const e of j.events || []) out.push(espnEvento(e, liga, logo));
    }
    return out;
  }

  // ---------- TheSportsDB (box) ----------
  async function cargarBox(liga, diaMX) {
    const out = [];
    for (const f of [diaMX, addDays(diaMX, 1)]) {
      const j = await getJSON(`${SPORTSDB}eventsday.php?d=${f}&l=${liga.sportsdb}`);
      for (const e of j.events || []) {
        const sinHora = !e.strTime || e.strTime.startsWith("00:00");
        let dia, hora, ts;
        if (sinHora) {
          dia = e.dateEvent; hora = "Por confirmar"; ts = Date.parse(e.dateEvent + "T23:59:00Z");
        } else {
          let iso = e.strTimestamp || `${e.dateEvent}T${e.strTime}`;
          if (!/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) iso += "Z"; // TheSportsDB da la hora en UTC
          const fecha = new Date(iso);
          dia = keyMX(fecha); hora = fmtHora.format(fecha); ts = fecha.getTime();
        }
        const partes = String(e.strEvent || "").split(/\s+vs\.?\s+/i);
        const st = String(e.strStatus || "").toLowerCase();
        let status = "programado";
        if (/postponed|cancel/.test(st)) status = "suspendido";
        else if (/finished|ft|final/.test(st)) status = "finalizado";
        out.push({
          dep: "box", liga: liga.nombre, ligaLogo: null, orden: LIGAS.indexOf(liga),
          ts, dia, hora,
          local: partes[0] || e.strEvent, visita: partes[1] || "",
          localLogo: null, visitaLogo: null, golesL: null, golesV: null,
          status, detalle: "", nota: [e.strVenue, e.strCountry].filter(Boolean).join(", "),
        });
      }
    }
    return out;
  }

  // ---------- caché corto en memoria ----------
  const cache = {}; // diaMX -> {t, eventos, fallas}
  async function cargarDia(diaMX, forzar) {
    const c = cache[diaMX];
    const vida = diaMX === keyMX(new Date()) ? 60e3 : 10 * 60e3;
    if (c && !forzar && Date.now() - c.t < vida) return c;
    let fallas = 0;
    const res = await Promise.all(LIGAS.map(l =>
      (l.sportsdb ? cargarBox(l, diaMX) : cargarESPN(l, diaMX)).catch(() => { fallas++; return []; })));
    const vistos = new Set();
    const eventos = res.flat()
      .filter(e => e.dia === diaMX)
      .filter(e => { const k = e.liga + e.local + e.visita + e.ts; if (vistos.has(k)) return false; vistos.add(k); return true; })
      .sort((a, b) => a.orden - b.orden || a.ts - b.ts);
    return (cache[diaMX] = { t: Date.now(), eventos, fallas, total: LIGAS.length * 2 });
  }

  // ---------- pantalla ----------
  function eventoHTML(ev) {
    const hayMarcador = ev.golesL != null && ev.golesV != null && ev.golesL !== "" &&
      (ev.status === "en_vivo" || ev.status === "finalizado");
    const marcador = hayMarcador ? `<span class="score">${esc(ev.golesL)} - ${esc(ev.golesV)}</span>` : "";
    let mid;
    if (ev.status === "en_vivo") mid = `<span class="status live">● EN VIVO</span>${marcador}<span class="det">${esc(ev.detalle)}</span>`;
    else if (ev.status === "finalizado") mid = `<span class="status ft">Final</span>${marcador}`;
    else if (ev.status === "suspendido") mid = `<span class="status susp">Aplazado</span>`;
    else mid = `<span class="time">${esc(ev.hora)}</span>`;
    const lado = (n, logo, cls) => `<div class="team ${cls}">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy">` : ""}<span>${esc(n)}</span></div>`;
    const nota = ev.nota ? `<div class="match-note">${esc(ev.nota)}</div>` : "";
    if (!ev.visita) {
      return `<div class="match"><div class="team solo"><span>${esc(ev.local)}</span></div><div class="mid">${mid}</div></div>${nota}`;
    }
    return `<div class="match">${lado(ev.local, ev.localLogo, "home")}<div class="mid">${mid}</div>${lado(ev.visita, ev.visitaLogo, "away")}</div>${nota}`;
  }

  function mount(root) {
    let dep = "todo", off = 0, timer = null, token = 0;
    try {
      const d = localStorage.getItem("topflix_dep");
      if (DEPORTES.some(x => x.k === d)) dep = d;
    } catch (_) {}

    root.innerHTML = `
      <div class="sp-bar">
        <div class="seg sp-days">${DIAS.map(d => `<button type="button" data-o="${d.o}">${d.t}</button>`).join("")}</div>
        <div class="sp-chips">${DEPORTES.map(d => `<button type="button" data-k="${d.k}">${d.t}</button>`).join("")}</div>
      </div>
      <p class="sp-meta"></p>
      <div class="sp-list"><p class="loading">Cargando…</p></div>`;
    const lista = root.querySelector(".sp-list");
    const meta = root.querySelector(".sp-meta");

    function marcar() {
      root.querySelectorAll(".sp-days button").forEach(b => b.classList.toggle("on", +b.dataset.o === off));
      root.querySelectorAll(".sp-chips button").forEach(b => b.classList.toggle("on", b.dataset.k === dep));
    }

    async function pintar(forzar) {
      const mio = ++token;
      marcar();
      const dia = addDays(keyMX(new Date()), off);
      const fechaTxt = new Date(dia + "T12:00:00Z").toLocaleDateString("es-MX",
        { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
        .replace(/^./, c => c.toUpperCase());
      if (!cache[dia]) lista.innerHTML = `<p class="loading">Cargando ${esc(fechaTxt)}…</p>`;
      const datos = await cargarDia(dia, forzar);
      if (mio !== token) return; // el usuario ya cambió de día/deporte

      const hora = new Date(datos.t).toLocaleTimeString("es-MX", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
      meta.innerHTML = `<span class="cap">${esc(fechaTxt)}</span> · hora de Ciudad de México · actualizado ${esc(hora)}` +
        (off === 0 ? " · se refresca solo cada minuto" : "");

      if (datos.fallas >= datos.total) {
        lista.innerHTML = `<p class="loading">No se pudo conectar con las fuentes de datos. Revisa tu internet y vuelve a intentar.</p>`;
        return;
      }
      const evs = datos.eventos.filter(e => dep === "todo" || e.dep === dep);
      if (!evs.length) {
        lista.innerHTML = `<p class="loading">Sin eventos ${dep === "todo" ? "" : "de este deporte "}para este día.</p>`;
        return;
      }
      let html = "", actual = null;
      for (const ev of evs) {
        if (ev.liga !== actual) {
          if (actual !== null) html += "</div>";
          actual = ev.liga;
          const logo = ev.ligaLogo ? `<img class="lg" src="${esc(ev.ligaLogo)}" alt="" loading="lazy">` : "";
          html += `<div class="league-group"><div class="league-head">${logo}<span>${esc(ev.liga)}</span></div>`;
        }
        html += eventoHTML(ev);
      }
      lista.innerHTML = html + "</div>";
    }

    root.querySelector(".sp-days").addEventListener("click", e => {
      const b = e.target.closest("button[data-o]"); if (!b) return;
      off = +b.dataset.o; pintar(false);
    });
    root.querySelector(".sp-chips").addEventListener("click", e => {
      const b = e.target.closest("button[data-k]"); if (!b) return;
      dep = b.dataset.k;
      try { localStorage.setItem("topflix_dep", dep); } catch (_) {}
      pintar(false);
    });

    function arrancarReloj() {
      clearInterval(timer);
      timer = setInterval(() => {
        if (document.hidden || root.closest("[hidden]")) return;
        if (off === 0) pintar(true);
      }, 60e3);
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && off === 0) pintar(false); });

    pintar(false);
    arrancarReloj();
    return { refrescar: () => pintar(false) };
  }

  window.TopflixDeportes = { mount };
})();
