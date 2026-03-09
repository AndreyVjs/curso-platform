-- ============================================================
-- CURSO PLATFORM — FUNCTIONS.SQL
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
