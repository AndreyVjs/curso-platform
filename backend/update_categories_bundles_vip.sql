-- ============================================================
-- CURSOS LUCRATIVOS — UPDATE: Categorias, Pacotes e VIP
-- Execute este script no SQL Editor do Supabase
-- É SEGURO rodar mais de uma vez (totalmente idempotente)
-- ============================================================


-- ============================================================
-- 1. ADICIONAR COLUNA category EM courses
-- Categorias são texto livre gerenciado pelo admin.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'courses'
          AND column_name  = 'category'
    ) THEN
        ALTER TABLE public.courses ADD COLUMN category TEXT;
        COMMENT ON COLUMN public.courses.category IS 'Nicho do curso. Ex: Confeitaria, Salgados, Fitness.';
    END IF;
END;
$$;


-- ============================================================
-- 2. ADICIONAR COLUNA is_vip EM users
-- Aluno VIP tem acesso irrestrito a todos os cursos ativos.
-- ============================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'users'
          AND column_name  = 'is_vip'
    ) THEN
        ALTER TABLE public.users ADD COLUMN is_vip BOOLEAN NOT NULL DEFAULT FALSE;
        COMMENT ON COLUMN public.users.is_vip IS 'TRUE = assinante premium; acessa todos os cursos ativos sem precisar de enrollment.';
    END IF;
END;
$$;


