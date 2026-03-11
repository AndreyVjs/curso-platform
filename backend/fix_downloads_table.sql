-- ============================================================
-- FEATURE: Tabela de downloads para rastrear progresso do aluno
-- Execute no SQL Editor do Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.downloads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, course_id)  -- Um registro por aluno/curso (upsert)
);

ALTER TABLE public.downloads ENABLE ROW LEVEL SECURITY;

-- Alunos podem registrar seus próprios downloads
DROP POLICY IF EXISTS "downloads: student_insert_own" ON public.downloads;
CREATE POLICY "downloads: student_insert_own"
    ON public.downloads FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Alunos podem ver seus próprios downloads
DROP POLICY IF EXISTS "downloads: student_select_own" ON public.downloads;
CREATE POLICY "downloads: student_select_own"
    ON public.downloads FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.get_user_role() = 'admin');

-- Alunos podem atualizar (upsert) seus próprios downloads
DROP POLICY IF EXISTS "downloads: student_update_own" ON public.downloads;
CREATE POLICY "downloads: student_update_own"
    ON public.downloads FOR UPDATE TO authenticated
    USING (user_id = auth.uid());

-- Admins têm acesso total
DROP POLICY IF EXISTS "downloads: admin_all" ON public.downloads;
CREATE POLICY "downloads: admin_all"
    ON public.downloads FOR ALL TO authenticated
    USING (public.get_user_role() = 'admin')
    WITH CHECK (public.get_user_role() = 'admin');

-- Função para admin ver último acesso por aluno/curso
CREATE OR REPLACE FUNCTION public.get_student_download_stats(p_user_id UUID)
RETURNS TABLE (course_id UUID, downloaded_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    IF public.get_user_role() IS DISTINCT FROM 'admin' AND auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    RETURN QUERY SELECT d.course_id, d.downloaded_at FROM public.downloads d WHERE d.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_download_stats(UUID) TO authenticated;

-- ✅ Pronto! Tabela de downloads criada.
