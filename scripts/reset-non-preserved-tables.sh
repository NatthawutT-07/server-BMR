#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/backend-BMR}"
PM2_APP_NAME="${PM2_APP_NAME:-bmr-backend}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/before_major_reset_$TIMESTAMP.dump"
COUNT_BEFORE_FILE="$BACKUP_DIR/preserved_counts_before_$TIMESTAMP.tsv"
COUNT_AFTER_FILE="$BACKUP_DIR/preserved_counts_after_$TIMESTAMP.tsv"

PRESERVED_TABLES=(
  "User"
  "employee_hq"
  "reward_hq"
  "branch_hq"
  "log_hq"
)

cd "$PROJECT_DIR"

for command_name in node npx psql pg_dump pg_restore; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

DATABASE_URL="$(
  node -e \
    "require('dotenv').config({ quiet: true }); process.stdout.write(process.env.DATABASE_URL || '')"
)"

if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is missing from the environment and .env" >&2
  exit 1
fi

# Prisma's schema query parameter is not accepted by PostgreSQL CLI tools.
PSQL_DATABASE_URL="$(
  DATABASE_URL="$DATABASE_URL" node -e \
    "try { const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('schema'); process.stdout.write(url.toString()); } catch { console.error('DATABASE_URL is not a valid PostgreSQL URL'); process.exit(1); }"
)"

mkdir -p "$BACKUP_DIR"

echo "Validating Prisma schema..."
npx prisma validate

echo "The following tables and their data will be preserved:"
printf '  - %s\n' "${PRESERVED_TABLES[@]}"
echo
echo "Every other table in the public schema will be deleted and recreated."
echo "A full backup will be written to: $BACKUP_FILE"
echo

if [[ "${1:-}" != "--yes" ]]; then
  read -r -p "Type RESET to continue: " confirmation
  if [[ "$confirmation" != "RESET" ]]; then
    echo "Cancelled."
    exit 0
  fi
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "Stopping PM2 application: $PM2_APP_NAME"
  pm2 stop "$PM2_APP_NAME"
else
  echo "WARNING: pm2 was not found. Ensure the API and all database workers are stopped."
fi

echo "Checking preserved tables..."
for table_name in "${PRESERVED_TABLES[@]}"; do
  table_exists="$(
    psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
      "SELECT to_regclass('public.\"$table_name\"') IS NOT NULL;"
  )"
  if [[ "$table_exists" != "t" ]]; then
    echo "Preserved table is missing: $table_name" >&2
    echo "No tables were deleted. The PM2 application remains stopped." >&2
    exit 1
  fi
done

echo "Creating full database backup..."
pg_dump "$PSQL_DATABASE_URL" --format=custom --file="$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null

get_preserved_counts() {
  psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F $'\t' <<'SQL'
SELECT 'User', COUNT(*) FROM public."User"
UNION ALL
SELECT 'employee_hq', COUNT(*) FROM public."employee_hq"
UNION ALL
SELECT 'reward_hq', COUNT(*) FROM public."reward_hq"
UNION ALL
SELECT 'branch_hq', COUNT(*) FROM public."branch_hq"
UNION ALL
SELECT 'log_hq', COUNT(*) FROM public."log_hq"
ORDER BY 1;
SQL
}

get_preserved_counts >"$COUNT_BEFORE_FILE"

echo "Dropping all non-preserved tables..."
psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'User',
        'employee_hq',
        'reward_hq',
        'branch_hq',
        'log_hq',
        '_prisma_migrations'
      )
  LOOP
    EXECUTE format('DROP TABLE public.%I CASCADE', table_record.tablename);
  END LOOP;
END
$$;
SQL

echo "Synchronizing the new Prisma schema..."
npx prisma db push --accept-data-loss
npx prisma generate

get_preserved_counts >"$COUNT_AFTER_FILE"

if ! diff -u "$COUNT_BEFORE_FILE" "$COUNT_AFTER_FILE"; then
  echo "Preserved row counts changed unexpectedly." >&2
  echo "The PM2 application remains stopped. Restore from: $BACKUP_FILE" >&2
  exit 1
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "Starting PM2 application: $PM2_APP_NAME"
  pm2 restart "$PM2_APP_NAME"
  pm2 status
fi

echo "Reset completed successfully."
echo "Backup: $BACKUP_FILE"
echo "Preserved row counts: $COUNT_AFTER_FILE"
