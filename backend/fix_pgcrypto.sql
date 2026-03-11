-- ============================================================
-- HOTFIX DEFINITIVO v3
-- Corrige TODOS os problemas de login de alunos criados pelo admin
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================

-- 1) Garantir extensão pgcrypto
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA extensions;

-- 2) Corrigir usuários existentes SEM identity (para poderem logar)
-- Usa o UUID do usuário como provider_id (formato correto do GoTrue v2)
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT
    gen_random_uuid(),
    au.id,
    jsonb_build_object(
        'sub', au.id::TEXT,
        'email', au.email,
        'email_verified', true
    ),
    'email',
    au.id::TEXT,
    NOW(),
    au.created_at,
    NOW()
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities ai
    WHERE ai.user_id = au.id AND ai.provider = 'email'
);

-- 3) Recriar admin_create_user — VERSÃO CORRIGIDA E TESTADA
DROP FUNCTION IF EXISTS public.admin_create_user(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_create_user(
    p_email     TEXT,
    p_password  TEXT,
    p_full_name TEXT,
    p_role      TEXT DEFAULT 'student'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role   TEXT;
    v_caller_id     UUID;
    v_new_user_id   UUID;
    v_hashed_pw     TEXT;
BEGIN
    -- Verificar permissão
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Autenticação necessária.';
    END IF;

    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Apenas administradores.';
    END IF;

    -- Validações
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
        RAISE EXCEPTION 'VALIDATION: Role inválido.';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
        RAISE EXCEPTION 'CONFLICT: Este email já está cadastrado.';
    END IF;

    v_new_user_id := gen_random_uuid();
    v_hashed_pw := crypt(p_password, gen_salt('bf'));

    -- 1) Inserir em auth.users
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_user_meta_data,
        raw_app_meta_data,
        role,
        aud,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
    )
    VALUES (
        v_new_user_id,
        '00000000-0000-0000-0000-000000000000',
        lower(trim(p_email)),
        v_hashed_pw,
        NOW(),
        jsonb_build_object('full_name', p_full_name, 'role', p_role),
        jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
        'authenticated',
        'authenticated',
        NOW(),
        NOW(),
        '',
        '',
        '',
        ''
    );

    -- 2) Inserir em auth.identities (OBRIGATÓRIO para login)
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
    )
    VALUES (
        gen_random_uuid(),
        v_new_user_id,
        jsonb_build_object(
            'sub', v_new_user_id::TEXT,
            'email', lower(trim(p_email)),
            'email_verified', true,
            'full_name', p_full_name
        ),
        'email',
        v_new_user_id::TEXT,
        NOW(),
        NOW(),
        NOW()
    );

    -- 3) Inserir em public.users (perfil da aplicação)
    INSERT INTO public.users (id, full_name, email, role, created_at)
    VALUES (v_new_user_id, trim(p_full_name), lower(trim(p_email)), p_role, NOW())
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            role      = EXCLUDED.role;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', v_new_user_id,
        'email',   lower(trim(p_email)),
        'role',    p_role,
        'message', 'Usuário criado com sucesso.'
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION '%', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4) Recriar admin_delete_user
DROP FUNCTION IF EXISTS public.admin_delete_user(UUID);

CREATE OR REPLACE FUNCTION public.admin_delete_user(p_target_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT; v_caller_id UUID; v_target_email TEXT;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED: Autenticação necessária.'; END IF;
    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FORBIDDEN: Apenas admins.'; END IF;
    IF p_target_user_id = v_caller_id THEN RAISE EXCEPTION 'INVALID: Não pode deletar a si mesmo.'; END IF;
    SELECT email INTO v_target_email FROM auth.users WHERE id = p_target_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Usuário não encontrado.'; END IF;
    DELETE FROM auth.users WHERE id = p_target_user_id;
    RETURN jsonb_build_object('success', true, 'deleted_email', v_target_email, 'message', 'Deletado.');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '%', SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

-- 5) Recriar get_admin_stats
DROP FUNCTION IF EXISTS public.get_admin_stats();
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_caller_role TEXT; v_s INT; v_c INT; v_e INT;
BEGIN
    SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    SELECT COUNT(*) INTO v_s FROM public.users WHERE role = 'student';
    SELECT COUNT(*) INTO v_c FROM public.courses WHERE active = TRUE;
    SELECT COUNT(*) INTO v_e FROM public.enrollments;
    RETURN jsonb_build_object('total_students', v_s, 'total_courses', v_c, 'total_enrollments', v_e);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- 6) Recriar get_my_enrolled_courses
DROP FUNCTION IF EXISTS public.get_my_enrolled_courses();
CREATE OR REPLACE FUNCTION public.get_my_enrolled_courses()
RETURNS TABLE (course_id UUID, title TEXT, description TEXT, cover_image_path TEXT, pdf_file_path TEXT, granted_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.title, c.description, c.cover_image_path, c.pdf_file_path, e.granted_at
    FROM public.enrollments e INNER JOIN public.courses c ON c.id = e.course_id
    WHERE e.user_id = auth.uid() AND c.active = TRUE ORDER BY e.granted_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_enrolled_courses() TO authenticated;

-- 7) Recriar check_course_access
DROP FUNCTION IF EXISTS public.check_course_access(UUID);
CREATE OR REPLACE FUNCTION public.check_course_access(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_caller_id UUID; v_caller_role TEXT; v_ok BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN RETURN FALSE; END IF;
    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role = 'admin' THEN RETURN TRUE; END IF;
    SELECT EXISTS (SELECT 1 FROM public.enrollments e INNER JOIN public.courses c ON c.id = e.course_id
        WHERE e.user_id = v_caller_id AND e.course_id = p_course_id AND c.active = TRUE) INTO v_ok;
    RETURN v_ok;
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_course_access(UUID) TO authenticated;

-- ✅ Script completo! Execute e teste o login.
