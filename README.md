# FaceAI Online — pacote inicial

Este pacote transforma o protótipo local em uma aplicação web conectada ao Supabase. O projeto inclui:
- autenticação por e-mail e senha;
- múltiplas escolas por usuário;
- papéis `admin` e `teacher`;
- cadastro de turmas e alunos;
- chamada manual;
- relatório com exportação CSV;
- políticas iniciais de segurança por escola (RLS).

## Importante
Esta versão **não armazena rostos, fotos ou modelos biométricos**. A chamada é manual. Dados de estudantes, especialmente crianças e adolescentes, exigem avaliação da escola, base legal adequada, transparência, minimização e controles de acesso conforme a LGPD. O pacote é um ponto de partida técnico, não uma auditoria de segurança nem aconselhamento jurídico.

O login e a senha são gerenciados pelo Supabase Auth. Nunca coloque uma chave `service_role` no navegador. Use somente a chave `anon`/public no `config.js`.

## 1. Criar o banco online
1. Crie um projeto em https://supabase.com/.
2. Abra **SQL Editor** no painel do projeto.
3. Copie e execute todo o conteúdo de `supabase/schema.sql`.
4. Em **Project Settings → API**, copie a Project URL e a chave `anon`/public.

## 2. Configurar a aplicação
1. Abra `public/config.js`.
2. Substitua os dois valores de exemplo pela URL e pela chave `anon`/public do Supabase.
3. Não compartilhe a chave `service_role`.

## 3. Testar localmente
A câmera não é necessária nesta versão. Para testar a página, sirva a pasta `public` com um servidor local, por exemplo:
- Python: `python -m http.server 8000 --directory public`
- depois abra `http://localhost:8000`.

Também é possível hospedar a pasta `public` em um serviço estático como Vercel ou Netlify.

## 4. Primeiro acesso e escola
1. Crie sua conta pela tela inicial.
2. Se a confirmação de e-mail estiver habilitada no Supabase, confirme o e-mail antes de entrar.
3. Entre e clique em **Criar escola**. O banco cria automaticamente seu vínculo como administrador.
4. Cadastre turmas e alunos e registre as chamadas.

## 5. Adicionar professores
Nesta versão inicial, o professor cria sua própria conta pelo botão **Criar conta**. Para vinculá-lo à escola:
1. O professor deve confirmar o e-mail e entrar uma vez para que exista no Auth.
2. No Supabase, abra **Authentication → Users** e copie o UUID desse usuário.
3. No SQL Editor, execute, substituindo os valores:

```sql
insert into public.school_members (school_id, user_id, role)
values ('UUID-DA-ESCOLA', 'UUID-DO-PROFESSOR', 'teacher')
on conflict (school_id, user_id) do update set role = excluded.role;
```

O UUID da escola pode ser consultado em **Table Editor → schools**. Faça esse procedimento somente para pessoas autorizadas.

## 6. Publicar na internet
- Vercel: importe o projeto/repositório e defina a pasta de saída como `public`, ou faça deploy de um projeto estático com `public` como raiz.
- Netlify: arraste a pasta `public` para o deploy manual ou conecte o repositório com diretório de publicação `public`.

Configure também no Supabase **Authentication → URL Configuration** a URL pública do site e os redirects permitidos.

## Limitações desta versão
- O app ainda não tem convites automáticos por e-mail nem recuperação de senha na interface.
- A interface de equipe mostra os membros; o vínculo de professores é feito pelo painel Supabase.
- A aplicação não implementa logs avançados, backups automáticos, monitoramento ou revisão independente de segurança.
- O Supabase Auth pode exigir confirmação de e-mail conforme a configuração do projeto.
- Para uso institucional, faça testes, revisão das políticas RLS e avaliação de privacidade antes de inserir dados reais.
