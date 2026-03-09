// ============================================================
// CURSO PLATFORM — student-core.js
// Lógica exclusiva da Área do Aluno
// ============================================================

const StudentCore = (() => {

    // ── Inicialização do Layout do Aluno ─────────────────────
    async function initLayout() {
        const result = await Auth.checkSession(CONFIG.ROLES.STUDENT);
        if (!result) return null;

        const { profile } = result;

        // Sidebar / Topbar
        const nameEl = document.getElementById('sidebar-user-name');
        const roleEl = document.getElementById('sidebar-user-role');
        const avatarEl = document.getElementById('sidebar-avatar');
        const topbarEl = document.getElementById('topbar-greeting-name');

        if (nameEl) nameEl.textContent = profile.full_name;
        if (roleEl) roleEl.textContent = 'Aluno';
        if (avatarEl) avatarEl.textContent = UI.initials(profile.full_name);
        if (topbarEl) topbarEl.textContent = profile.full_name.split(' ')[0] + '.';

        // Sidebar greeting
        const greetingEl = document.getElementById('greeting-text');
        if (greetingEl) {
            const hour = new Date().getHours();
            const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
            greetingEl.textContent = `${greet}, ${profile.full_name.split(' ')[0]}! Seus conteúdos estão prontos.`;
        }

        // Nav link ativo
        const currentPage = window.location.pathname.split('/').pop();
        document.querySelectorAll('.nav-link').forEach(link => {
            const href = (link.getAttribute('href') || '').split('/').pop();
            if (href === currentPage) link.classList.add('active');
        });

        // Logout
        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            if (!confirm('Deseja sair da plataforma?')) return;
            await Auth.logout();
        });

        // Mobile menu
        const menuToggle = document.getElementById('menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        menuToggle?.addEventListener('click', () => sidebar?.classList.toggle('open'));

        return result;
    }


    // ================================================================
    // DASHBOARD: Vitrine de Cursos do Aluno
    // ================================================================

    async function initDashboard() {
        const result = await initLayout();
        if (!result) return;

        await loadMyCourses();
    }

    async function loadMyCourses() {
        const grid = document.getElementById('courses-grid');
        if (!grid) return;

        UI.renderSkeletonGrid(grid, 6);

        try {
            const courses = await API.getMyEnrolledCourses();

            // Atualiza contador
            const countEl = document.getElementById('courses-count');
            if (countEl) countEl.textContent = courses.length;

            if (!courses.length) {
                grid.innerHTML = `
          <div style="grid-column: 1 / -1;">
            <div class="table-empty" style="padding: var(--space-16);">
              <div class="empty-icon">📦</div>
              <div class="empty-title">Nenhum curso disponível ainda</div>
              <p>Quando o administrador liberar acesso a um curso, ele aparecerá aqui.</p>
            </div>
          </div>`;
                return;
            }

            grid.innerHTML = courses.map(course => _renderCourseCard(course)).join('');

        } catch (err) {
            grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; color: var(--error); padding: var(--space-8);">
          <p>Erro ao carregar seus cursos: ${UI.escapeHtml(err.message)}</p>
        </div>`;
        }
    }

    function _renderCourseCard(course) {
        const coverUrl = API.getCoverUrl(course.cover_image_path);
        const courseUrl = `course-view.html?id=${course.course_id}`;

        return `
      <article class="course-card" onclick="window.location.href='${courseUrl}'" tabindex="0"
        role="button" aria-label="Acessar curso: ${UI.escapeHtml(course.title)}"
        onkeydown="if(event.key==='Enter' || event.key===' ') window.location.href='${courseUrl}'"
        style="cursor:pointer;">
        <div class="course-card-cover">
          ${coverUrl
                ? `<img src="${coverUrl}" alt="Capa de ${UI.escapeHtml(course.title)}" loading="lazy" />`
                : `<div class="course-card-cover-placeholder">📚</div>`
            }
        </div>
        <div class="course-card-body">
          <h3 class="course-card-title">${UI.escapeHtml(course.title)}</h3>
          <p class="course-card-description">
            ${UI.escapeHtml(course.description || 'Acesse o material completo deste curso.')}
          </p>
          <div style="margin-top: auto;">
            <span class="badge badge-success">✅ Acesso Liberado</span>
          </div>
        </div>
        <div class="course-card-footer">
          <a href="${courseUrl}" class="btn btn-primary btn-block">
            📖 Acessar Curso
          </a>
        </div>
      </article>
    `;
    }


    // ================================================================
    // COURSE VIEW: Página de Visualização e Download
    // ================================================================

    async function initCourseView() {
        const result = await initLayout();
        if (!result) return;

        // Extrai ID do curso da URL (?id=UUID)
        const params = new URLSearchParams(window.location.search);
        const courseId = params.get('id');

        if (!courseId) {
            _showAccessDenied('ID do curso não informado na URL.');
            return;
        }

        // Verifica acesso antes de mostrar qualquer coisa
        const hasAccess = await API.checkCourseAccess(courseId);
        if (!hasAccess) {
            _showAccessDenied('Você não tem permissão para acessar este curso.');
            return;
        }

        // Carrega dados do curso
        await loadCourseDetails(courseId);

        // Configura botão de download
        document.getElementById('download-btn')?.addEventListener('click', async () => {
            await handleDownload(courseId);
        });
    }

    async function loadCourseDetails(courseId) {
        const container = document.getElementById('course-details');
        if (!container) return;

        // Mostra skeleton
        document.getElementById('course-title-skeleton')?.classList.remove('hidden');
        document.getElementById('course-content')?.classList.add('hidden');

        try {
            const course = await API.getCourse(courseId);

            // Preenche dados
            const coverEl = document.getElementById('course-cover-img');
            const coverPlaceholder = document.getElementById('course-cover-placeholder');
            const titleEl = document.getElementById('course-title');
            const descEl = document.getElementById('course-description');
            const downloadBtn = document.getElementById('download-btn');

            const coverUrl = API.getCoverUrl(course.cover_image_path);
            if (coverEl && coverUrl) {
                coverEl.src = coverUrl;
                coverEl.alt = `Capa de ${course.title}`;
                coverEl.style.display = 'block';
                coverPlaceholder?.style && (coverPlaceholder.style.display = 'none');
            }

            if (titleEl) titleEl.textContent = course.title;
            if (descEl) descEl.textContent = course.description || 'Material exclusivo da plataforma.';

            // Atualiza o <title> da página
            document.title = `${course.title} — CursoPlataforma`;

            // Se não houver PDF, desabilita o botão
            if (downloadBtn && !course.pdf_file_path) {
                downloadBtn.disabled = true;
                downloadBtn.innerHTML = '⚠️ PDF não disponível ainda';
                downloadBtn.style.opacity = '0.5';
                downloadBtn.style.cursor = 'not-allowed';
            }

            // Esconde skeleton e mostra conteúdo
            document.getElementById('course-title-skeleton')?.classList.add('hidden');
            document.getElementById('course-content')?.classList.remove('hidden');

            return course;

        } catch (err) {
            container.innerHTML = `<p style="color:var(--error);">Erro ao carregar dados do curso: ${UI.escapeHtml(err.message)}</p>`;
        }
    }

    async function handleDownload(courseId) {
        const btn = document.getElementById('download-btn');
        const originalHTML = btn.innerHTML;

        btn.innerHTML = '⏳ Gerando link de download...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.8';

        try {
            // Re-verifica acesso (segurança dupla)
            const hasAccess = await API.checkCourseAccess(courseId);
            if (!hasAccess) {
                UI.toastError('Acesso negado. Você não tem permissão para baixar este material.');
                btn.innerHTML = originalHTML;
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
                return;
            }

            // Busca o caminho do PDF
            const course = await API.getCourse(courseId);
            if (!course.pdf_file_path) throw new Error('PDF não encontrado para este curso.');

            // Gera URL assinada (60 segundos de validade)
            const signedUrl = await API.getSignedPdfUrl(course.pdf_file_path);

            // Força o download
            const a = document.createElement('a');
            a.href = signedUrl;
            a.download = `${course.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            UI.toastSuccess('Download iniciado! O link expira em 60 segundos por segurança.', 'Download');

        } catch (err) {
            UI.toastError('Erro ao gerar link de download: ' + err.message);
        } finally {
            btn.innerHTML = originalHTML;
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
        }
    }

    function _showAccessDenied(msg) {
        const container = document.getElementById('course-details') || document.body;
        container.innerHTML = `
      <div style="
        text-align: center;
        padding: var(--space-16);
        max-width: 480px;
        margin: 0 auto;
      ">
        <div style="font-size: 4rem; margin-bottom: var(--space-4);">🔒</div>
        <h2 style="font-family: var(--font-heading); margin-bottom: var(--space-3);">Acesso Negado</h2>
        <p style="color: var(--text-secondary); margin-bottom: var(--space-6);">${UI.escapeHtml(msg)}</p>
        <a href="dashboard.html" class="btn btn-primary">← Voltar para meus cursos</a>
      </div>
    `;
    }


    // API pública
    return {
        initDashboard,
        initCourseView,
    };

})();
