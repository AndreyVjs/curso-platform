// ============================================================
// CURSO PLATFORM — api.js
// Camada de Acesso a Dados: Wrapper do Supabase
// Todas as operações de banco passam por aqui
// ============================================================

const API = (() => {

    function sb() { return Auth.client(); }


    // ================================================================
    // USERS
    // ================================================================

    /** Lista todos os usuários (admin only — RLS garante) */
    async function listUsers({ role = null } = {}) {
        let query = sb()
            .from('users')
            .select('id, full_name, email, role, created_at')
            .order('created_at', { ascending: false });

        if (role) query = query.eq('role', role);

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
    }

    /** Lista apenas alunos */
    async function listStudents() {
        return listUsers({ role: 'student' });
    }

    /**
     * Cria um usuário via RPC (sem derrubar sessão do Admin).
     * Chama a function admin_create_user() no Supabase.
     */
    async function createUser({ email, password, full_name, role = 'student' }) {
        const { data, error } = await sb().rpc('admin_create_user', {
            p_email: email,
            p_password: password,
            p_full_name: full_name,
            p_role: role,
        });

        if (error) {
            // Trata erros do PL/pgSQL (prefixados: "CONFLICT:", "VALIDATION:", etc.)
            const msg = error.message.replace(/^(CONFLICT|VALIDATION|UNAUTHORIZED|FORBIDDEN|INVALID): /, '');
            throw new Error(msg);
        }

        // data contém { success, user_id, email, role, message }
        return data;
    }

    /**
     * Deleta um usuário via RPC.
     */
    async function deleteUser(userId) {
        const { data, error } = await sb().rpc('admin_delete_user', {
            p_target_user_id: userId,
        });

        if (error) {
            const msg = error.message.replace(/^(NOT_FOUND|UNAUTHORIZED|FORBIDDEN|INVALID): /, '');
            throw new Error(msg);
        }
        return data;
    }

    /** Atualiza dados públicos de um usuário */
    async function updateUser(userId, { full_name, email, password }) {
        // Como alterar senha ou email sem ServiceRole exige RPC (se não existir, daremos throw ou limitamos aqui).
        // Atualiza primeiramente na tabela users
        const updates = { full_name };

        // Se pudermos alterar email/password, precisaríamos de uma RPC admin_update_user (opcional dependendo da estrutura atual).
        // Por hora atualiza os dados públicos
        const { data, error } = await sb()
            .from('users')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    // ================================================================
    // COURSES
    // ================================================================

    /** Lista todos os cursos (admin vê todos, aluno vê apenas ativos — RLS) */
    async function listCourses({ activeOnly = false } = {}) {
        let query = sb()
            .from('courses')
            .select('id, title, description, cover_image_path, pdf_file_path, active, created_at')
            .order('created_at', { ascending: false });

        if (activeOnly) query = query.eq('active', true);

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
    }

    /** Busca um curso pelo ID */
    async function getCourse(courseId) {
        const { data, error } = await sb()
            .from('courses')
            .select('id, title, description, cover_image_path, pdf_file_path, active, created_at')
            .eq('id', courseId)
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /**
     * Cria um curso com upload de capa e PDF.
     * @param {{ title, description, coverFile, pdfFile }} courseData
     */
    async function createCourse({ title, description, coverFile, pdfFile }) {
        // 1) Upload da capa (bucket público: course_assets)
        let cover_image_path = null;
        if (coverFile) {
            const coverExt = coverFile.name.split('.').pop();
            const coverPath = `covers/${crypto.randomUUID()}.${coverExt}`;
            const { error: coverErr } = await sb().storage
                .from(CONFIG.BUCKET_COVERS)
                .upload(coverPath, coverFile, { upsert: false });

            if (coverErr) throw new Error(`Erro ao enviar capa: ${coverErr.message}`);
            cover_image_path = coverPath;
        }

        // 2) Upload do PDF (bucket privado: course_files)
        let pdf_file_path = null;
        if (pdfFile) {
            const pdfPath = `pdfs/${crypto.randomUUID()}.pdf`;
            const { error: pdfErr } = await sb().storage
                .from(CONFIG.BUCKET_PDFS)
                .upload(pdfPath, pdfFile, { contentType: 'application/pdf', upsert: false });

            if (pdfErr) throw new Error(`Erro ao enviar PDF: ${pdfErr.message}`);
            pdf_file_path = pdfPath;
        }

        // 3) Insere na tabela courses
        const { data, error } = await sb()
            .from('courses')
            .insert({ title, description, cover_image_path, pdf_file_path })
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /** Atualiza um curso */
    async function updateCourse(courseId, { title, description, coverFile, pdfFile }) {
        const course = await getCourse(courseId);
        let updates = { title, description };

        // 1) Novo upload da capa
        if (coverFile) {
            const coverExt = coverFile.name.split('.').pop();
            const coverPath = `covers/${crypto.randomUUID()}.${coverExt}`;
            const { error: coverErr } = await sb().storage
                .from(CONFIG.BUCKET_COVERS)
                .upload(coverPath, coverFile, { upsert: false });

            if (coverErr) throw new Error(`Erro ao enviar nova capa: ${coverErr.message}`);
            updates.cover_image_path = coverPath;

            // Tentativa de remover a capa antiga (ignora erro)
            if (course.cover_image_path) {
                sb().storage.from(CONFIG.BUCKET_COVERS).remove([course.cover_image_path]);
            }
        }

        // 2) Novo upload do PDF
        if (pdfFile) {
            const pdfPath = `pdfs/${crypto.randomUUID()}.pdf`;
            const { error: pdfErr } = await sb().storage
                .from(CONFIG.BUCKET_PDFS)
                .upload(pdfPath, pdfFile, { contentType: 'application/pdf', upsert: false });

            if (pdfErr) throw new Error(`Erro ao enviar novo PDF: ${pdfErr.message}`);
            updates.pdf_file_path = pdfPath;

            // Tentativa de remover o PDF antigo (ignora erro)
            if (course.pdf_file_path) {
                sb().storage.from(CONFIG.BUCKET_PDFS).remove([course.pdf_file_path]);
            }
        }

        const { data, error } = await sb()
            .from('courses')
            .update(updates)
            .eq('id', courseId)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /** Ativa/desativa um curso */
    async function toggleCourseStatus(courseId, active) {
        const { data, error } = await sb()
            .from('courses')
            .update({ active })
            .eq('id', courseId)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /** Deleta um curso (e limpa os arquivos do Storage) */
    async function deleteCourse(courseId) {
        // Busca paths antes de deletar
        const course = await getCourse(courseId);

        // Remove arquivos do storage (sem parar se falhar)
        if (course.cover_image_path) {
            await sb().storage.from(CONFIG.BUCKET_COVERS).remove([course.cover_image_path]);
        }
        if (course.pdf_file_path) {
            await sb().storage.from(CONFIG.BUCKET_PDFS).remove([course.pdf_file_path]);
        }

        const { error } = await sb().from('courses').delete().eq('id', courseId);
        if (error) throw new Error(error.message);
    }


    // ================================================================
    // ENROLLMENTS
    // ================================================================

    /** Lista matrículas com JOIN de aluno e curso */
    async function listEnrollments() {
        const { data, error } = await sb()
            .from('enrollments')
            .select(`
        id,
        granted_at,
        user_id,
        course_id,
        users!enrollments_user_id_fkey ( full_name, email ),
        courses ( title )
      `)
            .order('granted_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data;
    }

    /** Matricula um aluno em um curso */
    async function enrollStudent(userId, courseId) {
        const adminProfile = Auth.currentProfile();
        const { data, error } = await sb()
            .from('enrollments')
            .insert({
                user_id: userId,
                course_id: courseId,
                granted_by: adminProfile?.id || null,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') throw new Error('Este aluno já está matriculado neste curso.');
            throw new Error(error.message);
        }
        return data;
    }

    /** Remove uma matrícula */
    async function unenrollStudent(enrollmentId) {
        const { error } = await sb()
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId);

        if (error) throw new Error(error.message);
    }


    // ================================================================
    // ALUNO: Cursos matriculados
    // ================================================================

    /**
     * Busca os cursos do aluno logado via RPC.
     * Retorna somente cursos ativos com matrícula ativa.
     */
    async function getMyEnrolledCourses() {
        const { data, error } = await sb().rpc('get_my_enrolled_courses');
        if (error) throw new Error(error.message);
        return data;
    }

    /** Verifica se o usuário tem acesso a um curso específico */
    async function checkCourseAccess(courseId) {
        const { data, error } = await sb().rpc('check_course_access', {
            p_course_id: courseId,
        });
        if (error) return false;
        return !!data;
    }

    /**
     * Gera uma URL assinada para download do PDF (válida por N segundos).
     * A geração SÓ funciona se a policy de storage permitir (aluno matriculado).
     * @param {string} pdfPath - pdf_file_path salvo no banco
     * @returns {string} URL assinada
     */
    async function getSignedPdfUrl(pdfPath) {
        const { data, error } = await sb().storage
            .from(CONFIG.BUCKET_PDFS)
            .createSignedUrl(pdfPath, CONFIG.SIGNED_URL_EXPIRES);

        if (error) throw new Error('Não foi possível gerar o link de download.');
        return data.signedUrl;
    }


    // ================================================================
    // STORAGE: URL pública da capa
    // ================================================================

    /**
     * Retorna a URL pública de uma imagem de capa.
     * @param {string} imagePath
     * @returns {string} URL pública
     */
    function getCoverUrl(imagePath) {
        if (!imagePath) return null;
        const { data } = Auth.client().storage
            .from(CONFIG.BUCKET_COVERS)
            .getPublicUrl(imagePath);
        return data?.publicUrl || null;
    }


    // ================================================================
    // ADMIN: Estatísticas do Dashboard
    // ================================================================

    async function getAdminStats() {
        const { data, error } = await sb().rpc('get_admin_stats');
        if (error) throw new Error(error.message);
        return data;
    }


    // API pública
    return {
        // Users
        listUsers,
        listStudents,
        createUser,
        updateUser,
        deleteUser,

        // Courses
        listCourses,
        getCourse,
        createCourse,
        updateCourse,
        toggleCourseStatus,
        deleteCourse,

        // Enrollments
        listEnrollments,
        enrollStudent,
        unenrollStudent,

        // Student
        getMyEnrolledCourses,
        checkCourseAccess,
        getSignedPdfUrl,

        // Storage
        getCoverUrl,

        // Stats
        getAdminStats,
    };

})();
