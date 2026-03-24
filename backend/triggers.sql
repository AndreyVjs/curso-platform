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
