// ============================================================
// SHORE Kanban — app.js
// ============================================================

const STATUSES = [
  { key: 'pendiente', label: 'Pendiente' },
  { key: 'en_proceso', label: 'En proceso' },
  { key: 'en_revision', label: 'En revisión' },
  { key: 'completado', label: 'Completado' },
];

const VERTIENTE_LABELS = {
  shore_content: 'SHORE Content',
  pm_video: 'PM · Shore Video',
  produccion_video: 'Producción · Shore Video',
};

const AREA_PALETTE = [
  '#b98cc9', '#7d93b8', '#7a9b5e', '#c1633f', '#8f8577',
  '#c97d94', '#c9974f', '#8fa679', '#b8493f', '#4fa889',
  '#a68fd6', '#7fa8c9', '#c9b06f', '#8fc9a6',
];
function getAreaColor(name) {
  const idx = state.areas.findIndex(a => a.name === name);
  return AREA_PALETTE[(idx >= 0 ? idx : 0) % AREA_PALETTE.length];
}

const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const NTH_NAMES = { 1: '1ra', 2: '2da', 3: '3ra', 4: '4ta', 5: '5ta' };

let db = null;
let state = {
  tasks: [],
  subtasks: [],       // all subtasks, filtered by task_id when needed
  quickPendings: [],
  dailyTasks: [],
  areas: [],
  recurringTasks: [],
  recurringCompletions: [],
  keepInMinds: [],
  section: 'home',    // 'home' | 'board' | 'recurring' | 'client' | 'paused' | 'archive'
  archiveFilter: 'completado', // 'completado' | 'cancelada'
  calendarDate: new Date(),   // mes que se está viendo en el calendario
  selectedDay: null,           // 'YYYY-MM-DD' seleccionado en el calendario
  view: 'todo',        // 'todo' | 'shore_content' | 'pm_video' | 'produccion_video'
  filters: { area: '', priority: '', blockedOnly: false },
  editingSubtasks: [],  // working copy of subtasks while modal is open
  editingTaskId: null,
};

// ============================================================
// Init
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const configured = SUPABASE_CONFIG.url && !SUPABASE_CONFIG.url.startsWith('PEGA_AQUI') &&
                      SUPABASE_CONFIG.anonKey && !SUPABASE_CONFIG.anonKey.startsWith('PEGA_AQUI');

  if (!configured) {
    document.getElementById('login-config-warning').hidden = false;
    document.querySelector('#login-form button').disabled = true;
    return;
  }

  db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

  if (sessionStorage.getItem('shore_kanban_authed') === 'true') {
    enterApp();
  }

  setupLoginForm();
  setupTopbar();
  setupSectionTabs();
  setupFilterbar();
  setupQuickPanel();
  setupModal();
  setupAreasModal();
  setupDailySection();
  setupRecurringSection();
  setupTodayPlanZone();
  setupKeepInMind();
  setupArchiveFilter();
  watchForDayChange();
});

// Revisa cada minuto si ya cambió el día (por si dejas la pestaña abierta
// pasada la medianoche); si cambió, vuelve a pintar la rutina diaria para
// que los checks se vean reiniciados sin necesidad de recargar la página.
function watchForDayChange() {
  let lastKnownDate = todayISO();
  setInterval(async () => {
    const current = todayISO();
    if (current !== lastKnownDate) {
      lastKnownDate = current;
      await clearStalePlannedDates();
      renderDailySection();
      renderBoard();
      renderTodayPlanZone();
      renderCalendar();
      renderOverdueRecurring();
      renderHome();
      if (state.section === 'client') renderClientView();
      if (state.section === 'paused') renderPausedView();
    }
  }, 60000);
}

// ============================================================
// Auth
// ============================================================
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function setupLoginForm() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = document.getElementById('login-password').value;
    const hash = await sha256Hex(pwd);

    const { data, error } = await db.from('app_auth').select('password_hash').eq('id', 1).single();

    if (error || !data) {
      showToast('No se pudo verificar la contraseña. Revisa la configuración de Supabase.');
      return;
    }

    if (hash === data.password_hash) {
      sessionStorage.setItem('shore_kanban_authed', 'true');
      document.getElementById('login-error').hidden = true;
      enterApp();
    } else {
      document.getElementById('login-error').hidden = false;
    }
  });
}

async function enterApp() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app').hidden = false;
  renderColumnsSkeleton();
  await loadAll();
}

// ============================================================
// Data loading
// ============================================================
async function loadAll() {
  const [tasksRes, subtasksRes, quickRes, dailyRes, areasRes, recurringRes, completionsRes, keepRes] = await Promise.all([
    db.from('tasks').select('*').order('position', { ascending: true }),
    db.from('subtasks').select('*').order('position', { ascending: true }),
    db.from('quick_pendings').select('*').order('created_at', { ascending: true }),
    db.from('daily_tasks').select('*').order('position', { ascending: true }),
    db.from('areas').select('*').order('position', { ascending: true }),
    db.from('recurring_tasks').select('*').order('created_at', { ascending: true }),
    db.from('recurring_completions').select('*'),
    db.from('keep_in_minds').select('*').order('position', { ascending: true }),
  ]);

  if (tasksRes.error) { showToast('Error cargando tareas: ' + tasksRes.error.message); return; }

  state.tasks = tasksRes.data || [];
  state.subtasks = subtasksRes.data || [];
  state.quickPendings = quickRes.data || [];
  state.dailyTasks = dailyRes.data || [];
  state.areas = areasRes.data || [];
  state.recurringTasks = recurringRes.data || [];
  state.recurringCompletions = completionsRes.data || [];
  state.keepInMinds = keepRes.data || [];

  await clearStalePlannedDates();
  await runAutoArchiveIfNeeded();

  populateAreaFilter();
  renderBoard();
  renderTodayPlanZone();
  renderQuickList();
  renderKeepInMindList();
  renderDailySection();
  renderRecurringRulesList();
  renderCalendar();
  renderOverdueRecurring();
  renderHome();
  if (state.section === 'client') renderClientView();
  if (state.section === 'paused') renderPausedView();
  if (state.section === 'archive') renderArchiveView();
}

// ============================================================
// Archivado automático (cada viernes 11:59 PM)
// ============================================================
function mostRecentFridayBoundary(now) {
  const d = new Date(now);
  const day = d.getDay(); // 0=domingo ... 5=viernes ... 6=sábado
  const diff = (day - 5 + 7) % 7;
  const friday = new Date(d);
  friday.setDate(d.getDate() - diff);
  friday.setHours(23, 59, 0, 0);
  if (friday > now) friday.setDate(friday.getDate() - 7);
  return friday;
}

