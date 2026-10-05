#!/bin/sh
set -e

# Wait for the database, apply migrations, then seed the catalog and default users.
until python -c "from sqlalchemy import create_engine, text; from app.config import get_settings; create_engine(get_settings().database_url).connect().execute(text('select 1'))" 2>/dev/null; do
  echo "Waiting for database..."
  sleep 1
done
alembic upgrade head
if [ "${LIS_SEED_DEMO:-false}" = "true" ]; then
  python -m app.seed --demo
else
  python -m app.seed
fi

exec "$@"
