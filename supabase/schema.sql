create table if not exists public.ralph_projects (
  id uuid primary key,
  name text not null,
  repo_url text not null,
  default_branch text not null default 'main',
  local_path text,
  default_provider text not null default 'manual',
  validation_commands text[] not null default array['yarn lint', 'yarn typecheck'],
  autonomy_level text not null default 'medium',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ralph_tasks (
  id uuid primary key,
  project_id uuid not null references public.ralph_projects(id) on delete cascade,
  title text not null,
  prompt text not null,
  provider text not null default 'manual',
  status text not null default 'queued',
  priority integer not null default 0,
  branch_name text,
  workspace_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ralph_runs (
  id uuid primary key,
  task_id uuid not null references public.ralph_tasks(id) on delete cascade,
  project_id uuid not null references public.ralph_projects(id) on delete cascade,
  provider text not null,
  status text not null default 'created',
  workspace_path text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary text,
  changed_files text[],
  diff_summary text,
  commit_sha text,
  remote_branch text,
  pr_url text,
  git_status text
);

alter table public.ralph_runs add column if not exists commit_sha text;
alter table public.ralph_runs add column if not exists remote_branch text;
alter table public.ralph_runs add column if not exists pr_url text;
alter table public.ralph_runs add column if not exists git_status text;

create table if not exists public.ralph_logs (
  id uuid primary key,
  run_id uuid not null references public.ralph_runs(id) on delete cascade,
  level text not null default 'info',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists ralph_tasks_project_status_idx on public.ralph_tasks(project_id, status);
create index if not exists ralph_runs_task_idx on public.ralph_runs(task_id);
create index if not exists ralph_logs_run_idx on public.ralph_logs(run_id, created_at);

alter table public.ralph_projects enable row level security;
alter table public.ralph_tasks enable row level security;
alter table public.ralph_runs enable row level security;
alter table public.ralph_logs enable row level security;

-- MVP: service role key used server-side only bypasses RLS.
-- Add user-scoped policies before exposing Supabase client to browser.
