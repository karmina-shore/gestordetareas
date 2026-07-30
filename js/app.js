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
};

const AREAS = ['Brand', 'MKT', 'Comercial', 'Dirección', 'Administración', 'Culture & People', 'Producción', 'Postproducción', 'Cliente'];

let supabase = null;
let state = {
  tasks: [],
  subtasks: [],       // all subtasks, filtered by task_id when needed
  quickPendings: [],
  view: 'todo',        // 'todo' | 'shore_content' | 'pm_video'
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

  supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

  if (sessionStorage.getItem('shore_kanban_authed') === 'true') {
    enterApp();
  }

  setupLoginForm();
  setupTopbar();
  setupFilterbar();
  setupQuickPanel();
  setupModal();
});

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

    const { data, error } = await supabase.from('app_auth').select('password_hash').eq('id', 1).single();

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
  const [tasksRes, subtasksRes, quickRes] = await Promise.all([
    supabase.from('tasks').select('*').order('position', { ascending: true }),
    supabase.from('subtasks').select('*').order('position', { ascending: true }),
    supabase.from('quick_pendings').select('*').order('created_at', { ascending: true }),
  ]);

  if (tasksRes.error) { showToast('Error cargando tareas: ' + tasksRes.error.message); return; }

  state.tasks = tasksRes.data || [];
  state.subtasks = subtasksRes.data || [];
  state.quickPendings = quickRes.data || [];

  populateAreaFilter();
  renderBoard();
  renderQuickList();
}

function populateAreaFilter() {
  const sel = document.getElementById('filter-area');
  sel.innerHTML = '<option value="">Todas</option>' + AREAS.map(a => `<option value="${a}">${a}</option>`).join('');
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
  const board = document.getElementById('board');
  board.innerHTML = STATUSES.map(s => `
    <div class="column" data-status="${s.key}">
      <div class="column-header">
        <span class="column-title">${s.label}</span>
        <span class="column-count" id="count-${s.key}">0</span>
      </div>
      <div class="column-body" id="col-${s.key}" data-status="${s.key}"></div>
    </div>
  `).join('');

  document.querySelectorAll('.column-body').forEach(el => {
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
  return state.tasks.filter(t => {
    if (state.view !== 'todo' && t.vertiente !== state.view) return false;
    if (state.filters.area && t.area !== state.filters.area) return false;
    if (state.filters.priority && t.priority !== state.filters.priority) return false;
    if (state.filters.blockedOnly && !isTaskBlocked(t)) return false;
    return true;
  });
}

function renderBoard() {
  const visible = getVisibleTasks();

  STATUSES.forEach(s => {
    const col = document.getElementById(`col-${s.key}`);
    const items = visible.filter(t => t.status === s.key);
    document.getElementById(`count-${s.key}`).textContent = items.length;

    if (items.length === 0) {
      col.innerHTML = `<div class="column-empty">Sin tareas aquí</div>`;
      return;
    }

    col.innerHTML = items.map(renderCard).join('');

    col.querySelectorAll('.card').forEach(cardEl => {
      cardEl.addEventListener('dragstart', onCardDragStart);
      cardEl.addEventListener('dragend', onCardDragEnd);
      cardEl.addEventListener('click', () => openTaskModal(cardEl.dataset.id));
    });
  });
}

function renderCard(task) {
  const subs = state.subtasks.filter(st => st.task_id === task.id);
  const hasSubs = subs.length > 0;
  const doneCount = subs.filter(s => s.done).length;
  const blocked = isTaskBlocked(task);
  const depTask = task.depends_on_task_id ? state.tasks.find(t => t.id === task.depends_on_task_id) : null;

  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due_date && task.due_date < today && task.status !== 'completado';

  return `
    <div class="card ${blocked ? 'blocked' : ''}" draggable="true" data-id="${task.id}" data-vertiente="${task.vertiente}">
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
        ${state.view === 'todo' ? `<span class="tag tag-vertiente-${task.vertiente}">${VERTIENTE_LABELS[task.vertiente]}</span>` : ''}
        ${task.area ? `<span class="tag tag-area" data-area="${task.area}">${task.area}</span>` : ''}
        ${blocked ? `<span class="tag tag-blocked">🔒 ${escapeHtml(depTask ? depTask.title : 'Tarea previa')}</span>` : ''}
        ${task.due_date ? `<span class="tag tag-due ${overdue ? 'overdue' : ''}">${formatDate(task.due_date)}</span>` : ''}
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
  if (!task || task.status === newStatus) return;

  task.status = newStatus;
  renderBoard();

  const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', draggedTaskId);
  if (error) showToast('No se pudo actualizar el estatus: ' + error.message);
  draggedTaskId = null;
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
    document.getElementById('task-area').value = task.area || '';
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

  const payload = {
    title: document.getElementById('task-title').value.trim(),
    vertiente: document.getElementById('task-vertiente').value,
    status: document.getElementById('task-status').value,
    priority: document.getElementById('task-priority').value,
    due_date: document.getElementById('task-due').value || null,
    area: document.getElementById('task-area').value || null,
    depends_on_task_id: document.getElementById('task-depends-on').value || null,
    description: document.getElementById('task-description').value.trim(),
    notes: document.getElementById('task-notes').value.trim(),
  };

  const existingId = document.getElementById('task-id').value;
  let taskId = existingId;

  if (existingId) {
    const { error } = await supabase.from('tasks').update(payload).eq('id', existingId);
    if (error) { showToast('Error al guardar: ' + error.message); return; }
  } else {
    payload.position = state.tasks.filter(t => t.status === payload.status).length;
    const { data, error } = await supabase.from('tasks').insert(payload).select().single();
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
    await supabase.from('subtasks').delete().in('id', removedIds);
  }

  for (let i = 0; i < state.editingSubtasks.length; i++) {
    const s = state.editingSubtasks[i];
    if (s.id) {
      await supabase.from('subtasks').update({ title: s.title, done: s.done, position: i }).eq('id', s.id);
    } else {
      await supabase.from('subtasks').insert({ task_id: taskId, title: s.title, done: s.done, position: i });
    }
  }
}

async function onDeleteTask() {
  const taskId = document.getElementById('task-id').value;
  if (!taskId) return;
  if (!confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.')) return;

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
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

    const { error } = await supabase.from('quick_pendings').insert({ title, position: state.quickPendings.length });
    if (error) { showToast('Error al agregar: ' + error.message); return; }

    input.value = '';
    const { data } = await supabase.from('quick_pendings').select('*').order('created_at', { ascending: true });
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
      await supabase.from('quick_pendings').update({ done: item.done }).eq('id', id);
    });
  });
  list.querySelectorAll('[data-action="remove"]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const id = e.target.closest('.quick-item').dataset.id;
      state.quickPendings = state.quickPendings.filter(q => q.id !== id);
      renderQuickList();
      await supabase.from('quick_pendings').delete().eq('id', id);
    });
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