async function runAutoArchiveIfNeeded() {
  const now = new Date();
  const boundary = mostRecentFridayBoundary(now);

  const { data: settingRow } = await db.from('app_settings').select('value').eq('key', 'last_archive_run').maybeSingle();
  const lastRun = settingRow && settingRow.value ? new Date(settingRow.value) : null;

  if (lastRun && lastRun >= boundary) return; // ya se archivó para esta semana

  const toArchive = state.tasks.filter(t => t.status === 'completado' && !t.archived);

  if (toArchive.length > 0) {
    const ids = toArchive.map(t => t.id);
    const { error } = await db.from('tasks').update({ archived: true, archived_at: now.toISOString() }).in('id', ids);
    if (!error) {
      toArchive.forEach(t => { t.archived = true; t.archived_at = now.toISOString(); });
    }
  }

  await db.from('app_settings').upsert({ key: 'last_archive_run', value: now.toISOString() });
}

function populateAreaFilter() {
  const sel = document.getElementById('filter-area');
  const current = sel.value;
  const options = state.areas.filter(a => a.name !== 'Cliente');
  sel.innerHTML = '<option value="">Todas</option>' + options.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  if (options.some(a => a.name === current)) sel.value = current;
}

function populateTaskAreaSelect(selectedValue) {
  const sel = document.getElementById('task-area');
  const options = state.areas.map(a => `<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)}</option>`).join('');
  sel.innerHTML = '<option value="">Nadie / no aplica</option>' + options + '<option value="__manage__">⚙️ Administrar opciones…</option>';
  sel.value = selectedValue || '';
  sel.dataset.previousValue = selectedValue || '';
}

// ============================================================
// Topbar / view tabs
// ============================================================
function setupTopbar() {
  document.querySelectorAll('.view-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      renderBoard();
    });
  });

  document.getElementById('new-task-btn').addEventListener('click', () => openTaskModal(null));
}

function setupSectionTabs() {
  document.querySelectorAll('.section-tab').forEach(btn => {
    btn.addEventListener('click', () => setSection(btn.dataset.section));
  });
}

function setSection(section) {
  state.section = section;

  document.querySelectorAll('.section-tab').forEach(b => b.classList.toggle('active', b.dataset.section === section));

  document.getElementById('home-wrap').hidden = section !== 'home';
  document.getElementById('board-section').hidden = section !== 'board';
  document.getElementById('view-tabs').hidden = section !== 'board';
  document.getElementById('recurring-wrap').hidden = section !== 'recurring';
  document.getElementById('client-wrap').hidden = section !== 'client';
  document.getElementById('paused-wrap').hidden = section !== 'paused';
  document.getElementById('archive-wrap').hidden = section !== 'archive';

  if (section === 'home') { renderHome(); }
  if (section === 'recurring') { renderRecurringRulesList(); renderCalendar(); renderOverdueRecurring(); }
  if (section === 'client') { renderClientView(); }
  if (section === 'paused') { renderPausedView(); }
  if (section === 'archive') { renderArchiveView(); }
}

// ============================================================
// Filter bar
// ============================================================
function setupFilterbar() {
  document.getElementById('filter-area').addEventListener('change', (e) => {
    state.filters.area = e.target.value;
    renderBoard();
  });
  document.getElementById('filter-priority').addEventListener('change', (e) => {
    state.filters.priority = e.target.value;
    renderBoard();
  });
  document.getElementById('filter-blocked').addEventListener('change', (e) => {
    state.filters.blockedOnly = e.target.checked;
    renderBoard();
  });
  document.getElementById('clear-filters').addEventListener('click', () => {
    state.filters = { area: '', priority: '', blockedOnly: false };
    document.getElementById('filter-area').value = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-blocked').checked = false;
    renderBoard();
  });
}

// ============================================================
// Board rendering
// ============================================================
function renderColumnsSkeleton() {
  buildColumnsSkeleton('board', '');
  buildColumnsSkeleton('client-board', 'client-');
}

function buildColumnsSkeleton(containerId, idPrefix) {
  const board = document.getElementById(containerId);
  board.innerHTML = STATUSES.map(s => `
    <div class="column" data-status="${s.key}">
      <div class="column-header">
        <span class="column-title">${s.label}</span>
        <span class="column-count" id="${idPrefix}count-${s.key}">0</span>
      </div>
      <div class="column-body" id="${idPrefix}col-${s.key}" data-status="${s.key}"></div>
    </div>
  `).join('');

  board.querySelectorAll('.column-body').forEach(el => {
    el.addEventListener('dragover', onColumnDragOver);
    el.addEventListener('dragleave', onColumnDragLeave);
    el.addEventListener('drop', onColumnDrop);
  });
}

function isTaskBlocked(task) {
  if (!task.depends_on_task_id) return false;
  const dep = state.tasks.find(t => t.id === task.depends_on_task_id);
  return dep ? dep.status !== 'completado' : false;
}

function getVisibleTasks() {
  const today = todayISO();
  return state.tasks.filter(t => {
    if (t.archived) return false;
    if (t.area === 'Cliente') return false;          // vive solo en la vista de Cliente
    if (t.planned_date === today) return false;       // vive solo en "Hoy voy a hacer"
    if (state.view !== 'todo' && t.vertiente !== state.view) return false;
    if (state.filters.area && t.area !== state.filters.area) return false;
    if (state.filters.priority && t.priority !== state.filters.priority) return false;
    if (state.filters.blockedOnly && !isTaskBlocked(t)) return false;
    return true;
  });
}

function getClientTasks() {
  const today = todayISO();
  return state.tasks.filter(t => !t.archived && t.area === 'Cliente' && t.planned_date !== today);
}

function getTodayPlanTasks() {
  const today = todayISO();
  return state.tasks.filter(t => !t.archived && t.planned_date === today);
}

