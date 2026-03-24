-- ============================================================
-- CURSOS LUCRATIVOS — SCHEMA.SQL
-- Fase 1: Criação das Tabelas, Extensões e Configurações Base
-- Execute este arquivo PRIMEIRO no SQL Editor do Supabase.
-- ============================================================

-- --------------------------------------------------------
-- 1. EXTENSÕES NECESSÁRIAS
-- --------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------------------
-- 2. TABELA: users
-- Perfil público estendido que espelha auth.users.
-- Criado automaticamente pelo trigger após signup.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name   TEXT        NOT NULL,
    email       TEXT        UNIQUE NOT NULL,
    role        TEXT        NOT NULL DEFAULT 'student'
                            CHECK (role IN ('admin', 'student')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS 'Perfil estendido dos usuários da plataforma.';
COMMENT ON COLUMN public.users.role IS 'admin = dono da plataforma; student = aluno consumidor.';

-- --------------------------------------------------------
-- 3. TABELA: courses
-- Catálogo de cursos/ebooks da plataforma.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courses (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    title            TEXT        NOT NULL,
    description      TEXT,
    cover_image_path TEXT,       -- Caminho no bucket: course_assets
    pdf_file_path    TEXT,       -- Caminho no bucket: course_files (privado)
    active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.courses IS 'Catálogo de cursos e ebooks disponíveis na plataforma.';
COMMENT ON COLUMN public.courses.cover_image_path IS 'Path no bucket público course_assets (ex: covers/uuid.jpg).';
COMMENT ON COLUMN public.courses.pdf_file_path IS 'Path no bucket PRIVADO course_files (ex: pdfs/uuid.pdf).';

-- --------------------------------------------------------
-- 4. TABELA: enrollments
-- Matrículas: vínculo entre aluno e curso (liberação de acesso).
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enrollments (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    course_id   UUID        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    granted_by  UUID        REFERENCES public.users(id) ON DELETE SET NULL,  -- Admin que liberou
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Garante que um aluno não seja matriculado duas vezes no mesmo curso
    CONSTRAINT enrollments_unique_user_course UNIQUE (user_id, course_id)
);

COMMENT ON TABLE public.enrollments IS 'Tabela relacional de matrículas. Cada linha = um aluno com acesso a um curso.';
COMMENT ON COLUMN public.enrollments.granted_by IS 'UUID do Admin que liberou o acesso. Auditoria.';

-- --------------------------------------------------------
-- 5. ÍNDICES DE PERFORMANCE
-- --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_enrollments_user_id   ON public.enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON public.enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_users_role            ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_courses_active        ON public.courses(active);


--- INICIO DE ARQUIVO ---

-- ============================================================
-- CURSOS LUCRATIVOS — TRIGGERS.SQL
-- Fase 1: Automações de Banco de Dados
-- Execute este arquivo APÓS schema.sql.
-- ============================================================


-- --------------------------------------------------------
-- TRIGGER 1: Sincronizar auth.users → public.users
-- OBJETIVO: Sempre que um usuário for criado no Supabase Auth,
--           criar automaticamente um perfil em public.users.
--           Funciona tanto para signup normal quanto para RPCs
--           que usam o service_role (criação pelo Admin).
-- --------------------------------------------------------

-- Função que o trigger chamará
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Roda com privilégios do owner (superuser), necessário para burlar RLS no insert
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
    v_role      TEXT;
BEGIN
    -- Extrai metadados passados no signup (raw_user_meta_data)
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)  -- Fallback: parte antes do @ do email
    );

    v_role := COALESCE(
        NEW.raw_user_meta_data->>'role',
        'student'  -- Role padrão se não especificado
    );

    -- Valida role para evitar injeção de valores inválidos
    IF v_role NOT IN ('admin', 'student') THEN
        v_role := 'student';
    END IF;

    INSERT INTO public.users (id, full_name, email, role, created_at)
    VALUES (
        NEW.id,
        v_full_name,
        NEW.email,
        v_role,
        NOW()
    )
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            email     = EXCLUDED.email,
            role      = EXCLUDED.role;
    -- ON CONFLICT: Garante idempotência. Se o perfil já existir (ex: re-trigger), atualiza.

    RETURN NEW;
END;
$$;

-- Remove o trigger anterior para garantir idempotência do script
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Cria o trigger que dispara APÓS INSERT em auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION public.handle_new_auth_user() IS
    'Gerado automaticamente: cria perfil em public.users após criação no auth.users.';


