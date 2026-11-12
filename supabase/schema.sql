-- Mis Notas: esquema de la base de datos (pegar en Supabase → SQL Editor → Run)

-- Catálogo compartido de ramos (lo ve toda la comunidad)
create table if not exists public.ramos (
  id          uuid primary key default gen_random_uuid(),
  sigla       text not null,
  nombre      text not null,
  universidad text not null default 'UC',
  carrera     text,
  periodo     text,                       -- ej. '2026-2' (un mismo ramo puede tener programas distintos por semestre)
  fuente      text,
  def         jsonb not null,             -- evaluaciones, ponderaciones, reglas
  creado_por  uuid references auth.users on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
-- Evita duplicados exactos: misma universidad + sigla + período
create unique index if not exists ramos_unicos on public.ramos (lower(universidad), upper(regexp_replace(sigla, '\s', '', 'g')), coalesce(periodo, ''));

-- Ramos que cada persona está cursando + sus notas (privado)
create table if not exists public.inscripciones (
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  ramo_id    uuid not null references public.ramos on delete cascade,
  notas      jsonb not null default '{}',
  opts       jsonb not null default '{}',
  override   jsonb,                       -- ponderaciones propias si la persona las editó
  created_at timestamptz not null default now(),
  primary key (user_id, ramo_id)
);

alter table public.ramos enable row level security;
alter table public.inscripciones enable row level security;

-- Catálogo: todos leen; usuarios con sesión agregan; solo quien lo creó puede editarlo
drop policy if exists "ramos_leer" on public.ramos;
create policy "ramos_leer" on public.ramos for select using (true);
drop policy if exists "ramos_crear" on public.ramos;
create policy "ramos_crear" on public.ramos for insert to authenticated with check (creado_por = auth.uid());
drop policy if exists "ramos_editar" on public.ramos;
create policy "ramos_editar" on public.ramos for update to authenticated using (creado_por = auth.uid());

-- Inscripciones y notas: cada uno ve y edita solo lo suyo
drop policy if exists "insc_propias" on public.inscripciones;
create policy "insc_propias" on public.inscripciones for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
