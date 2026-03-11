// ============================================================
// CURSO PLATFORM — ui.js
// DOM Helpers: Toasts, Modais, Loading, Utilitários de UI
// ============================================================

const UI = (() => {

    // ── Toast / Snackbar ──────────────────────────────────────

    function _ensureContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Exibe um toast (snackbar) na tela.
     * @param {string} message - Mensagem principal
     * @param {'success'|'error'|'info'|'warning'} type
     * @param {string} [title] - Título opcional
     */
    function toast(message, type = 'info', title = '') {
        const container = _ensureContainer();

        const icons = {
            success: '✅',
            error: '❌',
            info: 'ℹ️',
            warning: '⚠️',
        };

        const titles = {
            success: title || 'Sucesso',
            error: title || 'Erro',
            info: title || 'Informação',
            warning: title || 'Atenção',
        };

        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="toast-content">
        <div class="toast-title">${_escapeHtml(titles[type])}</div>
        <div class="toast-message">${_escapeHtml(message)}</div>
      </div>
    `;

        container.appendChild(el);

        // Remove após duração
        const duration = CONFIG.TOAST_DURATION || 4500;
        const timer = setTimeout(() => _removeToast(el), duration);

        // Clique para remover antes do tempo
        el.addEventListener('click', () => {
            clearTimeout(timer);
            _removeToast(el);
        });
    }

    function _removeToast(el) {
        el.classList.add('removing');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        // Fallback se animationend não disparar
        setTimeout(() => el.remove(), 500);
    }

    const toastSuccess = (msg, title) => toast(msg, 'success', title);
    const toastError = (msg, title) => toast(msg, 'error', title);
    const toastInfo = (msg, title) => toast(msg, 'info', title);
    const toastWarning = (msg, title) => toast(msg, 'warning', title);


    // ── Modais ────────────────────────────────────────────────

    /**
     * Abre um modal pelo ID do overlay.
     * @param {string} overlayId - ID do elemento .modal-overlay
     */
    function openModal(overlayId) {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Fechar ao clicar fora do modal
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(overlayId);
        }, { once: true });

        // Fechar com ESC
        const escHandler = (e) => {
            if (e.key === 'Escape') { closeModal(overlayId); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);
    }

    function closeModal(overlayId) {
        const overlay = document.getElementById(overlayId);
        if (!overlay) return;
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }


    // ── Botão Loading ─────────────────────────────────────────

    /**
     * Coloca um botão em estado de loading.
     * @param {HTMLButtonElement} btn
     * @param {string} loadingText
     */
    function setButtonLoading(btn, loadingText = 'Aguarde...') {
        btn._originalText = btn.innerHTML;
        btn._originalDisabled = btn.disabled;
        btn.classList.add('loading');
        btn.disabled = true;
        btn.innerHTML = loadingText;
    }

    /**
     * Restaura o botão ao estado original.
     * @param {HTMLButtonElement} btn
     */
    function resetButton(btn) {
        btn.classList.remove('loading');
        btn.disabled = btn._originalDisabled || false;
        if (btn._originalText !== undefined) btn.innerHTML = btn._originalText;
    }


    // ── Empty States ──────────────────────────────────────────

    function renderEmpty(container, { icon = '📭', title = 'Nenhum item encontrado', message = '' } = {}) {
        container.innerHTML = `
      <div class="table-empty">
        <div class="empty-icon">${icon}</div>
        <div class="empty-title">${_escapeHtml(title)}</div>
        ${message ? `<p>${_escapeHtml(message)}</p>` : ''}
      </div>
    `;
    }


    // ── Skeleton Loading ──────────────────────────────────────

    function renderSkeletonGrid(container, count = 6) {
        container.innerHTML = Array(count).fill('').map(() => `
      <div class="skeleton skeleton-card"></div>
    `).join('');
    }

    function renderSkeletonRows(tbodyEl, cols = 4, rows = 5) {
        tbodyEl.innerHTML = Array(rows).fill('').map(() => `
      <tr>${Array(cols).fill('').map(() => `
        <td><div class="skeleton skeleton-text" style="width:${60 + Math.random() * 30}%"></div></td>
      `).join('')}</tr>
    `).join('');
    }


    // ── Helpers ───────────────────────────────────────────────

    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Formata data ISO para exibição em pt-BR */
    function formatDate(isoString) {
        if (!isoString) return '—';
        return new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        }).format(new Date(isoString));
    }

    /** Alias de document.getElementById para brevidade */
    const el = (id) => document.getElementById(id);

    /** Alias de querySelector no document */
    const qs = (selector) => document.querySelector(selector);

    /** Alias de querySelectorAll no document */
    const qsa = (selector) => document.querySelectorAll(selector);

    /** Define visibilidade de um elemento */
    function show(el) { el?.classList.remove('hidden'); }
    function hide(el) { el?.classList.add('hidden'); }
    function toggle(el, condition) {
        if (condition) show(el); else hide(el);
    }

    /** Trunca uma string para N caracteres */
    function truncate(str, n = 120) {
        if (!str) return '';
        return str.length > n ? str.slice(0, n) + '…' : str;
    }

    /** Obtém iniciais de um nome (ex: "João Silva" → "JS") */
    function initials(name) {
        if (!name) return '?';
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    }


    /** Alterna modo escuro e persiste preferência */
    function toggleDark() {
        const isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('cp-dark', isDark ? '1' : '0');
        // Atualiza o ícone do botão de dark mode onde existir
        document.querySelectorAll('#btn-dark-mode, #btn-dark-student').forEach(btn => {
            if (btn) btn.textContent = isDark ? '☀️' : '🌙';
        });
    }

    /** Restaura o dark mode salvo (chame no início de cada página) */
    function restoreDark() {
        if (localStorage.getItem('cp-dark') === '1') {
            document.documentElement.classList.add('dark');
            document.querySelectorAll('#btn-dark-mode, #btn-dark-student').forEach(btn => {
                if (btn) btn.textContent = '☀️';
            });
        }
    }

    // API pública
    return {
        toast, toastSuccess, toastError, toastInfo, toastWarning,
        openModal, closeModal,
        setButtonLoading, resetButton,
        renderEmpty, renderSkeletonGrid, renderSkeletonRows,
        formatDate, el, qs, qsa, show, hide, toggle,
        truncate, initials, escapeHtml: _escapeHtml,
        toggleDark, restoreDark,
    };

})();
