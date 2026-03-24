// ============================================================
// CURSOS LUCRATIVOS — auth.js
// Autenticação, Sessão, Guarding por Role
// ============================================================

const Auth = (() => {

    // ── Instância do Supabase (lazy init) ────────────────────
    let _client = null;

    function getClient() {
        if (!_client) {
            _client = supabase.createClient(
                CONFIG.SUPABASE_URL,
                CONFIG.SUPABASE_ANON_KEY
            );
        }
        return _client;
    }

    // ── Sessão em cache (refresh preventivo) ─────────────────
    let _cachedUser = null;
    let _cachedProfile = null;


    // ── LOGIN ─────────────────────────────────────────────────

    /**
     * Autentica o usuário com email e senha.
     * @param {string} email
     * @param {string} password
     * @returns {{ user, profile }} ou lança erro
     */
    async function login(email, password) {
        const sb = getClient();

        const { data, error } = await sb.auth.signInWithPassword({ email, password });

        if (error) {
            // Mensagens amigáveis
            const messages = {
                'Invalid login credentials': 'Email ou senha incorretos. Verifique e tente novamente.',
                'Email not confirmed': 'Você precisa confirmar seu email antes de entrar.',
                'Too many requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
            };
            throw new Error(messages[error.message] || `Falha no login: ${error.message}`);
        }

        _cachedUser = data.user;

        // Busca perfil com role
        const profile = await _fetchProfile(data.user.id);
        _cachedProfile = profile;

        return { user: data.user, profile };
    }


    // ── LOGOUT ────────────────────────────────────────────────

    async function logout() {
        const sb = getClient();
        _cachedUser = null;
        _cachedProfile = null;

        await sb.auth.signOut();

        // Limpa qualquer dado local
        sessionStorage.clear();
        localStorage.removeItem('sb-profile-cache');

        window.location.href = _rootPath() + CONFIG.ROUTES.LOGIN;
    }


    // ── CHECK SESSION ─────────────────────────────────────────

    /**
     * Verifica se há sessão válida. Se não houver, redireciona para login.
     * Se houver, valida o role e redireciona se estiver na página errada.
     *
     * @param {'admin'|'student'|null} requiredRole
     *   - null = apenas verifica se está logado (sem restrição de role)
     *   - 'admin'   = somente admins podem estar aqui
     *   - 'student' = somente alunos podem estar aqui
     *
     * @returns {Promise<{user, profile}>} ou redireciona (não retorna)
     */
    async function checkSession(requiredRole = null) {
        const sb = getClient();

        const { data: { session }, error } = await sb.auth.getSession();

        if (error || !session) {
            window.location.href = _rootPath() + CONFIG.ROUTES.LOGIN;
            return null; // Nunca alcançado, mas evita erros de lint
        }

        _cachedUser = session.user;

        // Busca perfil (pode vir do cache local)
        let profile = _cachedProfile;
        if (!profile || profile.id !== session.user.id) {
            profile = await _fetchProfile(session.user.id);
            _cachedProfile = profile;
        }

        if (!profile) {
            // Perfil inexistente = conta corrompida / deletada
            await logout();
            return null;
        }

        // ── Guarda de Role ──
        if (requiredRole && profile.role !== requiredRole) {
            const redirectTo = profile.role === CONFIG.ROLES.ADMIN
                ? CONFIG.ROUTES.ADMIN_DASHBOARD
                : CONFIG.ROUTES.STUDENT_DASHBOARD;

            window.location.href = _rootPath() + redirectTo;
            return null;
        }

        return { user: session.user, profile };
    }


    // ── HELPERS INTERNOS ──────────────────────────────────────

    async function _fetchProfile(userId) {
        const sb = getClient();

        const { data, error } = await sb
            .from('users')
            .select('id, full_name, email, role, created_at')
            .eq('id', userId)
            .single();

        if (error || !data) return null;
        return data;
    }

    /** Calcula o caminho raiz relativo (para funcionar em subdiretórios) */
    function _rootPath() {
        // Se estiver em /frontend/pages/admin/ → precisa de ../../..
        // Se estiver em /frontend/pages/student/ → mesma coisa
        // Se estiver em /login.html → já é a raiz
        const path = window.location.pathname;

        if (path.includes('/frontend/pages/admin/') ||
            path.includes('/frontend/pages/student/')) {
            return '../../..';
        }
        if (path.includes('/frontend/')) {
            return '../..';
        }
        return '';
    }

    /** Getter para usar o client Supabase em outros módulos */
    function client() { return getClient(); }

    /** Getter para o perfil cacheado (depois de checkSession) */
    function currentProfile() { return _cachedProfile; }

    /** Getter para o user auth cacheado */
    function currentUser() { return _cachedUser; }


    // API pública
    return {
        login,
        logout,
        checkSession,
        client,
        currentProfile,
        currentUser,
    };

})();
