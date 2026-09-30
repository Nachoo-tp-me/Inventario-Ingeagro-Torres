#!/usr/bin/env bash
set -euo pipefail

container="ingeagro-stock-test-${RANDOM}"
docker run --rm -d --name "$container" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine >/dev/null
trap 'docker stop "$container" >/dev/null' EXIT

for attempt in {1..120}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.25
done
docker exec "$container" pg_isready -U postgres >/dev/null

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
SQL

for migration in \
  supabase/migrations/20260929000000_initial_inventory_schema.sql \
  supabase/migrations/20260929010000_harden_inventory_permissions.sql \
  supabase/migrations/20260930000000_shared_account_read_access.sql \
  supabase/migrations/20260930010000_limit_dashboard_read_access.sql \
  supabase/migrations/20260930020000_shared_account_category_read.sql \
  supabase/migrations/20260930050000_transactional_stock_operations.sql; do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null < "$migration"
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null < supabase/seed.sql
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null < tests/stock-transactions.sql

# Dos retiros simultáneos de 4 desde 5. El primero retiene el bloqueo durante
# 0,5 s; el segundo debe esperar y fallar sin dejar movimiento ni stock negativo.
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into public.productos (id, nombre, categoria_id)
values ('00000000-0000-0000-0000-000000000002', 'TEST concurrencia',
        (select id from public.categorias where nombre = 'Otros'));
set role authenticated;
set "request.jwt.claim.sub" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058';
insert into public.movimientos (producto_id, tipo, cantidad, destino_compartimiento_id)
select '00000000-0000-0000-0000-000000000002', 'entrada', 5, id
from public.compartimientos where codigo = 'C111';
SQL

first_sql="begin; set role authenticated; set \"request.jwt.claim.sub\" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'; insert into public.movimientos (producto_id,tipo,cantidad,origen_compartimiento_id) select '00000000-0000-0000-0000-000000000002','retiro',4,id from public.compartimientos where codigo='C111'; select pg_sleep(0.5); commit;"
second_sql="set role authenticated; set \"request.jwt.claim.sub\" = 'd5211ae5-39c6-4365-ad35-e6f6bdcc8058'; insert into public.movimientos (producto_id,tipo,cantidad,origen_compartimiento_id) select '00000000-0000-0000-0000-000000000002','retiro',4,id from public.compartimientos where codigo='C111';"

docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "$first_sql" >/dev/null 2>&1 &
first_pid=$!
sleep 0.1
docker exec "$container" psql -U postgres -v ON_ERROR_STOP=1 -c "$second_sql" >/dev/null 2>&1 &
second_pid=$!
if wait "$first_pid"; then first_ok=1; else first_ok=0; fi
if wait "$second_pid"; then second_ok=1; else second_ok=0; fi
if [ "$((first_ok + second_ok))" -ne 1 ]; then
  echo "La prueba de concurrencia esperaba un solo retiro exitoso" >&2
  exit 1
fi

result=$(docker exec "$container" psql -U postgres -At -c "select (select cantidad from public.inventario where producto_id='00000000-0000-0000-0000-000000000002'),(select count(*) from public.movimientos where producto_id='00000000-0000-0000-0000-000000000002' and tipo='retiro')")
if [ "$result" != "1|1" ]; then
  echo "Stock o historial inconsistente tras retiros concurrentes: $result" >&2
  exit 1
fi

echo "Transacciones, cero, historial y concurrencia: correctos"
