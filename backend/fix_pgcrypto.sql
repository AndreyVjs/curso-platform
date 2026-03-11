-- ============================================================
-- HOTFIX v2: Corrigir login de usuários criados pelo admin
-- O problema: faltava INSERT INTO auth.identities, que é
-- obrigatório no Supabase GoTrue v2 para login funcionar.
-- Cole e execute no SQL Editor do Supabase.
-- ============================================================

-- 1) Garantir pgcrypto
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA extensions;

-- 2) PRIMEIRO: Corrigir usuários já criados que não têm identity
-- Isso permite que alunos JÁ criados possam fazer login
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT
    au.id,
    au.id,
    jsonb_build_object(
        'sub', au.id::TEXT,
        'email', au.email,
        'email_verified', true
    ),
    'email',
    au.email,
    NOW(),
    au.created_at,
    NOW()
FROM auth.users au
WHERE NOT EXISTS (
    SELECT 1 FROM auth.identities ai
    WHERE ai.user_id = au.id AND ai.provider = 'email'
);

-- 3) Recriar admin_create_user COM auth.identities
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
    v_result        JSONB;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Você precisa estar autenticado.';
    END IF;

    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'FORBIDDEN: Apenas administradores podem criar usuários.';
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
        RAISE EXCEPTION 'VALIDATION: Role inválido. Use "admin" ou "student".';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
        RAISE EXCEPTION 'CONFLICT: Este email já está cadastrado na plataforma.';
    END IF;

    -- Criar usuário
    v_new_user_id := gen_random_uuid();
    v_hashed_pw := crypt(p_password, gen_salt('bf'));

    -- PASSO 1: auth.users
    INSERT INTO auth.users (
        id, instance_id, email, encrypted_password,
        email_confirmed_at, raw_user_meta_data,
        role, aud, created_at, updated_at
    )
    VALUES (
        v_new_user_id,
        '00000000-0000-0000-0000-000000000000',
        lower(trim(p_email)),
        v_hashed_pw,
        NOW(),
        jsonb_build_object('full_name', p_full_name, 'role', p_role),
        'authenticated',
        'authenticated',
        NOW(),
        NOW()
    );

    -- PASSO 2: auth.identities (CRÍTICO para login funcionar!)
    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
    )
    VALUES (
        v_new_user_id,
        v_new_user_id,
        jsonb_build_object(
            'sub', v_new_user_id::TEXT,
            'email', lower(trim(p_email)),
            'email_verified', true,
            'full_name', p_full_name
        ),
        'email',
        lower(trim(p_email)),
        NOW(),
        NOW(),
        NOW()
    );

    -- PASSO 3: public.users (perfil público)
    INSERT INTO public.users (id, full_name, email, role, created_at)
    VALUES (v_new_user_id, trim(p_full_name), lower(trim(p_email)), p_role, NOW())
    ON CONFLICT (id) DO UPDATE
        SET full_name = EXCLUDED.full_name,
            role      = EXCLUDED.role;

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
        RAISE EXCEPTION '%', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4) Recriar admin_delete_user
CREATE OR REPLACE FUNCTION public.admin_delete_user(
    p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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

    RETURN jsonb_build_object('success', true, 'deleted_email', v_target_email, 'message', 'Usuário deletado.');
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '%', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID) TO authenticated;

-- 5) Recriar get_admin_stats
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_caller_role TEXT; v_total_students INT; v_total_courses INT; v_total_enrollments INT;
BEGIN
    SELECT role INTO v_caller_role FROM public.users WHERE id = auth.uid();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'FORBIDDEN: Acesso negado.'; END IF;
    SELECT COUNT(*) INTO v_total_students FROM public.users WHERE role = 'student';
    SELECT COUNT(*) INTO v_total_courses FROM public.courses WHERE active = TRUE;
    SELECT COUNT(*) INTO v_total_enrollments FROM public.enrollments;
    RETURN jsonb_build_object('total_students', v_total_students, 'total_courses', v_total_courses, 'total_enrollments', v_total_enrollments);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

-- 6) Recriar get_my_enrolled_courses
CREATE OR REPLACE FUNCTION public.get_my_enrolled_courses()
RETURNS TABLE (course_id UUID, title TEXT, description TEXT, cover_image_path TEXT, pdf_file_path TEXT, granted_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT c.id, c.title, c.description, c.cover_image_path, c.pdf_file_path, e.granted_at
    FROM public.enrollments e
    INNER JOIN public.courses c ON c.id = e.course_id
    WHERE e.user_id = auth.uid() AND c.active = TRUE
    ORDER BY e.granted_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_enrolled_courses() TO authenticated;

-- 7) Recriar check_course_access
CREATE OR REPLACE FUNCTION public.check_course_access(p_course_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_caller_id UUID; v_caller_role TEXT; v_has_access BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN RETURN FALSE; END IF;
    SELECT role INTO v_caller_role FROM public.users WHERE id = v_caller_id;
    IF v_caller_role = 'admin' THEN RETURN TRUE; END IF;
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments e
        INNER JOIN public.courses c ON c.id = e.course_id
        WHERE e.user_id = v_caller_id AND e.course_id = p_course_id AND c.active = TRUE
    ) INTO v_has_access;
    RETURN v_has_access;
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_course_access(UUID) TO authenticated;

-- ✅ FEITO! Usuários existentes agora podem fazer login,
-- e novos usuários criados pelo admin também terão identidade.
