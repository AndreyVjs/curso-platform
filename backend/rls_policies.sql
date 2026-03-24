-- ============================================================
-- CURSOS LUCRATIVOS — RLS_POLICIES.SQL
-- Fase 1: Row Level Security — Segurança em Nível de Linha
-- Execute este arquivo POR ÚLTIMO, após functions.sql.
-- ============================================================
-- ESTRATÉGIA DE SEGURANÇA:
--   • Admins têm acesso irrestrito a todas as tabelas.
--   • Alunos têm acesso explicitamente limitado.
--   • A função helper get_user_role() lê diretamente do banco
--     (não do JWT), evitando bugs de cache de sessão que
--     afetaram projetos anteriores.
-- ============================================================


-- ============================================================
-- FUNÇÃO HELPER: get_user_role
-- Retorna o role do usuário autenticado ativo.
-- Lê de public.users (não do JWT) para garantir precisão.
-- SECURITY DEFINER para funcionar dentro das policies de RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE       -- Não modifica banco; mesmo resultado para mesma sessão
SET search_path = public
AS $$
    SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, anon;


-- ============================================================
-- ATIVAR RLS EM TODAS AS TABELAS
-- ============================================================

ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- REMOVER POLICIES ANTIGAS (IDEMPOTÊNCIA)
-- ============================================================

-- users
DROP POLICY IF EXISTS "users: admin_all"            ON public.users;
DROP POLICY IF EXISTS "users: student_select_own"   ON public.users;

-- courses
DROP POLICY IF EXISTS "courses: admin_all"          ON public.courses;
DROP POLICY IF EXISTS "courses: student_select_active" ON public.courses;

-- enrollments
DROP POLICY IF EXISTS "enrollments: admin_all"      ON public.enrollments;
DROP POLICY IF EXISTS "enrollments: student_select_own" ON public.enrollments;


-- ============================================================
-- POLICIES: TABELA users
-- ============================================================

-- Admins: acesso total (CRUD)
CREATE POLICY "users: admin_all"
    ON public.users
    FOR ALL
    TO authenticated
    USING      (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

-- Alunos: podem ler APENAS o próprio perfil
CREATE POLICY "users: student_select_own"
    ON public.users
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = id
        AND public.get_user_role() = 'student'
    );


-- ============================================================
-- POLICIES: TABELA courses
-- ============================================================

-- Admins: acesso total (CRUD)
CREATE POLICY "courses: admin_all"
    ON public.courses
    FOR ALL
    TO authenticated
    USING      (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

-- Alunos: podem ler APENAS cursos com active = TRUE
CREATE POLICY "courses: student_select_active"
    ON public.courses
    FOR SELECT
    TO authenticated
    USING (
        active = TRUE
        AND public.get_user_role() = 'student'
    );

-- Visitantes (anon): podem ler cursos ativos para o catálogo público
DROP POLICY IF EXISTS "courses: anon_select_active" ON public.courses;
CREATE POLICY "courses: anon_select_active"
    ON public.courses
    FOR SELECT
    TO anon
    USING (active = TRUE);


-- ============================================================
-- POLICIES: TABELA enrollments
-- ============================================================

-- Admins: acesso total (CRUD)
CREATE POLICY "enrollments: admin_all"
    ON public.enrollments
    FOR ALL
    TO authenticated
    USING      (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

-- Alunos: podem ver APENAS suas próprias matrículas
CREATE POLICY "enrollments: student_select_own"
    ON public.enrollments
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        AND public.get_user_role() = 'student'
    );


-- ============================================================
-- STORAGE: CONFIGURAÇÃO DOS BUCKETS
-- ============================================================
-- IMPORTANTE: Execute manualmente no Supabase Dashboard em:
--  Storage → New Bucket
--
-- Bucket 1: course_assets
--   • Nome:    course_assets
--   • Público: SIM (toggle Public = ON)
--   • Usado para: capas dos cursos (imagens)
--
-- Bucket 2: course_files
--   • Nome:    course_files
--   • Público: NÃO (toggle Public = OFF)
--   • Usado para: PDFs/ebooks (acesso controlado por signed URL)
-- ============================================================


-- ============================================================
-- STORAGE RLS — POLICIES DO BUCKET course_assets (Público)
-- ============================================================
-- Nota: Para buckets públicos do Supabase, as policies de
-- storage geralmente não são necessárias para leitura.
-- Mas garantimos que APENAS admins possam fazer upload.
-- ============================================================

-- Permite Admins fazerem upload de capas
INSERT INTO storage.buckets (id, name, public)
VALUES ('course_assets', 'course_assets', TRUE)
ON CONFLICT (id) DO UPDATE SET public = TRUE;

DROP POLICY IF EXISTS "course_assets: admin_upload" ON storage.objects;
DROP POLICY IF EXISTS "course_assets: public_read"  ON storage.objects;

CREATE POLICY "course_assets: admin_upload"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'course_assets'
        AND public.get_user_role() = 'admin'
    );

