// ============================================================
// CURSOS LUCRATIVOS — config.js
// Configuração Central: Supabase e constantes da plataforma
// ============================================================

const CONFIG = Object.freeze({

  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL: 'https://fhifkiwidjdlnhmhetlo.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_LeqF9LDE5UlJN-SCy7sZKA_-M1C8USd',

  // ── Storage Buckets ───────────────────────────────────────
  BUCKET_COVERS: 'course_assets',
  BUCKET_PDFS: 'course_files',

  // ── Rotas ─────────────────────────────────────────────────
  ROUTES: {
    LOGIN: '/login.html',
    CATALOG: '/catalogo.html',
    ADMIN_DASHBOARD: '/frontend/pages/admin/dashboard.html',
    ADMIN_USERS: '/frontend/pages/admin/users.html',
    ADMIN_COURSES: '/frontend/pages/admin/courses.html',
    ADMIN_ENROLLMENTS: '/frontend/pages/admin/enrollments.html',
    ADMIN_BUNDLES: '/frontend/pages/admin/bundles.html',
    STUDENT_DASHBOARD: '/frontend/pages/student/dashboard.html',
    STUDENT_COURSE: '/frontend/pages/student/course-view.html',
  },

  // ── WhatsApp ───────────────────────────────────────────────
  // Troque pelo número real com DDI+DDD (sem espaços ou símbolos)
  WHATSAPP_NUMBER: '5511999999999',
  WHATSAPP_MESSAGE: 'Olá! Vi os cursos na plataforma e gostaria de saber mais.',

  // ── Roles ─────────────────────────────────────────────────
  ROLES: {
    ADMIN: 'admin',
    STUDENT: 'student',
  },

  // ── URL de Acesso Assinada (segundos) ─────────────────────
  SIGNED_URL_EXPIRES: 60,

  // ── Toast ─────────────────────────────────────────────────
  TOAST_DURATION: 4500,
});
