// ============================================================
// CURSOS LUCRATIVOS — api.js
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
            .select('id, full_name, email, role, is_vip, created_at')
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
            const msg = error.message.replace(/^(CONFLICT|VALIDATION|UNAUTHORIZED|FORBIDDEN|INVALID): /, '');
            throw new Error(msg);
        }
        return data;
    }

    /** Deleta um usuário via RPC. */
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
    async function updateUser(userId, { full_name }) {
        const { data, error } = await sb()
            .from('users')
            .update({ full_name })
            .eq('id', userId)
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /**
     * Alterna o status VIP de um aluno.
     * @param {string} userId
     * @param {boolean} isVip
     */
    async function toggleVip(userId, isVip) {
        const { data, error } = await sb()
            .from('users')
            .update({ is_vip: isVip })
            .eq('id', userId)
            .select('id, is_vip')
            .single();

        if (error) throw new Error(error.message);
        return data;
    }


    // ================================================================
    // COURSES
    // ================================================================

    /** Lista todos os cursos (admin vê todos, aluno vê apenas ativos — RLS) */
    async function listCourses({ activeOnly = false, category = null } = {}) {
        let query = sb()
            .from('courses')
            .select('id, title, description, cover_image_path, pdf_file_path, active, category, created_at')
            .order('created_at', { ascending: false });

        if (activeOnly) query = query.eq('active', true);
        if (category) query = query.eq('category', category);

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return data;
    }

    /** Busca um curso pelo ID */
    async function getCourse(courseId) {
        const { data, error } = await sb()
            .from('courses')
            .select('id, title, description, cover_image_path, pdf_file_path, active, category, created_at')
            .eq('id', courseId)
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /**
     * Cria um curso com upload de capa e PDF.
     * @param {{ title, description, category, coverFile, pdfFile }} courseData
     */
    async function createCourse({ title, description, category, coverFile, pdfFile }) {
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

        let pdf_file_path = null;
        if (pdfFile) {
            const pdfPath = `pdfs/${crypto.randomUUID()}.pdf`;
            const { error: pdfErr } = await sb().storage
                .from(CONFIG.BUCKET_PDFS)
                .upload(pdfPath, pdfFile, { contentType: 'application/pdf', upsert: false });
            if (pdfErr) throw new Error(`Erro ao enviar PDF: ${pdfErr.message}`);
            pdf_file_path = pdfPath;
        }

        const { data, error } = await sb()
            .from('courses')
            .insert({ title, description, category: category || null, cover_image_path, pdf_file_path })
            .select()
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /** Atualiza um curso */
    async function updateCourse(courseId, { title, description, category, coverFile, pdfFile }) {
        const course = await getCourse(courseId);
        let updates = { title, description, category: category || null };

        if (coverFile) {
            const coverExt = coverFile.name.split('.').pop();
            const coverPath = `covers/${crypto.randomUUID()}.${coverExt}`;
            const { error: coverErr } = await sb().storage
                .from(CONFIG.BUCKET_COVERS)
                .upload(coverPath, coverFile, { upsert: false });
            if (coverErr) throw new Error(`Erro ao enviar nova capa: ${coverErr.message}`);
            updates.cover_image_path = coverPath;
            if (course.cover_image_path) {
                sb().storage.from(CONFIG.BUCKET_COVERS).remove([course.cover_image_path]);
            }
        }

        if (pdfFile) {
            const pdfPath = `pdfs/${crypto.randomUUID()}.pdf`;
            const { error: pdfErr } = await sb().storage
                .from(CONFIG.BUCKET_PDFS)
                .upload(pdfPath, pdfFile, { contentType: 'application/pdf', upsert: false });
            if (pdfErr) throw new Error(`Erro ao enviar novo PDF: ${pdfErr.message}`);
            updates.pdf_file_path = pdfPath;
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
        const course = await getCourse(courseId);
        if (course.cover_image_path) {
            await sb().storage.from(CONFIG.BUCKET_COVERS).remove([course.cover_image_path]);
        }
        if (course.pdf_file_path) {
            await sb().storage.from(CONFIG.BUCKET_PDFS).remove([course.pdf_file_path]);
        }
        const { error } = await sb().from('courses').delete().eq('id', courseId);
        if (error) throw new Error(error.message);
    }

    /**
     * Retorna as categorias distintas de cursos ativos via RPC.
     * @returns {string[]}
     */
    async function getDistinctCategories() {
        const { data, error } = await sb().rpc('get_distinct_categories');
        if (error) return [];
        return (data || []).map(r => r.category).filter(Boolean);
    }


    // ================================================================
    // BUNDLES (Pacotes de Cursos)
    // ================================================================

    /** Lista todos os bundles */
    async function listBundles() {
        const { data, error } = await sb()
            .from('bundles')
            .select('id, name, description, active, created_at')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        return data;
    }

    /** Busca um bundle pelo ID, com seus cursos */
    async function getBundle(bundleId) {
        const { data, error } = await sb()
            .from('bundles')
            .select(`id, name, description, active, bundle_courses ( course_id, courses ( id, title ) )`)
            .eq('id', bundleId)
            .single();

        if (error) throw new Error(error.message);
        return data;
    }

    /** Cria um bundle e associa a lista de course_ids */
    async function createBundle({ name, description, courseIds = [] }) {
        const { data: bundle, error } = await sb()
            .from('bundles')
            .insert({ name, description })
            .select()
            .single();

        if (error) throw new Error(error.message);

        if (courseIds.length > 0) {
            const rows = courseIds.map(cid => ({ bundle_id: bundle.id, course_id: cid }));
            const { error: relErr } = await sb().from('bundle_courses').insert(rows);
            if (relErr) throw new Error(relErr.message);
        }
        return bundle;
    }

    /** Deleta um bundle (bundle_courses removidos por CASCADE) */
    async function deleteBundle(bundleId) {
        const { error } = await sb().from('bundles').delete().eq('id', bundleId);
        if (error) throw new Error(error.message);
    }

    /**
     * Libera todos os cursos de um bundle para um aluno via RPC.
     * @param {string} bundleId
     * @param {string} userId
     */
    async function grantBundle(bundleId, userId) {
        const { data, error } = await sb().rpc('grant_bundle_to_student', {
            p_bundle_id: bundleId,
            p_user_id: userId,
        });

        if (error) {
            const msg = error.message.replace(/^(UNAUTHORIZED|FORBIDDEN|INVALID): /, '');
            throw new Error(msg);
        }
        return data;
    }


    // ================================================================
    // ENROLLMENTS
    // ================================================================

    /** Lista matrículas com JOIN de aluno e curso */
    async function listEnrollments() {
        const { data, error } = await sb()
            .from('enrollments')
            .select(`
                id, granted_at, user_id, course_id,
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
    // ALUNO: Cursos
    // ================================================================

    /**
     * Busca os cursos do aluno logado via RPC.
     * VIPs recebem todos os cursos ativos; alunos normais apenas os matriculados.
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
     * @param {string} pdfPath
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
        listUsers, listStudents, createUser, updateUser, deleteUser, toggleVip,
        // Courses
        listCourses, getCourse, createCourse, updateCourse, toggleCourseStatus, deleteCourse, getDistinctCategories,
        // Bundles
        listBundles, getBundle, createBundle, deleteBundle, grantBundle,
        // Enrollments
        listEnrollments, enrollStudent, unenrollStudent,
        // Student
        getMyEnrolledCourses, checkCourseAccess, getSignedPdfUrl,
        // Storage
        getCoverUrl,
        // Stats
        getAdminStats,
    };

})();