CREATE POLICY "course_assets: admin_update"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'course_assets'
        AND public.get_user_role() = 'admin'
    );

CREATE POLICY "course_assets: admin_delete"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'course_assets'
        AND public.get_user_role() = 'admin'
    );

-- Leitura pública (qualquer um pode ver capas)
CREATE POLICY "course_assets: public_read"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'course_assets');


-- ============================================================
-- STORAGE RLS — POLICIES DO BUCKET course_files (PRIVADO)
-- ============================================================
-- PDFs são protegidos. Acesso apenas via Signed URLs geradas
-- pelo backend JS após verificação de matrícula em enrollments.
-- Admins podem fazer upload e download direto.
-- Alunos: o download ocorre via createSignedUrl no JS,
--         que valida a matrícula antes de gerar a URL.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('course_files', 'course_files', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS "course_files: admin_all"           ON storage.objects;
DROP POLICY IF EXISTS "course_files: enrolled_student_read" ON storage.objects;

-- Admins: acesso total ao bucket privado
CREATE POLICY "course_files: admin_all"
    ON storage.objects
    FOR ALL
    TO authenticated
    USING (
        bucket_id = 'course_files'
        AND public.get_user_role() = 'admin'
    )
    WITH CHECK (
        bucket_id = 'course_files'
        AND public.get_user_role() = 'admin'
    );

-- Alunos matriculados: podem SELECIONAR (necessário para createSignedUrl funcionar)
-- A verificação de matrícula é feita via o nome do arquivo:
-- Padrão do path: pdfs/{course_id}/{filename}.pdf
-- A subquery abaixo extrai o course_id do path e verifica enrollment.
CREATE POLICY "course_files: enrolled_student_read"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'course_files'
        AND public.get_user_role() = 'student'
        AND EXISTS (
            SELECT 1
            FROM public.enrollments e
            INNER JOIN public.courses c ON c.id = e.course_id
            WHERE e.user_id = auth.uid()
              AND c.pdf_file_path = storage.objects.name
              AND c.active = TRUE
        )
    );


-- ============================================================
-- SEED: CRIAR USUÁRIO ADMIN INICIAL
-- ============================================================
-- ATENÇÃO: Substitua os valores abaixo pelos dados reais do
--          primeiro admin da plataforma ANTES de executar.
--
-- OPÇÃO A (Recomendada): Crie o admin pelo Supabase Dashboard:
--   Authentication → Users → Invite User (ou Add User)
--   Depois execute o UPDATE abaixo para promovê-lo a admin:
--
--   UPDATE public.users
--   SET role = 'admin'
--   WHERE email = 'SEU_EMAIL_ADMIN@exemplo.com';
--
-- OPÇÃO B: Se quiser criar via SQL direto (Supabase permite):
--   1. Vá em Authentication → Users → Add User → Set Password
--   2. Execute o UPDATE de role acima.
-- ============================================================

-- Descomente e ajuste os valores abaixo se quiser fazer via SQL puro:
/*
DO $$
DECLARE
    v_admin_id UUID;
BEGIN
    -- Substitua pelo UUID do usuário criado no Auth Dashboard
    v_admin_id := 'COLE_AQUI_O_UUID_DO_ADMIN'::UUID;

    UPDATE public.users
    SET role = 'admin'
    WHERE id = v_admin_id;

    RAISE NOTICE 'Admin promovido com sucesso: %', v_admin_id;
END;
$$;
*/

-- ============================================================
-- VERIFICAÇÃO FINAL
-- ============================================================
-- Execute as queries abaixo para confirmar que tudo foi criado:
--
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename IN ('users','courses','enrollments');
-- (rowsecurity deve ser TRUE para todas)
--
-- SELECT schemaname, tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;
-- (Deve listar 6 policies: 2 por tabela)
-- ============================================================
