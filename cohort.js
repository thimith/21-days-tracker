const SUPABASE_URL = 'https://lwlfrmdjgvybocnpchal.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bGZybWRqZ3Z5Ym9jbnBjaGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjE4MDYsImV4cCI6MjA4OTQzNzgwNn0.3kG4SxxXHSeu3J6_EmPPsO4Q40Yk0ZRabxlms0zS76U';
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

    const localDateStr   = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const parseLocalDate = s => { const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); };

    const _c = {
      userId: null, profile: null, isAdmin: false, isSkool: false, isExclusive: false,
      activeTab: null,
      // Skool data
      skoolMembers: [], skoolCycles: {}, skoolGoals: {}, skoolRedemptions: {}, skoolCheckins: {},
      skoolCheckinsLoaded: new Set(),
      // Exclusive data
      excCohort: null, excMembers: [], excGoals: {}, excRedemptions: {}, excCheckins: {},
      excCheckinsLoaded: new Set(),
    };

    function getCohortDay(startDate, targetDate) {
      const s = parseLocalDate(startDate);
      const t = targetDate ? parseLocalDate(targetDate) : (() => { const n=new Date(); n.setHours(0,0,0,0); return n; })();
      return Math.floor((t-s)/86400000)+1;
    }
    function getCohortDates(startDate) {
      return Array.from({length:21},(_,i)=>{ const d=parseLocalDate(startDate); d.setDate(d.getDate()+i); return localDateStr(d); });
    }
    function getCohortWeekNum(startDate, date) {
      return Math.min(3, Math.max(1, Math.ceil(getCohortDay(startDate,date)/7)));
    }
    function getWeekDates(startDate, weekNum) {
      const s = parseLocalDate(startDate);
      return Array.from({length:7},(_,i)=>{ const d=new Date(s); d.setDate(d.getDate()+(weekNum-1)*7+i); return localDateStr(d); });
    }

    // ── Auth + membership detection ──────────────────────────────────────
    async function init() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user) { window.location.href = 'index.html'; return; }
      _c.userId = session.user.id;

      const [{ data: profile }, { data: skoolMbr }, { data: memberships }] = await Promise.all([
        sb.from('profiles').select('*').eq('id', _c.userId).single(),
        sb.from('skool_members').select('*').eq('user_id', _c.userId).maybeSingle(),
        sb.from('cohort_members').select('cohort_id, cohorts(*)').eq('user_id', _c.userId)
      ]);
      if (!profile) { window.location.href = 'index.html'; return; }
      _c.profile = profile;
      _c.isAdmin     = profile.role === 'admin';
      _c.isSkool     = !!skoolMbr;
      _c.isExclusive = !!(memberships?.length);

      // Admin nav
      const adminEl = document.getElementById('adminNav');
      if (adminEl) adminEl.style.display = _c.isAdmin ? '' : 'none';

      // Decide which tabs to show
      const showSkool     = _c.isAdmin || _c.isSkool;
      const showExclusive = _c.isAdmin || _c.isExclusive;
      const tabBar = document.getElementById('tabBar');

      const titleEl = document.getElementById('pageTitle');
      if (showSkool && showExclusive) {
        tabBar.style.display = 'flex';
        titleEl.style.display = 'none';
        _c.activeTab = 'skool';
      } else if (showSkool) {
        tabBar.style.display = 'none';
        titleEl.textContent = 'Skool Community';
        titleEl.style.display = '';
        _c.activeTab = 'skool';
      } else if (showExclusive) {
        tabBar.style.display = 'none';
        titleEl.textContent = 'Exclusive Cohort';
        titleEl.style.display = '';
        _c.activeTab = 'exclusive';
      } else {
        document.getElementById('content').innerHTML = '<div class="empty-state">No cohort access found.</div>';
        return;
      }

      // Update tab button visibility for admin
      document.getElementById('tabSkool').style.display = showSkool ? '' : 'none';
      document.getElementById('tabExclusive').style.display = showExclusive ? '' : 'none';

      await loadTabData(_c.activeTab);
      renderTab(_c.activeTab);
    }

    async function switchTab(tab) {
      if (_c.activeTab === tab) return;
      _c.activeTab = tab;
      document.getElementById('tabSkool').classList.toggle('active', tab === 'skool');
      document.getElementById('tabExclusive').classList.toggle('active', tab === 'exclusive');
      document.getElementById('content').innerHTML = '<div class="empty-state">Loading…</div>';
      document.getElementById('summaryBar').style.display = 'none';
      await loadTabData(tab);
      renderTab(tab);
    }

    // ── SKOOL DATA ───────────────────────────────────────────────────────
    async function loadTabData(tab) {
      if (tab === 'skool') return loadSkoolData();
      return loadExclusiveData();
    }

    async function loadSkoolData() {
      // Fetch skool member user_ids, then profiles separately (no FK join needed)
      const { data: memberRows } = await sb.from('skool_members').select('user_id');
      if (!memberRows?.length) return;

      const memberIds = memberRows.map(r => r.user_id);
      const { data: profiles } = await sb.from('profiles').select('*').in('id', memberIds);
      _c.skoolMembers = profiles || [];
      if (!_c.skoolMembers.length) return;

      // Most recent cycle per member
      const { data: cycles } = await sb.from('skool_cycles')
        .select('*').in('user_id', memberIds).order('start_date', { ascending: false });
      _c.skoolCycles = {};
      for (const c of (cycles || [])) {
        if (!_c.skoolCycles[c.user_id]) _c.skoolCycles[c.user_id] = c;
      }

      // Goals for all current cycles
      const cycleIds = Object.values(_c.skoolCycles).map(c => c.id);
      if (cycleIds.length) {
        const { data: goals } = await sb.from('goals').select('*').in('cohort_id', cycleIds).order('sort_order');
        _c.skoolGoals = {};
        for (const g of (goals || [])) {
          if (!_c.skoolGoals[g.user_id]) _c.skoolGoals[g.user_id] = [];
          _c.skoolGoals[g.user_id].push(g);
        }
        // Redemptions
        const { data: redemptions } = await sb.from('redemptions').select('*').in('cohort_id', cycleIds).order('strike_number');
        _c.skoolRedemptions = {};
        for (const r of (redemptions || [])) {
          if (!_c.skoolRedemptions[r.user_id]) _c.skoolRedemptions[r.user_id] = [];
          _c.skoolRedemptions[r.user_id].push(r);
        }
        // Checkins for all active cycles
        const allGoalIds = (goals || []).map(g => g.id);
        if (allGoalIds.length) {
          const { data: checkins } = await sb.from('checkins').select('goal_id,date,value').in('goal_id', allGoalIds);
          for (const r of (checkins || [])) _c.skoolCheckins[`${r.goal_id}_${r.date}`] = r.value;
        }
        for (const m of _c.skoolMembers) _c.skoolCheckinsLoaded.add(m.id);
      }
    }

    // ── EXCLUSIVE DATA ───────────────────────────────────────────────────
    async function loadExclusiveData() {
      const { data: memberships } = await sb.from('cohort_members').select('cohort_id, cohorts(*)').eq('user_id', _c.userId);
      if (!memberships?.length) return;
      const cohorts = memberships.map(m => m.cohorts).filter(Boolean);
      const actives = cohorts.filter(c => { const d = getCohortDay(c.start_date); return d >= 1 && d <= 21; });
      _c.excCohort = actives.sort((a,b) => new Date(b.start_date)-new Date(a.start_date))[0]
                    || cohorts.sort((a,b) => new Date(b.start_date)-new Date(a.start_date))[0];
      if (!_c.excCohort) return;

      const { data: memberRows } = await sb.from('cohort_members').select('user_id, profiles(*)').eq('cohort_id', _c.excCohort.id);
      _c.excMembers = (memberRows || []).map(r => r.profiles).filter(Boolean);
      const memberIds = _c.excMembers.map(m => m.id);

      const [goalsRes, redemptionsRes] = await Promise.all([
        sb.from('goals').select('*').eq('cohort_id', _c.excCohort.id).in('user_id', memberIds).order('sort_order'),
        sb.from('redemptions').select('*').eq('cohort_id', _c.excCohort.id).in('user_id', memberIds).order('strike_number')
      ]);
      _c.excGoals = {};
      for (const g of (goalsRes.data || [])) {
        if (!_c.excGoals[g.user_id]) _c.excGoals[g.user_id] = [];
        _c.excGoals[g.user_id].push(g);
      }
      _c.excRedemptions = {};
      for (const r of (redemptionsRes.data || [])) {
        if (!_c.excRedemptions[r.user_id]) _c.excRedemptions[r.user_id] = [];
        _c.excRedemptions[r.user_id].push(r);
      }
      const allGoalIds = (goalsRes.data || []).map(g => g.id);
      if (allGoalIds.length) {
        const { data: checkins } = await sb.from('checkins').select('goal_id,date,value').in('goal_id', allGoalIds);
        for (const r of (checkins || [])) _c.excCheckins[`${r.goal_id}_${r.date}`] = r.value;
      }
      for (const m of _c.excMembers) _c.excCheckinsLoaded.add(m.id);
    }

    // ── RENDER ───────────────────────────────────────────────────────────
    let expandedId = null;

    function renderTab(tab) {
      expandedId = null;
      if (tab === 'skool') renderSkool();
      else renderExclusive();
    }

    // ── SKOOL RENDER ─────────────────────────────────────────────────────
    function renderSkool() {
      const members = _c.skoolMembers;
      if (!members.length) {
        document.getElementById('content').innerHTML = '<div class="empty-state">No Skool members yet.</div>';
        document.getElementById('summaryBar').style.display = 'none';
        return;
      }
      const today = localDateStr();

      // Split active (in cycle or upcoming) vs inactive (between cycles / no cycle)
      const active = [], inactive = [];
      for (const m of members) {
        const cycle = _c.skoolCycles[m.id];
        if (cycle) {
          const day = getCohortDay(cycle.start_date);
          if (day <= 21) active.push(m); // includes upcoming (day < 1) and in-progress
          else inactive.push(m);
        } else {
          inactive.push(m);
        }
      }

      // Sort active by day descending (furthest along first)
      active.sort((a,b) => {
        const da = getCohortDay(_c.skoolCycles[a.id].start_date);
        const db2 = getCohortDay(_c.skoolCycles[b.id].start_date);
        return db2 - da;
      });

      // Summary bar
      const inCycle = active.filter(m => { const c = _c.skoolCycles[m.id]; return c && getCohortDay(c.start_date) >= 1; });
      const pending = members.filter(m => (_c.skoolRedemptions[m.id]||[]).some(r=>r.status==='pending'));
      document.getElementById('summaryBar').style.display = '';
      document.getElementById('summaryBar').innerHTML = `
        <div class="stat-item"><div class="stat-value">${inCycle.length}</div><div class="stat-label">In Cycle</div></div>
        <div class="stat-item"><div class="stat-value">${members.length}</div><div class="stat-label">Total Members</div></div>
        <div class="stat-item"><div class="stat-value${pending.length>0?' warn':''}">${pending.length}</div><div class="stat-label">Owe Redemp.</div></div>`;

      // All active (in-cycle + upcoming) — no collapse
      let html = active.map(m => renderSkoolMemberCard(m)).join('');

      // Between-cycles section — visible but separated
      if (inactive.length) {
        html += `<div style="font-size:0.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;padding:12px 4px 4px;">Between cycles (${inactive.length})</div>`;
        html += inactive.map(m => renderSkoolMemberCard(m, true)).join('');
      }

      document.getElementById('content').innerHTML = html;
    }

    function toggleInactive(el) {
      const list = document.getElementById('inactiveList');
      const isOpen = el.classList.toggle('open');
      list.style.display = isOpen ? '' : 'none';
      sessionStorage.setItem('inactiveOpen', isOpen ? '1' : '0');
    }

    function renderSkoolMemberCard(member, isInactive = false) {
      const cycle = _c.skoolCycles[member.id];
      const goals = _c.skoolGoals[member.id] || [];
      const redemptions = _c.skoolRedemptions[member.id] || [];
      const pendingR = redemptions.filter(r => r.status === 'pending');
      const isSelf = member.id === _c.userId;
      const isOpen = expandedId === member.id;

      let dayLabel = 'Between cycles';
      let dayPillClass = 'day-pill inactive';
      let atRisk = false;

      if (cycle && !isInactive) {
        const day = getCohortDay(cycle.start_date);
        dayLabel = day >= 1 ? `Day ${day}` : `Day ${day} · Upcoming`;
        dayPillClass = day < 1 ? 'day-pill' : 'day-pill';
        atRisk = day >= 1 && (pendingR.length > 0 || redemptions.length >= 2);
      }

      const cardClass = ['member-card', isInactive ? 'inactive' : atRisk ? 'at-risk' : 'complete', isOpen ? 'open' : ''].filter(Boolean).join(' ');
      const badge = !isInactive && atRisk
        ? `<span class="status-badge at-risk">⚠ At Risk</span>`
        : !isInactive
          ? `<span class="status-badge on-track">✓ On Track</span>`
          : '';

      let detailHTML = '';
      if (isOpen) {
        const skoolToday = localDateStr();
        const skoolDates = getCohortDates(_c.skoolCycles[member.id]?.start_date || skoolToday);
        const goalRows = goals.length
          ? goals.map(g => {
              const frame = ['milestone','total_count','total_time_min','total_time_max'].includes(g.type) ? '21 Days'
                          : ['weekly_boolean','weekly_days','weekly_count','weekly_time_min','weekly_time_max','daily_count_weekly'].includes(g.type) ? 'Weekly'
                          : 'Daily';
              const dots = skoolDates.map((d, i) => {
                const val = _c.skoolCheckins[`${g.id}_${d}`];
                const done = val !== undefined && val !== false && val !== 0 && val !== '0';
                const isFuture = d > skoolToday;
                const isToday  = d === skoolToday;
                const color = isFuture ? 'var(--border)' : done ? 'var(--green)' : isToday ? 'var(--orange)' : 'var(--red)';
                return `<div title="Day ${i+1}" style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></div>`;
              }).join('');
              return `<div class="detail-goal-row" style="flex-direction:column;align-items:flex-start;gap:5px;">
                <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;">
                  <div class="detail-goal-name">${g.title}</div>
                  <div class="detail-goal-status na">${frame}</div>
                </div>
                <div style="display:flex;gap:4px;padding-bottom:2px;">${dots}</div>
              </div>`;
            }).join('')
          : '<div style="font-size:0.8rem;color:var(--muted);">No goals set.</div>';
        const redRows = redemptions.length
          ? redemptions.map(r => `<div class="redemption-row"><span class="r-badge ${r.status}">${r.status==='pending'?'Pending':'Done'}</span><span class="r-reason">${r.reason||''}</span></div>`).join('')
          : '<div style="font-size:0.8rem;color:var(--muted);padding:4px 0;">No strikes.</div>';
        detailHTML = `<div style="margin-bottom:14px;"><div class="detail-section-title">Goals</div>${goalRows}</div><div><div class="detail-section-title">Redemptions</div><div class="redemption-list">${redRows}</div></div>`;
      }

      return `<div class="${cardClass}" onclick="toggleExpand('${member.id}','skool')">
        <div class="member-top">
          <div class="member-name">${member.first_name || ''}${isSelf?' <span class="member-meta-inline">(you)</span>':''}</div>
          <div class="member-right">
            <span class="${dayPillClass}">${dayLabel}</span>
            ${badge}
            ${!isInactive ? `<div class="member-strikes">${[1,2,3].map(n=>`<div class="strike-pip${n<=redemptions.length?' active':''}"></div>`).join('')}</div>` : ''}
            <span class="member-chevron">▼</span>
          </div>
        </div>
        <div class="member-detail${isOpen?' open':''}">
          ${isOpen ? detailHTML : ''}
        </div>
      </div>`;
    }

    // ── EXCLUSIVE RENDER ─────────────────────────────────────────────────
    function renderExclusive() {
      const cohort = _c.excCohort;
      const members = _c.excMembers;
      if (!cohort || !members.length) {
        document.getElementById('content').innerHTML = '<div class="empty-state">No active exclusive cohort.</div>';
        document.getElementById('summaryBar').style.display = 'none';
        return;
      }
      const day = getCohortDay(cohort.start_date);

      const atRiskMembers = members.filter(m => (_c.excRedemptions[m.id]||[]).some(r=>r.status==='pending') || (_c.excRedemptions[m.id]||[]).length >= 2);
      const pendingAll = members.filter(m => (_c.excRedemptions[m.id]||[]).some(r=>r.status==='pending'));

      document.getElementById('summaryBar').style.display = '';
      document.getElementById('summaryBar').innerHTML = `
        <div class="stat-item"><div class="stat-value">${members.length}</div><div class="stat-label">Members</div></div>
        <div class="stat-item"><div class="stat-value good">${members.length - atRiskMembers.length}</div><div class="stat-label">On Track</div></div>
        <div class="stat-item"><div class="stat-value${pendingAll.length>0?' warn':''}">${pendingAll.length}</div><div class="stat-label">Owe Redemp.</div></div>`;

      document.getElementById('content').innerHTML = members.map(m => renderExcMemberCard(m, cohort, day)).join('');
    }

    function renderExcMemberCard(member, cohort, day) {
      const goals = _c.excGoals[member.id] || [];
      const redemptions = _c.excRedemptions[member.id] || [];
      const isSelf = member.id === _c.userId;
      const isOpen = expandedId === member.id;
      const atRisk = redemptions.some(r=>r.status==='pending') || redemptions.length >= 2;
      const cardClass = ['member-card', atRisk ? 'at-risk' : 'complete', isOpen ? 'open' : ''].filter(Boolean).join(' ');
      const badge = atRisk ? `<span class="status-badge at-risk">⚠ At Risk</span>` : `<span class="status-badge on-track">✓ On Track</span>`;

      let detailHTML = '';
      if (isOpen) {
        const excToday = localDateStr();
        const excDates = getCohortDates(cohort.start_date);
        const goalRows = goals.length
          ? goals.map(g => {
              const dots = excDates.map((d, i) => {
                const val = _c.excCheckins[`${g.id}_${d}`];
                const done = val !== undefined && val !== false && val !== 0 && val !== '0';
                const isFuture = d > excToday;
                const isToday  = d === excToday;
                const color = isFuture ? 'var(--border)' : done ? 'var(--green)' : isToday ? 'var(--orange)' : 'var(--red)';
                return `<div title="Day ${i+1}" style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></div>`;
              }).join('');
              return `<div class="detail-goal-row" style="flex-direction:column;align-items:flex-start;gap:5px;">
                <div style="display:flex;align-items:center;width:100%;"><div class="detail-goal-name">${g.title}</div></div>
                <div style="display:flex;gap:4px;padding-bottom:2px;">${dots}</div>
              </div>`;
            }).join('')
          : '<div style="font-size:0.8rem;color:var(--muted);">No goals.</div>';
        const redRows = redemptions.length
          ? redemptions.map(r => `<div class="redemption-row"><span class="r-badge ${r.status}">${r.status==='pending'?'Pending':'Done'}</span><span class="r-reason">${r.reason||''}</span></div>`).join('')
          : '<div style="font-size:0.8rem;color:var(--muted);padding:4px 0;">No strikes.</div>';
        detailHTML = `<div style="margin-bottom:14px;"><div class="detail-section-title">Goals</div>${goalRows}</div><div><div class="detail-section-title">Redemptions</div><div class="redemption-list">${redRows}</div></div>`;
      }

      return `<div class="${cardClass}" onclick="toggleExpand('${member.id}','exclusive')">
        <div class="member-top">
          <div class="member-name">${member.first_name || ''}${isSelf?' <span class="member-meta-inline">(you)</span>':''}</div>
          <div class="member-right">
            <span class="day-pill">Day ${day}</span>
            ${badge}
            <div class="member-strikes">${[1,2,3].map(n=>`<div class="strike-pip${n<=redemptions.length?' active':''}"></div>`).join('')}</div>
            <span class="member-chevron">▼</span>
          </div>
        </div>
        <div class="member-detail${isOpen?' open':''}">
          ${isOpen ? detailHTML : ''}
        </div>
      </div>`;
    }

    async function toggleExpand(memberId, tab) {
      expandedId = expandedId === memberId ? null : memberId;
      if (tab === 'skool') renderSkool();
      else renderExclusive();
    }

    init();
