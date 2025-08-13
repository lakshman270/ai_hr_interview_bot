document.addEventListener('DOMContentLoaded', () => {
    let state = { currentPage: 1, currentSearch: '', currentStatus: 'all', activeInterviewId: null, talentPoolPage: 1 };
    let pollingInterval = null, pipelineChart = null;
    dayjs.extend(dayjs_plugin_relativeTime);

    const getInitials = (name) => { if (!name) return '?'; const parts = name.trim().split(' '); let initials = parts[0].substring(0, 1).toUpperCase(); if (parts.length > 1) initials += parts[parts.length - 1].substring(0, 1).toUpperCase(); return initials; };
    const nameToColor = (name) => { if (!name) return '#cccccc'; let hash = 0; for (let i = 0; i < name.length; i++) { hash = name.charCodeAt(i) + ((hash << 5) - hash); hash = hash & hash; } const color = (hash & 0x00FFFFFF).toString(16).toUpperCase(); return "#" + "00000".substring(0, 6 - color.length) + color; };
    const showToast = (message, type = 'success') => { const toastContainer = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; toastContainer.appendChild(toast); setTimeout(() => toast.remove(), 4000); };
    const setLoading = (isLoading, formType) => { const btn = formType === 'manual' ? DOMElements.submitBtn : DOMElements.screenBtn; const loaderEl = formType === 'manual' ? DOMElements.loader : DOMElements.screenLoader; const text = formType === 'manual' ? DOMElements.btnText : DOMElements.screenBtnText; const error = formType === 'manual' ? DOMElements.errorMessage : DOMElements.screenMessage; btn.disabled = isLoading; loaderEl.classList.toggle('hidden', !isLoading); text.classList.toggle('hidden', isLoading); if (isLoading) error.classList.add('hidden'); };

    const DOMElements = {
        appContainer: document.querySelector('.app-container'), allViews: document.querySelectorAll('.view-container'), navLinks: document.querySelectorAll('.main-nav a'),
        statTotal: document.getElementById('stat-total'), statCompleted: document.getElementById('stat-completed'), statAwaitingCall: document.getElementById('stat-awaiting-call'), navBadgePending: document.getElementById('nav-badge-pending'),
        upNextList: document.getElementById('up-next-list'), activityFeed: document.getElementById('activity-feed'), chartCanvas: document.getElementById('pipeline-chart'), notificationBtn: document.getElementById('notification-btn'), notificationDropdown: document.getElementById('notification-dropdown'),
        interviewListBody: document.getElementById('interview-list-body'), emptyState: document.getElementById('empty-state'), searchInput: document.getElementById('search-input'), filterBtns: document.querySelectorAll('.filter-btn'), paginationControls: document.getElementById('pagination-controls'),
        talentPoolList: document.getElementById('talent-pool-list'), talentPoolPagination: document.getElementById('talent-pool-pagination'),
        newInterviewBtn: document.getElementById('new-interview-btn'), createModal: document.getElementById('create-modal'), selectAllCheckbox: document.getElementById('select-all-checkbox'), deleteSelectedBtn: document.getElementById('delete-selected-btn'),
        detailsPanel: document.getElementById('details-panel'), detailsPlaceholder: document.getElementById('details-panel-placeholder'), detailsContent: document.getElementById('details-panel-content'),
        createModalCloseBtn: document.getElementById('create-modal-close-btn'), modalTabs: document.querySelectorAll('.tab-link'), tabContents: document.querySelectorAll('.tab-content'),
        manualForm: document.getElementById('create-interview-form'), submitBtn: document.getElementById('submit-btn'), btnText: document.getElementById('btn-text'), loader: document.getElementById('loader'), errorMessage: document.getElementById('error-message'),
        screenResumesForm: document.getElementById('screen-resumes-form'), screenBtn: document.getElementById('screen-btn'), screenBtnText: document.getElementById('screen-btn-text'), screenLoader: document.getElementById('screen-loader'), screenMessage: document.getElementById('screen-message'),
        resumeResultsContainer: document.getElementById('resume-results-container'), resumeResultsList: document.getElementById('resume-results-list'), screenAgainBtn: document.getElementById('screen-again-btn'),
        savedJdSelect: document.getElementById('saved-jd-select'), jdText: document.getElementById('jd_text'), saveJdCheckbox: document.getElementById('save-jd-checkbox'), jdTitleInput: document.getElementById('jd-title-input'),
    };

    const phoneIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;

    const handleRouting = () => {
        let hash = window.location.hash || '#dashboard';
        const path = window.location.pathname;
        if (path.includes('/interviews')) hash = '#interviews'; if (path.includes('/talent-pool')) hash = '#talent-pool';
        DOMElements.allViews.forEach(view => view.classList.add('hidden'));
        DOMElements.navLinks.forEach(link => link.parentElement.classList.remove('active'));
        DOMElements.appContainer.classList.remove('talent-pool-active'); DOMElements.detailsPanel.classList.remove('hidden');
        stopPolling();
        const viewId = hash.substring(1) + '-view';
        const targetView = document.getElementById(viewId); const targetLink = document.querySelector(`a[data-view="${viewId}"]`);
        if (targetView && targetLink) {
            targetView.classList.remove('hidden');
            targetLink.parentElement.classList.add('active');
            if (hash === '#dashboard') { fetchDashboardData(); }
            else if (hash === '#interviews') { fetchAndRenderInterviews(); startPolling(); }
            else if (hash === '#talent-pool') { DOMElements.appContainer.classList.add('talent-pool-active'); DOMElements.detailsPanel.classList.add('hidden'); fetchTalentPool(); }
        }
    };

    const refreshActiveData = async () => {
        const hash = window.location.hash || '#dashboard';
        if (hash === '#interviews') { await fetchAndRenderInterviews(); if (state.activeInterviewId) { openDetailsPanel(state.activeInterviewId, false); } }
        if (hash === '#dashboard') { await fetchDashboardData(); }
        if (hash === '#talent-pool') { await fetchTalentPool(); }
    };

    const stopPolling = () => { if (pollingInterval) clearInterval(pollingInterval); pollingInterval = null; };
    const startPolling = () => { stopPolling(); pollingInterval = setInterval(refreshActiveData, 15000); };
    
    const fetchDashboardData = async () => {
        try {
            const response = await fetch('/api/dashboard-data'); if (!response.ok) throw new Error('Failed to fetch dashboard data');
            const data = await response.json();
            DOMElements.statTotal.textContent = data.stats.total_shortlisted || 0;
            DOMElements.statCompleted.textContent = data.stats.completed_count || 0;
            DOMElements.statAwaitingCall.textContent = data.stats.awaiting_call_count || 0;
            DOMElements.navBadgePending.textContent = data.stats.awaiting_call_count || 0;
            DOMElements.upNextList.innerHTML = data.up_next.map(item => `<div class="up-next-item" data-interview-id="${item.id}"> <div class="card-avatar" style="background-color: ${nameToColor(item.candidate_name)};">${getInitials(item.candidate_name)}</div> <div> <p><strong>${item.candidate_name}</strong></p> <p class="text-secondary">AI Score: ${item.score || '--'}/100</p> </div> <button class="action-btn primary" style="margin-left:auto; padding: 6px 12px;">View Report</button> </div>`).join('') || '<p class="text-secondary">No reports ready for review.</p>';
            const activityIcons = { 'created': '➕', 'started': '📞', 'complete': '✔', 'Deleted': '🗑️', 'Analyzed': '🧠', 'failed': '❌', 'timed out': '⏳' };
            const getIcon = (msg) => { for (const key in activityIcons) { if (msg.toLowerCase().includes(key)) return activityIcons[key]; } return '🔔'; };
            DOMElements.notificationDropdown.innerHTML = data.activities.map(act => `<div class="activity-item"> <div class="icon">${getIcon(act.message)}</div> <div> <p>${act.message}</p> <p class="time">${dayjs(act.timestamp).fromNow()}</p> </div> </div>`).join('') || '<p class="text-secondary" style="padding: 1rem;">No recent activity.</p>';
            const chartData = { labels: ['Awaiting Call', 'Active Calls', 'Completed'], datasets: [{ data: [data.stats.awaiting_call_count, data.stats.in_progress_count, data.stats.completed_count], backgroundColor: ['#EAB308', '#3B82F6', '#22C55E'], borderWidth: 0 }] };
            if (pipelineChart) { pipelineChart.destroy(); }
            pipelineChart = new Chart(DOMElements.chartCanvas, { type: 'doughnut', data: chartData, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } } } });
        } catch (error) { showToast(error.message, 'error'); }
    };

    const fetchAndRenderInterviews = async () => { try { const response = await fetch(`/api/interviews?page=${state.currentPage}&search=${encodeURIComponent(state.currentSearch)}&status=${state.currentStatus}`); if (!response.ok) throw new Error('Failed to fetch interviews'); const data = await response.json(); renderInterviewList(data.interviews); renderPagination(data.total_pages, data.current_page, DOMElements.paginationControls, 'interviewPage'); } catch (error) { showToast(error.message, 'error'); DOMElements.interviewListBody.innerHTML = `<p class="error-text">${error.message}</p>`; } };
    const fetchTalentPool = async () => { try { const response = await fetch(`/api/talent-pool?page=${state.talentPoolPage}&search=${encodeURIComponent(state.currentSearch)}`); if (!response.ok) throw new Error('Failed to fetch talent pool'); const data = await response.json(); renderTalentPoolList(data.candidates); renderPagination(data.total_pages, state.talentPoolPage, DOMElements.talentPoolPagination, 'talentPage'); } catch(error) { showToast(error.message, 'error'); } };
    const fetchJds = async () => { try { const response = await fetch('/api/jds'); const jds = await response.json(); DOMElements.savedJdSelect.innerHTML = '<option value="">-- Select a saved JD --</option>'; jds.forEach(jd => { const option = new Option(jd.title, jd.id); option.dataset.description = jd.description; DOMElements.savedJdSelect.appendChild(option); }); } catch (error) { console.error("Failed to fetch JDs:", error); } };

    const renderInterviewList = (interviews) => { DOMElements.interviewListBody.innerHTML = ''; if (!interviews || interviews.length === 0) { DOMElements.emptyState.classList.remove('hidden'); } else { DOMElements.emptyState.classList.add('hidden'); interviews.forEach(interview => DOMElements.interviewListBody.appendChild(createInterviewItem(interview))); } if (state.activeInterviewId) { const card = document.querySelector(`.interview-card[data-interview-id='${state.activeInterviewId}']`); if (card) card.classList.add('active'); } };
    const renderTalentPoolList = (candidates) => { const tbody = DOMElements.talentPoolList; tbody.innerHTML = ''; if (!candidates || candidates.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;">No candidates found.</td></tr>`; } else { candidates.forEach(c => tbody.appendChild(createTalentPoolItem(c))); } };
    const renderPagination = (totalPages, activePage, container, pageType) => { container.innerHTML = ''; if (totalPages <= 1) return; container.innerHTML = `<button class="nav-btn prev-btn" data-page-type="${pageType}" ${activePage === 1 ? 'disabled' : ''}>&lt;</button> <span class="page-info">Page ${activePage} of ${totalPages}</span> <button class="nav-btn next-btn" data-page-type="${pageType}" ${activePage === totalPages ? 'disabled' : ''}>&gt;</button>`; };
    
    const createInterviewItem = (interview) => { const item = document.createElement('div'); item.className = 'interview-card'; item.dataset.interviewId = interview.id; const initials = getInitials(interview.candidate_name), bgColor = nameToColor(interview.candidate_name); item.innerHTML = `<div><input type="checkbox" class="interview-checkbox" data-id="${interview.id}"></div><div class="card-info"><div class="card-avatar" style="background-color: ${bgColor};">${initials}</div><div><div class="candidate-name">${interview.candidate_name}</div><div class="job-position">${interview.job_position}</div></div></div><div class="status-badge ${interview.status}">${interview.status}</div><div class="card-actions">${interview.status === 'pending' ? `<button class="icon-btn call-btn" title="Start AI Call">${phoneIcon}</button>` : ''}</div>`; return item; };
    const createTalentPoolItem = (candidate) => { const item = document.createElement('tr'); const initials = getInitials(candidate.candidate_name), bgColor = nameToColor(candidate.candidate_name); item.innerHTML = `<td class="candidate-cell"><div class="card-avatar" style="background-color: ${bgColor};">${initials}</div><span>${candidate.candidate_name}</span></td><td>${candidate.phone_number || '--'}</td><td>${candidate.skills_to_assess || '--'}</td><td>${candidate.score !== null ? `${candidate.score}/100` : '--'}</td><td><button class="text-btn view-resume-btn">View</button></td>`; return item; };
    const createResumeResultItem = (result, jd) => { const item = document.createElement('div'); item.className = 'resume-result-item'; item.dataset.name = result.candidate_name; item.dataset.phone = result.phone_number; item.dataset.skills = result.skills_to_assess; item.dataset.jd = jd; const initials = getInitials(result.candidate_name), bgColor = nameToColor(result.candidate_name); const score = parseInt(result.match_score, 10); let scoreClass = 'low'; if (score >= 75) scoreClass = 'high'; else if (score >= 50) scoreClass = 'medium'; const canCreate = result.phone_number && result.phone_number.toLowerCase() !== 'n/a'; item.innerHTML = `<div class="card-avatar" style="background-color: ${bgColor};">${initials}</div><div class="resume-result-item-content"><div class="result-candidate-name">${result.candidate_name}</div><div class="ats-score-wrapper"><div class="ats-score-label"><span>ATS Match Score</span><strong>${score}%</strong></div><div class="score-bar"><div class="score-bar-inner ${scoreClass}" style="width: ${score}%;"></div></div></div><p class="match-reason">${result.match_reason}</p></div><button class="create-single-btn" ${!canCreate ? 'disabled' : ''} title="${canCreate ? 'Create interview' : 'No phone number found.'}">Create Interview</button>`; return item; };
    
    const openDetailsPanel = async (interviewId, showLoading = true) => { document.querySelectorAll('.interview-card').forEach(c => c.classList.remove('active')); const card = document.querySelector(`.interview-card[data-interview-id='${interviewId}']`); if (card) card.classList.add('active'); state.activeInterviewId = interviewId; DOMElements.detailsPlaceholder.classList.add('hidden'); DOMElements.detailsContent.classList.remove('hidden'); if(showLoading) DOMElements.detailsContent.innerHTML = '<div class="loader" style="margin: 4rem auto; border-top-color: var(--accent-indigo);"></div>'; try { const response = await fetch(`/api/interviews/${interviewId}`); if (!response.ok) throw new Error('Failed to load details'); renderDetails(await response.json()); } catch (error) { showToast(error.message, 'error'); DOMElements.detailsContent.innerHTML = `<p class="error-text">${error.message}</p>`; } };
    const renderDetails = (data) => {
        const skills = data.skills_to_assess || '';
        const skillTagsHtml = skills.split(',').map(s => s.trim()).filter(Boolean).map(skill => `<span class="skill-tag">${skill}</span>`).join('');
        const recordingHtml = data.recording_url ? `<div class="details-section"><h4>Recording</h4><audio controls src="${data.recording_url}"></audio></div>` : '';
        const getRecommendationClass = (rec) => { if (!rec) return ''; const recLower = rec.toLowerCase(); if (recLower.includes('strong hire') || recLower.includes('hire')) return 'completed'; if (recLower.includes('no hire')) return 'error'; return 'pending'; };
        const initials = getInitials(data.candidate_name), bgColor = nameToColor(data.candidate_name);
        DOMElements.detailsContent.innerHTML = `<div class="details-header"><div class="avatar" style="background-color: ${bgColor};">${initials}</div><div><h2>${data.candidate_name}</h2><p>${data.job_position}</p></div></div><div class="details-section"><h4>Key Skills</h4><div class="skill-tags-container">${skillTagsHtml || '<p class="text-secondary">No specific skills listed.</p>'}</div></div><div class="details-summary-grid"><div class="summary-card"><div class="title">Overall AI Score</div><div class="value">${data.score !== null ? `${data.score}/100` : 'N/A'}</div></div><div class="summary-card"><div class="title">AI Recommendation</div><div class="value recommendation status-badge ${getRecommendationClass(data.recommendation)}">${data.recommendation || 'N/A'}</div></div></div><div class="details-section"><h4>Detailed Analysis</h4><div class="detailed-score-grid"><div class="summary-card"><div class="title">Communication</div><div class="value">${data.comm_score !== null ? `${data.comm_score}/10` : 'N/A'}</div></div><div class="summary-card"><div class="title">Technical Knowledge</div><div class="value">${data.tech_score !== null ? `${data.tech_score}/10` : 'N/A'}</div></div><div class="summary-card"><div class="title">Job Relevance</div><div class="value">${data.relevance_score !== null ? `${data.relevance_score}/10` : 'N/A'}</div></div></div></div>${recordingHtml}<div class="details-section"><h4>AI Assessment</h4><p>${data.assessment || 'N/A'}</p></div>`;
    };

    const handleManualFormSubmit = async (e) => { e.preventDefault(); setLoading(true, 'manual'); const data = { candidate_name: DOMElements.manualForm.candidate_name.value, phone_number: DOMElements.manualForm.phone_number.value, job_position: DOMElements.manualForm.job_position.value, job_description: DOMElements.manualForm.job_description.value, skills_to_assess: DOMElements.manualForm.skills_to_assess.value }; try { const response = await fetch('/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) throw new Error((await response.json()).error || 'Failed to create.'); showToast('Interview created successfully!'); await refreshActiveData(); DOMElements.createModal.classList.add('hidden'); DOMElements.manualForm.reset(); } catch (error) { DOMElements.errorMessage.textContent = error.message; DOMElements.errorMessage.classList.remove('hidden'); } finally { setLoading(false, 'manual'); } };
    const handleScreenResumesSubmit = async (e) => { e.preventDefault(); setLoading(true, 'screen'); const formData = new FormData(DOMElements.screenResumesForm); try { const response = await fetch('/api/analyze-resumes', { method: 'POST', body: formData }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'An error occurred.'); DOMElements.screenResumesForm.classList.add('hidden'); DOMElements.resumeResultsContainer.classList.remove('hidden'); DOMElements.resumeResultsList.innerHTML = ''; if (data.results && data.results.length > 0) { const jd = formData.get('job_description'); data.results.forEach(result => DOMElements.resumeResultsList.appendChild(createResumeResultItem(result, jd))); } else { DOMElements.resumeResultsList.innerHTML = `<p class="text-secondary" style="padding: 2rem;">No candidates could be parsed.</p>`; } } catch (error) { DOMElements.screenMessage.textContent = error.message; DOMElements.screenMessage.className = 'message-text error'; DOMElements.screenMessage.classList.remove('hidden'); } finally { setLoading(false, 'screen'); } };
    const handleCreateSingleInterview = async (button) => { button.disabled = true; button.innerHTML = `<div class="loader" style="width:16px; height:16px; border-color: #fff; border-top-color: transparent;"></div>`; const item = button.closest('.resume-result-item'); const data = { candidate_name: item.dataset.name, phone_number: item.dataset.phone, skills_to_assess: item.dataset.skills, job_description: item.dataset.jd, job_position: DOMElements.jdText.value.substring(0, 50) + "..." }; try { const response = await fetch('/api/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) throw new Error('Failed to create'); button.textContent = 'Created ✔'; button.classList.add('success'); showToast(`Interview for ${data.candidate_name} created!`); refreshActiveData(); } catch (error) { button.textContent = 'Error'; showToast(error.message, 'error'); } };
    const handleListClick = async (e) => { const card = e.target.closest('.interview-card'); if (!card) return; const id = card.dataset.interviewId; if (e.target.closest('.call-btn')) { e.stopPropagation(); const callBtn = e.target.closest('.call-btn'); callBtn.disabled = true; callBtn.innerHTML = '<div class="loader" style="border-top-color: var(--accent-indigo);"></div>'; try { const response = await fetch(`/api/interviews/${id}/start-call`, { method: 'POST' }); if (!response.ok) throw new Error('Failed to start call'); const data = await response.json(); showToast(`Calling ${data.candidate_name}...`, 'info'); refreshActiveData(); } catch (error) { showToast(error.message, 'error'); refreshActiveData(); } } else { openDetailsPanel(id); } };
    const handleDeleteClick = async () => { const ids = Array.from(document.querySelectorAll('#interview-list-body .interview-checkbox:checked')).map(cb => cb.dataset.id); if (ids.length === 0) return; if (confirm(`Are you sure you want to delete ${ids.length} interview(s)?`)) { try { const response = await fetch('/api/interviews/delete', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }); if (!response.ok) throw new Error('Deletion failed'); showToast('Interviews deleted successfully!'); refreshActiveData(); } catch (error) { showToast(error.message, 'error'); } } };
    
    window.addEventListener('hashchange', handleRouting); window.addEventListener('popstate', handleRouting);
    DOMElements.searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter' || DOMElements.searchInput.value === '') { state.currentSearch = DOMElements.searchInput.value; state.currentPage = 1; state.talentPoolPage = 1; refreshActiveData(); } });
    DOMElements.newInterviewBtn.addEventListener('click', () => { DOMElements.createModal.classList.remove('hidden'); fetchJds(); });
    DOMElements.createModalCloseBtn.addEventListener('click', () => { DOMElements.createModal.classList.add('hidden'); DOMElements.screenResumesForm.classList.remove('hidden'); DOMElements.resumeResultsContainer.classList.add('hidden'); });
    DOMElements.modalTabs.forEach(tab => tab.addEventListener('click', () => { DOMElements.modalTabs.forEach(t => t.classList.remove('active')); tab.classList.add('active'); DOMElements.tabContents.forEach(c => c.classList.add('hidden')); document.getElementById(tab.dataset.tab).classList.remove('hidden'); }));
    DOMElements.manualForm.addEventListener('submit', handleManualFormSubmit);
    DOMElements.screenResumesForm.addEventListener('submit', handleScreenResumesSubmit);
    DOMElements.interviewListBody.addEventListener('click', handleListClick);
    DOMElements.talentPoolList.addEventListener('click', (e) => { if (e.target.classList.contains('view-resume-btn')) showToast('Resume storage is planned for a future update.', 'info'); });
    DOMElements.upNextList.addEventListener('click', (e) => { const item = e.target.closest('.up-next-item'); if (item) { openDetailsPanel(item.dataset.interviewId); } });
    DOMElements.resumeResultsContainer.addEventListener('click', (e) => { if (e.target.classList.contains('create-single-btn')) handleCreateSingleInterview(e.target); });
    DOMElements.screenAgainBtn.addEventListener('click', () => { DOMElements.screenResumesForm.classList.remove('hidden'); DOMElements.resumeResultsContainer.classList.add('hidden'); DOMElements.screenResumesForm.reset(); DOMElements.jdText.value = ''; });
    DOMElements.saveJdCheckbox.addEventListener('change', () => DOMElements.jdTitleInput.classList.toggle('hidden', !DOMElements.saveJdCheckbox.checked));
    DOMElements.savedJdSelect.addEventListener('change', () => { const option = DOMElements.savedJdSelect.options[DOMElements.savedJdSelect.selectedIndex]; if (option.value) DOMElements.jdText.value = option.dataset.description; });
    DOMElements.filterBtns.forEach(btn => btn.addEventListener('click', () => { DOMElements.filterBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); state.currentStatus = btn.dataset.status; state.currentPage = 1; fetchAndRenderInterviews(); }));
    document.body.addEventListener('click', (e) => {
        if(e.target.closest('.pagination-controls')) {
            const btn = e.target.closest('.nav-btn, .page-btn');
            if(!btn) return;
            const isInterview = btn.dataset.pageType === 'interviewPage';
            let currentPage = isInterview ? state.currentPage : state.talentPoolPage;
            if(btn.classList.contains('prev-btn')) currentPage--;
            else if(btn.classList.contains('next-btn')) currentPage++;
            else currentPage = parseInt(btn.dataset.page);
            if(isInterview) { state.currentPage = currentPage; fetchAndRenderInterviews(); }
            else { state.talentPoolPage = currentPage; fetchTalentPool(); }
        }
        if (e.target.closest('#notification-btn')) { DOMElements.notificationDropdown.classList.toggle('hidden'); } 
        else if (!e.target.closest('.notification-wrapper')) { DOMElements.notificationDropdown.classList.add('hidden'); }
    });
    DOMElements.selectAllCheckbox.addEventListener('change', () => { document.querySelectorAll('#interview-list-body .interview-checkbox').forEach(cb => cb.checked = DOMElements.selectAllCheckbox.checked); DOMElements.deleteSelectedBtn.classList.toggle('hidden', !DOMElements.selectAllCheckbox.checked); });
    DOMElements.interviewListBody.addEventListener('change', (e) => { if(e.target.classList.contains('interview-checkbox')) { const anyChecked = document.querySelectorAll('#interview-list-body .interview-checkbox:checked').length > 0; DOMElements.deleteSelectedBtn.classList.toggle('hidden', !anyChecked); } });
    DOMElements.deleteSelectedBtn.addEventListener('click', handleDeleteClick);

    handleRouting();
});