-- --------------------------------------------------------
-- TRIGGER 2: Sincronizar email ao atualizar auth.users
-- OBJETIVO: Se o email mudar no Auth, reflete em public.users
-- --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_auth_user_email_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF OLD.email IS DISTINCT FROM NEW.email THEN
        UPDATE public.users
        SET email = NEW.email
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;

CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auth_user_email_update();


--- INICIO DE ARQUIVO ---

-- ============================================================
-- CURSOS LUCRATIVOS — FUNCTIONS.SQL
-- Fase 1: RPCs (Remote Procedure Calls) em PL/pgSQL
-- Execute este arquivo APÓS triggers.sql.
-- ATENÇÃO: Estas funções usam SECURITY DEFINER e acessam
--          auth.users. Requerem que a role 'service_role'
--          seja proprietária OU que vc execute via SQL Editor
--          como superuser no Supabase.
-- ============================================================


-- ============================================================
-- RPC 1: admin_create_user
-- OBJETIVO CRÍTICO: Permitir que o Admin crie contas de alunos
--                  SEM deslogar a sessão atual do Admin.
-- PROBLEMA RESOLVIDO: supabase.auth.signUp() no frontend
--                     derruba a sessão do Admin. Esta função
--                     cria o usuário diretamente no banco via
--                     auth.users, contornando o problema.
-- SEGURANÇA: Apenas Admins podem chamar esta função (validado
--            internamente pelo check de role).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_create_user(
    p_email     TEXT,
    p_password  TEXT,
    p_full_name TEXT,
    p_role      TEXT DEFAULT 'student'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- ← CRÍTICO: Roda com privilégios de superuser
SET search_path = public
AS $$
DECLARE
    v_caller_role   TEXT;
    v_caller_id     UUID;
    v_new_user_id   UUID;
    v_hashed_pw     TEXT;
    v_result        JSONB;
BEGIN
    -- ── PASSO 1: Verificar se quem chama é Admin ──────────────
    v_caller_id := auth.uid();

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você precisa estar autenticado para executar esta ação.';
    END IF;

    SELECT role INTO v_caller_role
    FROM public.users
    WHERE id = v_caller_id;

    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Apenas administradores podem criar usuários.';
    END IF;

    -- ── PASSO 2: Validações de entrada ────────────────────────
    IF p_email IS NULL OR trim(p_email) = '' THEN
        RAISE EXCEPTION 'VALIDATION: Email é obrigatório.';
    END IF;

    IF p_password IS NULL OR length(p_password) < 6 THEN
        RAISE EXCEPTION 'VALIDATION: Senha deve ter no mínimo 6 caracteres.';
    END IF;

    IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
        RAISE EXCEPTION 'VALIDATION: Nome completo é obrigatório.';
    END IF;

    IF p_role NOT IN ('admin', 'student') THEN
        RAISE EXCEPTION 'VALIDATION: Role inválido. Use "admin" ou "student".';
    END IF;

    -- Verificar se email já existe
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
        RAISE EXCEPTION 'CONFLICT: Este email já está cadastrado na plataforma.';
    END IF;

    -- ── PASSO 3: Criar usuário diretamente em auth.users ─────
    -- Gera um UUID para o novo usuário
    v_new_user_id := uuid_generate_v4();

    -- Hash da senha usando bcrypt (função nativa do Supabase/pgcrypto)
    v_hashed_pw := crypt(p_password, gen_salt('bf'));

    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,   -- Confirma email imediatamente (Admin-created = trusted)
        raw_user_meta_data,
        role,
        aud,
        created_at,
        updated_at
    )
    VALUES (
        v_new_user_id,
        '00000000-0000-0000-0000-000000000000',  -- Instance ID padrão do Supabase
        lower(trim(p_email)),
        v_hashed_pw,
        NOW(),                                    -- Email confirmado imediatamente
        jsonb_build_object(
            'full_name', p_full_name,
            'role', p_role
        ),
        'authenticated',
        'authenticated',
        NOW(),
        NOW()
    );

    -- ── PASSO 4: Inserir/garantir perfil em public.users ─────
    -- O trigger handle_new_auth_user() deveria cuidar disso,
    -- mas fazemos manualmente como fallback de segurança.
    INSERT INTO public.users (id, full_name, email, role, created_at)
    VALUES (v_new_user_id, trim(p_full_name), lower(trim(p_email)), p_role, NOW())
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            role      = EXCLUDED.role;

    -- ── PASSO 5: Retornar resposta de sucesso ─────────────────
    v_result := jsonb_build_object(
        'success', true,
        'user_id', v_new_user_id,
        'email',   lower(trim(p_email)),
        'role',    p_role,
        'message', 'Usuário criado com sucesso.'
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN
        -- Propaga o erro com a mensagem original para o frontend tratar
        RAISE EXCEPTION '%', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) IS
    'RPC segura para Admin criar usuários sem derrubar sua própria sessão JWT.
     Usa SECURITY DEFINER para escrever em auth.users diretamente.
     Apenas usuários com role=admin podem chamar com sucesso.';

