# topflix

Sitio personal, **solo informativo**, para decidir qué ver. Reúne de la API pública
de [TMDB](https://www.themoviedb.org/):

- Tendencias de la semana (cine + series)
- En cine ahora y próximos estrenos (México, con respaldo de EE. UU.)
- Nuevo en tus plataformas (estrenos recientes en los servicios que marcas)
- Mejor valoradas del momento
- Más populares ahora
- Tráiler de YouTube incrustado y plataformas donde está cada título

Y una pestaña **⚽ Deportes** (opcional) con la agenda de hoy y mañana (hora de
Ciudad de México) de fútbol y NFL, vía [API-Sports](https://api-sports.io/):
Liga MX, ligas top de Europa, MLS, ligas de Centro/Sudamérica, Champions/Europa
League, Libertadores/Sudamericana, mundial y clasificatorias, Copa América,
amistosos de selecciones, NFL.

No sube ni publica nada. Solo lee de esas APIs y arma JSON que se muestran en una página.
Instalable como app (PWA): "Instalar aplicación" en el menú del navegador.

## Cómo funciona

1. `fetch.py` consulta TMDB → `web/data/feed.json`.
   `fetch_sports.py` consulta API-Sports → `web/data/agenda.json`
   (ninguno se guarda en git).
2. GitHub Actions (`.github/workflows/deploy.yml`) los corre cada 6 h y publica
   la carpeta `web/` en GitHub Pages.
3. La página (`web/index.html` + `app.js`) lee esos JSON.

## Puesta en marcha (una sola vez)

1. **Secret con la llave de TMDB**
   Repo → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*
   - Name: `TMDB_TOKEN`
   - Value: el *API Read Access Token* (v4) de <https://www.themoviedb.org/settings/api>

2. **Secret con la llave de API-Sports** (para la pestaña Deportes; opcional,
   sin esto la pestaña simplemente avisa que falta configurarla)
   - Regístrate gratis en <https://dashboard.api-sports.io/register> (solo correo)
   - Copia tu API Key del dashboard
   - Repo → mismo lugar que arriba → *New repository secret*
     - Name: `API_SPORTS_KEY`
     - Value: tu API Key

3. **Encender Pages**
   Repo → *Settings* → *Pages* → *Source: GitHub Actions*

4. Repo → *Actions* → *Actualizar y publicar* → *Run workflow*.
   Al terminar, la URL del sitio aparece en el paso *deploy*.

## Cambiar tus plataformas

Edita `platforms.json`, lista `mis_plataformas`. Escribe el nombre como lo conoces
(el recolector lo empareja con el catálogo de TMDB). El log de la Action muestra
cuáles emparejó y cuáles no.

## Cambiar las ligas/torneos de la agenda deportiva

Edita `sports.json`, lista `ligas_futbol` (nombres flexibles, no hace falta el
exacto de la API) y `excluir_si_contiene` (para quitar ruido tipo juveniles o
femenil). `incluir_nfl: false` apaga la NFL.

## Probar en local

```
set TMDB_TOKEN=tu_token   &&  py fetch.py                    # Windows (cmd)
$env:TMDB_TOKEN="tu_token" ;  py fetch.py                    # Windows (PowerShell)
$env:API_SPORTS_KEY="tu_key" ; py fetch_sports.py             # Windows (PowerShell)
python -m http.server -d web 8000                             # abre http://localhost:8000
```
