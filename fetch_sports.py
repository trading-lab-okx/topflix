#!/usr/bin/env python3
"""
topflix - agenda deportiva (solo lectura, uso personal).

Arma web/data/agenda.json con los partidos de HOY y MANANA (hora de Ciudad
de Mexico) de futbol y NFL, filtrados a las ligas/torneos de sports.json.
Usa las APIs publicas de api-sports.io (v3.football + v1.american-football).
No sube ni transmite nada: solo arma un calendario informativo.

Si falta la llave o algo falla, escribe un agenda.json vacio con el motivo
en vez de tumbar el resto del sitio (las peliculas siguen funcionando).

Uso:
    API_SPORTS_KEY=xxxxx  py fetch_sports.py --out web/data/agenda.json
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

HTTP_TIMEOUT = 20
MX_OFFSET = dt.timedelta(hours=-6)  # Mexico: sin horario de verano desde 2022 (UTC-6 fijo)


def now_utc_naive() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def api_get(base: str, path: str, key: str, params: dict | None = None, tries: int = 4) -> dict:
    params = {k: v for k, v in (params or {}).items() if v is not None}
    url = f"{base}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "x-apisports-key": key,
            "Accept": "application/json",
            "User-Agent": "topflix/1.0 (personal)",
        },
    )
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < tries:
                time.sleep(2 * attempt)
                continue
            body = e.read().decode("utf-8", "replace")[:250]
            raise RuntimeError(f"{e.code} en {path}: {body}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < tries:
                time.sleep(2 * attempt)
                continue
            raise
    raise RuntimeError(f"agotados los reintentos en {path}")


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def wanted_match(name: str, wanted: list[str], exclude: list[str]) -> bool:
    n = _norm(name)
    if not n:
        return False
    for ex in exclude:
        e = _norm(ex)
        if e and e in n:
            return False
    for w in wanted:
        w = _norm(w)
        if w and (w in n or n in w):
            return True
    return False


def mx_local(iso_utc: str) -> dt.datetime:
    s = iso_utc.replace("Z", "+00:00")
    d = dt.datetime.fromisoformat(s)
    if d.tzinfo is not None:
        d = d.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return d + MX_OFFSET


def status_label(short: str | None) -> str:
    s = (short or "").upper()
    if s in {"1H", "2H", "HT", "ET", "P", "LIVE", "BT", "INT", "IN PLAY", "Q1", "Q2", "Q3", "Q4", "OT"}:
        return "en_vivo"
    if s in {"FT", "AET", "PEN", "AOT", "FINAL", "FT/OT", "FT/PEN"}:
        return "finalizado"
    if s in {"PST", "POSTPONED", "CANC", "ABD", "CANCELLED", "ABANDONED", "SUSP"}:
        return "suspendido"
    return "programado"


# --------------------------------------------------------------------------- #
#  Futbol: v3.football.api-sports.io
# --------------------------------------------------------------------------- #
def fetch_football(key: str, dates: list[str], wanted: list[str], exclude: list[str]) -> list[dict]:
    events = []
    for date in dates:
        try:
            data = api_get("https://v3.football.api-sports.io", "/fixtures", key,
                            {"date": date, "timezone": "UTC"})
        except Exception as e:  # noqa: BLE001
            print(f"  aviso: no se pudo consultar futbol ({date}): {e}", flush=True)
            continue
        for fx in data.get("response", []):
            try:
                league = fx.get("league") or {}
                lname = league.get("name") or ""
                if not wanted_match(lname, wanted, exclude):
                    continue
                fixture = fx.get("fixture") or {}
                iso = fixture.get("date")
                if not iso:
                    continue
                teams = fx.get("teams") or {}
                goals = fx.get("goals") or {}
                home, away = teams.get("home") or {}, teams.get("away") or {}
                local = mx_local(iso)
                events.append({
                    "sport": "futbol",
                    "league": lname,
                    "league_country": league.get("country"),
                    "league_logo": league.get("logo"),
                    "round": league.get("round"),
                    "home": home.get("name"),
                    "home_logo": home.get("logo"),
                    "away": away.get("name"),
                    "away_logo": away.get("logo"),
                    "home_score": goals.get("home"),
                    "away_score": goals.get("away"),
                    "status": status_label((fixture.get("status") or {}).get("short")),
                    "date_local": local.strftime("%Y-%m-%d"),
                    "time_local": local.strftime("%H:%M"),
                })
            except Exception as e:  # noqa: BLE001
                print(f"  aviso: partido de futbol no interpretado: {e}", flush=True)
    return events


# --------------------------------------------------------------------------- #
#  NFL: v1.american-football.api-sports.io
#  (esquema menos probado que el de futbol: se hace a prueba de fallos,
#  si algo no calza simplemente se omite ese partido sin tumbar el resto)
# --------------------------------------------------------------------------- #
def fetch_nfl(key: str, dates: list[str]) -> list[dict]:
    events = []
    for date in dates:
        try:
            data = api_get("https://v1.american-football.api-sports.io", "/games", key, {"date": date})
        except Exception as e:  # noqa: BLE001
            print(f"  aviso: no se pudo consultar NFL ({date}): {e}", flush=True)
            continue
        for g in data.get("response", []):
            try:
                league = g.get("league") or {}
                if "nfl" not in _norm(league.get("name")):
                    continue
                game = g.get("game") if isinstance(g.get("game"), dict) else {}
                date_block = game.get("date") if isinstance(game.get("date"), dict) else {}
                iso = date_block.get("date") or g.get("date")
                if isinstance(iso, str) and "T" not in iso and date_block.get("time"):
                    iso = f"{iso}T{date_block['time']}:00+00:00"
                if not iso:
                    continue
                teams = g.get("teams") or {}
                scores = g.get("scores") or {}
                home, away = teams.get("home") or {}, teams.get("away") or {}
                home_score = (scores.get("home") or {}).get("total") if isinstance(scores.get("home"), dict) else None
                away_score = (scores.get("away") or {}).get("total") if isinstance(scores.get("away"), dict) else None
                status = g.get("status") or {}
                local = mx_local(iso)
                week = game.get("week") if isinstance(game, dict) else None
                events.append({
                    "sport": "nfl",
                    "league": "NFL",
                    "league_country": "USA",
                    "league_logo": None,
                    "round": f"Semana {week}" if week else None,
                    "home": home.get("name"),
                    "home_logo": home.get("logo"),
                    "away": away.get("name"),
                    "away_logo": away.get("logo"),
                    "home_score": home_score,
                    "away_score": away_score,
                    "status": status_label(status.get("short") if isinstance(status, dict) else str(status)),
                    "date_local": local.strftime("%Y-%m-%d"),
                    "time_local": local.strftime("%H:%M"),
                })
            except Exception as e:  # noqa: BLE001
                print(f"  aviso: partido de NFL no interpretado: {e}", flush=True)
    return events


# --------------------------------------------------------------------------- #
#  Armado final
# --------------------------------------------------------------------------- #
def build(key: str, cfg: dict) -> dict:
    today_mx = (now_utc_naive() + MX_OFFSET).date()
    # 3 fechas UTC alcanzan para cubrir "hoy" y "manana" completos en hora de Mexico (UTC-6 fijo)
    utc_dates = [(today_mx + dt.timedelta(days=d)).isoformat() for d in (0, 1, 2)]

    wanted = cfg.get("ligas_futbol", [])
    exclude = cfg.get("excluir_si_contiene", [])
    order = [_norm(x) for x in wanted]

    events = fetch_football(key, utc_dates, wanted, exclude)
    if cfg.get("incluir_nfl", True):
        events += fetch_nfl(key, utc_dates)

    def league_rank(ev: dict) -> int:
        if ev["sport"] == "nfl":
            return -1
        n = _norm(ev["league"])
        for i, w in enumerate(order):
            if w and (w in n or n in w):
                return i
        return len(order)

    events.sort(key=lambda e: (e["date_local"], league_rank(e), e["time_local"]))

    mx_today = today_mx.isoformat()
    mx_tomorrow = (today_mx + dt.timedelta(days=1)).isoformat()
    days = []
    for date, label in ((mx_today, "Hoy"), (mx_tomorrow, "Mañana")):
        days.append({
            "date": date,
            "label": label,
            "events": [e for e in events if e["date_local"] == date],
        })

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "timezone": "America/Mexico_City (UTC-6 fijo)",
        "days": days,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/data/agenda.json")
    ap.add_argument("--config", default="sports.json")
    args = ap.parse_args()

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    key = (os.environ.get("API_SPORTS_KEY") or "").strip()

    if not key:
        print("Aviso: falta API_SPORTS_KEY, se omite la agenda deportiva por ahora.", flush=True)
        feed = {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "error": "sin_configurar",
            "days": [],
        }
    else:
        try:
            with open(args.config, encoding="utf-8") as fh:
                cfg = json.load(fh)
            feed = build(key, cfg)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR construyendo la agenda deportiva: {e}", flush=True)
            feed = {
                "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "error": str(e),
                "days": [],
            }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1)
    total = sum(len(d["events"]) for d in feed.get("days", []))
    print(f"Listo: agenda con {total} eventos -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
