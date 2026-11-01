-- FaceAI: migration for teacher/guardian profiles and fixed QR attendance.
-- Apply in Supabase SQL Editor only after reviewing the project backup.
begin;

-- Composite key required by the school-scoped foreign keys below.
create unique index if not exists students_id_school_unique_idx
  on public.students(id, school_id);

create table if not exists public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text,
  email text,
  staff_registration text,
  subjects text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, user_id)
);

create table if not exists public.guardian_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  full_name text not null check (char_length(full_name) between 2 and 120),
  relationship text not null check (char_length(relationship) between 2 and 40),
  phone text,
  email text,
  emergency_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardian_student_school_fk foreign key (student_id, school_id)
    references public.students(id, school_id) on delete cascade
);

create table if not exists public.student_qr_credentials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint qr_student_school_fk foreign key (student_id, school_id)
    references public.students(id, school_id) on delete cascade
);

create index if not exists guardian_profiles_student_idx
  on public.guardian_profiles(student_id);
create index if not exists teacher_profiles_user_idx
  on public.teacher_profiles(user_id);
create index if not exists student_qr_credentials_student_idx
  on public.student_qr_credentials(student_id) where active = true;

alter table public.teacher_profiles enable row level security;
alter table public.guardian_profiles enable row level security;
alter table public.student_qr_credentials enable row level security;

drop policy if exists "admins manage teacher profiles" on public.teacher_profiles;
create policy "admins manage teacher profiles"
  on public.teacher_profiles for all to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists "teachers view own profile" on public.teacher_profiles;
create policy "teachers view own profile"
  on public.teacher_profiles for select to authenticated
  using (user_id = auth.uid() and public.is_school_member(school_id));

drop policy if exists "admins manage guardian profiles" on public.guardian_profiles;
create policy "admins manage guardian profiles"
  on public.guardian_profiles for all to authenticated
  using (public.is_school_admin(school_id))
  with check (public.is_school_admin(school_id));

drop policy if exists "assigned teachers view guardian profiles" on public.guardian_profiles;
create policy "assigned teachers view guardian profiles"
  on public.guardian_profiles for select to authenticated
  using (
    public.is_school_member(school_id)
    and exists (
      select 1 from public.students s
      where s.id = guardian_profiles.student_id
        and s.school_id = guardian_profiles.school_id
        and exists (
          select 1 from public.class_teachers ct
          where ct.school_id = guardian_profiles.school_id
            and ct.class_id = s.class_id
            and ct.teacher_id = auth.uid()
        )
    )
  );

-- QR credentials are never readable by browser clients. Issuance and validation
-- must be performed by authenticated server-side Edge Functions.
drop policy if exists "admins manage student QR credentials" on public.student_qr_credentials;
drop policy if exists "deny client access to student QR credentials" on public.student_qr_credentials;
create policy "deny client access to student QR credentials"
  on public.student_qr_credentials for all to authenticated
  using (false) with check (false);

grant select, insert, update, delete on public.teacher_profiles, public.guardian_profiles to authenticated;
revoke all on public.student_qr_credentials from anon, authenticated;
grant usage on schema public to authenticated;

commit;
