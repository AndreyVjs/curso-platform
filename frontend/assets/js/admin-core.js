// ============================================================
// CURSO PLATFORM — admin-core.js
// Lógica exclusiva do painel Admin
// ============================================================

const AdminCore = (() => {

    // ── Sidebar Ativa ────────────────────────────────────────
    function highlightNavLink() {
        const currentPath = window.location.pathname.split('/').pop();
        document.querySelectorAll('.nav-link').forEach(link => {
            const href = (link.getAttribute('href') || '').split('/').pop();
            if (href === currentPath) {
                link.classList.add('active');
            }
        });
    }

    // ── Inicialização do Layout Admin ────────────────────────
    async function initLayout(pageName = '') {
        const result = await Auth.checkSession(CONFIG.ROLES.ADMIN);
        if (!result) return null;

        const { profile } = result;

        // Preenche dados do usuário na sidebar
        const nameEl = document.getElementById('sidebar-user-name');
        const roleEl = document.getElementById('sidebar-user-role');
        const avatarEl = document.getElementById('sidebar-avatar');

        if (nameEl) nameEl.textContent = profile.full_name;
        if (roleEl) roleEl.textContent = 'Administrador';
        if (avatarEl) avatarEl.textContent = UI.initials(profile.full_name);

        // Topbar
        const topbarName = document.getElementById('topbar-user-name');
        if (topbarName) topbarName.textContent = profile.full_name;

        // Destaca nav link ativo
        highlightNavLink();

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            if (!confirm('Deseja realmente sair?')) return;
            await Auth.logout();
        });

        // Mobile: menu toggle
        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        menuToggle?.addEventListener('click', () => {
            sidebar?.classList.toggle('open');
        });

        return result;
    }


    // ================================================================
    // MÓDULO: Dashboard
    // ================================================================

    async function initDashboard() {
        const result = await initLayout('dashboard');
        if (!result) return;
        UI.restoreDark();

        await loadStats();
        await loadRecentEnrollments();
        loadEnrollmentsChart(); // async sem await — não bloqueia
    }

    async function loadEnrollmentsChart() {
        const canvas = document.getElementById('enrollments-chart');
        if (!canvas || typeof Chart === 'undefined') return;
        try {
            const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
            const today = new Date();
            const days = [], labels = [];
            for (let i = 29; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                days.push(d.toISOString().slice(0, 10));
                labels.push(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
            }
            const { data } = await sb.from('enrollments').select('granted_at').gte('granted_at', days[0] + 'T00:00:00Z');
            const counts = {};
            days.forEach(d => counts[d] = 0);
            (data || []).forEach(e => { const day = (e.granted_at || '').slice(0, 10); if (counts[day] !== undefined) counts[day]++; });
            const isDark = document.documentElement.classList.contains('dark');
            const gridColor = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
            const textColor = isDark ? '#9DA3B4' : '#6C757D';
            new Chart(canvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{ label: 'Matrículas', data: days.map(d => counts[d]), borderColor: '#134E2A', backgroundColor: 'rgba(19,78,42,.1)', borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#134E2A' }]
                },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } }, y: { grid: { color: gridColor }, ticks: { color: textColor, precision: 0 }, beginAtZero: true } } }
            });
        } catch (_) { /* silencioso */ }
    }

    async function loadStats() {
        const container = document.getElementById('stats-grid');
        if (!container) return;

        try {
            const stats = await API.getAdminStats();
            document.getElementById('stat-students').textContent = stats.total_students ?? 0;
            document.getElementById('stat-courses').textContent = stats.total_courses ?? 0;
            document.getElementById('stat-enrollments').textContent = stats.total_enrollments ?? 0;
        } catch (err) {
            UI.toastError('Erro ao carregar estatísticas: ' + err.message);
        }
    }

    async function loadRecentEnrollments() {
        const tbody = document.getElementById('recent-enrollments-tbody');
        if (!tbody) return;

        UI.renderSkeletonRows(tbody, 4, 3);

        try {
            const enrollments = await API.listEnrollments();
            const recent = enrollments.slice(0, 8);

            if (!recent.length) {
                tbody.innerHTML = `<tr><td colspan="4"><div class="table-empty"><div class="empty-icon">📋</div><div class="empty-title">Nenhuma matrícula ainda</div></div></td></tr>`;
                return;
            }

            tbody.innerHTML = recent.map(e => `
        <tr>
          <td>${UI.escapeHtml(e.users?.full_name || '—')}</td>
          <td>${UI.escapeHtml(e.users?.email || '—')}</td>
          <td>${UI.escapeHtml(e.courses?.title || '—')}</td>
          <td>${UI.formatDate(e.granted_at)}</td>
        </tr>
      `).join('');

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--error); padding: var(--space-6);">Erro ao carregar dados.</td></tr>`;
        }
    }


    // ================================================================
    // MÓDULO: Users (Gestão de Alunos)
    // ================================================================

    async function initUsers() {
        const result = await initLayout('users');
        if (!result) return;
        UI.restoreDark();

        await loadUsers();

        // Botão para abrir modal de criação
        document.getElementById('btn-new-user')?.addEventListener('click', () => {
            document.getElementById('edit-user-id').value = '';
            document.getElementById('modal-user-title').textContent = 'Criar Novo Aluno';
            document.getElementById('btn-save-user').textContent = '✅ Criar Aluno';
            document.getElementById('pwd-req').style.display = 'inline';
            document.getElementById('pwd-hint').textContent = '⚠️ Anote ou informe a senha ao aluno após criar a conta.';
            // Esconde seção de cursos no modo criação
            document.getElementById('courses-enrollment-section').style.display = 'none';
            document.getElementById('btn-save-enrollments').style.display = 'none';

            UI.openModal('modal-create-user');
            document.getElementById('form-create-user')?.reset();
            clearFormError('create-user-error');
        });

        // Fecha modal
        document.getElementById('modal-close-user')?.addEventListener('click', () => {
            UI.closeModal('modal-create-user');
        });

        // Submit do formulário de criação
        document.getElementById('form-create-user')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleCreateUser();
        });
    }

    // Cache para filtro client-side
    let _allUsers = [];

    async function loadUsers() {
        const grid = document.getElementById('users-grid');
        if (!grid) return;

        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: var(--space-8); color: var(--text-muted);">Carregando alunos...</div>';

        try {
            _allUsers = await API.listStudents();
            _renderUsersGrid(_allUsers);
        } catch (err) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--error); padding: var(--space-6);">Erro: ${UI.escapeHtml(err.message)}</div>`;
        }
    }

    function _renderUsersGrid(users) {
        const grid = document.getElementById('users-grid');
        if (!grid) return;

        if (!users.length) {
            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: var(--space-12) var(--space-6); background: var(--bg-white); border: 1px dashed var(--border-color); border-radius: var(--radius-lg);">
                    <div style="font-size: 3rem; margin-bottom: var(--space-3); opacity: 0.5;">👥</div>
                    <div style="font-family: var(--font-heading); font-weight: var(--weight-semibold); color: var(--text-primary); margin-bottom: var(--space-2);">Nenhum aluno cadastrado</div>
                    <p style="color: var(--text-secondary);">Clique em "Novo Aluno" para adicionar.</p>
                </div>`;
            return;
        }

        grid.innerHTML = users.map(u => `
            <div class="card" style="display: flex; flex-direction: column; height: 100%;">
                <div class="card-body" style="flex: 1; display:flex; flex-direction:column; align-items:center; text-align:center; gap:var(--space-4);">
                    <div class="avatar" style="width: 64px; height: 64px; font-size: 1.5rem; background: linear-gradient(135deg, var(--primary), var(--primary-hover)); display: flex; align-items: center; justify-content: center; color: white; border-radius: 50%;">${UI.initials(u.full_name)}</div>
                    <div>
                        <h3 style="font-family: var(--font-heading); font-size: var(--text-lg); font-weight: var(--weight-semibold); margin-bottom: 2px;">${UI.escapeHtml(u.full_name)}</h3>
                        <p style="color: var(--text-secondary); font-size: var(--text-sm);">${UI.escapeHtml(u.email)}</p>
                    </div>
                    <div style="font-size: var(--text-xs); color: var(--text-muted); background: var(--bg-secondary); padding: 4px 12px; border-radius: 12px;">
                        Cadastrado em ${UI.formatDate(u.created_at)}
                    </div>
                </div>
                <div class="card-footer" style="display:flex; gap:var(--space-2); justify-content:center; background:var(--bg-secondary); padding:var(--space-4);">
                    <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="AdminCore.editUser('${u.id}', '${UI.escapeHtml(u.full_name)}', '${UI.escapeHtml(u.email)}')">
                        ✏️ Editar
                    </button>
                    <button class="btn btn-danger btn-sm" style="flex:1;" onclick="AdminCore.confirmDeleteUser('${u.id}', '${UI.escapeHtml(u.full_name)}')">
                        🗑 Remover
                    </button>
                </div>
            </div>
            `).join('');
    }

    function filterUsers(query) {
        const q = (query || '').toLowerCase().trim();
        if (!q) { _renderUsersGrid(_allUsers); return; }
        const filtered = _allUsers.filter(u =>
            u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
        );
        _renderUsersGrid(filtered);
    }

    function copyPassword() {
        const val = document.getElementById('new-user-password')?.value;
        if (!val) { UI.toast('Nenhuma senha para copiar.', 'warning'); return; }
        navigator.clipboard.writeText(val).then(() => {
            const btn = document.getElementById('btn-copy-pwd');
            if (btn) { const orig = btn.innerHTML; btn.innerHTML = '✅ Copiado!'; setTimeout(() => btn.innerHTML = orig, 2000); }
            UI.toastSuccess('Senha copiada para a área de transferência!');
        }).catch(() => UI.toastError('Não foi possível copiar. Copie manualmente.'));
    }

    async function handleCreateUser() {
        const btn = document.getElementById('btn-save-user');
        const userId = document.getElementById('edit-user-id').value;
        const fullName = document.getElementById('new-user-name').value.trim();
        const email = document.getElementById('new-user-email').value.trim();
        const password = document.getElementById('new-user-password').value;

        clearFormError('create-user-error');

        if (!fullName || !email || (!userId && !password)) {
            showFormError('create-user-error', 'Preencha todos os campos obrigatórios.');
            return;
        }

        if (password && password.length < 6) {
            showFormError('create-user-error', 'A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        UI.setButtonLoading(btn, userId ? 'Salvando...' : 'Criando conta...');

        try {
            if (userId) {
                // Modo Edição
                await API.updateUser(userId, { full_name: fullName, email, password });
                UI.toastSuccess(`Dados de "${fullName}" atualizados com sucesso!`);
            } else {
                // Modo Criação
                await API.createUser({ email, password, full_name: fullName, role: 'student' });
                UI.toastSuccess(`Aluno "${fullName}" registrado com sucesso! Acesso gerado.`);
            }

            UI.closeModal('modal-create-user');
            await loadUsers(); // Atualiza a lista

        } catch (err) {
            UI.resetButton(btn);
            showFormError('create-user-error', err.message);
        }
    }

    function editUser(id, name, email) {
        document.getElementById('edit-user-id').value = id;
        document.getElementById('new-user-name').value = name;
        document.getElementById('new-user-email').value = email;
        document.getElementById('new-user-password').value = '';

        document.getElementById('modal-user-title').textContent = 'Editar Aluno';
        document.getElementById('btn-save-user').textContent = '✅ Salvar Dados';
        document.getElementById('pwd-req').style.display = 'none';
        document.getElementById('pwd-hint').textContent = 'ℹ️ Deixe em branco para manter a senha atual.';

        // Mostra seção de cursos e botão de salvar matrículas
        document.getElementById('courses-enrollment-section').style.display = 'block';
        document.getElementById('btn-save-enrollments').style.display = 'inline-flex';

        clearFormError('create-user-error');
        UI.openModal('modal-create-user');

        // Carrega os cursos e matrículas do aluno
        loadUserEnrollments(id);

        // Configura botão de salvar matrículas
        const saveEnrollBtn = document.getElementById('btn-save-enrollments');
        saveEnrollBtn.onclick = () => saveEnrollments(id, name);
    }

    async function loadUserEnrollments(userId) {
        const checklist = document.getElementById('courses-checklist');
        const countEl = document.getElementById('enrolled-count');
        checklist.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:var(--text-sm);padding:var(--space-4);">Carregando...</div>';

        try {
            const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

            // Busca todos os cursos ativos
            const { data: allCourses, error: errC } = await sb
                .from('courses')
                .select('id, title')
                .eq('active', true)
                .order('title');
            if (errC) throw errC;

            // Busca matrículas atuais do aluno
            const { data: enrolled, error: errE } = await sb
                .from('enrollments')
                .select('course_id')
                .eq('user_id', userId);
            if (errE) throw errE;

            const enrolledIds = new Set((enrolled || []).map(e => e.course_id));
            const enrolledCount = enrolledIds.size;

            if (countEl) countEl.textContent = `${enrolledCount} de ${allCourses.length} curso(s) liberado(s)`;

            if (!allCourses.length) {
                checklist.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:var(--text-sm);padding:var(--space-4);">Nenhum curso cadastrado ainda.</div>';
                return;
            }

            checklist.innerHTML = allCourses.map(c => {
                const isEnrolled = enrolledIds.has(c.id);
                return `
                <label style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);border:1px solid ${isEnrolled ? 'var(--primary-light)' : 'var(--border-color)'};background:${isEnrolled ? 'var(--primary-light)' : 'var(--bg-secondary)'};cursor:pointer;transition:all .15s;" id="label-${c.id}">
                    <input type="checkbox" data-course-id="${c.id}" ${isEnrolled ? 'checked' : ''}
                        style="width:16px;height:16px;accent-color:var(--primary);cursor:pointer;"
                        onchange="AdminCore.updateCheckboxStyle(this)">
                    <span style="font-size:var(--text-sm);font-weight:var(--weight-medium);flex:1;">${UI.escapeHtml(c.title)}</span>
                    ${isEnrolled ? '<span style="font-size:.7rem;color:var(--primary);font-weight:600;">✅ Liberado</span>' : '<span style="font-size:.7rem;color:var(--text-muted);">Não liberado</span>'}
                </label>`;
            }).join('');

        } catch (err) {
            checklist.innerHTML = `<div style="text-align:center;color:var(--error);font-size:var(--text-sm);padding:var(--space-4);">Erro ao carregar: ${UI.escapeHtml(err.message)}</div>`;
        }
    }

    function updateCheckboxStyle(checkbox) {
        const courseId = checkbox.dataset.courseId;
        const label = document.getElementById(`label-${courseId}`);
        if (!label) return;
        const badge = label.querySelector('span:last-child');
        if (checkbox.checked) {
            label.style.border = '1px solid var(--primary-light)';
            label.style.background = 'var(--primary-light)';
            if (badge) { badge.textContent = '✅ Liberado'; badge.style.color = 'var(--primary)'; }
        } else {
            label.style.border = '1px solid var(--border-color)';
            label.style.background = 'var(--bg-secondary)';
            if (badge) { badge.textContent = 'Não liberado'; badge.style.color = 'var(--text-muted)'; }
        }
    }

    async function saveEnrollments(userId, userName) {
        const btn = document.getElementById('btn-save-enrollments');
        const errEl = document.getElementById('enrollment-error');
        errEl.classList.add('hidden');
        errEl.textContent = '';

        const checkboxes = document.querySelectorAll('#courses-checklist input[type="checkbox"]');
        const toEnroll = [];
        const toRemove = [];

        const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

        // Pega estado atual de matrículas
        const { data: current } = await sb.from('enrollments').select('course_id').eq('user_id', userId);
        const currentIds = new Set((current || []).map(e => e.course_id));

        checkboxes.forEach(cb => {
            const cid = cb.dataset.courseId;
            if (cb.checked && !currentIds.has(cid)) toEnroll.push(cid);
            if (!cb.checked && currentIds.has(cid)) toRemove.push(cid);
        });

        if (!toEnroll.length && !toRemove.length) {
            UI.toast('Nenhuma mudança detectada nos cursos.', 'info');
            return;
        }

        UI.setButtonLoading(btn, 'Salvando...');

        try {
            // Adicionar matrículas
            if (toEnroll.length) {
                const rows = toEnroll.map(cid => ({ user_id: userId, course_id: cid, granted_at: new Date().toISOString() }));
                const { error } = await sb.from('enrollments').insert(rows);
                if (error) throw error;
            }

            // Remover matrículas
            if (toRemove.length) {
                const { error } = await sb.from('enrollments').delete()
                    .eq('user_id', userId).in('course_id', toRemove);
                if (error) throw error;
            }

            UI.toastSuccess(`Cursos de "${userName}" atualizados! +${toEnroll.length} adicionado(s), -${toRemove.length} removido(s).`);
            // Recarrega a lista atualizada
            await loadUserEnrollments(userId);

        } catch (err) {
            errEl.textContent = '⚠️ Erro ao salvar: ' + err.message;
            errEl.classList.remove('hidden');
        }

        UI.resetButton(btn);
    }

    async function confirmDeleteUser(userId, userName) {
        if (!confirm(`Tem certeza que deseja remover o aluno "${userName}"?\n\nEsta ação é permanente e removerá todas as matrículas do aluno.`)) return;

        try {
            await API.deleteUser(userId);
            UI.toastSuccess(`Aluno "${userName}" removido com sucesso.`);
            await loadUsers();
        } catch (err) {
            UI.toastError('Erro ao remover aluno: ' + err.message);
        }
    }


    // ================================================================
    // MÓDULO: Courses (Gestão de Cursos)
    // ================================================================

    async function initCourses() {
        const result = await initLayout('courses');
        if (!result) return;
        UI.restoreDark();

        await loadCourses();

        // Abrir modal
        document.getElementById('btn-new-course')?.addEventListener('click', () => {
            document.getElementById('edit-course-id').value = '';
            document.getElementById('modal-course-title').textContent = 'Criar Novo Curso';
            document.getElementById('btn-save-course').textContent = '📤 Criar Curso';
            document.getElementById('pdf-req').style.display = 'inline';

            UI.openModal('modal-create-course');
            document.getElementById('form-create-course')?.reset();
            resetFileInputs();
            clearFormError('create-course-error');
        });

        // Fechar modal
        document.getElementById('modal-close-course')?.addEventListener('click', () => {
            UI.closeModal('modal-create-course');
        });

        // File input displays
        setupFileInput('cover-file', 'cover-file-name', '🖼 Arraste a capa aqui ou clique para selecionar', ['jpg', 'jpeg', 'png', 'webp']);
        setupFileInput('pdf-file', 'pdf-file-name', '📄 Arraste o PDF aqui ou clique para selecionar', ['pdf']);

        // Submit
        document.getElementById('form-create-course')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleCreateCourse();
        });
    }

    function setupFileInput(inputId, displayTextId, placeholder, allowedExts) {
        const input = document.getElementById(inputId);
        const nameEl = document.getElementById(displayTextId);
        if (!input || !nameEl) return;

        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) { nameEl.textContent = placeholder; return; }

            const ext = file.name.split('.').pop().toLowerCase();
            if (!allowedExts.includes(ext)) {
                UI.toastError(`Formato inválido. Use: ${allowedExts.join(', ').toUpperCase()}`);
                input.value = '';
                nameEl.textContent = placeholder;
                return;
            }

            const size = (file.size / 1024 / 1024).toFixed(2);
            nameEl.textContent = `✅ ${file.name} (${size} MB)`;

            // Preview da imagem (apenas para uploads de capa)
            if (inputId === 'cover-file') {
                const wrap = document.getElementById('cover-preview-wrap');
                const img = document.getElementById('cover-preview-img');
                if (wrap && img) {
                    const reader = new FileReader();
                    reader.onload = e => { img.src = e.target.result; wrap.style.display = 'block'; };
                    reader.readAsDataURL(file);
                }
            }
        });
    }

    function resetFileInputs() {
        ['cover-file', 'pdf-file'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const texts = {
            'cover-file-name': '🖼 Arraste a capa aqui ou clique para selecionar',
            'pdf-file-name': '📄 Arraste o PDF aqui ou clique para selecionar',
        };
        Object.entries(texts).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        });
        // Esconde preview da capa
        const wrap = document.getElementById('cover-preview-wrap');
        if (wrap) wrap.style.display = 'none';
    }

    async function handleCreateCourse() {
        const btn = document.getElementById('btn-save-course');
        const courseId = document.getElementById('edit-course-id').value;
        const title = document.getElementById('course-title').value.trim();
        const description = document.getElementById('course-description').value.trim();
        const coverFile = document.getElementById('cover-file').files[0] || null;
        const pdfFile = document.getElementById('pdf-file').files[0] || null;

        clearFormError('create-course-error');

        if (!title) {
            showFormError('create-course-error', 'O título do curso é obrigatório.');
            return;
        }

        if (!courseId && !pdfFile) {
            showFormError('create-course-error', 'O arquivo PDF é obrigatório para novos cursos.');
            return;
        }

        UI.setButtonLoading(btn, courseId ? 'Salvando...' : 'Enviando arquivos...');

        try {
            if (courseId) {
                await API.updateCourse(courseId, { title, description, coverFile, pdfFile });
                UI.toastSuccess(`Curso "${title}" atualizado com sucesso!`);
            } else {
                await API.createCourse({ title, description, coverFile, pdfFile });
                UI.toastSuccess(`Curso "${title}" criado com sucesso!`);
            }

            UI.closeModal('modal-create-course');
            await loadCourses();

        } catch (err) {
            UI.resetButton(btn);
            showFormError('create-course-error', err.message);
        }
    }

    async function loadCourses() {
        const grid = document.getElementById('courses-grid');
        if (!grid) return;

        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: var(--space-8); color: var(--text-muted);">Carregando cursos...</div>';

        try {
            const courses = await API.listCourses();

            if (!courses.length) {
                grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: var(--space-12) var(--space-6); background: var(--bg-white); border: 1px dashed var(--border-color); border-radius: var(--radius-lg);">
                    <div style="font-size: 3rem; margin-bottom: var(--space-3); opacity: 0.5;">📚</div>
                    <div style="font-family: var(--font-heading); font-weight: var(--weight-semibold); color: var(--text-primary); margin-bottom: var(--space-2);">Nenhum curso criado ainda</div>
                    <p style="color: var(--text-secondary);">Clique em "Novo Curso" para começar.</p>
                </div>`;
                return;
            }

            grid.innerHTML = courses.map(c => `
            <div class="course-card">
                <div class="course-card-cover">
                    ${c.cover_image_path
                    ? `<img src="${API.getCoverUrl(c.cover_image_path)}" alt="Capa" />`
                    : `<div class="course-card-cover-placeholder">📚</div>`
                }
                </div>
                <div class="course-card-body">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <h3 class="course-card-title">${UI.escapeHtml(c.title)}</h3>
                        <span class="badge ${c.active ? 'badge-success' : 'badge-neutral'}" style="margin-left:8px;">
                            ${c.active ? 'Ativo' : 'Inativo'}
                        </span>
                    </div>
                    <p class="course-card-description">${UI.truncate(c.description, 80) || 'Sem descrição'}</p>
                    <div style="margin-top:auto;">
                        <span class="badge ${c.pdf_file_path ? 'badge-primary' : 'badge-neutral'}">
                            ${c.pdf_file_path ? '📄 PDF Anexado' : '⚠️ Sem PDF'}
                        </span>
                    </div>
                </div>
                <div class="course-card-footer" style="display:flex; flex-direction:column; gap:var(--space-2);">
                    <div style="display:flex; gap:var(--space-2);">
                        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="AdminCore.editCourse('${c.id}')">
                            ✏️ Editar
                        </button>
                        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="AdminCore.toggleCourse('${c.id}', ${!c.active})">
                            ${c.active ? '🔴 Desativar' : '🟢 Ativar'}
                        </button>
                    </div>
                    <button class="btn btn-danger btn-sm btn-block" onclick="AdminCore.confirmDeleteCourse('${c.id}', '${UI.escapeHtml(c.title)}')">
                        🗑 Excluir
                    </button>
                </div>
            </div>
            `).join('');

        } catch (err) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--error); padding: var(--space-6);">Erro: ${UI.escapeHtml(err.message)}</div>`;
        }
    }

    async function toggleCourse(courseId, newStatus) {
        try {
            await API.toggleCourseStatus(courseId, newStatus);
            UI.toastSuccess(`Curso ${newStatus ? 'ativado' : 'desativado'} com sucesso.`);
            await loadCourses();
        } catch (err) {
            UI.toastError('Erro: ' + err.message);
        }
    }

    async function editCourse(courseId) {
        try {
            const course = await API.getCourse(courseId);

            document.getElementById('edit-course-id').value = course.id;
            document.getElementById('course-title').value = course.title;
            document.getElementById('course-description').value = course.description || '';

            document.getElementById('modal-course-title').textContent = 'Editar Curso';
            document.getElementById('btn-save-course').textContent = '📤 Salvar Alterações';
            document.getElementById('pdf-req').style.display = 'none';

            resetFileInputs();
            clearFormError('create-course-error');
            UI.openModal('modal-create-course');
        } catch (err) {
            UI.toastError('Erro ao carregar dados do curso: ' + err.message);
        }
    }

    async function confirmDeleteCourse(courseId, title) {
        if (!confirm(`Deseja excluir permanentemente o curso "${title}"?\n\nOs arquivos de capa e PDF também serão removidos.`)) return;

        try {
            await API.deleteCourse(courseId);
            UI.toastSuccess(`Curso "${title}" excluído.`);
            await loadCourses();
        } catch (err) {
            UI.toastError('Erro ao excluir: ' + err.message);
        }
    }


    // ================================================================
    // MÓDULO: Enrollments (Matrículas)
    // ================================================================

    async function initEnrollments() {
        const result = await initLayout('enrollments');
        if (!result) return;
        UI.restoreDark();

        await Promise.all([
            loadEnrollments(),
            populateEnrollmentSelects(),
        ]);

        document.getElementById('form-enroll')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleEnroll();
        });
    }

    async function populateEnrollmentSelects() {
        try {
            const [students, courses] = await Promise.all([
                API.listStudents(),
                API.listCourses({ activeOnly: true }),
            ]);

            const studentSelect = document.getElementById('enroll-student');
            const courseSelect = document.getElementById('enroll-course');

            if (studentSelect) {
                studentSelect.innerHTML = `<option value="">— Selecione um aluno —</option>` +
                    students.map(s => `<option value="${s.id}">${UI.escapeHtml(s.full_name)} (${UI.escapeHtml(s.email)})</option>`).join('');
            }

            if (courseSelect) {
                courseSelect.innerHTML = `<option value="">— Selecione um curso —</option>` +
                    courses.map(c => `<option value="${c.id}">${UI.escapeHtml(c.title)}</option>`).join('');
            }

        } catch (err) {
            UI.toastError('Erro ao carregar dados: ' + err.message);
        }
    }

    async function handleEnroll() {
        const btn = document.getElementById('btn-enroll');
        const userId = document.getElementById('enroll-student').value;
        const courseId = document.getElementById('enroll-course').value;

        clearFormError('enroll-error');

        if (!userId || !courseId) {
            showFormError('enroll-error', 'Selecione um aluno e um curso para matricular.');
            return;
        }

        UI.setButtonLoading(btn, 'Liberando acesso...');

        try {
            await API.enrollStudent(userId, courseId);
            UI.toastSuccess('Acesso liberado! O aluno já pode ver este curso.');
            document.getElementById('form-enroll').reset();
            clearFormError('enroll-error');
            await loadEnrollments();

        } catch (err) {
            UI.resetButton(btn);
            showFormError('enroll-error', err.message);
        }
    }

    async function loadEnrollments() {
        const grid = document.getElementById('enrollments-grid');
        if (!grid) return;

        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted);">Carregando matrículas...</div>';

        try {
            const enrollments = await API.listEnrollments();

            if (!enrollments.length) {
                grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: var(--space-8); background: var(--bg-secondary); border-radius: var(--radius-lg);">
                    <div style="font-size: 2.5rem; margin-bottom: var(--space-3); opacity: 0.5;">🎓</div>
                    <div style="font-family: var(--font-heading); font-weight: var(--weight-semibold); color: var(--text-primary); margin-bottom: var(--space-2);">Nenhuma matrícula registrada</div>
                </div>`;
                return;
            }

            grid.innerHTML = enrollments.map(e => `
            <div class="card" style="display:flex; flex-direction:column; border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow:hidden;">
                <div style="padding: var(--space-4) var(--space-5); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); display:flex; align-items:center; gap:var(--space-3);">
                    <div class="avatar" style="width:40px;height:40px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;font-weight:bold;">
                        ${UI.initials(e.users?.full_name || 'A')}
                    </div>
                    <div>
                        <div style="font-weight:var(--weight-semibold); font-size:var(--text-sm); line-height:1.2;">
                            ${UI.escapeHtml(e.users?.full_name || '—')}
                        </div>
                        <div style="font-size:var(--text-xs); color:var(--text-secondary);">
                            ${UI.escapeHtml(e.users?.email || '—')}
                        </div>
                    </div>
                </div>
                <div style="padding: var(--space-5); flex:1;">
                    <div style="font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-bottom: 4px;">Curso Vinculado</div>
                    <div style="font-family: var(--font-heading); font-size: var(--text-base); font-weight: var(--weight-medium); color: var(--text-primary);">
                        📚 ${UI.escapeHtml(e.courses?.title || '—')}
                    </div>
                    <div style="margin-top: var(--space-4); font-size: var(--text-xs); color: var(--text-muted);">
                        Liberado em: ${UI.formatDate(e.granted_at)}
                    </div>
                </div>
                <div style="padding: var(--space-3) var(--space-5); border-top: 1px solid var(--border-color); background: var(--bg-white);">
                    <button class="btn btn-danger btn-block btn-sm"
                        onclick="AdminCore.confirmUnenroll('${e.id}', '${UI.escapeHtml(e.users?.full_name || '')}', '${UI.escapeHtml(e.courses?.title || '')}')">
                        🔒 Revogar Acesso
                    </button>
                </div>
            </div>
            `).join('');

        } catch (err) {
            grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--error);">Erro: ${UI.escapeHtml(err.message)}</div>`;
        }
    }

    async function confirmUnenroll(enrollmentId, userName, courseName) {
        if (!confirm(`Revogar acesso de "${userName}" ao curso "${courseName}"?\n\nO aluno perderá o acesso imediatamente.`)) return;

        try {
            await API.unenrollStudent(enrollmentId);
            UI.toastSuccess('Acesso revogado com sucesso.');
            await loadEnrollments();
        } catch (err) {
            UI.toastError('Erro ao revogar: ' + err.message);
        }
    }


    // ── Helpers internos de formulário ───────────────────────

    function showFormError(elId, msg) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'flex';
        el.classList.remove('hidden');
    }

    function clearFormError(elId) {
        const el = document.getElementById(elId);
        if (!el) return;
        el.textContent = '';
        el.style.display = 'none';
        el.classList.add('hidden');
    }


    // API pública do módulo
    return {
        initDashboard,
        initUsers,
        initCourses,
        initEnrollments,

        // Expostos globalmente para handlers inline (onclick)
        editUser,
        editCourse,
        confirmDeleteUser,
        confirmDeleteCourse,
        toggleCourse,
        confirmUnenroll,
        updateCheckboxStyle,
        filterUsers,
        copyPassword,
    };

})();
