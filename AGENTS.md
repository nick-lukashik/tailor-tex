# AGENTS.md

tailor-tex: internal NestJS service of Tailor that turns a `CvDocument` into a PDF with XeLaTeX ("Minimal violet", `templates/cv.tex`) and measures it with poppler. No database, no queue, no user auth: `POST /api/v1/cv/render` and `POST /api/v1/cv/measure` behind `INTERNAL_API_TOKEN`. Built from nest-starter (`.template-version`); the TeX code is ported from Atelier's atelier-tex. The human-facing description is `README.md`.

## Commands

- `pnpm install`: dependencies (Node 26, pnpm 12; versions pinned exactly).
- `pnpm env:local`: `.env` from `.env.example`; `pnpm dev`: build, `tsc --watch` and `node --watch` (needs TeX Live on the host); `pnpm docker:up` / `pnpm docker:down`: the image from `compose.yaml` instead.
- `pnpm verify`: lint + typecheck + build + test. It must be green before you hand work over; report the command and its actual result, and say whether the TeX tests ran or were skipped.
- `pnpm test:unit`, `pnpm test:int`. Tests only through `vitest run`, never watch. `test/tex.int.test.ts` skips without `xelatex`/poppler on PATH; run the suite inside the image to cover it (README, "Tests").
- `pnpm format`: Biome with fixes.

## Structure

- `src/main.ts`: entry point; `src/app.module.ts`: module wiring; `src/app.setup.ts`: HTTP setup (shared with the tests), with the 60 s request budget.
- `src/config/`: the Zod env schema (`env.ts`) and the `registerAs` groups (`config.ts`: `app`, `auth`, `tex`). Nothing else reads `process.env`.
- `src/common/`: infrastructure from nest-starter (`http`, `health`, `metrics`, `logging`, `openapi`, `context`, `config`). Differences: no `database`; error codes add `UNAUTHORIZED` 401 and `UNPROCESSABLE` 422 and drop `UNAVAILABLE` 503; `ApiErrors` defaults to 500 and 504.
- `src/auth/internal-token.guard.ts`: the bearer check, the same scheme as `@Internal()` of `@nick-lukashik/auth/nest`.
- `src/cv/`: `cv.schemas.ts` (contract) → `latex.ts` (escaping) and `content.ts` (`content.tex`) → `cv.service.ts` (build folder, xelatex, poppler, slots, readiness) → `measure.ts` (parsing poppler and the log) → `cv.controller.ts`. `tools.ts`: the process runner and the slots; `assets.ts`: template and fonts.
- `src/db/migrate.ts`: a no-op for the gitops migrate Job (logs `no migrations`).
- `templates/`, `fonts/`: the layout and IBM Plex Sans (OFL), copied into the image.
- `test/`: integration tests, `harness.ts` (app start, `FakeTools`), `fixtures/` (made-up CVs, recorded poppler output); unit tests sit next to the code.
- `Dockerfile`, `.github/workflows/ci.yml`: the image and CI follow the [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (kind **api**); see "Deploy" in `README.md`.

## Conventions

- Code style is Biome's (`biome.json`): 4 spaces, single quotes, no `;`, lines up to 120 characters, objects and arrays always expanded, operators at the start of a wrapped line, `type` over `interface`, `string[]`, kebab-case file names. Run `pnpm format` after edits.
- ESM: relative imports end in `.js`. Injectable classes are imported as values, not `import type`. Non-classes go through a `Symbol` token (`TOOL_RUNNER`).
- Controllers are thin: the schema on the parameter, a service call. The contract is the Zod schemas in `cv.schemas.ts` with `.meta({ id })`; input objects are `z.strictObject`.
- TeX safety, never weaken it: every text value goes through `latex.ts` (callers and models never send LaTeX); a value printed raw needs a schema that allows only safe characters (`phoneDigits`); xelatex runs with `-no-shell-escape`, `openin_any=p`, `openout_any=p`, without a shell, with only the variables of `toolEnv()`; a timeout kills the process group; builds are bounded by `TEX_CONCURRENCY` (429 when busy). A template change keeps the ATS rules in its header comment.
- Errors: `throw new AppError(code, message, details?)`. Codes: `VALIDATION_FAILED` 400, `UNAUTHORIZED` 401, `NOT_FOUND` 404, `PAYLOAD_TOO_LARGE` 413, `UNPROCESSABLE` 422 (TeX error with the log tail in `details`, or over `maxPages`), `RATE_LIMITED` 429, `INTERNAL` 500 (also a killed xelatex), `TIMEOUT` 504. Only `ErrorFilter` builds the response body.
- Time budgets: request 60 s (`TEX_REQUEST_TIMEOUT_MS`, an exception to the contract's 10 s), one build 45 s (`TEX_TIMEOUT_MS`, below the request budget), body 1 MiB (`BODY_LIMIT`).
- Readiness requires only the TeX toolchain (`xelatex`, `pdfinfo`, `pdffonts`, `pdftotext` run; cached 30 s).
- A new environment variable: `src/config/env.ts` → a group in `src/config/config.ts` → `.env.example`. Secrets have no `.default()`.
- Logs: pino JSON, only `Logger` from `@nestjs/common`; the object first, a constant message. CV text (it is personal data), the TeX log and tokens are never logged.
- Runtime: the app listens on `PORT` (local default 4000; the image and the cluster use 3000), metrics on `METRICS_PORT` (9464). The image runs as uid `10001` with a read-only root filesystem: write nothing outside `/tmp`.
- English everywhere: code, comments (short and rare) and docs.
- No secrets, real IPs, e-mail addresses or real CV data in files (fixtures use made-up people and `example.com`).

## Library rules

Short rules for each library, checked against the installed versions. Read the relevant file before changing code in that area.

- `.claude/rules/nestjs.md`: NestJS 12, @nestjs/config, terminus, swagger (NestJS llms.txt).
- `.claude/rules/zod.md`: Zod 4 (Zod llms.txt).
- `.claude/rules/pino.md`: pino 10 and nestjs-pino 5 (docs summary).
- `.claude/rules/prometheus.md`: @prometheus-io/client (docs summary).
- `.claude/rules/vitest.md`: Vitest 5 (Vitest llms.txt and its guide for AI agents).
- `.claude/rules/biome.md`: Biome 2 (docs summary).