// Orden automático: 1) vence hoy, 2) urgente, 3) área "Mío" — el resto conserva su orden original
function taskSortKey(t) {
  const today = todayISO();
  return [
    (t.due_date === today && t.status !== 'completado') ? 0 : 1,
    t.priority === 'urgente' ? 0 : 1,
    t.area === 'Mío' ? 0 : 1,
  ];
}
function compareTasks(a, b) {
  const ka = taskSortKey(a), kb = taskSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

function renderBoard() {
  renderTasksIntoColumns(getVisibleTasks(), '', { showVertiente: state.view === 'todo' });
}

function renderClientView() {
  renderTasksIntoColumns(getClientTasks(), 'client-', { showVertiente: true });
}

function renderTasksIntoColumns(tasksList, idPrefix, opts = {}) {
  STATUSES.forEach(s => {
    const col = document.getElementById(`${idPrefix}col-${s.key}`);
    if (!col) return;
    const items = tasksList.filter(t => t.status === s.key).sort(compareTasks);
    document.getElementById(`${idPrefix}count-${s.key}`).textContent = items.length;

    if (items.length === 0) {
      col.innerHTML = `<div class="column-empty">Sin tareas aquí</div>`;
      return;
    }

    col.innerHTML = items.map(t => renderCard(t, opts)).join('');

    col.querySelectorAll('.card').forEach(cardEl => {
      cardEl.addEventListener('dragstart', onCardDragStart);
      cardEl.addEventListener('dragend', onCardDragEnd);
      cardEl.addEventListener('click', () => openTaskModal(cardEl.dataset.id));
    });
  });
}

function renderCard(task, opts = {}) {
  const subs = state.subtasks.filter(st => st.task_id === task.id);
  const hasSubs = subs.length > 0;
  const doneCount = subs.filter(s => s.done).length;
  const blocked = isTaskBlocked(task);
  const depTask = task.depends_on_task_id ? state.tasks.find(t => t.id === task.depends_on_task_id) : null;

  const today = todayISO();
  const overdue = task.due_date && task.due_date < today && task.status !== 'completado';
  const dueToday = task.due_date === today && task.status !== 'completado';
  const showVertiente = opts.showVertiente !== false && (opts.showVertiente || state.view === 'todo');

  const areaTag = task.area
    ? `<span class="tag tag-area" style="background:${getAreaColor(task.area)}">${escapeHtml(task.area)}</span>`
    : '';

  return `
    <div class="card ${blocked ? 'blocked' : ''} ${dueToday ? 'due-today' : ''}" draggable="true" data-id="${task.id}" data-vertiente="${task.vertiente}">
      <div class="card-top">
        <div class="card-title">${escapeHtml(task.title)}</div>
        <div class="priority-dot ${task.priority}"></div>
      </div>
      ${task.notes ? `<div class="card-notes">${escapeHtml(task.notes)}</div>` : ''}
      ${hasSubs ? `
        <div class="card-progress">
          <div class="card-progress-bar"><div class="card-progress-fill" style="width:${Math.round((doneCount / subs.length) * 100)}%"></div></div>
          <span class="card-progress-label">${doneCount}/${subs.length}</span>
        </div>` : ''}
      <div class="card-tags">
        ${showVertiente ? `<span class="tag tag-vertiente-${task.vertiente}">${VERTIENTE_LABELS[task.vertiente]}</span>` : ''}
        ${areaTag}
        ${blocked ? `<span class="tag tag-blocked">🔒 ${escapeHtml(depTask ? depTask.title : 'Tarea previa')}</span>` : ''}
        ${task.due_date ? `<span class="tag tag-due ${overdue ? 'overdue' : ''} ${dueToday ? 'today' : ''}">${dueToday ? 'Hoy' : formatDate(task.due_date)}</span>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// ============================================================
// Drag & drop
// ============================================================
let draggedTaskId = null;

function onCardDragStart(e) {
  draggedTaskId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onCardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}
function onColumnDragOver(e) {
  e.preventDefault();
  e.currentTarget.closest('.column').classList.add('drag-over');
}
function onColumnDragLeave(e) {
  e.currentTarget.closest('.column').classList.remove('drag-over');
}
async function onColumnDrop(e) {
  e.preventDefault();
  const column = e.currentTarget.closest('.column');
  column.classList.remove('drag-over');
  const newStatus = e.currentTarget.dataset.status;
  if (!draggedTaskId) return;

  const task = state.tasks.find(t => t.id === draggedTaskId);
  if (!task) return;

  const wasPlanned = !!task.planned_date;
  if (task.status === newStatus && !wasPlanned) { draggedTaskId = null; return; }

  const update = { status: newStatus };
  task.status = newStatus;
  if (wasPlanned) { update.planned_date = null; task.planned_date = null; }

  renderBoard();
  renderTodayPlanZone();
  if (state.section === 'client') renderClientView();

  const { error } = await db.from('tasks').update(update).eq('id', draggedTaskId);
  if (error) showToast('No se pudo actualizar el estatus: ' + error.message);
  draggedTaskId = null;
}

// ============================================================
// "Hoy voy a hacer"
// ============================================================
function setupTodayPlanZone() {
  const zone = document.getElementById('today-plan-zone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', onTodayZoneDrop);
}

async function onTodayZoneDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('today-plan-zone');
  zone.classList.remove('drag-over');
  if (!draggedTaskId) return;

  const task = state.tasks.find(t => t.id === draggedTaskId);
  if (!task) { draggedTaskId = null; return; }

  const today = todayISO();
  task.planned_date = today;
  renderBoard();
  renderTodayPlanZone();
  if (state.section === 'client') renderClientView();

  const { error } = await db.from('tasks').update({ planned_date: today }).eq('id', draggedTaskId);
  if (error) showToast('No se pudo planear: ' + error.message);
  draggedTaskId = null;
}

async function returnFromTodayPlan(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.planned_date = null;
  renderBoard();
  renderTodayPlanZone();
  if (state.section === 'client') renderClientView();
  const { error } = await db.from('tasks').update({ planned_date: null }).eq('id', taskId);
  if (error) showToast('No se pudo regresar: ' + error.message);
}

function renderTodayPlanZone() {
  const zone = document.getElementById('today-plan-zone');
  const items = getTodayPlanTasks().sort(compareTasks);

  if (items.length === 0) {
    zone.innerHTML = '<div class="today-plan-empty">Nada planeado todavía — arrastra una tarjeta del tablero.</div>';
    return;
  }

  zone.innerHTML = items.map(t => `
    <div>
      ${renderCard(t, { showVertiente: true })}
      <button type="button" class="today-plan-return" data-id="${t.id}">↩ Regresar al tablero</button>
    </div>
  `).join('');

  zone.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('dragstart', onCardDragStart);
    cardEl.addEventListener('dragend', onCardDragEnd);
    cardEl.addEventListener('click', () => openTaskModal(cardEl.dataset.id));
  });
  zone.querySelectorAll('.today-plan-return').forEach(btn => {
    btn.addEventListener('click', (e) => returnFromTodayPlan(e.target.dataset.id));
  });
}

