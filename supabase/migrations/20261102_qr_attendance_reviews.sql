-- Persistent manual review queue for QR attendance.
begin;

-- Required composite key for the school-scoped student foreign key.
create unique index if not exists students_id_school_unique_idx
  on public.students(id, school_id);
create table if not exists public.qr_attendance_reviews (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null,
  scanned_by uuid not null references auth.users(id),
  attendance_date date not null,
  reason text not null check (reason in ('student_without_class','teacher_not_assigned')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint qr_review_student_school_fk foreign key (student_id,school_id)
    references public.students(id,school_id) on delete cascade
);
create unique index if not exists qr_attendance_reviews_one_pending_idx
  on public.qr_attendance_reviews(student_id,attendance_date)
  where status='pending';
create index if not exists qr_attendance_reviews_school_status_idx
  on public.qr_attendance_reviews(school_id,status,created_at desc);
alter table public.qr_attendance_reviews enable row level security;
drop policy if exists "deny client access to QR attendance reviews" on public.qr_attendance_reviews;
create policy "deny client access to QR attendance reviews"
  on public.qr_attendance_reviews for all to authenticated
  using (false) with check (false);
revoke all on public.qr_attendance_reviews from anon,authenticated;
commit;
