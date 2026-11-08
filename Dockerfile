# syntax=docker/dockerfile:1
#   docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t tailor-tex .
#   docker run --rm --read-only --tmpfs /tmp --user 10001:10001 -p 4000:3000 \
#     -e INTERNAL_API_TOKEN=... tailor-tex
# APP_VERSION is the only build arg: one image runs on stage and prod, the rest
# is runtime env. The gitops api component runs `node dist/db/migrate.js`
# from the same image before a rollout; here it only logs "no migrations".

# base: the Node image every stage starts from. Renovate updates the tag.
FROM node:26.13.0-trixie-slim AS base
WORKDIR /app

# deps: pnpm and the manifests.
FROM base AS deps
ENV CI=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Node 25+ ships without corepack: install the pnpm that package.json "packageManager" names.
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
    && npm cache clean --force

# build: dist/ from src/.
FROM deps AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# prod-deps: node_modules without dev dependencies.
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store

# tex: XeLaTeX and poppler, apart from the app so code changes reuse the layer.
# texlive-xetex brings every package templates/cv.tex loads (geometry, fontspec,
# babel-english, microtype, enumitem, titlesec, needspace, etoolbox, xcolor,
# hyperref; the last few through texlive-latex-extra). texlive-fonts-recommended
# (15 MB) only for pzdr.tfm (ZapfDingbats), which hyperref's XeTeX driver loads
# for every link. Debian, as the template, its thresholds and the bbox
# measurements were validated on Debian's TeX Live.
FROM base AS tex
RUN apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
       texlive-xetex texlive-fonts-recommended poppler-utils fontconfig \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
COPY fonts/ibm-plex-sans /usr/local/share/fonts/ibm-plex-sans
# Fail the build, not the first render, when the toolchain is incomplete.
RUN fc-cache -f \
    && xelatex -version >/dev/null \
    && kpsewhich pzdr.tfm >/dev/null \
    && pdftotext -v 2>/dev/null \
    && command -v pdfinfo pdffonts >/dev/null

# runtime: files stay owned by root, so the app cannot change itself. The
# numeric non-root user (Kubernetes can verify runAsNonRoot) writes only to
# /tmp (emptyDir): TeX's caches and config and one folder per build there.
FROM tex AS runtime
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="tailor-tex" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    METRICS_PORT=9464 \
    HOME=/tmp \
    TEXMFVAR=/tmp/texmf-var \
    TEXMFCONFIG=/tmp/texmf-config \
    XDG_CACHE_HOME=/tmp/.cache
COPY package.json ./
COPY templates ./templates
COPY fonts ./fonts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 10001:10001
EXPOSE 3000 9464
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
