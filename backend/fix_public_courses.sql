-- ============================================================
-- HOTFIX: Permitir leitura pública de cursos ativos
-- (necessário para a landing page mostrar o catálogo sem login)
-- Cole no SQL Editor do Supabase e execute.
-- ============================================================

-- Remove a policy antiga se existir
DROP POLICY IF EXISTS "courses: anon_select_active" ON public.courses;

-- Cria policy que permite qualquer visitante (inclusive sem login)
-- ver cursos ativos — apenas leitura, sem dados sensíveis expostos
CREATE POLICY "courses: anon_select_active"
    ON public.courses
    FOR SELECT
    TO anon
    USING (active = TRUE);

-- ✅ Feito! A landing page agora consegue carregar os cursos.