-- Concede execução apenas para roles autenticadas
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================
-- RPC 2: admin_delete_user
-- OBJETIVO: Deletar um usuário completamente do auth.users
--           e public.users (CASCADE cuida das enrollments).
-- SEGURANÇA: Apenas Admins podem executar.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_delete_user(
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role   TEXT;
    v_caller_id     UUID;
    v_target_email  TEXT;
BEGIN
    -- Verificar se quem chama é Admin
    v_caller_id := auth.uid();

    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Autenticação necessária.';
    END IF;

    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;

    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Apenas administradores podem deletar usuários.';
    END IF;

    -- Impede auto-deleção
    IF p_target_user_id = v_caller_id THEN
        RAISE EXCEPTION 'INVALID: Você não pode deletar sua própria conta por aqui.';
    END IF;

    -- Captura email para a resposta
    SELECT email INTO v_target_email
    FROM auth.users WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: Usuário não encontrado.';
    END IF;

    -- Deleta do auth.users — CASCADE derruba public.users e enrollments
    DELETE FROM auth.users WHERE id = p_target_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_email', v_target_email,
        'message', 'Usuário deletado permanentemente.'
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '%', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;


-- ============================================================
-- RPC 3: get_my_enrolled_courses
-- OBJETIVO: Retorna os cursos ativos nos quais o usuário
--           logado está matriculado. Usado no Student Dashboard.
--           Feito via RPC para garantir que a lógica de join
--           entre enrollments+courses aconteça server-side.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_enrolled_courses()
RETURNS TABLE (
    course_id        UUID,
    title            TEXT,
    description      TEXT,
    cover_image_path TEXT,
    pdf_file_path    TEXT,
    granted_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id            AS course_id,
        c.title,
        c.description,
        c.cover_image_path,
        c.pdf_file_path,
        e.granted_at
    FROM public.enrollments e
    INNER JOIN public.courses c ON c.id = e.course_id
    WHERE
        e.user_id = auth.uid()
        AND c.active = TRUE
    ORDER BY e.granted_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_enrolled_courses() TO authenticated;


-- ============================================================
-- RPC 4: check_course_access
-- OBJETIVO: Verificar se o usuário logado tem acesso a um
--           curso específico. Usado em course-view.html antes
--           de gerar a URL assinada do PDF.
-- RETORNO: TRUE se tiver acesso, FALSE se não tiver.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_course_access(
    p_course_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   UUID;
    v_caller_role TEXT;
    v_has_access  BOOLEAN;
BEGIN
    v_caller_id := auth.uid();

    IF v_caller_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Admins têm acesso universal
    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role = 'admin' THEN
        RETURN TRUE;
    END IF;

    -- Para alunos: verificar matrícula
    SELECT EXISTS (
        SELECT 1
        FROM public.enrollments e
        INNER JOIN public.courses c ON c.id = e.course_id
        WHERE e.user_id = v_caller_id
          AND e.course_id = p_course_id
          AND c.active = TRUE
    ) INTO v_has_access;

    RETURN v_has_access;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_course_access(UUID) TO authenticated;


-- ============================================================
-- RPC 5: get_admin_stats
-- OBJETIVO: Retorna métricas para o dashboard do Admin
--           (total alunos, total cursos, total matrículas).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role   TEXT;
    v_total_students INT;
    v_total_courses  INT;
    v_total_enrollments INT;
BEGIN
    -- Apenas admins podem ver as stats
    SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Acesso negado.';
    END IF;

    SELECT COUNT(*) INTO v_total_students   FROM public.users WHERE role = 'student';
    SELECT COUNT(*) INTO v_total_courses    FROM public.courses WHERE active = TRUE;
    SELECT COUNT(*) INTO v_total_enrollments FROM public.enrollments;

    RETURN jsonb_build_object(
        'total_students',    v_total_students,
        'total_courses',     v_total_courses,
        'total_enrollments', v_total_enrollments
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;


--- INICIO DE ARQUIVO ---

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
-- (Sem filtro de matrícula aqui — o JS + RPC fazem isso.
--  RLS aqui garante que cursos inativos nunca vazem.)
CREATE POLICY "courses: student_select_active"
    ON public.courses
    FOR SELECT
    TO authenticated
    USING (
        active = TRUE
        AND public.get_user_role() = 'student'
    );


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