async function clearStalePlannedDates() {
  const today = todayISO();
  const stale = state.tasks.filter(t => t.planned_date && t.planned_date !== today);
  if (stale.length === 0) return;
  const ids = stale.map(t => t.id);
  const { error } = await db.from('tasks').update({ planned_date: null }).in('id', ids);
  if (!error) stale.forEach(t => { t.planned_date = null; });
}

// ============================================================
// Task modal
// ============================================================
function setupModal() {
  document.getElementById('close-modal').addEventListener('click', closeTaskModal);
  document.getElementById('cancel-task-btn').addEventListener('click', closeTaskModal);
  document.getElementById('task-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'task-modal-backdrop') closeTaskModal();
  });

  document.getElementById('subtask-add-btn').addEventListener('click', addSubtaskToEditingList);
  document.getElementById('subtask-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSubtaskToEditingList(); }
  });

  document.getElementById('task-area').addEventListener('change', (e) => {
    if (e.target.value === '__manage__') {
      const previous = e.target.dataset.previousValue || '';
      e.target.value = previous;
      openAreasModal();
    } else {
      e.target.dataset.previousValue = e.target.value;
    }
  });

  document.getElementById('task-form').addEventListener('submit', onSaveTask);
  document.getElementById('delete-task-btn').addEventListener('click', onDeleteTask);
}

function openTaskModal(taskId) {
  state.editingTaskId = taskId;
  const modalTitle = document.getElementById('modal-title');
  const deleteBtn = document.getElementById('delete-task-btn');
  const form = document.getElementById('task-form');
  form.reset();

  populateDependsOnSelect(taskId);

  if (taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    modalTitle.textContent = 'Editar tarea';
    deleteBtn.hidden = false;
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-vertiente').value = task.vertiente;
    document.getElementById('task-status').value = task.status;
    document.getElementById('task-priority').value = task.priority;
    document.getElementById('task-due').value = task.due_date || '';
    populateTaskAreaSelect(task.area);
    document.getElementById('task-depends-on').value = task.depends_on_task_id || '';
    document.getElementById('task-description').value = task.description || '';
    document.getElementById('task-notes').value = task.notes || '';

    state.editingSubtasks = state.subtasks
      .filter(s => s.task_id === taskId)
      .map(s => ({ ...s }));
  } else {
    modalTitle.textContent = 'Nueva tarea';
    deleteBtn.hidden = true;
    document.getElementById('task-id').value = '';
    document.getElementById('task-vertiente').value = state.view !== 'todo' ? state.view : 'shore_content';
    populateTaskAreaSelect('');
    state.editingSubtasks = [];
  }

  renderEditingSubtasks();
  document.getElementById('task-modal-backdrop').hidden = false;
}

function closeTaskModal() {
  document.getElementById('task-modal-backdrop').hidden = true;
  state.editingTaskId = null;
  state.editingSubtasks = [];
}

function populateDependsOnSelect(currentTaskId) {
  const sel = document.getElementById('task-depends-on');
  const options = state.tasks
    .filter(t => t.id !== currentTaskId)
    .map(t => `<option value="${t.id}">${escapeHtml(t.title)}</option>`)
    .join('');
  sel.innerHTML = '<option value="">Ninguna</option>' + options;
}

function renderEditingSubtasks() {
  const list = document.getElementById('subtasks-list');
  const progress = document.getElementById('subtasks-progress');
  const subs = state.editingSubtasks;

  if (subs.length === 0) {
    list.innerHTML = '';
    progress.textContent = '';
    return;
  }

  const doneCount = subs.filter(s => s.done).length;
  progress.textContent = `${doneCount}/${subs.length}`;

  list.innerHTML = subs.map((s, i) => `
    <li class="subtask-item ${s.done ? 'done' : ''}" data-index="${i}">
      <input type="checkbox" ${s.done ? 'checked' : ''} data-action="toggle">
      <span>${escapeHtml(s.title)}</span>
      <button type="button" data-action="remove" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  list.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('change', (e) => {
      const i = e.target.closest('.subtask-item').dataset.index;
      state.editingSubtasks[i].done = e.target.checked;
      renderEditingSubtasks();
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.addEventListener('click', (e) => {
      const i = e.target.closest('.subtask-item').dataset.index;
      state.editingSubtasks.splice(i, 1);
      renderEditingSubtasks();
    });
  });
}

function addSubtaskToEditingList() {
  const input = document.getElementById('subtask-add-input');
  const title = input.value.trim();
  if (!title) return;
  state.editingSubtasks.push({ title, done: false, position: state.editingSubtasks.length });
  input.value = '';
  renderEditingSubtasks();
}

async function onSaveTask(e) {
  e.preventDefault();

  const newStatus = document.getElementById('task-status').value;
  const existingId = document.getElementById('task-id').value;
  const existingTask = existingId ? state.tasks.find(t => t.id === existingId) : null;
  const oldStatus = existingTask ? existingTask.status : null;

  const payload = {
    title: document.getElementById('task-title').value.trim(),
    vertiente: document.getElementById('task-vertiente').value,
    status: newStatus,
    priority: document.getElementById('task-priority').value,
    due_date: document.getElementById('task-due').value || null,
    area: document.getElementById('task-area').value || null,
    depends_on_task_id: document.getElementById('task-depends-on').value || null,
    description: document.getElementById('task-description').value.trim(),
    notes: document.getElementById('task-notes').value.trim(),
  };

  // Pausar: recuerda en qué columna estaba para poder reanudarla ahí mismo
  if (newStatus === 'pausada' && oldStatus !== 'pausada') {
    payload.previous_status = oldStatus || 'pendiente';
  }
  // Cancelar: se archiva automáticamente (clasificada aparte de "Completadas")
  if (newStatus === 'cancelada') {
    payload.archived = true;
    payload.archived_at = new Date().toISOString();
  } else if (oldStatus === 'cancelada' && newStatus !== 'cancelada') {
    // Se está reviviendo una tarea cancelada
    payload.archived = false;
    payload.archived_at = null;
  }

  let taskId = existingId;

  if (existingId) {
    const { error } = await db.from('tasks').update(payload).eq('id', existingId);
    if (error) { showToast('Error al guardar: ' + error.message); return; }
  } else {
    payload.position = state.tasks.filter(t => t.status === payload.status).length;
    const { data, error } = await db.from('tasks').insert(payload).select().single();
    if (error) { showToast('Error al crear: ' + error.message); return; }
    taskId = data.id;
  }

  await syncSubtasks(taskId);
  closeTaskModal();
  await loadAll();
  showToast('Tarea guardada.');
}

async function syncSubtasks(taskId) {
  const existingIds = state.subtasks.filter(s => s.task_id === taskId).map(s => s.id);
  const keptIds = state.editingSubtasks.filter(s => s.id).map(s => s.id);
  const removedIds = existingIds.filter(id => !keptIds.includes(id));

  if (removedIds.length) {
    await db.from('subtasks').delete().in('id', removedIds);
  }

  for (let i = 0; i < state.editingSubtasks.length; i++) {
    const s = state.editingSubtasks[i];
    if (s.id) {
      await db.from('subtasks').update({ title: s.title, done: s.done, position: i }).eq('id', s.id);
    } else {
      await db.from('subtasks').insert({ task_id: taskId, title: s.title, done: s.done, position: i });
    }
  }
}

async function onDeleteTask() {
  const taskId = document.getElementById('task-id').value;
  if (!taskId) return;
  if (!confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.')) return;

  const { error } = await db.from('tasks').delete().eq('id', taskId);
  if (error) { showToast('Error al eliminar: ' + error.message); return; }

  closeTaskModal();
  await loadAll();
  showToast('Tarea eliminada.');
}

// ============================================================
// Quick pendings panel
// ============================================================
function setupQuickPanel() {
  const panel = document.getElementById('quick-panel');
  const backdrop = document.getElementById('quick-panel-backdrop');

  document.getElementById('toggle-quick-panel').addEventListener('click', () => {
    panel.classList.add('open');
    backdrop.hidden = false;
  });
  document.getElementById('close-quick-panel').addEventListener('click', closeQuickPanel);
  backdrop.addEventListener('click', closeQuickPanel);

  function closeQuickPanel() {
    panel.classList.remove('open');
    backdrop.hidden = true;
  }

  document.getElementById('quick-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('quick-add-input');
    const title = input.value.trim();
    if (!title) return;

    const { error } = await db.from('quick_pendings').insert({ title, position: state.quickPendings.length });
    if (error) { showToast('Error al agregar: ' + error.message); return; }

    input.value = '';
    const { data } = await db.from('quick_pendings').select('*').order('created_at', { ascending: true });
    state.quickPendings = data || [];
    renderQuickList();
  });
}

function renderQuickList() {
  const list = document.getElementById('quick-list');
  if (state.quickPendings.length === 0) {
    list.innerHTML = '<li class="quick-empty">No tienes pendientes rápidos.</li>';
    return;
  }

  list.innerHTML = state.quickPendings.map(q => `
    <li class="quick-item ${q.done ? 'done' : ''}" data-id="${q.id}">
      <input type="checkbox" ${q.done ? 'checked' : ''} data-action="toggle">
      <span>${escapeHtml(q.title)}</span>
      <button type="button" data-action="remove" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  list.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('change', async (e) => {
      const id = e.target.closest('.quick-item').dataset.id;
      const item = state.quickPendings.find(q => q.id === id);
      item.done = e.target.checked;
      renderQuickList();
      await db.from('quick_pendings').update({ done: item.done }).eq('id', id);
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = e.target.closest('.quick-item').dataset.id;
      state.quickPendings = state.quickPendings.filter(q => q.id !== id);
      renderQuickList();
      await db.from('quick_pendings').delete().eq('id', id);
    });
  });
}

