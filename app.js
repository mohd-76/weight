(() => {
  'use strict';

  const STORAGE_KEY = 'weighttrack_v1';
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DEFAULT_TASKS = [
    'Follow my planned meals',
    'Move my body in a way that feels good',
    'Drink water regularly',
    'Make time for restful sleep'
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const dateFromKey = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  const weekStartKey = (date = new Date()) => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    return dateKey(start);
  };

  const formatDate = (key, options = {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }) => {
    if (!key) return '—';
    return dateFromKey(key).toLocaleDateString(undefined, options);
  };

  const uid = () =>
    window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const freshState = () => ({
    profile: {
      name: '',
      unit: 'kg',
      heightCm: '',
      startWeight: null,
      targetWeight: null,
      targetDate: '',
      weeklyRate: 0.5,
      weighDays: [4, 0],
      weighTime: '08:00',
      dailyReminder: false,
      dailyTime: '09:00',
      notificationsEnabled: false,
      theme: 'light',
      setupComplete: false
    },
    entries: [],
    tasksByDate: {},
    dailyGoalTemplates: [],
    weeklyGoals: [],
    weeklyGoalProgress: {},
    targetSchedule: [],
    reminderLog: {}
  });

  // Separate browser storage for every Google account.
  let activeAccountUid = null;
  let activeStorageKey = `${STORAGE_KEY}_guest`;

  let chart = null;
  let chartRange = '30';
  let toastTimer = null;

  function normalizeState(parsed) {
    const base = freshState();
    const incoming = parsed && typeof parsed === 'object' ? parsed : {};

    return {
      ...base,
      ...incoming,
      profile: { ...base.profile, ...(incoming.profile || {}) },
      entries: Array.isArray(incoming.entries) ? incoming.entries : [],
      tasksByDate: incoming.tasksByDate && typeof incoming.tasksByDate === 'object'
        ? incoming.tasksByDate : {},
      dailyGoalTemplates: Array.isArray(incoming.dailyGoalTemplates)
        ? incoming.dailyGoalTemplates : [],
      weeklyGoals: Array.isArray(incoming.weeklyGoals)
        ? incoming.weeklyGoals : [],
      weeklyGoalProgress: incoming.weeklyGoalProgress &&
        typeof incoming.weeklyGoalProgress === 'object'
        ? incoming.weeklyGoalProgress : {},
      targetSchedule: Array.isArray(incoming.targetSchedule)
        ? incoming.targetSchedule : [],
      reminderLog: incoming.reminderLog &&
        typeof incoming.reminderLog === 'object'
        ? incoming.reminderLog : {}
    };
  }

  function loadState(storageKey = activeStorageKey) {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? normalizeState(JSON.parse(saved)) : freshState();
    } catch (error) {
      console.warn('Could not read saved WeightTrack data:', error);
      return freshState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(activeStorageKey, JSON.stringify(state));

      window.dispatchEvent(
        new CustomEvent('weighttrack:local-change', {
          detail: JSON.parse(JSON.stringify(state))
        })
      );
    } catch (error) {
      console.error('Could not save WeightTrack data:', error);
      showToast('Could not save data in this browser.');
    }
  }

  let state = loadState(activeStorageKey);

  // Receive data loaded by Firebase.
  window.addEventListener('weighttrack:cloud-load', event => {
    if (!event.detail || typeof event.detail !== 'object') return;

    state = normalizeState(event.detail);

    try {
      localStorage.setItem(activeStorageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('Could not update this account local cache:', error);
    }

    renderAll();
  });

  // Detect Google account changes.
  window.addEventListener('weighttrack:cloud-status', event => {
    const status = event.detail || {};

    const statusEl = $('#cloudSyncStatus');
    const accountEl = $('#cloudAccountName');
    const signOut = $('#signOutButton');
    const authButton = $('#authButton');

    if (status.user) {
      const nextUid = status.user.uid;

      if (activeAccountUid !== nextUid) {
        activeAccountUid = nextUid;
        activeStorageKey = `${STORAGE_KEY}_user_${nextUid}`;

        // Never display another account's old data.
        state = freshState();
        renderAll();
      }
    } else {
      activeAccountUid = null;
      activeStorageKey = `${STORAGE_KEY}_guest`;

      state = loadState(activeStorageKey);
      renderAll();
    }

    if (accountEl) {
      accountEl.textContent = status.user
        ? (status.user.displayName || status.user.email || 'Google account')
        : 'Not signed in';
    }

    if (statusEl) {
      statusEl.textContent = status.message ||
        (status.user
          ? 'Connected to your private cloud account.'
          : 'Your data is saved in this browser.');
    }

    if (signOut) signOut.disabled = !status.user;

    if (authButton) {
      authButton.textContent = status.user
        ? 'Sign out'
        : 'Sign in with Google';
    }

    if (status.user?.displayName && !state.profile.name) {
      state.profile.name = status.user.displayName;
      renderAll();
    }
  });

  function sortedEntries() {
    return [...state.entries].sort(
      (a, b) => a.date.localeCompare(b.date) ||
        a.createdAt - b.createdAt
    );
  }

  function latestEntry() {
    return sortedEntries().at(-1) || null;
  }

  function firstEntry() {
    return sortedEntries()[0] || null;
  }

  function kgToDisplay(kg) {
    return Number(
      state.profile.unit === 'lb'
        ? kg * 2.2046226218
        : kg
    );
  }

  function displayToKg(value) {
    return Number(
      state.profile.unit === 'lb'
        ? value / 2.2046226218
        : value
    );
  }

  function fmtWeight(kg, decimals = 1) {
    if (kg === null || kg === undefined || !Number.isFinite(Number(kg))) {
      return '—';
    }
    return kgToDisplay(Number(kg)).toFixed(decimals);
  }

  function unit() {
    return state.profile.unit || 'kg';
  }

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');

    clearTimeout(toastTimer);

    toastTimer = setTimeout(
      () => toast.classList.remove('show'),
      2600
    );
  }

  function renderAll() {
    document.body.classList.toggle(
      'dark',
      state.profile.theme === 'dark'
    );

    $('#themeToggle').textContent =
      state.profile.theme === 'dark' ? '☀' : '☾';

    $('#todayLabel').textContent =
      new Date().toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });

    const hour = new Date().getHours();

    $('#greetingWord').textContent =
      hour < 12 ? 'morning' :
      hour < 17 ? 'afternoon' : 'evening';

    $('#profileNameSide').textContent =
      state.profile.name || 'Your profile';

    const initials = (state.profile.name || 'Y')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(s => s[0])
      .join('')
      .toUpperCase() || 'Y';

    $('#avatarInitials').textContent = initials;
    $('#topAvatar').textContent = initials;

    $('#setupBanner').classList.toggle(
      'hidden',
      Boolean(state.profile.setupComplete)
    );

    $('#weightUnit').textContent = unit();
    $('#changeUnit').textContent = unit();
    $('#goalUnit').textContent = unit();

    const latest = latestEntry();
    const first = firstEntry();

    const current = latest?.weightKg ?? null;
    const start = state.profile.startWeight ?? first?.weightKg ?? null;
    const target = state.profile.targetWeight ?? null;

    $('#currentWeight').textContent = fmtWeight(current);

    $('#lastLoggedText').textContent = latest
      ? `Last logged ${formatDate(latest.date, {
          day: 'numeric',
          month: 'short'
        })}`
      : 'Log your first weigh-in';

    const change = first && latest
      ? first.weightKg - latest.weightKg
      : null;

    $('#totalChange').textContent = change === null
      ? '—'
      : `${change > 0 ? '' : change < 0 ? '+' : ''}${fmtWeight(Math.abs(change))}`;

    $('#changeCaption').textContent = change === null
      ? 'Since your first entry'
      : change > 0
        ? 'Down since your first entry'
        : change < 0
          ? 'Up since your first entry'
          : 'No change since your first entry';

    $('#goalWeight').textContent = fmtWeight(target);

    let progress = 0;

    if (start !== null && target !== null &&
        current !== null && start !== target) {
      progress = start > target
        ? ((start - current) / (start - target)) * 100
        : ((current - start) / (target - start)) * 100;
    }

    progress = Math.max(
      0,
      Math.min(100, Number.isFinite(progress) ? progress : 0)
    );

    $('#goalPercent').textContent = Math.round(progress);
    $('#goalProgressBar').style.width = `${progress}%`;
    $('#ringPercent').textContent = `${Math.round(progress)}%`;
    $('#goalRing').style.background =
      `conic-gradient(var(--green) ${progress * 3.6}deg, #eaf0ea ${progress * 3.6}deg)`;

    $('#remainingText').textContent =
      target === null || current === null
        ? 'Set a goal to get started'
        : `${fmtWeight(Math.abs(current - target))} ${unit()} to go`;

    renderCustomGoalProgress(current, start);

    $('#startWeightLabel').textContent =
      start === null ? '—' : `${fmtWeight(start)} ${unit()}`;

    $('#targetWeightLabel').textContent =
      target === null ? '—' : `${fmtWeight(target)} ${unit()}`;

    $('#nextCheckin').textContent = nextCheckinLabel();

    renderTasks();
    renderWeeklyGoals();
    renderTargetSchedule();
    renderWeeklySummary();
    renderHistory();
    renderProgress();
    renderChart();
    updateSettingsForm();
  }

  function renderCustomGoalProgress(current, start) {
    const targets = [...(state.targetSchedule || [])]
      .sort((a, b) => a.date.localeCompare(b.date));

    const today = todayKey();

    const nextTarget = targets.find(target =>
      target.date >= today &&
      !sortedEntries().some(entry => entry.date === target.date)
    ) || targets[targets.length - 1];

    const percentEl = $('#customGoalPercent');
    const barEl = $('#customGoalProgressBar');
    const captionEl = $('#customGoalCaption');

    if (!percentEl || !barEl || !captionEl) return;

    if (!nextTarget || current === null || start === null ||
        Number(start) === Number(nextTarget.weightKg)) {
      percentEl.textContent = '0';
      barEl.style.width = '0%';
      captionEl.textContent = !nextTarget
        ? 'Add a dated target'
        : 'Log your starting/current weight';
      return;
    }

    const baseline = Number(start);
    const target = Number(nextTarget.weightKg);

    const raw = baseline > target
      ? ((baseline - current) / (baseline - target)) * 100
      : ((current - baseline) / (target - baseline)) * 100;

    const progress = Math.max(
      0,
      Math.min(100, Number.isFinite(raw) ? raw : 0)
    );

    percentEl.textContent = String(Math.round(progress));
    barEl.style.width = `${progress}%`;

    const actualForDate = sortedEntries()
      .find(entry => entry.date === nextTarget.date);

    captionEl.textContent = actualForDate
      ? `${formatDate(nextTarget.date, {
          day: 'numeric',
          month: 'short'
        })} target compared`
      : `Next: ${fmtWeight(target)} ${unit()} by ${formatDate(nextTarget.date, {
          day: 'numeric',
          month: 'short'
        })}`;
  }

  function nextCheckinLabel() {
    const days = (state.profile.weighDays || []).map(Number);

    if (!days.length) return 'No days selected';

    const today = new Date();
    let next = null;

    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + offset
      );

      if (days.includes(candidate.getDay())) {
        next = candidate;
        break;
      }
    }

    if (!next) return 'Choose your days';

    const diff = Math.round(
      (new Date(next.getFullYear(), next.getMonth(), next.getDate()) -
       new Date(today.getFullYear(), today.getMonth(), today.getDate())) /
      86400000
    );

    return `${diff === 0 ? 'Today' :
      diff === 1 ? 'Tomorrow' :
      DAY_NAMES[next.getDay()]}, ${next.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short'
      })}`;
  }

  function getTasksForToday() {
    const key = todayKey();

    if (!Array.isArray(state.tasksByDate[key])) {
      state.tasksByDate[key] = DEFAULT_TASKS.map(title => ({
        id: uid(),
        title,
        done: false,
        custom: false
      }));
    }

    const tasks = state.tasksByDate[key];

    (state.dailyGoalTemplates || []).forEach(template => {
      if (!tasks.some(task => task.templateId === template.id)) {
        tasks.push({
          id: uid(),
          templateId: template.id,
          title: template.title,
          done: false,
          custom: true
        });
      }
    });

    return tasks;
  }

  function renderTasks() {
    const tasks = getTasksForToday();
    const done = tasks.filter(task => task.done).length;

    $('#taskCount').textContent = `${done}/${tasks.length}`;

    $('#dailyDateLabel').textContent =
      new Date().toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'short'
      });

    $('#taskList').innerHTML = tasks.map(task => `
      <div class="task-row" data-task-id="${safeText(task.id)}">
        <button class="task-check ${task.done ? 'checked' : ''}"
          data-task-toggle="${safeText(task.id)}"
          aria-label="${task.done ? 'Mark incomplete' : 'Mark complete'}"></button>
        <span class="task-text ${task.done ? 'done' : ''}">${safeText(task.title)}</span>
        ${task.custom
          ? `<button class="task-delete" data-task-delete="${safeText(task.id)}" aria-label="Delete target">×</button>`
          : '<span></span>'}
      </div>
    `).join('') || '<p class="field-hint">No targets added for today.</p>';
  }

   function currentWeekEntries() {
    const start = dateFromKey(weekStartKey());
    const end = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 6
    );

    return sortedEntries().filter(entry =>
      dateFromKey(entry.date) >= start &&
      dateFromKey(entry.date) <= end
    );
  }

  function getWeeklyProgress(goalId) {
    const key = weekStartKey();

    if (!state.weeklyGoalProgress[key]) {
      state.weeklyGoalProgress[key] = {};
    }

    return Number(state.weeklyGoalProgress[key][goalId] || 0);
  }

  function renderWeeklyGoals() {
    const entries = currentWeekEntries();

    const uniqueWeighInDays =
      new Set(entries.map(entry => entry.date)).size;

    const weighTarget = (state.profile.weighDays || []).length;

    const items = [];

    if (weighTarget > 0) {
      items.push({
        id: '__weighins__',
        title: 'Log your weight',
        target: weighTarget,
        current: uniqueWeighInDays,
        automatic: true
      });
    }

    (state.weeklyGoals || []).forEach(goal =>
      items.push({
        ...goal,
        current: getWeeklyProgress(goal.id),
        automatic: false
      })
    );

    const markup = items.length
      ? items.map(goal => {
          const percent = Math.min(
            100,
            Math.round(goal.current / goal.target * 100)
          );

          return `
            <div class="weekly-goal-row">
              <div class="weekly-goal-copy">
                <strong>${safeText(goal.title)}</strong>
                <small>${goal.current} of ${goal.target}
                  ${goal.automatic ? 'weigh-ins' : 'times'} this week</small>
                <div class="weekly-goal-track">
                  <span style="width:${percent}%"></span>
                </div>
              </div>
              <div class="weekly-goal-actions">
                <b>${percent}%</b>
                ${goal.automatic
                  ? '<span class="auto-label">AUTO</span>'
                  : `
                    <button class="goal-step"
                      data-weekly-minus="${safeText(goal.id)}"
                      aria-label="Decrease progress">−</button>
                    <button class="goal-step"
                      data-weekly-plus="${safeText(goal.id)}"
                      aria-label="Increase progress">＋</button>
                  `}
              </div>
            </div>
          `;
        }).join('')
      : '<p class="field-hint">No weekly goals yet. Add a goal such as “Exercise 3 times this week”.</p>';

    $('#weeklyGoalList').innerHTML = markup;

    $('#weeklyGoalManagerList').innerHTML = items.length
      ? items.map(goal => `
          <div class="weekly-goal-manager-row">
            <div>
              <strong>${safeText(goal.title)}</strong>
              <small>${goal.automatic
                ? 'Automatically counted from your weigh-ins'
                : `${goal.target} times per week`}</small>
            </div>
            <span class="manager-progress">
              ${goal.current}/${goal.target}
            </span>
            ${goal.automatic
              ? ''
              : `<button class="task-delete"
                  data-weekly-delete="${safeText(goal.id)}"
                  aria-label="Delete weekly goal">×</button>`}
          </div>
        `).join('')
      : '<p class="field-hint">No custom weekly goals yet. Add your first one above.</p>';
  }

  function renderTargetSchedule() {
    const targets = [...(state.targetSchedule || [])]
      .sort((a, b) => a.date.localeCompare(b.date));

    const entriesByDate = new Map(
      sortedEntries().map(entry => [entry.date, entry])
    );

    const compared = targets.filter(target =>
      entriesByDate.has(target.date)
    ).length;

    const pending = targets.length - compared;

    $('#targetPlanSummary').innerHTML = `
      <span><strong>${targets.length}</strong> total targets</span>
      <span><strong>${compared}</strong> compared</span>
      <span><strong>${pending}</strong> pending</span>
    `;

    $('#targetPlanTable').innerHTML = targets.map(target => {
      const entry = entriesByDate.get(target.date);

      const difference = entry
        ? entry.weightKg - target.weightKg
        : null;

      const differenceLabel = difference === null
        ? '—'
        : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${fmtWeight(Math.abs(difference))} ${unit()}`;

      const differenceClass = difference === null
        ? ''
        : difference <= 0
          ? 'change-positive'
          : 'change-negative';

      const status = entry
        ? '<span class="target-status compared">Compared</span>'
        : '<span class="target-status pending">Pending</span>';

      return `
        <tr>
          <td>${formatDate(target.date)}</td>
          <td>${fmtWeight(target.weightKg)} ${unit()}</td>
          <td>${entry ? `${fmtWeight(entry.weightKg)} ${unit()}` : '—'}</td>
          <td class="${differenceClass}">${differenceLabel}</td>
          <td>${status}</td>
          <td>
            <div class="row-actions">
              <button class="row-action"
                data-target-edit="${safeText(target.id)}">Edit</button>
              <button class="row-action"
                data-target-delete="${safeText(target.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    $('#targetPlanEmpty').style.display =
      targets.length ? 'none' : 'block';

    $('.target-unit-label').textContent = unit();
  }

  function resetTargetForm() {
    $('#targetPlanForm').reset();
    $('#targetPlanForm').dataset.editingId = '';
    $('#savePlannedTarget').textContent = '＋ Add target';
    $('#cancelTargetEdit').classList.add('hidden');
    $('.target-unit-label').textContent = unit();
  }

  function renderWeeklySummary() {
    const today = dateFromKey(todayKey());

    const cutoff = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 6
    );

    const weekEntries = sortedEntries().filter(entry =>
      dateFromKey(entry.date) >= cutoff &&
      dateFromKey(entry.date) <= today
    );

    let changeText = '—';

    if (weekEntries.length >= 2) {
      const delta = weekEntries[0].weightKg -
        weekEntries.at(-1).weightKg;

      changeText = `${delta > 0 ? '−' : delta < 0 ? '+' : ''}${fmtWeight(Math.abs(delta))} ${unit()}`;
    } else if (weekEntries.length === 1) {
      changeText = '1 entry';
    }

    $('#weeklyChange').textContent = changeText;

    $('#weeklyCaption').textContent =
      weekEntries.length >= 2
        ? (
            weekEntries[0].weightKg > weekEntries.at(-1).weightKg
              ? 'Down over the last 7 days'
              : weekEntries[0].weightKg < weekEntries.at(-1).weightKg
                ? 'Up over the last 7 days'
                : 'No change over the last 7 days'
          )
        : 'Add another weigh-in to compare';

    $('#weeklyEntries').textContent = weekEntries.length;

    let totalTasks = 0;
    let completedTasks = 0;

    Object.entries(state.tasksByDate).forEach(([key, tasks]) => {
      if (
        dateFromKey(key) >= cutoff &&
        dateFromKey(key) <= today &&
        Array.isArray(tasks)
      ) {
        totalTasks += tasks.length;
        completedTasks += tasks.filter(task => task.done).length;
      }
    });

    $('#weeklyTasks').textContent = totalTasks
      ? `${Math.round(completedTasks / totalTasks * 100)}%`
      : '—';
  }

  function renderHistory() {
    const entries = sortedEntries().reverse();

    $('#historyCount').textContent =
      `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} recorded`;

    $('#historyEmpty').style.display =
      entries.length ? 'none' : 'block';

    $('#historyTable').innerHTML = entries.map((entry, index) => {
      const olderChronological = entries[index + 1];

      let change = '—';
      let changeClass = '';

      if (olderChronological) {
        const delta = entry.weightKg - olderChronological.weightKg;

        change = `${delta > 0 ? '+' : ''}${fmtWeight(delta)} ${unit()}`;

        changeClass = delta < 0
          ? 'change-positive'
          : delta > 0
            ? 'change-negative'
            : '';
      }

      return `
        <tr>
          <td>${formatDate(entry.date)}</td>
          <td>${fmtWeight(entry.weightKg)} ${unit()}</td>
          <td class="${changeClass}">${change}</td>
          <td>${entry.note
            ? safeText(entry.note)
            : '<span style="color:#b1bab3">—</span>'}</td>
          <td>
            <div class="row-actions">
              <button class="row-action"
                data-edit-entry="${safeText(entry.id)}">Edit</button>
              <button class="row-action"
                data-delete-entry="${safeText(entry.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderProgress() {
    const entries = sortedEntries();

    const first = entries[0];
    const latest = entries.at(-1);

    const delta = first && latest
      ? first.weightKg - latest.weightKg
      : null;

    $('#allTimeChange').textContent = delta === null
      ? '—'
      : `${delta > 0 ? '' : delta < 0 ? '+' : ''}${fmtWeight(Math.abs(delta))}`;

    $('#bestWeight').textContent = entries.length
      ? fmtWeight(Math.min(...entries.map(e => e.weightKg)))
      : '—';

    $('#totalEntries').textContent = entries.length;

    const milestones = [5, 10, 15, 20, 25, 30];

    const lost = first && latest
      ? Math.max(0, first.weightKg - latest.weightKg)
      : 0;

    $('#milestoneList').innerHTML = milestones.map(mark => {
      const earned = lost >= mark;

      return `
        <div class="milestone-row">
          <span class="milestone-icon ${earned ? 'earned' : ''}">
            ${earned ? '✓' : '✦'}
          </span>
          <span class="milestone-copy">
            <strong>${mark} kg ${earned
              ? 'milestone reached'
              : 'change milestone'}</strong>
            <small>${earned
              ? 'You reached this from your first recorded weight.'
              : `${fmtWeight(Math.max(0, mark - lost))} ${unit()} more to reach this milestone.`}</small>
          </span>
          <span class="milestone-state ${earned ? 'earned' : ''}">
            ${earned ? 'Completed' : 'Locked'}
          </span>
        </div>
      `;
    }).join('');

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const planned = [];
    const selectedDays = (state.profile.weighDays || []).map(Number);

    for (
      let d = new Date(monthStart);
      d <= now;
      d.setDate(d.getDate() + 1)
    ) {
      if (selectedDays.includes(d.getDay())) {
        planned.push(dateKey(d));
      }
    }

    const actual = new Set(entries.map(e => e.date));

    const completed = planned.filter(key =>
      actual.has(key)
    ).length;

    const rate = planned.length
      ? Math.round(completed / planned.length * 100)
      : 0;

    $('#checkinRate').textContent = `${rate}%`;
    $('#checkinRateBar').style.width = `${rate}%`;

    $('#consistencyNote').textContent = planned.length
      ? `${completed} of ${planned.length} planned check-ins completed this month.`
      : 'Choose one or more weigh-in days to track consistency.';
  }

  function renderChart() {
    const canvas = $('#weightChart');
    const empty = $('#chartEmpty');

    if (!canvas || typeof Chart === 'undefined') {
      empty.style.display = 'flex';
      empty.textContent =
        'Chart library could not load. Check your internet connection.';
      return;
    }

    let entries = sortedEntries();
    let targets = [...(state.targetSchedule || [])];

    if (chartRange !== 'all') {
      const days = Number(chartRange);

      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - (days - 1));

      entries = entries.filter(e =>
        dateFromKey(e.date) >= cutoff
      );

      targets = targets.filter(t =>
        dateFromKey(t.date) >= cutoff
      );
    }

    const actualByDate = new Map(
      entries.map(e => [
        e.date,
        Number(kgToDisplay(e.weightKg).toFixed(2))
      ])
    );

    const targetByDate = new Map(
      targets.map(t => [
        t.date,
        Number(kgToDisplay(t.weightKg).toFixed(2))
      ])
    );

    const chartDates = [
      ...new Set([
        ...actualByDate.keys(),
        ...targetByDate.keys()
      ])
    ].sort();

    empty.style.display = chartDates.length ? 'none' : 'flex';

    if (chart) chart.destroy();

    const styles = getComputedStyle(document.body);

    const gridColor =
      styles.getPropertyValue('--line').trim() || '#e8eee8';

    const tickColor =
      state.profile.theme === 'dark' ? '#9aa89d' : '#9aa49c';

    chart = new Chart(canvas, {
      type: 'line',

      data: {
        labels: chartDates.map(key =>
          formatDate(key, {
            day: 'numeric',
            month: 'short'
          })
        ),

        datasets: [
          {
            label: `Actual weight (${unit()})`,
            data: chartDates.map(key =>
              actualByDate.has(key) ? actualByDate.get(key) : null
            ),
            borderColor: '#27845d',
            backgroundColor: 'rgba(39,132,93,.10)',
            fill: true,
            borderWidth: 2.5,
            tension: .34,
            spanGaps: false,
            pointRadius: chartDates.length > 24 ? 1.5 : 3.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#fff',
            pointBorderColor: '#27845d',
            pointBorderWidth: 2
          },
          {
            label: `Planned target (${unit()})`,
            data: chartDates.map(key =>
              targetByDate.has(key) ? targetByDate.get(key) : null
            ),
            borderColor: '#9272c8',
            backgroundColor: 'transparent',
            borderDash: [6, 5],
            fill: false,
            borderWidth: 2,
            tension: 0,
            spanGaps: false,
            pointRadius: 4,
            pointHoverRadius: 5,
            pointBackgroundColor: '#9272c8',
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            backgroundColor: '#20382a',
            padding: 10,
            displayColors: false,
            callbacks: {
              label: ctx =>
                `${ctx.parsed.y.toFixed(1)} ${unit()}`
            }
          }
        },

        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              maxTicksLimit: 7,
              font: {
                family: 'DM Sans',
                size: 9
              }
            },
            border: { display: false }
          },

          y: {
            grid: {
              color: gridColor,
              drawTicks: false
            },
            ticks: {
              color: tickColor,
              padding: 9,
              font: {
                family: 'DM Sans',
                size: 9
              },
              callback: value => `${value}`
            },
            border: { display: false }
          }
        }
      }
    });
  }

  function updateSettingsForm() {
    $('#startWeightInput').value =
      state.profile.startWeight === null
        ? ''
        : kgToDisplay(state.profile.startWeight).toFixed(1);

    $('#targetWeightInput').value =
      state.profile.targetWeight === null
        ? ''
        : kgToDisplay(state.profile.targetWeight).toFixed(1);

    $('#heightInput').value = state.profile.heightCm || '';
    $('#targetDateInput').value = state.profile.targetDate || '';

    $('#weeklyRateInput').value =
      String(state.profile.weeklyRate || 0.5);

    $('#weighTimeInput').value =
      state.profile.weighTime || '08:00';

    $('#dailyTimeInput').value =
      state.profile.dailyTime || '09:00';

    $('#dailyReminderToggle').checked =
      Boolean(state.profile.dailyReminder);

    $('#displayNameInput').value =
      state.profile.name || '';

    $('#unitInput').value = unit();

    $('.target-unit-label').textContent = unit();

    $$('#weekdayPicker button').forEach(button =>
      button.classList.toggle(
        'selected',
        (state.profile.weighDays || [])
          .includes(Number(button.dataset.day))
      )
    );

    const permission =
      'Notification' in window
        ? Notification.permission
        : 'unsupported';

    const status = $('#notificationStatus');

    if (permission === 'granted') {
      status.textContent =
        'Browser notifications are allowed. Daily reminders can appear while this app is open.';
    } else if (permission === 'denied') {
      status.textContent =
        'Notifications are blocked by your browser. Change site notification permissions in browser settings to enable them.';
    } else if (permission === 'unsupported') {
      status.textContent =
        'This browser does not support notifications.';
    } else {
      status.textContent =
        'Notifications need your permission. This first version can remind you while the app is open; background notifications will be added with push setup.';
    }

    $('#enableNotifications').textContent =
      permission === 'granted'
        ? 'Notifications enabled'
        : 'Enable browser notifications';
  }

   function openWeightModal(entry = null) {
    $('#weightForm').dataset.editingId = entry?.id || '';

    $('#weightModalTitle').textContent =
      entry ? 'Edit weigh-in' : 'Log your weight';

    $('#saveEntryButton').textContent =
      entry ? 'Update weigh-in' : 'Save weigh-in';

    $('#entryWeight').value =
      entry ? kgToDisplay(entry.weightKg).toFixed(1) : '';

    $('#entryDate').value = entry?.date || todayKey();
    $('#entryNote').value = entry?.note || '';

    $('#weightModal').classList.remove('hidden');
    $('#entryWeight').focus();
  }

  function closeModals() {
    $$('.modal-backdrop').forEach(modal =>
      modal.classList.add('hidden')
    );
  }

  function switchView(view) {
    const titleMap = {
      home: 'Overview',
      history: 'Weight history',
      progress: 'Progress',
      goals: 'Goals & reminders'
    };

    $$('.view').forEach(section =>
      section.classList.toggle(
        'active',
        section.id === `view-${view}`
      )
    );

    $$('.nav-item, .mobile-nav button').forEach(button =>
      button.classList.toggle(
        'active',
        button.dataset.view === view
      )
    );

    $('#breadcrumbTitle').textContent =
      titleMap[view] || 'Overview';

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  function navigateTo(view) {
    switchView(view);
  }

  // Navigation and general actions.

  $$('[data-view]').forEach(button =>
    button.addEventListener('click', () =>
      switchView(button.dataset.view)
    )
  );

  $$('[data-view-link]').forEach(button =>
    button.addEventListener('click', () =>
      switchView(button.dataset.viewLink)
    )
  );

  $$('[data-open-goals]').forEach(button =>
    button.addEventListener('click', () =>
      switchView('goals')
    )
  );

  $('#profileButton').addEventListener('click', () =>
    switchView('goals')
  );

  $('#topAvatar').addEventListener('click', () =>
    switchView('goals')
  );

  $('#logWeightTop').addEventListener('click', () =>
    openWeightModal()
  );

  $('#logWeightHistory').addEventListener('click', () =>
    openWeightModal()
  );

  $('#themeToggle').addEventListener('click', () => {
    state.profile.theme =
      state.profile.theme === 'dark' ? 'light' : 'dark';

    saveState();
    renderAll();
  });

  $$('[data-close-modal]').forEach(button =>
    button.addEventListener('click', closeModals)
  );

  $$('.modal-backdrop').forEach(backdrop =>
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModals();
    })
  );

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModals();
  });

  // Weight entries.

  $('#weightForm').addEventListener('submit', event => {
    event.preventDefault();

    const inputValue = Number($('#entryWeight').value);
    const date = $('#entryDate').value;

    if (
      !Number.isFinite(inputValue) ||
      inputValue <= 0 ||
      inputValue > 1100 ||
      !date
    ) {
      showToast('Enter a valid weight and date.');
      return;
    }

    const editingId = $('#weightForm').dataset.editingId;

    const existing = state.entries.find(
      entry => entry.id === editingId
    );

    const entry = {
      id: existing?.id || uid(),
      date,
      weightKg: displayToKg(inputValue),
      note: $('#entryNote').value.trim(),
      createdAt: existing?.createdAt || Date.now()
    };

    if (existing) {
      state.entries = state.entries.map(item =>
        item.id === editingId ? entry : item
      );
    } else {
      state.entries.push(entry);
    }

    if (state.profile.startWeight === null) {
      state.profile.startWeight = entry.weightKg;
    }

    saveState();
    closeModals();
    renderAll();

    showToast(
      existing
        ? 'Weigh-in updated.'
        : 'Weigh-in saved. Nice work showing up.'
    );
  });

  $('#historyTable').addEventListener('click', event => {
    const editButton = event.target.closest('[data-edit-entry]');
    const deleteButton = event.target.closest('[data-delete-entry]');

    if (editButton) {
      const entry = state.entries.find(
        item => item.id === editButton.dataset.editEntry
      );

      if (entry) openWeightModal(entry);
    }

    if (deleteButton) {
      const id = deleteButton.dataset.deleteEntry;

      if (confirm('Delete this weigh-in? This cannot be undone.')) {
        state.entries = state.entries.filter(
          entry => entry.id !== id
        );

        saveState();
        renderAll();
        showToast('Weigh-in deleted.');
      }
    }
  });

  // Chart date filters.

  $$('.filter-button').forEach(button =>
    button.addEventListener('click', () => {
      chartRange = button.dataset.range;

      $$('.filter-button').forEach(item =>
        item.classList.toggle('active', item === button)
      );

      renderChart();
    })
  );

  // Daily targets.

  $('#taskList').addEventListener('click', event => {
    const toggle = event.target.closest('[data-task-toggle]');
    const remove = event.target.closest('[data-task-delete]');

    const tasks = getTasksForToday();

    if (toggle) {
      const task = tasks.find(
        item => item.id === toggle.dataset.taskToggle
      );

      if (task) task.done = !task.done;

      saveState();
      renderTasks();
      renderWeeklySummary();
    }

    if (remove) {
      const removedTask = tasks.find(
        item => item.id === remove.dataset.taskDelete
      );

      state.tasksByDate[todayKey()] = tasks.filter(
        item => item.id !== remove.dataset.taskDelete
      );

      if (removedTask?.templateId) {
        state.dailyGoalTemplates =
          (state.dailyGoalTemplates || []).filter(
            template => template.id !== removedTask.templateId
          );
      }

      saveState();
      renderTasks();
      renderWeeklySummary();
    }
  });

  $('#addTaskButton').addEventListener('click', () => {
    $('#taskNameInput').value = '';
    $('#taskModal').classList.remove('hidden');
    $('#taskNameInput').focus();
  });

  $('#taskForm').addEventListener('submit', event => {
    event.preventDefault();

    const title = $('#taskNameInput').value.trim();

    if (!title) return;

    const todayTasks = getTasksForToday();

    const templateId = $('#repeatDailyInput').checked
      ? uid()
      : null;

    if (templateId) {
      state.dailyGoalTemplates.push({
        id: templateId,
        title
      });
    }

    todayTasks.push({
      id: uid(),
      ...(templateId ? { templateId } : {}),
      title,
      done: false,
      custom: true
    });

    saveState();
    closeModals();
    renderTasks();
    renderWeeklySummary();

    showToast(
      templateId
        ? 'Daily target added and set to repeat.'
        : 'Daily target added for today.'
    );
  });

  // Weekly goal creation and progress tracking.

  $('#addWeeklyGoalButton').addEventListener('click', () => {
    $('#weeklyGoalNameInput').value = '';
    $('#weeklyGoalTargetInput').value = '3';

    $('#weeklyGoalModal').classList.remove('hidden');
    $('#weeklyGoalNameInput').focus();
  });

  $('#weeklyGoalForm').addEventListener('submit', event => {
    event.preventDefault();

    const title = $('#weeklyGoalNameInput').value.trim();
    const target = Number($('#weeklyGoalTargetInput').value);

    if (
      !title ||
      !Number.isInteger(target) ||
      target < 1 ||
      target > 21
    ) {
      showToast('Enter a goal and a weekly target from 1 to 21.');
      return;
    }

    state.weeklyGoals.push({
      id: uid(),
      title,
      target,
      createdAt: Date.now()
    });

    saveState();
    closeModals();
    renderWeeklyGoals();
    showToast('Weekly goal created.');
  });

  document.addEventListener('click', event => {
    const plus = event.target.closest('[data-weekly-plus]');
    const minus = event.target.closest('[data-weekly-minus]');
    const remove = event.target.closest('[data-weekly-delete]');

    if (plus || minus) {
      const id = (plus || minus).dataset.weeklyPlus ||
        (plus || minus).dataset.weeklyMinus;

      const goal = (state.weeklyGoals || []).find(
        item => item.id === id
      );

      if (!goal) return;

      const key = weekStartKey();

      if (!state.weeklyGoalProgress[key]) {
        state.weeklyGoalProgress[key] = {};
      }

      const current = getWeeklyProgress(id);

      state.weeklyGoalProgress[key][id] = Math.max(
        0,
        Math.min(
          goal.target,
          current + (plus ? 1 : -1)
        )
      );

      saveState();
      renderWeeklyGoals();
    }

    if (remove) {
      const id = remove.dataset.weeklyDelete;

      if (
        confirm(
          'Delete this weekly goal? Past progress records will remain in your saved data.'
        )
      ) {
        state.weeklyGoals = state.weeklyGoals.filter(
          item => item.id !== id
        );

        saveState();
        renderWeeklyGoals();
        showToast('Weekly goal deleted.');
      }
    }
  });

  // Custom dated weight targets.

  $('#targetPlanForm').addEventListener('submit', event => {
    event.preventDefault();

    const date = $('#plannedTargetDate').value;
    const weightValue = Number($('#plannedTargetWeight').value);

    if (
      !date ||
      !Number.isFinite(weightValue) ||
      weightValue <= 0 ||
      weightValue > 500
    ) {
      showToast('Enter a valid target date and weight.');
      return;
    }

    const editingId = $('#targetPlanForm').dataset.editingId;

    const duplicate = state.targetSchedule.find(
      item => item.date === date && item.id !== editingId
    );

    if (duplicate) {
      showToast('A target already exists for this date. Edit that target instead.');
      return;
    }

    const existing = state.targetSchedule.find(
      item => item.id === editingId
    );

    const target = {
      id: existing?.id || uid(),
      date,
      weightKg: displayToKg(weightValue),
      createdAt: existing?.createdAt || Date.now()
    };

    if (existing) {
      state.targetSchedule = state.targetSchedule.map(
        item => item.id === editingId ? target : item
      );
    } else {
      state.targetSchedule.push(target);
    }

    saveState();
    resetTargetForm();
    renderAll();

    showToast(
      existing
        ? 'Dated target updated.'
        : 'Dated target added.'
    );
  });

  $('#targetPlanTable').addEventListener('click', event => {
    const edit = event.target.closest('[data-target-edit]');
    const remove = event.target.closest('[data-target-delete]');

    if (edit) {
      const target = state.targetSchedule.find(
        item => item.id === edit.dataset.targetEdit
      );

      if (!target) return;

      $('#plannedTargetDate').value = target.date;

      $('#plannedTargetWeight').value =
        kgToDisplay(target.weightKg).toFixed(1);

      $('#targetPlanForm').dataset.editingId = target.id;

      $('#savePlannedTarget').textContent = 'Save changes';

      $('#cancelTargetEdit').classList.remove('hidden');

      $('#plannedTargetDate').focus();
    }

    if (remove) {
      const id = remove.dataset.targetDelete;

      if (!confirm('Delete this dated weight target?')) return;

      state.targetSchedule = state.targetSchedule.filter(
        item => item.id !== id
      );

      if ($('#targetPlanForm').dataset.editingId === id) {
        resetTargetForm();
      }

      saveState();
      renderAll();
      showToast('Dated target deleted.');
    }
  });

  $('#cancelTargetEdit').addEventListener('click', resetTargetForm);

  // Goal and profile settings.

  $('#goalForm').addEventListener('submit', event => {
    event.preventDefault();

    const start = displayToKg(
      Number($('#startWeightInput').value)
    );

    const target = displayToKg(
      Number($('#targetWeightInput').value)
    );

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(target) ||
      start <= 0 ||
      target <= 0 ||
      start > 500 ||
      target > 500
    ) {
      showToast('Enter valid starting and target weights.');
      return;
    }

    state.profile.startWeight = start;
    state.profile.targetWeight = target;

    state.profile.heightCm = $('#heightInput').value
      ? Number($('#heightInput').value)
      : '';

    state.profile.targetDate = $('#targetDateInput').value;
    state.profile.weeklyRate = Number($('#weeklyRateInput').value);
    state.profile.setupComplete = true;

    if (!state.entries.length) {
      state.entries.push({
        id: uid(),
        date: todayKey(),
        weightKg: start,
        note: 'Starting weight',
        createdAt: Date.now()
      });
    }

    saveState();
    renderAll();

    $('#goalSaveMessage').textContent = 'Saved';

    showToast('Your goal has been saved.');

    setTimeout(() => {
      $('#goalSaveMessage').textContent = '';
    }, 2400);
  });

  $('#weekdayPicker').addEventListener('click', event => {
    const button = event.target.closest('button[data-day]');

    if (!button) return;

    const day = Number(button.dataset.day);
    const days = state.profile.weighDays || [];

    state.profile.weighDays = days.includes(day)
      ? days.filter(value => value !== day)
      : [...days, day];

    state.profile.weighDays.sort((a, b) => a - b);

    button.classList.toggle(
      'selected',
      state.profile.weighDays.includes(day)
    );

    saveState();
    renderAll();
  });

  $('#saveSchedule').addEventListener('click', () => {
    state.profile.weighTime =
      $('#weighTimeInput').value || '08:00';

    saveState();
    renderAll();

    $('#scheduleSaveMessage').textContent = 'Schedule saved';

    showToast('Weigh-in schedule saved.');

    setTimeout(() => {
      $('#scheduleSaveMessage').textContent = '';
    }, 2400);
  });

  $('#saveProfile').addEventListener('click', () => {
    state.profile.name = $('#displayNameInput').value.trim();
    state.profile.unit = $('#unitInput').value;

    saveState();
    renderAll();

    showToast('Profile updated.');
  });

  // Browser notifications.

  $('#enableNotifications').addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('This browser does not support notifications.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();

      renderAll();

      if (permission === 'granted') {
        state.profile.notificationsEnabled = true;

        saveState();

        new Notification('WeightTrack reminders enabled', {
          body: 'We will give you a gentle nudge while the app is open.'
        });

        showToast('Browser notifications enabled.');
      } else {
        showToast('Notification permission was not granted.');
      }

    } catch (error) {
      console.warn(error);
      showToast('Could not request notification permission.');
    }
  });

  $('#dailyReminderToggle').addEventListener('change', event => {
    state.profile.dailyReminder = event.target.checked;

    saveState();

    showToast(
      event.target.checked
        ? 'Daily reminder switched on.'
        : 'Daily reminder switched off.'
    );
  });

  $('#dailyTimeInput').addEventListener('change', event => {
    state.profile.dailyTime = event.target.value || '09:00';
    saveState();
  });

  function sendReminder(title, body, key) {
    if (
      !('Notification' in window) ||
      Notification.permission !== 'granted' ||
      state.reminderLog[key]
    ) {
      return;
    }

    try {
      new Notification(title, { body });

      state.reminderLog[key] = true;

      saveState();

    } catch (error) {
      console.warn('Notification failed:', error);
    }
  }

  function checkReminders() {
    if (
      !state.profile.notificationsEnabled ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    const now = new Date();
    const today = todayKey();

    const hhmm =
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (
      state.profile.dailyReminder &&
      hhmm === (state.profile.dailyTime || '09:00')
    ) {
      sendReminder(
        'Your WeightTrack focus for today',
        'Take one small action that supports your goal. Progress is built one day at a time.',
        `${today}-daily`
      );
    }

    if (
      (state.profile.weighDays || []).includes(now.getDay()) &&
      hhmm === (state.profile.weighTime || '08:00')
    ) {
      sendReminder(
        "It's a weigh-in day",
        'When it suits you, record your weight in WeightTrack. Look at the trend, not just one number.',
        `${today}-weighin`
      );
    }
  }

  setInterval(checkReminders, 30000);

  // Export CSV.

  $('#exportCsv').addEventListener('click', () => {
    const entries = sortedEntries();

    if (!entries.length) {
      showToast('There are no entries to export yet.');
      return;
    }

    const rows = [
      ['Date', 'Weight (kg)', 'Weight (display unit)', 'Unit', 'Note'],

      ...entries.map(e => [
        e.date,
        e.weightKg.toFixed(2),
        kgToDisplay(e.weightKg).toFixed(2),
        unit(),
        e.note || ''
      ])
    ];

    const csv = rows.map(row =>
      row.map(value =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(',')
    ).join('\n');

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8;'
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    link.href = url;
    link.download = `weighttrack-history-${todayKey()}.csv`;
    link.click();

    URL.revokeObjectURL(url);

    showToast('Your CSV export is ready.');
  });

  // Reset data.

  $('#resetData').addEventListener('click', () => {
    if (
      !confirm(
        'Reset all WeightTrack data saved in this browser? This will delete your profile, entries, goals and daily targets.'
      )
    ) {
      return;
    }

    state = freshState();

    saveState();
    renderAll();
    switchView('home');

    showToast('Local data has been reset.');
  });

  // Keep selected unit visible in the weigh-in form.

  const observer = new MutationObserver(() => {
    const unitLabel = $('#weightModal .input-with-unit span');

    if (unitLabel) {
      unitLabel.textContent = unit();
    }
  });

  observer.observe($('#weightModal'), {
    attributes: true,
    attributeFilter: ['class']
  });

  // Initial rendering.

  renderAll();
  checkReminders();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      renderAll();
      checkReminders();
    }
  });

})();
