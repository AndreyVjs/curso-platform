-- ============================================================
-- CURSO PLATFORM — SCHEMA.SQL
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