// ============================================================
// Rutina diaria
// ============================================================
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetweenISO(fromISO, toISO) {
  const from = new Date(fromISO + 'T00:00:00');
  const to = new Date(toISO + 'T00:00:00');
  return Math.round((to - from) / 86400000);
}

function yesterdayISO(fromTodayISO) {
  const d = new Date(fromTodayISO + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function setupDailySection() {
  document.getElementById('daily-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('daily-add-input');
    const title = input.value.trim();
    if (!title) return;

    const { error } = await db.from('daily_tasks').insert({ title, position: state.dailyTasks.length });
    if (error) { showToast('Error al agregar: ' + error.message); return; }

    input.value = '';
    const { data } = await db.from('daily_tasks').select('*').order('position', { ascending: true });
    state.dailyTasks = data || [];
    renderDailySection();
  });
}

function renderDailySection() {
  const list = document.getElementById('daily-list');
  const today = todayISO();

  if (state.dailyTasks.length === 0) {
    list.innerHTML = '<div class="daily-empty">Agrega tus tareas de todos los días — se reinician automáticamente cada 24 horas.</div>';
    return;
  }

  list.innerHTML = state.dailyTasks.map(dt => {
    const checkedToday = dt.last_checked_date === today;
    const daysSince = dt.last_checked_date ? daysBetweenISO(dt.last_checked_date, today) : null;
    const warning = !checkedToday && daysSince !== null && daysSince >= 3;

    let metaHtml = '';
    if (checkedToday) {
      metaHtml = `<span>🔥 Racha: ${dt.streak}</span><span>· Mejor: ${dt.best_streak}</span>`;
    } else if (daysSince === null) {
      metaHtml = `<span>Sin registrar aún</span>`;
    } else if (daysSince === 0) {
      metaHtml = `<span>🔥 Racha: ${dt.streak}</span><span>· Mejor: ${dt.best_streak}</span>`;
    } else {
      metaHtml = `<span>${daysSince} día${daysSince === 1 ? '' : 's'} sin check</span><span>· Mejor racha: ${dt.best_streak}</span>`;
    }

    return `
      <div class="daily-item ${checkedToday ? 'checked-today' : ''} ${warning ? 'warning' : ''}" data-id="${dt.id}">
        <input type="checkbox" ${checkedToday ? 'checked' : ''} data-action="toggle-daily">
        <div class="daily-item-body">
          <div class="daily-item-title">${escapeHtml(dt.title)}</div>
          <div class="daily-item-meta">${metaHtml}</div>
        </div>
        <button type="button" class="daily-item-delete" data-action="delete-daily" aria-label="Eliminar">✕</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action="toggle-daily"]').forEach(el => {
    el.addEventListener('change', (e) => onToggleDaily(e.target.closest('.daily-item').dataset.id, e.target.checked));
  });
  list.querySelectorAll('[data-action="delete-daily"]').forEach(el => {
    el.addEventListener('click', (e) => onDeleteDaily(e.target.closest('.daily-item').dataset.id));
  });
}

async function onToggleDaily(id, isChecked) {
  const dt = state.dailyTasks.find(d => d.id === id);
  if (!dt) return;
  const today = todayISO();

  let update;
  if (isChecked) {
    const wasYesterday = dt.last_checked_date === yesterdayISO(today);
    const newStreak = wasYesterday ? dt.streak + 1 : 1;
    update = {
      last_checked_date: today,
      streak: newStreak,
      best_streak: Math.max(dt.best_streak, newStreak),
    };
  } else {
    // Deshacer el check de hoy: retrocede la racha y marca como si el último
    // check hubiera sido ayer (aproximación razonable para uso personal).
    const newStreak = Math.max(0, dt.streak - 1);
    update = {
      last_checked_date: newStreak > 0 ? yesterdayISO(today) : null,
      streak: newStreak,
      best_streak: dt.best_streak,
    };
  }

  Object.assign(dt, update);
  renderDailySection();

  const { error } = await db.from('daily_tasks').update(update).eq('id', id);
  if (error) showToast('No se pudo guardar: ' + error.message);
}

async function onDeleteDaily(id) {
  if (!confirm('¿Eliminar esta tarea diaria?')) return;
  state.dailyTasks = state.dailyTasks.filter(d => d.id !== id);
  renderDailySection();
  const { error } = await db.from('daily_tasks').delete().eq('id', id);
  if (error) showToast('No se pudo eliminar: ' + error.message);
}

// ============================================================
// Modal de administrar áreas
// ============================================================
function setupAreasModal() {
  document.getElementById('close-areas-modal').addEventListener('click', closeAreasModal);
  document.getElementById('areas-modal-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'areas-modal-backdrop') closeAreasModal();
  });
  document.getElementById('area-add-btn').addEventListener('click', addArea);
  document.getElementById('area-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addArea(); }
  });
}

function openAreasModal() {
  renderAreasManageList();
  document.getElementById('areas-modal-backdrop').hidden = false;
}
function closeAreasModal() {
  document.getElementById('areas-modal-backdrop').hidden = true;
  // Refresca el select de la tarea abierta (si sigue abierto detrás) con la lista actualizada
  const taskModalOpen = !document.getElementById('task-modal-backdrop').hidden;
  if (taskModalOpen) {
    const current = document.getElementById('task-area').dataset.previousValue || '';
    populateTaskAreaSelect(current);
  }
  populateAreaFilter();
}

function renderAreasManageList() {
  const list = document.getElementById('areas-manage-list');
  if (state.areas.length === 0) {
    list.innerHTML = '<li class="recurring-empty">Aún no tienes áreas. Agrega una abajo.</li>';
    return;
  }
  list.innerHTML = state.areas.map(a => `
    <li class="subtask-item" data-id="${a.id}">
      <span style="width:10px;height:10px;border-radius:50%;background:${getAreaColor(a.name)};flex-shrink:0;"></span>
      <span>${escapeHtml(a.name)}</span>
      <button type="button" data-action="remove-area" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  list.querySelectorAll('[data-action="remove-area"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('li').dataset.id;
      if (!confirm('¿Eliminar esta área? Las tareas que ya la tengan asignada la conservarán como texto.')) return;
      state.areas = state.areas.filter(a => a.id !== id);
      renderAreasManageList();
      const { error } = await db.from('areas').delete().eq('id', id);
      if (error) showToast('No se pudo eliminar: ' + error.message);
    });
  });
}

