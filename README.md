# topflix

Sitio personal, **solo informativo**, para decidir qué ver. Reúne de la API pública
de [TMDB](https://www.themoviedb.org/):

- Tendencias de la semana (cine + series)
- En cine ahora y próximos estrenos (México, con respaldo de EE. UU.)
- Nuevo en tus plataformas (estrenos recientes en los servicios que marcas)
- Mejor valoradas del momento
- Más populares ahora
- Tráiler de YouTube incrustado y plataformas donde está cada título

No sube ni publica nada. Solo lee de TMDB y arma un JSON que se muestra en una página.

## Cómo funciona

1. `fetch.py` consulta TMDB y escribe `web/data/feed.json` (no se guarda en git).
2. GitHub Actions (`.github/workflows/deploy.yml`) lo corre cada 6 h y publica
   la carpeta `web/` en GitHub Pages.
3. La página (`web/index.html` + `app.js`) lee ese JSON.

## Puesta en marcha (una sola vez)

1. **Secret con la llave de TMDB**
   Repo → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*
   - Name: `TMDB_TOKEN`
   - Value: el *API Read Access Token* (v4) de <https://www.themoviedb.org/settings/api>

2. **Encender Pages**
   Repo → *Settings* → *Pages* → *Source: GitHub Actions*

3. Repo → *Actions* → *Actualizar y publicar* → *Run workflow*.
   Al terminar, la URL del sitio aparece en el paso *deploy*.

## Cambiar tus plataformas

Edita `platforms.json`, lista `mis_plataformas`. Escribe el nombre como lo conoces
(el recolector lo empareja con el catálogo de TMDB). El log de la Action muestra
cuáles emparejó y cuáles no.

## Probar en local

```
set TMDB_TOKEN=tu_token   &&  py fetch.py            # Windows (cmd)
$env:TMDB_TOKEN="tu_token" ;  py fetch.py            # Windows (PowerShell)
python -m http.server -d web 8000                    # abre http://localhost:8000
```
