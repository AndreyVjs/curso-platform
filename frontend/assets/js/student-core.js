// ============================================================
// CURSOS LUCRATIVOS — student-core.js
// Lógica exclusiva da Área do Aluno
// ============================================================

const StudentCore = (() => {

  // ── Inicialização do Layout do Aluno ─────────────────────
  async function initLayout() {
    const result = await Auth.checkSession(CONFIG.ROLES.STUDENT);
    if (!result) return null;

    const { profile } = result;

    const nameEl = document.getElementById('sidebar-user-name');
    const roleEl = document.getElementById('sidebar-user-role');
    const avatarEl = document.getElementById('sidebar-avatar');
    const topbarEl = document.getElementById('topbar-greeting-name');

    if (nameEl) nameEl.textContent = profile.full_name;
    if (roleEl) roleEl.textContent = 'Aluno';
    if (avatarEl) avatarEl.textContent = UI.initials(profile.full_name);
    if (topbarEl) topbarEl.textContent = profile.full_name.split(' ')[0] + '.';

    // Saudação da sidebar
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

  // Estado local do dashboard
  let _allCourses = [];   // todos os cursos retornados pela RPC
  let _downloadedIds = new Set(); // IDs já baixados
  let _isVip = false;

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
      const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      const { data: { user } } = await sb.auth.getUser();

      // Carrega cursos e downloads em paralelo
      const [courses, dlData, userRow] = await Promise.all([
        API.getMyEnrolledCourses(),
        sb.from('downloads').select('course_id').eq('user_id', user.id),
        sb.from('users').select('is_vip').eq('id', user.id).single(),
      ]);

      _allCourses = courses || [];
      _downloadedIds = new Set((dlData.data || []).map(d => d.course_id));
      _isVip = userRow?.data?.is_vip === true;

      // Banner VIP
      const vipBanner = document.getElementById('vip-banner');
      if (vipBanner && _isVip) vipBanner.style.display = 'flex';

      // Monta os filtros de categoria dinamicamente
      await _buildCategoryFilters();

      // Renderiza todos os cursos inicialmente
      _renderFilteredCourses('');

    } catch (err) {
      grid.innerHTML = `
        <div style="grid-column:1/-1; text-align:center; color: var(--error); padding: var(--space-8);">
          <p>Erro ao carregar seus cursos: ${UI.escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  /**
   * Constrói os botões de filtro de categoria com base nas categorias
   * presentes nos cursos do aluno (sem chamar uma RPC extra).
   */
  async function _buildCategoryFilters() {
    const filtersEl = document.getElementById('category-filters');
    if (!filtersEl) return;

    // Coleta categorias únicas dos cursos do aluno
    const catSet = new Set();
    _allCourses.forEach(c => { if (c.category) catSet.add(c.category); });
    const categories = [...catSet].sort();

    // Se há menos de 2 cursos ou 0 categorias, não exibe filtros
    const wrapEl = document.getElementById('category-filters-wrap');
    if (!wrapEl) return;
    if (categories.length < 1) {
      wrapEl.style.display = 'none';
      return;
    }
    wrapEl.style.display = 'block';

    // Botão "Todos" já está no HTML, apenas adiciona os de categoria
    const existing = filtersEl.querySelectorAll('[data-category]:not([data-category=""])');
    existing.forEach(el => el.remove());

    const emojis = { confeitaria: '🧁', salgados: '🥟', fitness: '💪', artesanato: '🎨', gourmet: '🍽', bebidas: '🥤', sobremesas: '🍮', kids: '👦', outros: '📦' };

    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-btn';
      btn.dataset.category = cat;
      const icon = emojis[cat.toLowerCase()] || '📂';
      btn.innerHTML = `${icon} ${UI.escapeHtml(cat)}`;
      btn.addEventListener('click', () => _onCategoryClick(btn, cat));
      filtersEl.appendChild(btn);
    });

    // Evento no botão "Todos"
    document.getElementById('cat-btn-all')?.addEventListener('click', function () {
      _onCategoryClick(this, '');
    });
  }

  function _onCategoryClick(btn, category) {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _renderFilteredCourses(category);
  }

  /**
   * Renderiza o grid filtrando por categoria.
   * @param {string} category - string vazia = todos
   */
  function _renderFilteredCourses(category) {
    const grid = document.getElementById('courses-grid');
    if (!grid) return;

    const filtered = category
      ? _allCourses.filter(c => c.category === category)
      : _allCourses;

    // Atualiza contador
    const countWrap = document.getElementById('filtered-count-wrap');
    const countEl = document.getElementById('filtered-count');
    const labelEl = document.getElementById('filtered-label');
    if (countWrap && _allCourses.length > 0) {
      countWrap.style.display = 'block';
      if (countEl) countEl.textContent = filtered.length;
      if (labelEl) labelEl.textContent = category ? `na categoria "${category}"` : '';
    }

    if (!filtered.length) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1;">
          <div class="table-empty" style="padding: var(--space-16);">
            <div class="empty-icon">📦</div>
            <div class="empty-title">Nenhum curso nesta categoria ainda</div>
            <p>${category ? `Não há cursos de "${UI.escapeHtml(category)}" liberados para você.` : 'Quando o administrador liberar acesso a um curso, ele aparecerá aqui.'}</p>
          </div>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(c => _renderCourseCard(c, _downloadedIds)).join('');
  }

  /**
   * Renderiza um card de curso.
   * Se o aluno não for VIP e não tiver matrícula, exibe cadeado mas
   * o card sempre aparece (VIP já recebe todos da RPC, portanto se
   * está na lista significa que tem acesso).
   */
  function _renderCourseCard(course, downloadedIds = new Set()) {
    const coverUrl = API.getCoverUrl(course.cover_image_path);
    const courseUrl = `course-view.html?id=${course.course_id}`;
    const isNew = !downloadedIds.has(course.course_id);
    const catHtml = course.category
      ? `<span class="badge-category">${UI.escapeHtml(course.category)}</span>`
      : '';

    // Como a RPC já filtra por acesso (enrolled ou VIP), todo curso
    // retornado aqui é acessível. O cadeado é apenas visual na vitrine
    // pública — na área do aluno todos os cards são clicáveis.
    return `
      <article class="course-card" onclick="window.location.href='${courseUrl}'" tabindex="0"
        role="button" aria-label="Acessar curso: ${UI.escapeHtml(course.title)}"
        onkeydown="if(event.key==='Enter'||event.key===' ') window.location.href='${courseUrl}'"
        style="cursor:pointer;">
        <div class="course-card-cover" style="position:relative;">
          ${coverUrl
        ? `<img src="${coverUrl}" alt="Capa de ${UI.escapeHtml(course.title)}" loading="lazy" />`
        : `<div class="course-card-cover-placeholder">📚</div>`
      }
          ${isNew ? '<div style="position:absolute;top:10px;right:10px;background:#ef4444;color:#fff;font-size:.68rem;font-weight:700;padding:3px 9px;border-radius:999px;letter-spacing:.04em;">NOVO</div>' : ''}
        </div>
        <div class="course-card-body">
          ${catHtml ? `<div style="margin-bottom:2px;">${catHtml}</div>` : ''}
          <h3 class="course-card-title">${UI.escapeHtml(course.title)}</h3>
          <p class="course-card-description">
            ${UI.escapeHtml(course.description || 'Acesse o material completo deste curso.')}
          </p>
          <div style="margin-top: auto; display:flex; gap: 6px; align-items:center; flex-wrap:wrap;">
            <span class="badge badge-success">✅ Acesso Liberado</span>
            ${isNew
        ? '<span class="badge" style="background:#fef3c7;color:#92400e;">🆕 Não acessado</span>'
        : '<span class="badge" style="background:#d1fae5;color:#065f46;">✔ Já baixado</span>'
      }
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

    const params = new URLSearchParams(window.location.search);
    const courseId = params.get('id');

    if (!courseId) {
      _showAccessDenied('ID do curso não informado na URL.');
      return;
    }

    const hasAccess = await API.checkCourseAccess(courseId);
    if (!hasAccess) {
      _showAccessDenied('Você não tem permissão para acessar este curso.');
      return;
    }

    await loadCourseDetails(courseId);

    document.getElementById('download-btn')?.addEventListener('click', async () => {
      await handleDownload(courseId);
    });
  }

  async function loadCourseDetails(courseId) {
    const container = document.getElementById('course-details');
    if (!container) return;

    document.getElementById('course-title-skeleton')?.classList.remove('hidden');
    document.getElementById('course-content')?.classList.add('hidden');

    try {
      const course = await API.getCourse(courseId);

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

      document.title = `${course.title} — CursosLucrativos`;

      if (downloadBtn && !course.pdf_file_path) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '⚠️ PDF não disponível ainda';
        downloadBtn.style.opacity = '0.5';
        downloadBtn.style.cursor = 'not-allowed';
      }

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
      const hasAccess = await API.checkCourseAccess(courseId);
      if (!hasAccess) {
        UI.toastError('Acesso negado. Você não tem permissão para baixar este material.');
        return;
      }

      const course = await API.getCourse(courseId);
      if (!course.pdf_file_path) throw new Error('PDF não encontrado para este curso.');

      const signedUrl = await API.getSignedPdfUrl(course.pdf_file_path);

      const a = document.createElement('a');
      a.href = signedUrl;
      a.download = `${course.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      UI.toastSuccess('Download iniciado! O link expira em 60 segundos por segurança.', 'Download');

      // Registra o download para rastreamento
      try {
        const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
        const { data: { user } } = await sb.auth.getUser();
        await sb.from('downloads').upsert(
          { user_id: user.id, course_id: courseId, downloaded_at: new Date().toISOString() },
          { onConflict: 'user_id,course_id' }
        );
        const badgeEl = document.getElementById('download-status-badge');
        if (badgeEl) {
          badgeEl.textContent = '✔ Baixado';
          badgeEl.style.background = '#d1fae5';
          badgeEl.style.color = '#065f46';
        }
      } catch (_) { /* silencioso — não impede o download */ }

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


  // ================================================================
  // PERFIL DO ALUNO
  // ================================================================

  async function initProfile() {
    const result = await initLayout();
    if (!result) return;
    const { profile } = result;
    const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    if (nameInput) nameInput.value = profile.full_name;
    if (emailInput) emailInput.value = profile.email;

    const avatarEl = document.getElementById('profile-avatar');
    const dispNameEl = document.getElementById('profile-display-name');
    const dispEmailEl = document.getElementById('profile-display-email');
    if (avatarEl) avatarEl.textContent = UI.initials(profile.full_name);
    if (dispNameEl) dispNameEl.textContent = profile.full_name;
    if (dispEmailEl) dispEmailEl.textContent = profile.email;

    // Stats
    try {
      const [{ count: enCount }, { count: dlCount }] = await Promise.all([
        sb.from('enrollments').select('*', { count: 'exact', head: true }).eq('user_id', profile.id),
        sb.from('downloads').select('*', { count: 'exact', head: true }).eq('user_id', profile.id),
      ]);

      const enEl = document.getElementById('stat-courses');
      const dlEl = document.getElementById('stat-downloads');
      if (enEl) enEl.textContent = enCount || 0;
      if (dlEl) dlEl.textContent = dlCount || 0;
    } catch (_) { /* erro silencioso em stats */ }

    // Salvar alterações
    document.getElementById('form-profile')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-profile');
      const errEl = document.getElementById('profile-error');
      const newName = nameInput.value.trim();
      const newPwd = document.getElementById('profile-password').value;

      if (!newName) { UI.toastError('O nome é obrigatório.'); return; }

      UI.setButtonLoading(btn, 'Salvando...');
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

      try {
        const { error: nameErr } = await sb.from('users').update({ full_name: newName }).eq('id', profile.id);
        if (nameErr) throw nameErr;

        if (newPwd) {
          if (newPwd.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
          const { error: authErr } = await sb.auth.updateUser({ password: newPwd });
          if (authErr) throw authErr;
        }

        UI.toastSuccess('Seu perfil foi atualizado com sucesso!');
        if (dispNameEl) dispNameEl.textContent = newName;
        document.getElementById('profile-password').value = '';
        const sideAvatar = document.getElementById('sidebar-avatar');
        if (sideAvatar) sideAvatar.textContent = UI.initials(newName);

      } catch (err) {
        if (errEl) {
          errEl.textContent = '❌ ' + err.message;
          errEl.classList.remove('hidden');
        } else {
          UI.toastError(err.message);
        }
      } finally {
        UI.resetButton(btn);
      }
    });
  }

  // API pública
  return {
    initDashboard,
    initCourseView,
    initProfile,
  };

})();