async function addArea() {
  const input = document.getElementById('area-add-input');
  const name = input.value.trim();
  if (!name) return;

  if (state.areas.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    showToast('Esa área ya existe.');
    return;
  }

  const { data, error } = await db.from('areas').insert({ name, position: state.areas.length }).select().single();
  if (error) { showToast('No se pudo agregar: ' + error.message); return; }

  state.areas.push(data);
  input.value = '';
  renderAreasManageList();
}

// ============================================================
// Archivo
// ============================================================
function setupArchiveFilter() {
  document.querySelectorAll('.pill-tab[data-archive-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill-tab[data-archive-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.archiveFilter = btn.dataset.archiveFilter;
      renderArchiveView();
    });
  });
}

function renderArchiveView() {
  const list = document.getElementById('archive-list');
  const archived = state.tasks
    .filter(t => t.archived && t.status === state.archiveFilter)
    .sort((a, b) => new Date(b.archived_at || 0) - new Date(a.archived_at || 0));

  if (archived.length === 0) {
    const emptyMsg = state.archiveFilter === 'cancelada'
      ? 'No tienes tareas canceladas archivadas.'
      : 'Todavía no hay tareas completadas archivadas. Se archivan solas cada viernes a las 11:59 PM.';
    list.innerHTML = `<div class="archive-empty">${emptyMsg}</div>`;
    return;
  }

  list.innerHTML = archived.map(t => `
    <div class="archive-item" data-id="${t.id}">
      <div>
        <div class="archive-item-title">${escapeHtml(t.title)}</div>
        <div class="archive-item-meta">${VERTIENTE_LABELS[t.vertiente]} · Archivada el ${t.archived_at ? formatDateLong(t.archived_at) : '—'}</div>
      </div>
      <button type="button" class="btn btn-ghost" data-action="restore">Restaurar</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="restore"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.archive-item').dataset.id;
      const task = state.tasks.find(t => t.id === id);
      task.archived = false;
      renderArchiveView();
      const { error } = await db.from('tasks').update({ archived: false }).eq('id', id);
      if (error) { showToast('No se pudo restaurar: ' + error.message); return; }
      showToast('Tarea restaurada al tablero.');
    });
  });
}

function formatDateLong(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Para fechas puras 'YYYY-MM-DD' (sin hora) — evita el corrimiento de un día
// que causa parsear ese formato directo con `new Date()` en husos horarios negativos.
function formatDateOnlyLong(dateOnlyISO) {
  const d = new Date(dateOnlyISO + 'T00:00:00');
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
}

// ============================================================
// Tareas recurrentes + calendario
// ============================================================
function setupRecurringSection() {
  document.getElementById('recurring-pattern-type').addEventListener('change', (e) => {
    document.getElementById('recurring-nth-field').hidden = e.target.value !== 'monthly_nth';
  });

  document.getElementById('recurring-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('recurring-title').value.trim();
    const patternType = document.getElementById('recurring-pattern-type').value;
    const weekday = parseInt(document.getElementById('recurring-weekday').value, 10);
    let nthOccurrences = null;

    if (patternType === 'monthly_nth') {
      nthOccurrences = Array.from(document.querySelectorAll('.nth-check:checked')).map(c => parseInt(c.value, 10));
      if (nthOccurrences.length === 0) { showToast('Elige al menos una semana del mes.'); return; }
    }

    const { data, error } = await db.from('recurring_tasks')
      .insert({ title, pattern_type: patternType, weekday, nth_occurrences: nthOccurrences })
      .select().single();

    if (error) { showToast('Error al crear: ' + error.message); return; }

    state.recurringTasks.push(data);
    e.target.reset();
    document.getElementById('recurring-nth-field').hidden = true;
    renderRecurringRulesList();
    renderCalendar();
    showToast('Tarea recurrente creada.');
  });

  document.getElementById('cal-prev').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    renderCalendar();
  });
}

function describeRecurrence(rule) {
  const dayName = WEEKDAY_NAMES[rule.weekday];
  if (rule.pattern_type === 'weekly') return `Cada ${dayName.toLowerCase()}`;
  const nths = (rule.nth_occurrences || []).map(n => NTH_NAMES[n]).join(' y ');
  return `${nths} ${dayName.toLowerCase()} de cada mes`;
}

function renderRecurringRulesList() {
  const list = document.getElementById('recurring-rules-list');
  if (state.recurringTasks.length === 0) {
    list.innerHTML = '<li class="recurring-empty">Aún no tienes tareas recurrentes.</li>';
    return;
  }
  list.innerHTML = state.recurringTasks.map(r => `
    <li class="recurring-rule-item" data-id="${r.id}">
      <div>
        <div class="recurring-rule-title">${escapeHtml(r.title)}</div>
        <div class="recurring-rule-desc">${describeRecurrence(r)}</div>
      </div>
      <button type="button" data-action="delete-recurring" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  list.querySelectorAll('[data-action="delete-recurring"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('.recurring-rule-item').dataset.id;
      if (!confirm('¿Eliminar esta tarea recurrente? También se borrará su historial de checks.')) return;
      state.recurringTasks = state.recurringTasks.filter(r => r.id !== id);
      renderRecurringRulesList();
      renderCalendar();
      const { error } = await db.from('recurring_tasks').delete().eq('id', id);
      if (error) showToast('No se pudo eliminar: ' + error.message);
    });
  });
}

