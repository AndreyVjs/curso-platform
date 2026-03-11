-- ============================================================
-- MASTER UPDATE: Novas Funcionalidades (Downloads e Perfil)
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Garantir extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Criar tabela de rastreamento de downloads
CREATE TABLE IF NOT EXISTS public.downloads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    downloaded_at TIMESTAMPTZ DEFAULT NOW(),
    -- Um registro por usuário/curso (upsert atualiza a data)
    UNIQUE(user_id, course_id)
);

-- Habilitar RLS em downloads
ALTER TABLE public.downloads ENABLE ROW LEVEL SECURITY;

-- Polícias para downloads
DROP POLICY IF EXISTS "downloads: select_own" ON public.downloads;
CREATE POLICY "downloads: select_own" ON public.downloads
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "downloads: insert_own" ON public.downloads;
CREATE POLICY "downloads: insert_own" ON public.downloads
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "downloads: update_own" ON public.downloads;
CREATE POLICY "downloads: update_own" ON public.downloads
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id);

-- 3. Atualizar RLS da tabela users para permitir auto-edição de nome
-- (Necessário para a página de perfil do aluno funcionar)
DROP POLICY IF EXISTS "users: update_own_name" ON public.users;
CREATE POLICY "users: update_own_name" ON public.users
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 4. Garantir que a tabela courses tem RLS para anon_select (Catálogo)
-- Se você já executou fix_public_courses.sql, isso é redundante, mas seguro.
DROP POLICY IF EXISTS "courses: anon_select_active" ON public.courses;
CREATE POLICY "courses: anon_select_active"
    ON public.courses
    FOR SELECT
    TO anon, authenticated
    USING (active = TRUE);

-- ============================================================
-- FIM DO SCRIPT
-- ============================================================
