create extension if not exists pgcrypto;

-- Personal DBs use (company_id, code) uniqueness on app_pages / role permissions.
insert into public.app_pages (company_id, code, name, sort_order, is_active, updated_at)
select companies.id, 'designations', 'Designations', 122, true, now()
from public.companies
where companies.is_active = true
  and not exists (
    select 1
    from public.app_pages pages
    where pages.company_id = companies.id
      and pages.code = 'designations'
  );

update public.app_pages
set name = 'Designations',
    sort_order = 122,
    is_active = true,
    updated_at = now()
where code = 'designations';

insert into public.role_page_permissions (company_id, role_id, page_id, can_view, can_add, can_edit, updated_at)
select roles.company_id, roles.id, pages.id, true, true, true, now()
from public.user_roles roles
join public.app_pages pages
  on pages.company_id = roles.company_id
 and pages.code = 'designations'
where lower(roles.code) = 'owner'
  and not exists (
    select 1
    from public.role_page_permissions existing
    where existing.role_id = roles.id
      and existing.page_id = pages.id
  );

create table if not exists public.designations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  provider_ids uuid[] not null default '{}',
  model_ids uuid[] not null default '{}',
  onboarding_categories text[] not null default array['employees']::text[],
  profile_field_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.designations
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists model_ids uuid[] not null default '{}',
  add column if not exists profile_field_rules jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_categories text[] not null default array['employees']::text[],
  add column if not exists provider_ids uuid[] not null default '{}';

-- Prefer company-scoped uniqueness when company_id is present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'designations_company_code_key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'designations' and column_name = 'company_id'
  ) then
    begin
      alter table public.designations drop constraint if exists designations_code_key;
    exception when undefined_object then
      null;
    end;
    create unique index if not exists designations_company_code_key
      on public.designations (company_id, code);
  elsif not exists (
    select 1
    from pg_constraint
    where conname in ('designations_code_key')
  ) and not exists (
    select 1 from pg_indexes where indexname = 'designations_company_code_key'
  ) then
    create unique index if not exists designations_code_key on public.designations (code);
  end if;
end $$;

create index if not exists designations_provider_ids_idx
  on public.designations using gin(provider_ids);

create index if not exists designations_model_ids_idx
  on public.designations using gin(model_ids);

create index if not exists designations_onboarding_categories_idx
  on public.designations using gin(onboarding_categories);

alter table public.designations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'designations'
      and policyname = 'service_role_designations_all'
  ) then
    create policy "service_role_designations_all"
      on public.designations
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- Seed from lead_job_roles only when that table exists.
do $$
begin
  if to_regclass('public.lead_job_roles') is not null then
    insert into public.designations (company_id, code, name, provider_ids, is_active, updated_at)
    select
      coalesce(roles.company_id, companies.id),
      roles.code,
      roles.name,
      '{}'::uuid[],
      true,
      now()
    from public.lead_job_roles roles
    cross join lateral (
      select id from public.companies where is_active = true order by created_at limit 1
    ) companies
    where coalesce(roles.is_active, true) = true
    on conflict do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';
