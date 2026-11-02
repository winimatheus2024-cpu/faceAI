-- Foto de identificação escolar: bucket privado e acesso limitado à escola.
begin;
alter table public.students add column if not exists photo_path text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('student-photos','student-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "school members view student photos" on storage.objects;
create policy "school members view student photos" on storage.objects for select to authenticated
using (bucket_id='student-photos' and public.is_school_member((storage.foldername(name))[1]::uuid));
drop policy if exists "school admins upload student photos" on storage.objects;
create policy "school admins upload student photos" on storage.objects for insert to authenticated
with check (bucket_id='student-photos' and public.is_school_admin((storage.foldername(name))[1]::uuid));
drop policy if exists "school admins update student photos" on storage.objects;
create policy "school admins update student photos" on storage.objects for update to authenticated
using (bucket_id='student-photos' and public.is_school_admin((storage.foldername(name))[1]::uuid))
with check (bucket_id='student-photos' and public.is_school_admin((storage.foldername(name))[1]::uuid));
drop policy if exists "school admins delete student photos" on storage.objects;
create policy "school admins delete student photos" on storage.objects for delete to authenticated
using (bucket_id='student-photos' and public.is_school_admin((storage.foldername(name))[1]::uuid));
commit;
