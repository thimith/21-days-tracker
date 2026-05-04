const SUPABASE_URL = 'https://lwlfrmdjgvybocnpchal.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3bGZybWRqZ3Z5Ym9jbnBjaGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NjE4MDYsImV4cCI6MjA4OTQzNzgwNn0.3kG4SxxXHSeu3J6_EmPPsO4Q40Yk0ZRabxlms0zS76U';
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const parseLocalDate = s => { const [y,m,dd] = s.split('-').map(Number); return new Date(y, m-1, dd); };
    function getCohortDay(startDate) {
      const s = parseLocalDate(startDate); const n = new Date(); n.setHours(0,0,0,0);
      return Math.floor((n-s)/86400000)+1;
    }

    let _userId, _cohortId;
    const _stakeTimers = {};

    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      const authUser = session?.user;
      if (!authUser) { window.location.href = 'index.html'; return; }
      _userId = authUser.id;

      // Profile
      let { data: profile } = await sb.from('profiles').select('*').eq('id', _userId).single();
      if (!profile) {
        const fullName = authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '';
        const parts = fullName.trim().split(' ');
        const role = authUser.email === 'thierry.muller@gmail.com' ? 'admin' : 'member';
        const np = { id: _userId, first_name: parts[0]||'', last_name: parts.slice(1).join(' ')||'', email: authUser.email||'', role, whatsapp:'' };
        const { data: c } = await sb.from('profiles').insert(np).select().single();
        profile = c || np;
      }
      if (profile.role === 'admin') document.getElementById('adminNav').style.display = '';

      const displayName = profile.first_name || authUser.email?.split('@')[0] || '—';
      document.getElementById('profileCard').innerHTML = `
        <div class="profile-avatar">${displayName[0].toUpperCase()}</div>
        <div class="profile-info">
          <div class="profile-name">${displayName}</div>
          <div class="profile-email">${authUser.email||'—'}</div>
          <span class="role-badge ${profile.role==='admin'?'admin':'member'}">${profile.role==='admin'?'Admin':'Member'}</span>
        </div>`;

      document.getElementById('accountInfo').innerHTML = `
        <div class="info-row"><span class="info-label">Name</span><span class="info-value">${displayName}</span></div>
        <div class="info-row"><span class="info-label">Email</span><span class="info-value">${authUser.email||'—'}</span></div>
        <div class="info-row"><span class="info-label">Role</span><span class="info-value">${profile.role||'—'}</span></div>`;

      // Resolve cohort — Skool members use skool_cycles, others use cohort_members
      const [{ data: skoolMbr }, { data: memberships }] = await Promise.all([
        sb.from('skool_members').select('*').eq('user_id', _userId).maybeSingle(),
        sb.from('cohort_members').select('cohort_id, cohorts(*)').eq('user_id', _userId)
      ]);

      let cohortLabel = 'No active cohort', startDate = null;

      if (skoolMbr) {
        const { data: cycles } = await sb.from('skool_cycles')
          .select('*').eq('user_id', _userId).order('start_date', { ascending: false });
        if (cycles?.length) {
          const active = cycles.find(c => { const d = getCohortDay(c.start_date); return d >= 1 && d <= 21; });
          const picked = active || cycles[0];
          _cohortId = picked.id;
          startDate = picked.start_date;
          const day = getCohortDay(startDate);
          cohortLabel = day < 1 ? `Day ${day} (Upcoming — ${startDate})` : day <= 21 ? `Day ${day} of 21` : 'Completed';
          document.getElementById('cohortInfo').innerHTML = `
            <div class="info-row"><span class="info-label">Cohort</span><span class="info-value">Skool Community</span></div>
            <div class="info-row"><span class="info-label">Start Date</span><span class="info-value">${startDate}</span></div>
            <div class="info-row"><span class="info-label">Progress</span><span class="info-value">${cohortLabel}</span></div>`;
        } else {
          document.getElementById('cohortInfo').innerHTML = `<div class="info-row"><span class="info-label">Cohort</span><span class="info-value">Skool — no cycle started</span></div>`;
        }
      } else if (memberships?.length) {
        const cohorts = memberships.map(m => m.cohorts).filter(Boolean);
        const actives = cohorts.filter(c => { const d = getCohortDay(c.start_date); return d >= 1 && d <= 21; });
        const cohort = actives[0] || cohorts.sort((a,b) => new Date(b.start_date)-new Date(a.start_date))[0];
        if (cohort) {
          _cohortId = cohort.id;
          startDate = cohort.start_date;
          const day = getCohortDay(startDate);
          const dl = day >= 1 && day <= 21 ? `Day ${day} of 21` : day < 1 ? 'Upcoming' : 'Completed';
          document.getElementById('cohortInfo').innerHTML = `
            <div class="info-row"><span class="info-label">Cohort</span><span class="info-value">${cohort.name}</span></div>
            <div class="info-row"><span class="info-label">Start Date</span><span class="info-value">${startDate}</span></div>
            <div class="info-row"><span class="info-label">Progress</span><span class="info-value">${dl}</span></div>`;
        } else {
          document.getElementById('cohortInfo').innerHTML = `<div class="info-row"><span class="info-label">No active cohort</span></div>`;
        }
      } else {
        document.getElementById('cohortInfo').innerHTML = `<div class="info-row"><span class="info-label">Cohort</span><span class="info-value">None</span></div>`;
      }

      // Goals
      if (_cohortId) {
        const { data: goalsRaw } = await sb.from('goals')
          .select('*').eq('user_id', _userId).eq('cohort_id', _cohortId).order('sort_order');
        const goals = goalsRaw || [];
        if (goals.length) {
          const frameOf = t => ['milestone','total_count','total_time_min','total_time_max'].includes(t) ? '21 Days'
            : ['weekly_boolean','weekly_days','weekly_count','weekly_time_min','weekly_time_max','daily_count_weekly'].includes(t) ? 'Weekly' : 'Daily';
          const pillCls = f => f === '21 Days' ? 'milestone' : f === 'Weekly' ? 'weekly' : 'boolean';
          document.getElementById('goalsList').innerHTML = goals.map(g => {
            const frame = frameOf(g.type);
            return `<div class="goal-row">
              <div class="goal-row-title">${g.title}</div>
              <span class="goal-type-pill pill-${pillCls(frame)}">${frame}</span>
            </div>`;
          }).join('');
        } else {
          document.getElementById('goalsList').innerHTML = `<div class="info-row"><span class="info-label">No goals set yet</span></div>`;
        }

        // Stakes — editable with real-time save
        const { data: stakes } = await sb.from('stakes')
          .select('*').eq('user_id', _userId).eq('cohort_id', _cohortId).maybeSingle();
        const s = stakes || {};
        document.getElementById('stakesList').innerHTML = `
          <div class="stake-field">
            <div class="stake-label">🏆 Reward — if I complete all 21 days</div>
            <textarea class="stake-textarea" id="sk-complete" rows="2" placeholder="e.g. I'll book that trip I've been putting off…" oninput="onStakeInput('complete',this)">${s.complete||''}</textarea>
            <span class="stake-saved" id="sv-complete">✓ Saved</span>
          </div>
          <div class="stake-field">
            <div class="stake-label">⚡ Redemption 1 — miss a day</div>
            <textarea class="stake-textarea" id="sk-r1" rows="2" placeholder="e.g. 50 burpees on a video call with the group…" oninput="onStakeInput('r1',this)">${s.r1||''}</textarea>
            <span class="stake-saved" id="sv-r1">✓ Saved</span>
          </div>
          <div class="stake-field">
            <div class="stake-label">⚡ Redemption 2 — miss two days</div>
            <textarea class="stake-textarea" id="sk-r2" rows="2" placeholder="e.g. Cold shower + public post in the group…" oninput="onStakeInput('r2',this)">${s.r2||''}</textarea>
            <span class="stake-saved" id="sv-r2">✓ Saved</span>
          </div>
          <div class="stake-field">
            <div class="stake-label">💀 Failure — 3 strikes</div>
            <textarea class="stake-textarea" id="sk-fail" rows="2" placeholder="e.g. Donate $50 to a cause I hate…" oninput="onStakeInput('fail',this)">${s.fail||''}</textarea>
            <span class="stake-saved" id="sv-fail">✓ Saved</span>
          </div>`;
      } else {
        document.getElementById('goalsList').innerHTML = `<div class="info-row"><span class="info-label">No active cycle</span></div>`;
        document.getElementById('stakesList').innerHTML = `<div class="info-row"><span class="info-label">No active cycle</span></div>`;
      }
    })();

    function onStakeInput(field, el) {
      clearTimeout(_stakeTimers[field]);
      _stakeTimers[field] = setTimeout(() => saveStake(field, el.value.trim()), 800);
    }

    async function saveStake(field, value) {
      if (!_cohortId || !_userId) return;
      const patch = { user_id: _userId, cohort_id: _cohortId, [field]: value };
      const { error } = await sb.from('stakes').upsert(patch, { onConflict: 'user_id,cohort_id' });
      if (!error) {
        const ind = document.getElementById(`sv-${field}`);
        if (ind) {
          ind.classList.add('show');
          setTimeout(() => ind.classList.remove('show'), 2000);
        }
      }
    }

    async function logout() { await sb.auth.signOut(); window.location.href = 'index.html'; }
