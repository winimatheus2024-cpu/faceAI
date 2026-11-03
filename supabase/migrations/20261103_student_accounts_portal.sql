-- Student login mapping and row-level access for the private student portal.
begin;

create unique index if not exists students_id_school_unique_idx
  on public.students(id, school_id);

create table if not exists public.student_accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),
  constraint student_accounts_student_unique unique (student_id),
  constraint student_accounts_student_school_fk
    foreign key (student_id, school_id)
    references public.students(id, school_id) on delete cascade,
  constraint student_accounts_username_format
    check (username ~ '^[a-z0-9_]{3,32}$')
);

create unique index if not exists student_accounts_username_unique_idx on public.student_accounts(lower(username));

create or replace function public.is_linked_student(target_student uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.student_accounts sa
    where sa.student_id = target_student and sa.user_id = auth.uid()
  );
$$;

create or replace function public.is_linked_student_class(target_class uuid, target_school uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.student_accounts sa
    join public.students s on s.id = sa.student_id and s.school_id = sa.school_id
    where sa.user_id = auth.uid()
      and sa.school_id = target_school
      and s.class_id = target_class
  );
$$;

alter table public.student_accounts enable row level security;

drop policy if exists "students read own account" on public.student_accounts;
create policy "students read own account"
  on public.student_accounts for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admins manage student accounts" on public.student_accounts;
create policy "admins manage student accounts"
  on public.student_accounts for all to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists "students read own student record" on public.students;
create policy "students read own student record"
  on public.students for select to authenticated
  using (public.is_linked_student(id));

drop policy if exists "students read own class" on public.classes;
create policy "students read own class"
  on public.classes for select to authenticated
  using (public.is_linked_student_class(id, school_id));

drop policy if exists "students read own attendance" on public.attendance;
create policy "students read own attendance"
  on public.attendance for select to authenticated
  using (public.is_linked_student(student_id));

grant select, insert, update, delete on public.student_accounts to authenticated;
grant execute on function public.is_linked_student(uuid) to authenticated;
grant execute on function public.is_linked_student_class(uuid, uuid) to authenticated;

commit;
