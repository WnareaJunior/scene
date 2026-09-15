# Test/CI Postgres: PostGIS + pgvector in one image (no upstream image ships
# both). Same recipe as the devbox's dev-postgres (stacks/data/Dockerfile).
# Used by .github/workflows/ci.yml; usable locally with
#   docker build -t scene-test-postgres backend/test
FROM postgis/postgis:17-3.5
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-17-pgvector \
    && rm -rf /var/lib/apt/lists/*
