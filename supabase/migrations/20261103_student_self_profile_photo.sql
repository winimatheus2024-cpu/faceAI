-- Permite que cada aluno envie e visualize somente sua própria foto de perfil.
begin;
drop policy if exists "students upload own profile photo" on storage.objects;
create policy "students upload own profile photo" on storage.objects
for insert to authenticated
with check (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and name ~ ('^'||sa.school_id::text||'/'||sa.student_id::text||'/profile  )
);
drop policy if exists "students view own profile photo" on storage.objects;
create policy "students view own profile photo" on storage.objects
for select to authenticated
using (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
);
drop policy if exists "students update own profile photo" on storage.objects;
create policy "students update own profile photo" on storage.objects
for update to authenticated
using (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
)
with check (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
);
commit;
)
  )
);
drop policy if exists "students view own profile photo" on storage.objects;
create policy "students view own profile photo" on storage.objects
for select to authenticated
using (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
);
drop policy if exists "students update own profile photo" on storage.objects;
create policy "students update own profile photo" on storage.objects
for update to authenticated
using (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
)
with check (
  bucket_id='student-photos'
  and exists (
    select 1 from public.student_accounts sa
    where sa.user_id=auth.uid()
      and sa.school_id::text=(storage.foldername(name))[1]
      and sa.student_id::text=(storage.foldername(name))[2]
      and (storage.foldername(name))[3]='profile'
  )
);
commit;
