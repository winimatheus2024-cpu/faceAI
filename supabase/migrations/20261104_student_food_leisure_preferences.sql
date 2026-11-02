-- Preferências simples para a ficha técnica do aluno.
begin;
alter table public.students
  add column if not exists food_preference text,
  add column if not exists leisure_preference text;
commit;
