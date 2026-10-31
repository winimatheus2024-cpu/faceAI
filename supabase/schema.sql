-- FaceAI Online: esquema inicial para Supabase
-- Execute no SQL Editor do seu projeto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.school_members (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','teacher')),
  created_at timestamptz not null default now(),
  unique (school_id,user_id)
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  shift text not null default 'Matutino',
  created_at timestamptz not null default now(),
  unique (school_id,name),
  unique (id,school_id)
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid,
  name text not null check (char_length(name) between 1 and 120),
  registration text,
  created_at timestamptz not null default now(),
  unique (school_id,registration),
  constraint students_class_school_fk foreign key (class_id,school_id)
    references public.classes(id,school_id) on delete restrict
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  date date not null,
  status text not null check (status in ('Presente','Ausente','Justificado')),
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (student_id,date)
);

create or replace function public.is_school_member(target_school uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.school_members m where m.school_id=target_school and m.user_id=auth.uid()) $$;

create or replace function public.is_school_admin(target_school uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.school_members m where m.school_id=target_school and m.user_id=auth.uid() and m.role='admin') $$;

create or replace function public.add_school_creator_as_admin()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.school_members(school_id,user_id,role) values(new.id,new.created_by,'admin');
  return new;
end $$;

drop trigger if exists school_creator_membership on public.schools;
create trigger school_creator_membership after insert on public.schools
for each row execute function public.add_school_creator_as_admin();

alter table public.schools enable row level security;
alter table public.school_members enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "school members can view schools" on public.schools;
create policy "school members can view schools" on public.schools for select to authenticated
using (public.is_school_member(id));
drop policy if exists "authenticated users can create school" on public.schools;
create policy "authenticated users can create school" on public.schools for insert to authenticated
with check (created_by=auth.uid());

drop policy if exists "members can view membership" on public.school_members;
create policy "members can view membership" on public.school_members for select to authenticated
using (user_id=auth.uid() or public.is_school_admin(school_id));
drop policy if exists "admins can add members" on public.school_members;
create policy "admins can add members" on public.school_members for insert to authenticated
with check (public.is_school_admin(school_id));
drop policy if exists "admins can remove members" on public.school_members;
create policy "admins can remove members" on public.school_members for delete to authenticated
using (public.is_school_admin(school_id));

drop policy if exists "members read classes" on public.classes;
create policy "members read classes" on public.classes for select to authenticated using(public.is_school_member(school_id));
drop policy if exists "staff add classes" on public.classes;
create policy "staff add classes" on public.classes for insert to authenticated with check(public.is_school_member(school_id));
drop policy if exists "admins update classes" on public.classes;
create policy "admins update classes" on public.classes for update to authenticated using(public.is_school_admin(school_id)) with check(public.is_school_admin(school_id));
drop policy if exists "admins delete classes" on public.classes;
create policy "admins delete classes" on public.classes for delete to authenticated using(public.is_school_admin(school_id));

drop policy if exists "members read students" on public.students;
create policy "members read students" on public.students for select to authenticated using(public.is_school_member(school_id));
drop policy if exists "staff add students" on public.students;
create policy "staff add students" on public.students for insert to authenticated with check(public.is_school_member(school_id));
drop policy if exists "admins update students" on public.students;
create policy "admins update students" on public.students for update to authenticated using(public.is_school_admin(school_id)) with check(public.is_school_admin(school_id));
drop policy if exists "admins delete students" on public.students;
create policy "admins delete students" on public.students for delete to authenticated using(public.is_school_admin(school_id));

drop policy if exists "members read attendance" on public.attendance;
create policy "members read attendance" on public.attendance for select to authenticated using(public.is_school_member(school_id));
drop policy if exists "staff record attendance" on public.attendance;
create policy "staff record attendance" on public.attendance for insert to authenticated with check(public.is_school_member(school_id) and recorded_by=auth.uid());
drop policy if exists "staff update attendance" on public.attendance;
create policy "staff update attendance" on public.attendance for update to authenticated using(public.is_school_member(school_id)) with check(public.is_school_member(school_id) and recorded_by=auth.uid());
drop policy if exists "admins delete attendance" on public.attendance;
create policy "admins delete attendance" on public.attendance for delete to authenticated using(public.is_school_admin(school_id));

-- Necessário para a consulta da lista de escolas e da equipe.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.schools, public.school_members, public.classes, public.students, public.attendance to authenticated;
