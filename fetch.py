#!/usr/bin/env python3
"""
topflix - recolector de informacion (solo lectura, uso personal).

Consulta la API publica de TMDB y arma un unico archivo JSON (data/feed.json)
con secciones: tendencias, en cine ahora, proximos estrenos, nuevo en tus
plataformas, mejor valoradas del momento y mas populares. Cada titulo lleva
poster, sinopsis, generos, nota, plataformas donde esta disponible y, si existe,
el enlace + embed del trailer de YouTube.

No sube ni publica nada. Solo lee de TMDB y escribe un JSON local.

Uso:
    TMDB_TOKEN=xxxxx  py fetch.py --out web/data/feed.json

El token es el "API Read Access Token" (v4) de https://www.themoviedb.org/settings/api
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
SECTION_SIZE = 20           # titulos por seccion
RECENT_DAYS = 100           # ventana para "nuevo en tus plataformas"
TOP_RATED_MONTHS = 8        # ventana para "mejor valoradas del momento"
HTTP_TIMEOUT = 25

# filas por genero (ids de genero de peliculas de TMDB, estables)
GENRES_MOVIE = [
    (28, "Accion"),
    (35, "Comedia"),
    (27, "Terror"),
    (878, "Ciencia ficcion"),
    (18, "Drama"),
    (16, "Animacion"),
    (53, "Suspenso"),
    (10749, "Romance"),
    (80, "Crimen"),
    (99, "Documental"),
]


# --------------------------------------------------------------------------- #
#  HTTP
# --------------------------------------------------------------------------- #
def _token() -> str:
    tok = (os.environ.get("TMDB_TOKEN") or "").strip()
    if not tok:
        sys.exit("ERROR: falta la variable de entorno TMDB_TOKEN")
    return tok


def api_get(path: str, params: dict | None = None, _tries: int = 5) -> dict:
    params = {k: v for k, v in (params or {}).items() if v is not None}
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {_token()}",
            "Accept": "application/json",
            "User-Agent": "topflix/1.0 (personal)",
        },
    )
    for attempt in range(1, _tries + 1):
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < _tries:
                wait = int(e.headers.get("Retry-After", "2")) + 1
                time.sleep(wait)
                continue
            if e.code in (500, 502, 503, 504) and attempt < _tries:
                time.sleep(2 * attempt)
                continue
            body = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"TMDB {e.code} en {path}: {body}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < _tries:
                time.sleep(2 * attempt)
                continue
            raise
    raise RuntimeError(f"TMDB: agotados los reintentos en {path}")


# --------------------------------------------------------------------------- #
#  Plataformas del usuario  ->  IDs de proveedor de TMDB
# --------------------------------------------------------------------------- #
def _norm(s: str) -> str:
    s = s.lower().strip()
    s = s.replace("+", " plus ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def resolve_platforms(regions: list[str], wanted: list[str]) -> dict:
    """Devuelve {nombre_pedido: {'id': int, 'tmdb_name': str}} y una lista de no encontrados."""
    catalog: dict[str, tuple[int, str]] = {}
    for region in regions:
        for kind in ("movie", "tv"):
            data = api_get(f"/watch/providers/{kind}", {"watch_region": region})
            for p in data.get("results", []):
                catalog.setdefault(_norm(p["provider_name"]), (p["provider_id"], p["provider_name"]))

    resolved: dict[str, dict] = {}
    missing: list[str] = []
    for name in wanted:
        n = _norm(name)
        hit = catalog.get(n)
        if not hit:
            # match laxo por prefijo / contencion
            for cn, val in catalog.items():
                if cn == n or cn.startswith(n + " ") or n.startswith(cn + " ") or (len(n) > 4 and n in cn):
                    hit = val
                    break
        if hit:
            resolved[name] = {"id": hit[0], "tmdb_name": hit[1]}
        else:
            missing.append(name)
    return {"resolved": resolved, "missing": missing}


# --------------------------------------------------------------------------- #
#  Utilidades de formato
# --------------------------------------------------------------------------- #
def poster(path: str | None, size: str = "w342") -> str | None:
    return f"{IMG}/{size}{path}" if path else None


def pick_trailer(videos: dict) -> dict | None:
    vids = [v for v in videos.get("results", []) if v.get("site") == "YouTube" and v.get("key")]
    if not vids:
        return None

    def score(v: dict) -> tuple:
        t = (v.get("type") or "").lower()
        lang = (v.get("iso_639_1") or "").lower()
        return (
            t == "trailer",
            t == "teaser",
            bool(v.get("official")),
            lang == "es",
            lang == "en",
        )

    best = max(vids, key=score)
    return {
        "youtube": f"https://www.youtube.com/watch?v={best['key']}",
        "embed": f"https://www.youtube.com/embed/{best['key']}",
        "name": best.get("name"),
    }


def providers_block(wp: dict, region: str, mine_ids: set[int]) -> dict:
    reg = (wp.get("results") or {}).get(region) or {}
    out = {"flatrate": [], "rent": [], "buy": [], "link": reg.get("link")}
    for key in ("flatrate", "rent", "buy"):
        for p in reg.get(key, []) or []:
            out[key].append(
                {
                    "name": p["provider_name"],
                    "logo": poster(p.get("logo_path"), "w92"),
                    "mine": p["provider_id"] in mine_ids,
                }
            )
    out["on_mine"] = any(p["mine"] for p in out["flatrate"])
    return out


# --------------------------------------------------------------------------- #
#  Enriquecer un titulo (detalle + videos + proveedores + generos)
# --------------------------------------------------------------------------- #
def enrich(media_type: str, tmdb_id: int, lang: str, region: str, mine_ids: set[int]) -> dict:
    d = api_get(
        f"/{media_type}/{tmdb_id}",
        {
            "language": lang,
            "append_to_response": "videos,watch/providers",
            "include_video_language": "es,en,null",
        },
    )
    title = d.get("title") or d.get("name") or "(sin titulo)"
    date = d.get("release_date") or d.get("first_air_date") or ""
    return {
        "id": tmdb_id,
        "media_type": media_type,
        "title": title,
        "original_title": d.get("original_title") or d.get("original_name") or title,
        "overview": d.get("overview") or "",
        "date": date,
        "year": date[:4] if date else "",
        "poster": poster(d.get("poster_path"), "w342"),
        "backdrop": poster(d.get("backdrop_path"), "w780"),
        "vote_average": round(d.get("vote_average") or 0, 1),
        "vote_count": d.get("vote_count") or 0,
        "genres": [g["name"] for g in d.get("genres", [])][:4],
        "runtime": d.get("runtime") or (d.get("episode_run_time") or [None])[0],
        "trailer": pick_trailer(d.get("videos") or {}),
        "providers": providers_block(d.get("watch/providers") or {}, region, mine_ids),
        "tmdb_url": f"https://www.themoviedb.org/{media_type}/{tmdb_id}",
    }


# --------------------------------------------------------------------------- #
#  Listas base (ids ordenados) por seccion
# --------------------------------------------------------------------------- #
def _ids_from_results(results: list[dict], default_mt: str | None = None) -> list[tuple[str, int]]:
    out = []
    for r in results:
        mt = r.get("media_type") or default_mt
        if mt in ("movie", "tv") and r.get("id"):
            out.append((mt, r["id"]))
    return out


def collect(lang: str, region: str, region2: str, mine_ids: set[int]) -> list[dict]:
    today = dt.date.today()
    recent_from = (today - dt.timedelta(days=RECENT_DAYS)).isoformat()
    toprated_from = (today - dt.timedelta(days=TOP_RATED_MONTHS * 30)).isoformat()
    prov_param = "|".join(str(i) for i in sorted(mine_ids)) or None

    sections: list[dict] = []

    def add(sid: str, title: str, subtitle: str, pairs: list[tuple[str, int]]):
        seen: set[tuple[str, int]] = set()
        uniq = []
        for p in pairs:
            if p not in seen:
                seen.add(p)
                uniq.append(p)
            if len(uniq) >= SECTION_SIZE:
                break
        sections.append({"id": sid, "title": title, "subtitle": subtitle, "_pairs": uniq})

    # 1. Tendencias de la semana (cine + tv)
    tr = api_get("/trending/all/week", {"language": lang})
    add("trending", "Tendencias de la semana", "Lo que mas se mueve ahora mismo",
        _ids_from_results(tr.get("results", [])))

    # 2. En cine ahora (Mexico, con respaldo EE. UU.)
    npx = api_get("/movie/now_playing", {"language": lang, "region": region, "page": 1})
    npus = api_get("/movie/now_playing", {"language": lang, "region": region2, "page": 1})
    add("in_theaters", f"En cine ahora", f"Cartelera de {region} (y estrenos de {region2})",
        _ids_from_results(npx.get("results", []), "movie") + _ids_from_results(npus.get("results", []), "movie"))

    # 3. Proximos estrenos
    up = api_get("/movie/upcoming", {"language": lang, "region": region, "page": 1})
    upus = api_get("/movie/upcoming", {"language": lang, "region": region2, "page": 1})
    fut = [r for r in up.get("results", []) + upus.get("results", [])
           if (r.get("release_date") or "9999") > today.isoformat()]
    fut.sort(key=lambda r: r.get("release_date") or "9999")
    add("upcoming", "Proximos estrenos", "Lo que viene a cartelera",
        _ids_from_results(fut, "movie"))

    # 4. Nuevo en tus plataformas (estrenos recientes disponibles en flatrate)
    if prov_param:
        nm_movie = api_get("/discover/movie", {
            "language": lang, "watch_region": region,
            "with_watch_providers": prov_param, "with_watch_monetization_types": "flatrate",
            "release_date.gte": recent_from, "release_date.lte": today.isoformat(),
            "sort_by": "primary_release_date.desc", "vote_count.gte": 5, "page": 1,
        })
        nm_tv = api_get("/discover/tv", {
            "language": lang, "watch_region": region,
            "with_watch_providers": prov_param, "with_watch_monetization_types": "flatrate",
            "first_air_date.gte": recent_from, "first_air_date.lte": today.isoformat(),
            "sort_by": "first_air_date.desc", "vote_count.gte": 5, "page": 1,
        })
        merged = _ids_from_results(nm_movie.get("results", []), "movie") + _ids_from_results(nm_tv.get("results", []), "tv")
        add("new_on_mine", "Nuevo en tus plataformas",
            "Estrenos recientes en los servicios que marcaste", merged)

    # 5. Mejor valoradas del momento
    tr_rated = api_get("/discover/movie", {
        "language": lang, "region": region,
        "primary_release_date.gte": toprated_from, "primary_release_date.lte": today.isoformat(),
        "sort_by": "vote_average.desc", "vote_count.gte": 200, "page": 1,
    })
    add("top_rated", "Mejor valoradas del momento",
        f"Estrenos de los ultimos {TOP_RATED_MONTHS} meses con mejor nota",
        _ids_from_results(tr_rated.get("results", []), "movie"))

    # 6. Mas populares ahora
    pop_m = api_get("/movie/popular", {"language": lang, "region": region, "page": 1})
    pop_t = api_get("/tv/popular", {"language": lang, "page": 1})
    inter = []
    a, b = _ids_from_results(pop_m.get("results", []), "movie"), _ids_from_results(pop_t.get("results", []), "tv")
    for i in range(max(len(a), len(b))):
        if i < len(a):
            inter.append(a[i])
        if i < len(b):
            inter.append(b[i])
    add("popular", "Mas populares ahora", "Lo mas visto y buscado", inter)

    # 7. Filas por genero (peliculas mas populares de cada genero)
    for gid, gname in GENRES_MOVIE:
        g = api_get("/discover/movie", {
            "language": lang, "region": region,
            "with_genres": str(gid), "sort_by": "popularity.desc",
            "vote_count.gte": 80, "page": 1,
        })
        add(f"genre_{gid}", gname, f"Lo mas popular en {gname.lower()}",
            _ids_from_results(g.get("results", []), "movie"))

    # ---- enriquecer todos los titulos unicos en paralelo ----
    all_pairs: list[tuple[str, int]] = []
    for s in sections:
        all_pairs.extend(s["_pairs"])
    uniq_pairs = list(dict.fromkeys(all_pairs))
    print(f"Enriqueciendo {len(uniq_pairs)} titulos unicos...", flush=True)

    cache: dict[tuple[str, int], dict] = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(enrich, mt, tid, lang, region, mine_ids): (mt, tid) for mt, tid in uniq_pairs}
        for f in as_completed(futs):
            key = futs[f]
            try:
                cache[key] = f.result()
            except Exception as e:  # noqa: BLE001
                print(f"  aviso: no se pudo enriquecer {key}: {e}", flush=True)

    for s in sections:
        s["items"] = [cache[p] for p in s["_pairs"] if p in cache]
        del s["_pairs"]
    return [s for s in sections if s.get("items")]


# --------------------------------------------------------------------------- #
#  Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/data/feed.json")
    ap.add_argument("--config", default="platforms.json")
    args = ap.parse_args()

    with open(args.config, encoding="utf-8") as fh:
        cfg = json.load(fh)
    region = cfg.get("region_principal", "MX")
    region2 = cfg.get("region_secundaria", "US")
    lang = cfg.get("idioma", "es-MX")
    wanted = cfg.get("mis_plataformas", [])

    print(f"Region: {region} / respaldo {region2} / idioma {lang}", flush=True)
    pr = resolve_platforms([region, region2], wanted)
    for name, info in pr["resolved"].items():
        print(f"  OK  {name:22s} -> id {info['id']} ({info['tmdb_name']})", flush=True)
    for name in pr["missing"]:
        print(f"  --  {name:22s} -> sin coincidencia en TMDB (revisa el nombre)", flush=True)
    mine_ids = {info["id"] for info in pr["resolved"].values()}

    sections = collect(lang, region, region2, mine_ids)

    feed = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "region": region,
        "region_secundaria": region2,
        "idioma": lang,
        "mis_plataformas": [
            {"nombre": n, "tmdb_id": i["id"], "tmdb_nombre": i["tmdb_name"]}
            for n, i in pr["resolved"].items()
        ],
        "plataformas_sin_coincidencia": pr["missing"],
        "sections": sections,
    }

    out = args.out
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1)
    total = sum(len(s["items"]) for s in sections)
    print(f"Listo: {len(sections)} secciones, {total} tarjetas -> {out}", flush=True)


if __name__ == "__main__":
    main()
