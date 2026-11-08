# tailor-tex

Internal service of Tailor (a CV per vacancy): turns CV data (`CvDocument` JSON) into a PDF with XeLaTeX in the two-page "Minimal violet" layout, and measures the result with poppler (pages, fill of each page, printed lines of every block). No database, no queue, no user auth: two internal routes behind a service token. Built from [`nest-starter`](https://github.com/nick-lukashik/nest-starter) (`.template-version`); the TeX part is ported from Atelier's `atelier-tex`, which ran in production.

The caller never writes LaTeX. Every text value is escaped by `src/cv/latex.ts`; only `**…**` spans in summary and bullets become highlights. `phoneDigits` is the one value printed raw, and the schema allows only `+?\d{6,20}` there.

## What is inside

| Component                    | Version       | Why                                                                      |
| ---------------------------- | ------------- | ------------------------------------------------------------------------ |
| Node.js / pnpm               | 26.13 / 12.16 | `.node-version`, `packageManager`                                        |
| NestJS (express)             | 12.3          | as in nest-starter                                                       |
| Zod / @nestjs/swagger        | 4.6 / 12.0.5  | one schema for validation and OpenAPI                                    |
| pino / @prometheus-io/client | 10.4 / 0.16   | JSON logs, metrics                                                       |
| Vitest / Biome / TypeScript  | 5.0 / 2.6 / 7 |                                                                          |
| TeX Live (Debian trixie)     | 2024          | `texlive-xetex`, `texlive-fonts-recommended` (only for `pzdr.tfm`)       |
| poppler-utils                | 25.03         | `pdfinfo`, `pdffonts`, `pdftotext -bbox-layout`                          |
| IBM Plex Sans                | from Atelier  | `fonts/ibm-plex-sans/`, SIL Open Font License 1.1 (`OFL.txt` next to it) |

## Getting started

xelatex and poppler are needed to build a PDF. Without them (a Mac without TeX Live) the service starts but readiness is 503 and builds fail; run it in Docker instead:

```sh
pnpm install
pnpm env:local       # .env from .env.example (local-only INTERNAL_API_TOKEN)
pnpm docker:up       # the image on :4000, metrics :9464, as in Kubernetes
pnpm dev             # or on the host, with TeX Live installed
```

```sh
pnpm verify          # lint + typecheck + build + test
pnpm test:unit       # escaping, content.tex, measurements, process runner
pnpm test:int        # HTTP with a fake toolchain; real XeLaTeX tests when xelatex is on PATH
pnpm docker:down
```

Swagger UI: `/docs` (except with `NODE_ENV=production`), document: `/openapi.json`.

## API

Internal only: every `/api/v1/cv/*` request needs `Authorization: Bearer <INTERNAL_API_TOKEN>` (the platform's service-to-service scheme, compared in constant time; the NetworkPolicy admits only `api-client` pods). Body for both routes:

```json
{ "document": CvDocument, "template": "minimal-violet", "maxPages": 2 }
```

`template` defaults to `minimal-violet` (the only one), `maxPages` to 2 (1–4). Unknown fields are a 400.

| Method and path              | Response                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/cv/render`     | 200 `application/pdf` (the bytes), headers `x-pdf-pages` and `x-pdf-fill` (fill of the last page, 0..1). More pages than `maxPages`: 422.                          |
| `POST /api/v1/cv/measure`    | 200 `{ pages, fill: number[] (per page), sizeBytes, fits, overfullPt, fontsOk, blocks: { id, lines \| null }[], warnings }`, no PDF; `fits` is `pages <= maxPages` |
| `GET /health/live`, `/ready` | ready: 503 while `xelatex`, `pdfinfo`, `pdffonts` or `pdftotext` does not run (probe cached 30 s)                                                                  |
| `GET /openapi.json`, `/docs` | OpenAPI from the Zod schemas                                                                                                                                       |

`measure` is for the fitting loop (Atelier's shape, kept): `blocks` are `summary:<i>`, `skill:<i>` and `bullet:<bullet id>` with the lines each takes in print, so a caller knows what to shorten; `fill` says how much of each page is used. `render` is for the final PDF. Each call is one full build (two xelatex runs and poppler, about 1 s for two pages).

```sh
curl -sS http://localhost:4000/api/v1/cv/render \
  -H "authorization: Bearer $INTERNAL_API_TOKEN" -H 'content-type: application/json' \
  -d '{"document":{"name":"Alex Example","location":"Lisbon","phoneDisplay":"+351 900 000 000","phoneDigits":"+351900000000","headline":"Engineer","stack":"TypeScript","links":[{"url":"mailto:alex@example.com","text":"alex@example.com"}],"summary":["Builds **APIs**."],"skills":[{"label":"Languages","items":["TypeScript"]}],"jobs":[{"title":"Engineer","company":"Contoso","dates":"2020 – 2024","location":"","description":"","bullets":[{"id":"b1","text":"Shipped things."}]}],"education":[],"languages":[],"pdf":{"title":"","subject":"","keywords":[]}}}' \
  -D - -o cv.pdf
```

Error body: `{ code, message, details?: { path, message }[], requestId }` with `code` one of `VALIDATION_FAILED` (400), `UNAUTHORIZED` (401, no valid service token), `NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413, body over 1 MiB), `UNPROCESSABLE` (422: TeX failed, the first error and a few lines of context in `details` with `path: "log"`; or more pages than `maxPages`), `RATE_LIMITED` (429: every build slot busy, retry later), `INTERNAL` (500, also when xelatex is killed, e.g. at the memory limit), `TIMEOUT` (504: the build over `TEX_TIMEOUT_MS` or the request over 60 s).

## How a build runs (`src/cv/cv.service.ts`)

1. `content.tex` from the document (`content.ts`, escaping in `latex.ts`); the layout is `templates/cv.tex`.
2. A folder `tailor-tex-XXXX` under `TEX_WORK_DIR` (`/tmp`), with `cv.tex`, `content.tex` and `fonts/` linked to `fonts/ibm-plex-sans`. It is removed whatever happens.
3. `xelatex -interaction=nonstopmode -halt-on-error -no-shell-escape`, twice, then `pdfinfo`, `pdffonts`, `pdftotext -bbox-layout` (`measure.ts` parses their output).

Hardening, kept from atelier-tex:

- No shell: `spawn` without a shell, arguments passed verbatim. Each tool leads its own process group, and on a timeout the whole group is killed (xelatex pipes into xdvipdfmx).
- `-no-shell-escape`, and `openin_any=p` / `openout_any=p` (no reading or writing outside the build folder and the TeX tree). The tools get only `PATH`, `HOME`, `TMPDIR`, locale and TeX cache variables: never `INTERNAL_API_TOKEN`.
- At most `TEX_CONCURRENCY` builds at once (2); with `TEX_QUEUE_MAX=0` (the default) one more is refused at once with 429.
- A TeX error answers 422 with the log tail; the tail quotes CV text, so it goes only to the caller, never to the logs. Logs carry pages, fill, size, overfull, timings: no CV text.

Metrics (port 9464): `tailor_tex_builds_total{outcome=ok|tex_error|timeout|busy|failed}`, `tailor_tex_build_seconds`, `tailor_tex_slots{state=active|waiting}`, plus the starter's HTTP metrics.

## Time budgets

| Budget        | Value                     | Where                                                    | When exceeded                                       |
| ------------- | ------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Whole request | **60 s** (contract: 10 s) | `TEX_REQUEST_TIMEOUT_MS` in `src/app.setup.ts`           | 504 `TIMEOUT`; `http_server_request_timeouts_total` |
| One build     | 45 s                      | `TEX_TIMEOUT_MS`: both xelatex runs and poppler together | the process group is killed, 504 `TIMEOUT`          |
| Request body  | 1 MiB                     | `BODY_LIMIT` in `src/app.setup.ts`                       | 413 `PAYLOAD_TOO_LARGE`                             |

The 60 s request budget is an exception to the service contract, like the gateway's `GATEWAY_REQUEST_TIMEOUT_MS`: a XeLaTeX build may take more than 10 s on a busy node. A normal two-page build takes about 1 s. The build budget is below the request budget, so a slow build ends with this service's own 504 and a killed process, not with an abandoned one.

## Tests

- Unit (`src/**/*.test.ts`): escaping, `content.tex` (snapshot), bbox, pdffonts and log parsing on recorded output (`test/fixtures/alex.*`, recorded in this image), the process runner (no shell, group kill), slots, the token guard.
- Integration (`test/`): the real app with a fake toolchain (`FakeTools` in `test/harness.ts`): both routes, 400/401/413/422/429/504, the hardening flags, health, OpenAPI, metrics, body limit.
- `test/tex.int.test.ts` runs real XeLaTeX through the app. **It is skipped when `xelatex`, `pdftotext`, `pdfinfo` or `pdffonts` is not on PATH**, which is the case on the org CI runner and on a Mac without TeX Live. To run it, use the image (it has Node and TeX):

```sh
docker build -t tailor-tex:local .
docker run --rm --user 0 -v "$PWD":/src:ro tailor-tex:local bash -c 'mkdir /w && cd /src && tar --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -xf - -C /w && cd /w && npm i -g pnpm@12.16.1 && NODE_ENV=development pnpm install --frozen-lockfile && NODE_ENV=test pnpm vitest run'
```

Fixtures are made-up people only (example names, `example.com`), never real CV data.

## Docker

```sh
docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t tailor-tex .
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --user 10001:10001 -p 4000:3000 -p 9464:9464 -e INTERNAL_API_TOKEN="$INTERNAL_API_TOKEN" tailor-tex
```

- Base `node:26.13.0-trixie-slim`. Stages: `deps` → `build` and `prod-deps`; `tex` (TeX Live, poppler, fontconfig, the Plex fonts in `/usr/local/share/fonts` and `fc-cache`; the build fails unless `xelatex -version` and `pdftotext -v` run) → `runtime`. The image is about 1.3 GB, almost all TeX Live.
- `templates/` and `fonts/` live in the repo and are copied to `/app`.
- Runs as uid `10001` with a read-only root filesystem. It writes only to `/tmp`: `HOME`, `TEXMFVAR`, `TEXMFCONFIG`, `XDG_CACHE_HOME` point there, plus one folder per build.
- `node dist/db/migrate.js` exists for the gitops api component's migrate Job and only logs `no migrations`.
- Memory (`docker run --memory`, two-page CV): one build fits in 256 MiB; two parallel builds (`TEX_CONCURRENCY=2`) need more than 384 MiB and passed at 448 and 512 MiB. A little short of memory, the kernel kills xelatex and the build answers 500; far short (256 MiB), it kills the whole container.

## CI

`.github/workflows/ci.yml`: `build.yml@v1` with `kind: api` and no `services` (no database), then `deploy-pr.yml@v1` on `master`. The TeX tests skip on the runner (no xelatex); the image build itself checks the toolchain.

## Deploy

The [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (kind **api**), with the 60 s request budget above as its exception.

- Image `ghcr.io/nick-lukashik/tailor-tex`, by digest; gitops `apps/tailor-tex/prod/` with `components/service`, `components/api` and `components/internal` (no IngressRoute, no Traefik ingress).
- ConfigMap `tailor-tex-config`: `LOG_LEVEL`, `TRUST_PROXY_HOPS`, `TEX_CONCURRENCY`, `TEX_QUEUE_MAX`, `TEX_TIMEOUT_MS`. SealedSecret `tailor-tex-secrets`: `INTERNAL_API_TOKEN`, the same value the caller (tailor-api) sends.
- `/tmp` must be a writable `emptyDir` (TeX caches and the build folders take well under 1 MiB). Memory: see "Docker". The 512 MiB limit of `components/api` fits `TEX_CONCURRENCY=2` with little room; 768 MiB leaves room, or keep 512 MiB with `TEX_CONCURRENCY=1`.
- Callers: pods labelled `nick-lukashik.com/api-client: "true"` (tailor-api).

Conventions for agents and people: `AGENTS.md`; library rules: `.claude/rules/`.