// Devuelve true si `rule` ocurre en la fecha dada (objeto Date)
function ruleOccursOn(rule, date) {
  if (date.getDay() !== rule.weekday) return false;
  if (rule.pattern_type === 'weekly') return true;
  const nthOfMonth = Math.ceil(date.getDate() / 7);
  return (rule.nth_occurrences || []).includes(nthOfMonth);
}

function dateToISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();

  const label = state.calendarDate.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  document.getElementById('calendar-month-label').textContent = label;

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = firstDay.getDay();
  const today = todayISO();

  let cells = '';
  for (let i = 0; i < startWeekday; i++) cells += `<div class="calendar-day empty"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const iso = dateToISO(date);
    const occurring = state.recurringTasks.filter(r => ruleOccursOn(r, date));
    const isToday = iso === today;
    const isSelected = iso === state.selectedDay;

    const dots = occurring.map(r => {
      const completion = state.recurringCompletions.find(c => c.recurring_task_id === r.id && c.occurrence_date === iso);
      const color = AREA_PALETTE[state.recurringTasks.indexOf(r) % AREA_PALETTE.length];
      return `<span class="calendar-day-dot ${completion && completion.done ? 'done' : ''}" style="background:${color}"></span>`;
    }).join('');

    cells += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${iso}">
        <span class="calendar-day-num">${day}</span>
        <div class="calendar-day-dots">${dots}</div>
      </div>
    `;
  }

  document.getElementById('calendar-grid').innerHTML = cells;

  document.querySelectorAll('.calendar-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDay = el.dataset.date;
      renderCalendar();
      renderCalendarDayPanel();
    });
  });

  if (!state.selectedDay) state.selectedDay = today;
  renderCalendarDayPanel();
}

function renderCalendarDayPanel() {
  const panel = document.getElementById('calendar-day-panel');
  if (!state.selectedDay) { panel.innerHTML = ''; return; }

  const date = new Date(state.selectedDay + 'T00:00:00');
  const occurring = state.recurringTasks.filter(r => ruleOccursOn(r, date));
  const label = date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  if (occurring.length === 0) {
    panel.innerHTML = `<h3>${label}</h3><div class="calendar-day-panel-empty">No hay tareas recurrentes este día.</div>`;
    return;
  }

  const itemsHtml = occurring.map(r => {
    const completion = state.recurringCompletions.find(c => c.recurring_task_id === r.id && c.occurrence_date === state.selectedDay);
    const done = completion ? completion.done : false;
    return `
      <li class="calendar-day-task ${done ? 'done' : ''}" data-rule-id="${r.id}">
        <input type="checkbox" ${done ? 'checked' : ''}>
        <span>${escapeHtml(r.title)}</span>
      </li>
    `;
  }).join('');

  panel.innerHTML = `<h3>${label}</h3><ul class="calendar-day-tasks">${itemsHtml}</ul>`;

  panel.querySelectorAll('.calendar-day-task input').forEach(input => {
    input.addEventListener('change', (e) => {
      const ruleId = e.target.closest('.calendar-day-task').dataset.ruleId;
      toggleRecurringCompletion(ruleId, state.selectedDay, e.target.checked);
    });
  });
}

async function toggleRecurringCompletion(ruleId, dateISO, done) {
  const existing = state.recurringCompletions.find(c => c.recurring_task_id === ruleId && c.occurrence_date === dateISO);

  if (existing) {
    existing.done = done;
    renderCalendarDayPanel();
    renderCalendar();
    const { error } = await db.from('recurring_completions').update({ done }).eq('id', existing.id);
    if (error) showToast('No se pudo guardar: ' + error.message);
  } else {
    const { data, error } = await db.from('recurring_completions')
      .insert({ recurring_task_id: ruleId, occurrence_date: dateISO, done })
      .select().single();
    if (error) { showToast('No se pudo guardar: ' + error.message); return; }
    state.recurringCompletions.push(data);
    renderCalendarDayPanel();
    renderCalendar();
  }
}

function getWeekStartMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getOverdueRecurringOccurrences() {
  const today = new Date();
  const todayStr = todayISO();
  const weekStart = getWeekStartMonday(today);
  const overdue = [];

  for (let d = new Date(weekStart); dateToISO(d) < todayStr; d.setDate(d.getDate() + 1)) {
    const iso = dateToISO(d);
    state.recurringTasks.forEach(r => {
      if (!ruleOccursOn(r, d)) return;
      const completion = state.recurringCompletions.find(c => c.recurring_task_id === r.id && c.occurrence_date === iso);
      if (!completion || !completion.done) {
        overdue.push({ rule: r, dateISO: iso });
      }
    });
  }
  return overdue;
}