-- ============================================================
-- 3. CRIAR TABELA: bundles (Pacotes de Cursos)
-- Um bundle é um conjunto nomeado de cursos que pode ser
-- liberado para um aluno de uma só vez.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bundles (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT        NOT NULL,
    description TEXT,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.bundles IS 'Pacotes agrupando múltiplos cursos para liberação em lote.';

-- Habilitar RLS
ALTER TABLE public.bundles ENABLE ROW LEVEL SECURITY;

-- Remover policies antigas (idempotência)
DROP POLICY IF EXISTS "bundles: admin_all"          ON public.bundles;
DROP POLICY IF EXISTS "bundles: student_select_active" ON public.bundles;

-- Admins: acesso total
CREATE POLICY "bundles: admin_all"
    ON public.bundles
    FOR ALL
    TO authenticated
    USING      (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

-- Alunos: podem ver bundles ativos (leitura)
CREATE POLICY "bundles: student_select_active"
    ON public.bundles
    FOR SELECT
    TO authenticated
    USING (active = TRUE AND public.get_user_role() = 'student');


-- ============================================================
-- 4. CRIAR TABELA: bundle_courses (Relação Bundle → Cursos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bundle_courses (
    bundle_id  UUID NOT NULL REFERENCES public.bundles(id)  ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES public.courses(id)  ON DELETE CASCADE,
    PRIMARY KEY (bundle_id, course_id)
);

COMMENT ON TABLE public.bundle_courses IS 'Cursos pertencentes a cada bundle.';

ALTER TABLE public.bundle_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bundle_courses: admin_all"      ON public.bundle_courses;
DROP POLICY IF EXISTS "bundle_courses: student_select" ON public.bundle_courses;

CREATE POLICY "bundle_courses: admin_all"
    ON public.bundle_courses
    FOR ALL
    TO authenticated
    USING      (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "bundle_courses: student_select"
    ON public.bundle_courses
    FOR SELECT
    TO authenticated
    USING (public.get_user_role() = 'student');


-- ============================================================
-- 5. ÍNDICES DE PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_courses_category      ON public.courses(category);
CREATE INDEX IF NOT EXISTS idx_users_is_vip          ON public.users(is_vip);
CREATE INDEX IF NOT EXISTS idx_bundles_active        ON public.bundles(active);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_bundle ON public.bundle_courses(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_courses_course ON public.bundle_courses(course_id);


-- ============================================================
-- 6. ATUALIZAR RPC: get_my_enrolled_courses
-- Agora retorna TODOS os cursos ativos para alunos VIP,
-- e apenas os cursos com matrícula para alunos normais.
-- Também inclui a categoria no retorno.
-- ============================================================
DROP FUNCTION IF EXISTS public.get_my_enrolled_courses();
CREATE OR REPLACE FUNCTION public.get_my_enrolled_courses()
RETURNS TABLE (
    course_id         UUID,
    title             TEXT,
    description       TEXT,
    cover_image_path  TEXT,
    pdf_file_path     TEXT,
    category          TEXT,
    granted_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_vip  BOOLEAN;
BEGIN
    -- Verifica se o aluno é VIP
    SELECT is_vip INTO v_is_vip
    FROM public.users
    WHERE id = v_user_id
    LIMIT 1;

    IF v_is_vip THEN
        -- VIP: retorna todos os cursos ativos
        RETURN QUERY
        SELECT
            c.id          AS course_id,
            c.title,
            c.description,
            c.cover_image_path,
            c.pdf_file_path,
            c.category,
            c.created_at  AS granted_at
        FROM public.courses c
        WHERE c.active = TRUE
        ORDER BY c.title;
    ELSE
        -- Normal: apenas cursos com matrícula
        RETURN QUERY
        SELECT
            c.id          AS course_id,
            c.title,
            c.description,
            c.cover_image_path,
            c.pdf_file_path,
            c.category,
            e.granted_at
        FROM public.enrollments e
        INNER JOIN public.courses c ON c.id = e.course_id
        WHERE e.user_id = v_user_id
          AND c.active  = TRUE
        ORDER BY c.title;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_enrolled_courses() TO authenticated;


-- ============================================================
-- 7. ATUALIZAR RPC: check_course_access
-- Alunos VIP têm acesso a qualquer curso ativo.
-- ============================================================
DROP FUNCTION IF EXISTS public.check_course_access(UUID);
CREATE OR REPLACE FUNCTION public.check_course_access(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_is_vip  BOOLEAN;
    v_enrolled BOOLEAN;
    v_active   BOOLEAN;
BEGIN
    -- O curso existe e está ativo?
    SELECT active INTO v_active FROM public.courses WHERE id = p_course_id LIMIT 1;
    IF NOT FOUND OR NOT v_active THEN
        RETURN FALSE;
    END IF;

    -- O aluno é VIP?
    SELECT is_vip INTO v_is_vip FROM public.users WHERE id = v_user_id LIMIT 1;
    IF v_is_vip THEN
        RETURN TRUE;
    END IF;

    -- Tem matrícula neste curso?
    SELECT EXISTS (
        SELECT 1 FROM public.enrollments
        WHERE user_id  = v_user_id
          AND course_id = p_course_id
    ) INTO v_enrolled;

    RETURN v_enrolled;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_course_access(UUID) TO authenticated;


-- ============================================================
-- 8. NOVA RPC: grant_bundle_to_student
-- Libera todos os cursos de um bundle para um aluno de uma vez.
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_bundle_to_student(
    p_bundle_id UUID,
    p_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_course      RECORD;
    v_count       INT := 0;
BEGIN
    -- Apenas admins podem chamar esta função
    v_caller_role := public.get_user_role();
    IF v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Apenas administradores podem liberar pacotes.';
    END IF;

    -- Percorre os cursos do bundle e insere matrículas (ignorando duplicatas)
    FOR v_course IN
        SELECT course_id FROM public.bundle_courses WHERE bundle_id = p_bundle_id
    LOOP
        INSERT INTO public.enrollments (user_id, course_id, granted_by)
        VALUES (p_user_id, v_course.course_id, auth.uid())
        ON CONFLICT (user_id, course_id) DO NOTHING;

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'courses_granted', v_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_bundle_to_student(UUID, UUID) TO authenticated;


-- ============================================================
-- 9. NOVA RPC: get_distinct_categories
-- Retorna as categorias únicas de cursos ativos para popular
-- os filtros na interface sem hardcode.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_distinct_categories()
RETURNS TABLE (category TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT DISTINCT category
    FROM public.courses
    WHERE active = TRUE
      AND category IS NOT NULL
      AND category <> ''
    ORDER BY category;
$$;

GRANT EXECUTE ON FUNCTION public.get_distinct_categories() TO authenticated, anon;


-- ============================================================
-- FIM DO SCRIPT
-- Para verificar:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'courses' AND column_name = 'category';
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'is_vip';
--
--   SELECT tablename FROM pg_tables WHERE schemaname='public';
-- ============================================================
