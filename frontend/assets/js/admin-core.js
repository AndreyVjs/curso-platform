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

        await loadStats();
        await loadRecentEnrollments();
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

        await loadUsers();

        // Botão para abrir modal de criação
        document.getElementById('btn-new-user')?.addEventListener('click', () => {
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

    async function loadUsers() {
        const tbody = document.getElementById('users-tbody');
        if (!tbody) return;

        UI.renderSkeletonRows(tbody, 4, 5);

        try {
            const users = await API.listStudents();

            if (!users.length) {
                tbody.innerHTML = `
          <tr><td colspan="4">
            <div class="table-empty">
              <div class="empty-icon">👥</div>
              <div class="empty-title">Nenhum aluno cadastrado</div>
              <p>Clique em "Novo Aluno" para adicionar.</p>
            </div>
          </td></tr>`;
                return;
            }

            tbody.innerHTML = users.map(u => `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap: var(--space-3);">
              <div class="avatar">${UI.initials(u.full_name)}</div>
              <div>
                <div style="font-weight: var(--weight-medium);">${UI.escapeHtml(u.full_name)}</div>
              </div>
            </div>
          </td>
          <td>${UI.escapeHtml(u.email)}</td>
          <td>${UI.formatDate(u.created_at)}</td>
          <td>
            <button
              class="btn btn-danger btn-sm"
              onclick="AdminCore.confirmDeleteUser('${u.id}', '${UI.escapeHtml(u.full_name)}')"
              title="Remover aluno"
            >🗑 Remover</button>
          </td>
        </tr>
      `).join('');

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--error); padding: var(--space-6);">Erro: ${UI.escapeHtml(err.message)}</td></tr>`;
        }
    }

    async function handleCreateUser() {
        const btn = document.getElementById('btn-save-user');
        const fullName = document.getElementById('new-user-name').value.trim();
        const email = document.getElementById('new-user-email').value.trim();
        const password = document.getElementById('new-user-password').value;

        clearFormError('create-user-error');

        if (!fullName || !email || !password) {
            showFormError('create-user-error', 'Preencha todos os campos obrigatórios.');
            return;
        }

        if (password.length < 6) {
            showFormError('create-user-error', 'A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        UI.setButtonLoading(btn, 'Criando conta...');

        try {
            await API.createUser({ email, password, full_name: fullName, role: 'student' });

            UI.closeModal('modal-create-user');
            UI.toastSuccess(`Aluno "${fullName}" registrado com sucesso! Acesso gerado.`);
            await loadUsers(); // Atualiza a lista

        } catch (err) {
            UI.resetButton(btn);
            showFormError('create-user-error', err.message);
        }
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

        await loadCourses();

        // Abrir modal
        document.getElementById('btn-new-course')?.addEventListener('click', () => {
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
    }

    async function handleCreateCourse() {
        const btn = document.getElementById('btn-save-course');
        const title = document.getElementById('course-title').value.trim();
        const description = document.getElementById('course-description').value.trim();
        const coverFile = document.getElementById('cover-file').files[0] || null;
        const pdfFile = document.getElementById('pdf-file').files[0] || null;

        clearFormError('create-course-error');

        if (!title) {
            showFormError('create-course-error', 'O título do curso é obrigatório.');
            return;
        }

        UI.setButtonLoading(btn, 'Enviando arquivos...');

        try {
            const course = await API.createCourse({ title, description, coverFile, pdfFile });

            UI.closeModal('modal-create-course');
            UI.toastSuccess(`Curso "${course.title}" criado com sucesso!`);
            await loadCourses();

        } catch (err) {
            UI.resetButton(btn);
            showFormError('create-course-error', err.message);
        }
    }

    async function loadCourses() {
        const tbody = document.getElementById('courses-tbody');
        if (!tbody) return;

        UI.renderSkeletonRows(tbody, 5, 4);

        try {
            const courses = await API.listCourses();

            if (!courses.length) {
                tbody.innerHTML = `
          <tr><td colspan="5">
            <div class="table-empty">
              <div class="empty-icon">📚</div>
              <div class="empty-title">Nenhum curso criado ainda</div>
              <p>Clique em "Novo Curso" para começar.</p>
            </div>
          </td></tr>`;
                return;
            }

            tbody.innerHTML = courses.map(c => `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap: var(--space-3);">
              ${c.cover_image_path
                    ? `<img src="${API.getCoverUrl(c.cover_image_path)}" alt="Capa" style="width:48px; height:36px; object-fit:cover; border-radius: var(--radius-sm);" />`
                    : `<div style="width:48px; height:36px; background: var(--primary-light); border-radius: var(--radius-sm); display:flex; align-items:center; justify-content:center; font-size:1rem;">📚</div>`
                }
              <span style="font-weight: var(--weight-medium);">${UI.escapeHtml(c.title)}</span>
            </div>
          </td>
          <td>${UI.truncate(c.description, 80) || '<span style="color:var(--text-muted)">Sem descrição</span>'}</td>
          <td>
            <span class="badge ${c.pdf_file_path ? 'badge-success' : 'badge-neutral'}">
              ${c.pdf_file_path ? '✅ PDF' : '⚠️ Sem PDF'}
            </span>
          </td>
          <td>
            <span class="badge ${c.active ? 'badge-success' : 'badge-neutral'}">
              ${c.active ? 'Ativo' : 'Inativo'}
            </span>
          </td>
          <td style="display:flex; gap: var(--space-2); flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm" onclick="AdminCore.toggleCourse('${c.id}', ${!c.active})">
              ${c.active ? '🔴 Desativar' : '🟢 Ativar'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="AdminCore.confirmDeleteCourse('${c.id}', '${UI.escapeHtml(c.title)}')">
              🗑
            </button>
          </td>
        </tr>
      `).join('');

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--error); padding: var(--space-6);">Erro: ${UI.escapeHtml(err.message)}</td></tr>`;
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
        const tbody = document.getElementById('enrollments-tbody');
        if (!tbody) return;

        UI.renderSkeletonRows(tbody, 5, 4);

        try {
            const enrollments = await API.listEnrollments();

            if (!enrollments.length) {
                tbody.innerHTML = `
          <tr><td colspan="5">
            <div class="table-empty">
              <div class="empty-icon">🎓</div>
              <div class="empty-title">Nenhuma matrícula registrada</div>
            </div>
          </td></tr>`;
                return;
            }

            tbody.innerHTML = enrollments.map(e => `
        <tr>
          <td>${UI.escapeHtml(e.users?.full_name || '—')}</td>
          <td>${UI.escapeHtml(e.users?.email || '—')}</td>
          <td>${UI.escapeHtml(e.courses?.title || '—')}</td>
          <td>${UI.formatDate(e.granted_at)}</td>
          <td>
            <button
              class="btn btn-danger btn-sm"
              onclick="AdminCore.confirmUnenroll('${e.id}', '${UI.escapeHtml(e.users?.full_name || '')}', '${UI.escapeHtml(e.courses?.title || '')}')"
            >🔒 Revogar</button>
          </td>
        </tr>
      `).join('');

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--error); padding: var(--space-6);">Erro: ${UI.escapeHtml(err.message)}</td></tr>`;
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
        confirmDeleteUser,
        confirmDeleteCourse,
        toggleCourse,
        confirmUnenroll,
    };

})();
