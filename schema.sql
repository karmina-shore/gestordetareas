-- ============================================================
-- SHORE Kanban — esquema de base de datos para Supabase
-- ============================================================
-- Cómo usar: entra a tu proyecto de Supabase > SQL Editor >
-- pega este archivo completo > Run.

-- Extensión necesaria para generar IDs únicos
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Tabla principal de tareas
-- ------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  notes text default '',
  vertiente text not null check (vertiente in ('shore_content', 'pm_video')),
  status text not null default 'pendiente' check (status in ('pendiente', 'en_proceso', 'en_revision', 'completado')),
  priority text not null default 'normal' check (priority in ('normal', 'prioritaria', 'urgente')),
  area text default null, -- Brand, MKT, Comercial, Direccion, Administracion, Culture & People, Produccion, Postproduccion, Cliente
  depends_on_task_id uuid references tasks(id) on delete set null,
  due_date date default null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Subtareas (para tareas marcadas como "proceso grande")
-- ------------------------------------------------------------
create table if not exists subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Pendientes rápidos / recordatorios (fuera del flujo Kanban)
-- ------------------------------------------------------------
create table if not exists quick_pendings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Autenticación simple (una sola fila con el hash de la contraseña)
-- ------------------------------------------------------------
create table if not exists app_auth (
  id integer primary key default 1,
  password_hash text not null,
  constraint single_row check (id = 1)
);

-- Actualiza automáticamente updated_at en cada cambio de tarea
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
-- Este tablero es de uso personal y el acceso a la página ya está
-- protegido con contraseña, así que habilitamos operaciones abiertas
-- con la llave "anon" únicamente para estas tablas específicas.

alter table tasks enable row level security;
alter table subtasks enable row level security;
alter table quick_pendings enable row level security;
alter table app_auth enable row level security;

create policy "tasks_all" on tasks for all using (true) with check (true);
create policy "subtasks_all" on subtasks for all using (true) with check (true);
create policy "quick_pendings_all" on quick_pendings for all using (true) with check (true);

-- app_auth: solo lectura desde la app (el hash se define manualmente abajo)
create policy "app_auth_select" on app_auth for select using (true);

-- ------------------------------------------------------------
-- Define tu contraseña de acceso
-- ------------------------------------------------------------
-- 1. Elige una contraseña, por ejemplo: "MiClaveSegura2026"
-- 2. Genera su hash SHA-256 en https://emn178.github.io/online-tools/sha256.html
--    (o abre la consola del navegador y corre:
--     crypto.subtle.digest('SHA-256', new TextEncoder().encode('tu-contraseña'))
--     el código de la app ya incluye una utilidad para esto, ver README)
-- 3. Reemplaza 'PEGA_AQUI_TU_HASH' abajo y ejecuta este insert:

insert into app_auth (id, password_hash)
values (1, 'PEGA_AQUI_TU_HASH')
on conflict (id) do update set password_hash = excluded.password_hash;