function renderOverdueRecurring() {
  const banner = document.getElementById('recurring-overdue-banner');
  const overdue = getOverdueRecurringOccurrences();

  if (overdue.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }

  banner.hidden = false;
  banner.innerHTML = `
    <h3>⚠️ Atrasadas esta semana (${overdue.length})</h3>
    <ul class="recurring-overdue-list">
      ${overdue.map((o, i) => `
        <li class="recurring-overdue-item" data-idx="${i}">
          <span>${escapeHtml(o.rule.title)} <small>${formatDateOnlyLong(o.dateISO)}</small></span>
          <button type="button" data-action="mark-done">Marcar hecho</button>
        </li>
      `).join('')}
    </ul>
  `;

  banner.querySelectorAll('[data-action="mark-done"]').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const o = overdue[i];
      toggleRecurringCompletion(o.rule.id, o.dateISO, true).then(renderOverdueRecurring);
    });
  });
}

async function resumeTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const newStatus = task.previous_status || 'pendiente';
  task.status = newStatus;
  task.previous_status = null;
  renderPausedView();
  renderBoard();
  const { error } = await db.from('tasks').update({ status: newStatus, previous_status: null }).eq('id', taskId);
  if (error) { showToast('No se pudo reanudar: ' + error.message); return; }
  showToast('Tarea reanudada.');
}

function renderPausedView() {
  const list = document.getElementById('paused-list');
  const paused = state.tasks.filter(t => t.status === 'pausada' && !t.archived).sort(compareTasks);

  if (paused.length === 0) {
    list.innerHTML = '<div class="archive-empty">No tienes tareas pausadas ahora mismo.</div>';
    return;
  }

  list.innerHTML = paused.map(t => `
    <div class="paused-card-wrap" data-id="${t.id}">
      ${renderCard(t, { showVertiente: true })}
      <button type="button" class="paused-resume-btn" data-id="${t.id}">▶ Reanudar</button>
    </div>
  `).join('');

  list.querySelectorAll('.card').forEach(cardEl => {
    cardEl.addEventListener('click', () => openTaskModal(cardEl.dataset.id));
  });
  list.querySelectorAll('.paused-resume-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); resumeTask(e.target.dataset.id); });
  });
}

// ============================================================
// Keep in mind
// ============================================================
function setupKeepInMind() {
  document.getElementById('keepinmind-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('keepinmind-add-input');
    const title = input.value.trim();
    if (!title) return;

    const { data, error } = await db.from('keep_in_minds').insert({ title, position: state.keepInMinds.length }).select().single();
    if (error) { showToast('Error al agregar: ' + error.message); return; }

    state.keepInMinds.push(data);
    input.value = '';
    renderKeepInMindList();
  });
}

function renderKeepInMindList() {
  const list = document.getElementById('keepinmind-list');
  if (state.keepInMinds.length === 0) {
    list.innerHTML = '<li class="quick-empty">Nada en el radar todavía.</li>';
    return;
  }

  list.innerHTML = state.keepInMinds.map(k => `
    <li class="quick-item ${k.done ? 'done' : ''}" data-id="${k.id}">
      <input type="checkbox" ${k.done ? 'checked' : ''} data-action="toggle">
      <span>${escapeHtml(k.title)}</span>
      <button type="button" data-action="remove" aria-label="Eliminar">✕</button>
    </li>
  `).join('');

  list.querySelectorAll('[data-action="toggle"]').forEach(el => {
    el.addEventListener('change', async (e) => {
      const id = e.target.closest('.quick-item').dataset.id;
      const item = state.keepInMinds.find(k => k.id === id);
      item.done = e.target.checked;
      renderKeepInMindList();
      await db.from('keep_in_minds').update({ done: item.done }).eq('id', id);
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = e.target.closest('.quick-item').dataset.id;
      state.keepInMinds = state.keepInMinds.filter(k => k.id !== id);
      renderKeepInMindList();
      await db.from('keep_in_minds').delete().eq('id', id);
    });
  });
}

// ============================================================
// Inicio / Resumen
// ============================================================
function renderHome() {
  const grid = document.getElementById('home-grid');
  const today = todayISO();

  const activeTasks = state.tasks.filter(t => !t.archived && t.area !== 'Cliente' && t.status !== 'pausada' && t.status !== 'cancelada');
  const urgentCount = activeTasks.filter(t => t.priority === 'urgente').length;
  const plannedCount = getTodayPlanTasks().length;
  const pausedCount = state.tasks.filter(t => t.status === 'pausada' && !t.archived).length;
  const clientCount = getClientTasks().length;
  const overdueRecurring = getOverdueRecurringOccurrences().length;
  const dailyDone = state.dailyTasks.filter(d => d.last_checked_date === today).length;
  const keepCount = state.keepInMinds.filter(k => !k.done).length;
  const archivedCompleted = state.tasks.filter(t => t.archived && t.status === 'completado').length;
  const archivedCancelled = state.tasks.filter(t => t.archived && t.status === 'cancelada').length;

  const tiles = [
    { icon: '📋', title: 'Tablero', stat: `${activeTasks.length} activas · ${urgentCount} urgentes`, section: 'board', alert: false },
    { icon: '📌', title: 'Hoy voy a hacer', stat: `${plannedCount} planeadas`, section: 'board', alert: false },
    { icon: '🔥', title: 'Rutina diaria', stat: `${dailyDone}/${state.dailyTasks.length} hoy`, section: 'board', alert: false },
    { icon: '🗒', title: 'Keep in mind', stat: `${keepCount} en el radar`, section: 'board', alert: false },
    { icon: '📅', title: 'Recurrentes', stat: overdueRecurring > 0 ? `${overdueRecurring} atrasadas` : 'Al día', section: 'recurring', alert: overdueRecurring > 0 },
    { icon: '🤝', title: 'Cliente', stat: `${clientCount} pendientes`, section: 'client', alert: false },
    { icon: '⏸', title: 'Pausadas', stat: `${pausedCount} atoradas`, section: 'paused', alert: pausedCount > 0 },
    { icon: '🗄', title: 'Archivo', stat: `${archivedCompleted} completadas · ${archivedCancelled} canceladas`, section: 'archive', alert: false },
  ];

  grid.innerHTML = tiles.map(t => `
    <button type="button" class="home-tile ${t.alert ? 'alert' : ''}" data-section="${t.section}">
      <span class="home-tile-icon">${t.icon}</span>
      <span class="home-tile-title">${t.title}</span>
      <span class="home-tile-stat">${t.stat}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.home-tile').forEach(tile => {
    tile.addEventListener('click', () => setSection(tile.dataset.section));
  });
}

// ============================================================
// Toast
// ============================================================
let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}
