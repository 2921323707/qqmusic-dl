/**
 * qqmusic-dl Web UI —— 零构建原生 ES module（无框架 / 无 CDN）
 *
 * 章节索引：
 *   1. 常量与全局状态
 *   2. 工具函数（DOM / 格式化 / fetch 封装）
 *   3. Toast 通知
 *   4. 标签页路由
 *   5. 登录认证（状态 / 扫码 / 退出）
 *   6. 搜索页
 *   7. 任务页（轮询 / 取消 / 重试）
 *   8. 媒体库页
 *   9. 设置页
 *  10. 事件绑定与启动
 *
 * 安全约定：所有来自 API 的文本一律通过 textContent / createTextNode 插入 DOM，
 * 不使用 innerHTML 拼接；URL 类字段（封面 / 二维码）先做协议校验再赋给 src。
 */

/* ============================================================
   1. 常量与全局状态
   ============================================================ */

const API = {
  authStatus: '/api/auth/status',
  authQrcode: '/api/auth/qrcode',
  authQrcodePoll: (id) => `/api/auth/qrcode/${encodeURIComponent(id)}`,
  authQrcodeCancel: (id) => `/api/auth/qrcode/${encodeURIComponent(id)}/cancel`,
  authLogout: '/api/auth/logout',
  search: '/api/search',
  downloads: '/api/downloads',
  tasks: '/api/tasks',
  taskClear: '/api/tasks/clear',
  taskCancel: (id) => `/api/tasks/${encodeURIComponent(id)}/cancel`,
  taskRetry: (id) => `/api/tasks/${encodeURIComponent(id)}/retry`,
  library: '/api/library',
  libraryCleanup: '/api/library/cleanup',
  fileAudio: (id) => `/api/library/${encodeURIComponent(id)}/audio`,
  fileCover: (id) => `/api/library/${encodeURIComponent(id)}/cover`,
  fileLrc: (id) => `/api/library/${encodeURIComponent(id)}/lrc`,
  fileLocate: (id) => `/api/library/${encodeURIComponent(id)}/locate`,
  fileDelete: (id) => `/api/library/${encodeURIComponent(id)}/delete`,
  openDownloadDir: '/api/system/open-download-dir',
  playlistResolve: '/api/playlist/resolve',
  playlistDownload: '/api/playlist/download',
  config: '/api/config',
};

const PAGE_NUM = 20;          // 搜索每页条数
const TASK_POLL_MS = 1500;    // 任务轮询间隔
const QR_POLL_MS = 2000;      // 扫码轮询间隔
const ACTIVE_STATUSES = ['pending', 'active', 'downloading']; // 可取消的任务状态
const RETRYABLE_STATUSES = ['failed', 'canceled'];            // 可重试的任务状态

/** 任务状态 → 徽章文案与配色 */
const TASK_STATUS = {
  pending:    { label: '等待中', cls: 'badge-gray' },
  active:     { label: '进行中', cls: 'badge-blue' },
  downloading:{ label: '下载中', cls: 'badge-blue is-pulse' },
  success:    { label: '已完成', cls: 'badge-green' },
  failed:     { label: '失败',   cls: 'badge-red' },
  canceled:   { label: '已取消', cls: 'badge-gray' },
};

/** 扫码事件 → 提示文案（与后端语义对齐：SCAN = 二维码有效、等待扫描；CONF = 已扫描、待手机确认） */
const QR_EVENT_HINT = {
  WAIT:   '等待扫描…',
  SCAN:   '等待扫描…',
  CONF:   '已扫描，请在手机上确认',
  DONE:   '登录成功',
  REFUSE: '您拒绝了本次登录',
  TIMEOUT:'二维码已过期，请重新获取',
};

const PAGE_TITLES = { search: '搜索', tasks: '任务', library: '媒体库', playlist: '歌单', settings: '设置' };

const state = {
  tab: 'search',
  auth: null,    // GET /api/auth/status 结果
  config: null,  // GET /api/config 结果
  search: { keyword: '', page: 1, hasNext: false, searched: false },
  tasks: { timer: null, everLoaded: false },
  library: { q: '', list: [], missing: 0, pendingDelete: null },
  playlist: { input: '', info: null, songs: [], selected: new Set() },
  player: { file: null, list: [], index: -1, seeking: false },
  lyrics: { fileId: null, lines: [], loaded: false, panelOpen: false, pip: null, pipFont: 26, timer: null, activeIndex: -1 },
  qr: { qrId: null, timer: null },
};

/* ============================================================
   2. 工具函数
   ============================================================ */

/** 简化 querySelector */
const $ = (sel, root = document) => root.querySelector(sel);

/**
 * 极简 hyperscript：所有文本经 textContent / createTextNode 插入，天然防 XSS。
 * attrs 约定：class / text / value / selected / checked / disabled / hidden / on* / 其余走 setAttribute
 */
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = String(val);
    else if (key === 'value') node.value = val;
    else if (key === 'dataset') { for (const [dk, dv] of Object.entries(val)) node.dataset[dk] = String(dv); }
    else if (key === 'selected' || key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = true;
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** 统一错误类型，携带后端错误码与提示 */
class ApiError extends Error {
  constructor(code, message, hint, status) {
    super(message || code || '请求失败');
    this.name = 'ApiError';
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

/**
 * fetch 封装：统一 JSON 解析与 { error: { code, message } } 错误响应处理。
 * @param {string} path 接口路径（同源相对路径）
 * @param {{ method?: string, body?: string }} [options]
 */
async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, {
      method: options.method || 'GET',
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body || undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', '网络请求失败，请确认 qqmusic-dl 服务正在运行');
  }
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!res.ok) {
    const e = (payload && payload.error) || {};
    throw new ApiError(
      e.code || `HTTP_${res.status}`,
      e.message || `请求失败（HTTP ${res.status}）`,
      e.hint,
      res.status,
    );
  }
  return payload;
}

/** 时长格式化为 mm:ss */
function formatDuration(sec) {
  if (sec == null || sec === '') return '--:--';
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '--:--';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 文件大小格式化为二进制单位（1024）：B / KB / MB / GB / TB */
function formatSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return '--';
  let n = Number(bytes);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  const val = i === 0 ? String(Math.round(n)) : n.toFixed(2);
  return `${val} ${units[i]}`;
}

/** 音质选项文案：label + code，如 "SQ 无损 (F000)" */
function qualityLabel(q) {
  if (!q) return '';
  return q.label ? `${q.label} (${q.code})` : String(q.code || '');
}

/** 校验 URL 是否为安全的 http(s) 链接（用于封面等） */
function safeHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/** 简单防抖 */
function debounce(fn, ms) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ============================================================
   3. Toast 通知（右上角，3 秒自动消失）
   ============================================================ */

function toast(message, type = 'info') {
  const wrap = $('#toast-wrap');
  const node = h('div', { class: `toast toast-${type}`, role: 'status' }, message);
  wrap.append(node);
  requestAnimationFrame(() => node.classList.add('toast-in'));
  setTimeout(() => {
    node.classList.add('toast-out');
    setTimeout(() => node.remove(), 300);
  }, 3000);
}

/* ============================================================
   4. 标签页路由
   ============================================================ */

function switchTab(tab) {
  if (!PAGE_TITLES[tab]) return;
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.page').forEach((page) => {
    page.hidden = page.id !== `page-${tab}`;
  });
  $('#topbar-page').textContent = PAGE_TITLES[tab];
  if (tab === 'tasks') startTaskPolling();
  else stopTaskPolling();
  if (tab === 'library') loadLibrary();
  if (tab === 'playlist') initPlaylistPage();
  if (tab === 'settings') loadConfig(); // 打开设置页时拉取最新配置
}

/* ============================================================
   5. 登录认证
   ============================================================ */

/** 重新请求登录状态并渲染顶栏 */
async function refreshAuth() {
  try {
    state.auth = await api(API.authStatus);
  } catch {
    state.auth = { loggedIn: false, expired: false };
  }
  renderAuth();
}

/** 渲染顶栏登录状态区 */
function renderAuth() {
  const area = $('#auth-area');
  area.replaceChildren();
  const st = state.auth || { loggedIn: false };
  if (st.loggedIn) {
    // 已登录：musicid + 过期警告徽章（如有）+ 退出按钮
    const expired = !!st.expired;
    area.append(
      h('span', { class: `badge ${expired ? 'badge-warn' : 'badge-green'}` }, expired ? '已过期' : '已登录'),
      h('span', { class: 'auth-id', text: st.musicid != null ? `ID ${st.musicid}` : '' }),
      h('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: onLogout,
      }, '退出'),
    );
  } else {
    // 未登录：徽章 + 扫码登录按钮
    area.append(
      h('span', { class: 'badge badge-gray' }, '未登录'),
      h('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onclick: openQrModal,
      }, '扫码登录'),
    );
  }
  // 手动刷新状态按钮（文字按钮，无图标）
  area.append(h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    onclick: async () => { await refreshAuth(); toast('登录状态已刷新', 'info'); },
  }, '刷新'));
}

/** 退出登录（危险操作，confirm 确认） */
async function onLogout() {
  if (!window.confirm('确定要退出登录吗？本地保存的凭证将被清除。')) return;
  try {
    await api(API.authLogout, { method: 'POST' });
    toast('已退出登录', 'success');
    await refreshAuth();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 打开扫码登录模态框 */
async function openQrModal() {
  $('#qr-image').removeAttribute('src');
  $('#qr-hint').textContent = '正在获取二维码…';
  $('#qr-modal').hidden = false;
  document.body.classList.add('no-scroll');
  try {
    const data = await api(API.authQrcode, { method: 'POST' });
    state.qr.qrId = data.qrId;
    if (typeof data.image === 'string' && data.image.startsWith('data:image/')) {
      $('#qr-image').src = data.image;
    }
    const minutes = Math.max(1, Math.round((data.expiresIn || 180) / 60));
    $('#qr-hint').textContent = `等待扫描…（二维码约 ${minutes} 分钟内有效）`;
    startQrPolling();
  } catch (err) {
    toast(err.message, 'error');
    closeQrModal({ cancel: false });
  }
}

/** 启动扫码状态轮询（2s 一次） */
function startQrPolling() {
  stopQrPolling();
  state.qr.timer = setInterval(pollQr, QR_POLL_MS);
}

function stopQrPolling() {
  if (state.qr.timer) {
    clearInterval(state.qr.timer);
    state.qr.timer = null;
  }
}

/** 轮询扫码状态 */
async function pollQr() {
  const qrId = state.qr.qrId;
  if (!qrId) return;
  try {
    const data = await api(API.authQrcodePoll(qrId));
    switch (data.event) {
      case 'DONE':
        stopQrPolling();
        closeQrModal({ cancel: false });
        await refreshAuth();
        toast('登录成功', 'success');
        break;
      case 'REFUSE':
      case 'TIMEOUT':
        stopQrPolling();
        closeQrModal({ cancel: false });
        toast(QR_EVENT_HINT[data.event] || '扫码登录未完成', 'error');
        break;
      case 'WAIT':
      case 'SCAN':
      case 'CONF':
        $('#qr-hint').textContent = QR_EVENT_HINT[data.event] || data.message || '等待中…';
        break;
      default:
        if (data.message) $('#qr-hint').textContent = data.message;
    }
  } catch (err) {
    stopQrPolling();
    closeQrModal({ cancel: false });
    toast(err.message, 'error');
  }
}

/** 关闭扫码模态框；cancel 为 true 时通知后端作废二维码 */
function closeQrModal({ cancel = true } = {}) {
  stopQrPolling();
  const qrId = state.qr.qrId;
  state.qr.qrId = null;
  $('#qr-modal').hidden = true;
  document.body.classList.remove('no-scroll');
  if (cancel && qrId) {
    api(API.authQrcodeCancel(qrId), { method: 'POST' }).catch(() => {});
  }
}

/** NOT_LOGGED_IN 时的登录引导弹窗 */
function openLoginGuide(err) {
  $('#guide-message').textContent = err.hint || err.message || '该音质需要 QQ 音乐登录凭证，请先扫码登录。';
  $('#login-guide-modal').hidden = false;
  document.body.classList.add('no-scroll');
}

function closeLoginGuide() {
  $('#login-guide-modal').hidden = true;
  document.body.classList.remove('no-scroll');
}

/* ============================================================
   6. 搜索页
   ============================================================ */

/** 执行搜索（page 从 1 开始） */
async function runSearch(page = 1) {
  const keyword = $('#search-input').value.trim();
  if (!keyword) {
    toast('请输入搜索关键词', 'error');
    $('#search-input').focus();
    return;
  }
  state.search.keyword = keyword;
  state.search.page = Math.max(1, page);
  $('#search-loading').hidden = false;
  $('#search-btn').disabled = true;
  $('#search-empty').hidden = true;
  try {
    const params = new URLSearchParams({ keyword, page: String(state.search.page), num: String(PAGE_NUM) });
    const data = await api(`${API.search}?${params.toString()}`);
    const songs = Array.isArray(data.songs) ? data.songs : [];
    // 结果不足一页视为末页
    state.search.hasNext = songs.length >= PAGE_NUM;
    state.search.searched = true;
    renderSearchResults(songs);
    updatePager();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    $('#search-loading').hidden = true;
    $('#search-btn').disabled = false;
  }
}

function renderSearchResults(songs) {
  const box = $('#search-results');
  box.replaceChildren();
  if (!songs.length) {
    $('#search-empty-text').textContent = `没有找到与“${state.search.keyword}”相关的歌曲`;
    $('#search-empty').hidden = false;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const song of songs) frag.append(renderSongRow(song));
  box.append(frag);
}

function renderSongRow(song) {
  // 封面（cover 可能为 null → 占位符）
  const cover = h('div', { class: 'song-cover' });
  if (safeHttpUrl(song.cover)) {
    cover.append(h('img', { src: song.cover, alt: '', loading: 'lazy' }));
  } else {
    cover.append(h('span', { 'aria-hidden': 'true' }, '♪'));
  }
  const sub = h('div', { class: 'song-sub' },
    h('span', { text: song.artist || '未知歌手' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { text: song.album || '未知专辑' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { class: 'song-duration', text: formatDuration(song.duration) }),
  );
  const select = buildQualitySelect();
  const downloadBtn = h('button', {
    class: 'btn btn-primary btn-sm', type: 'button',
    onclick: () => onDownload(song, select.value),
  }, '下载');
  return h('div', { class: 'song' },
    cover,
    h('div', { class: 'song-body' }, h('div', { class: 'song-title', text: song.title || '未知歌曲' }), sub),
    select,
    downloadBtn,
  );
}

/** 构建音质下拉（选项来自 /api/config 的 qualities，默认选中 defaultQuality） */
function buildQualitySelect() {
  const select = h('select', { class: 'song-quality', 'aria-label': '选择音质' });
  const qualities = currentQualities();
  for (const q of qualities) {
    select.append(h('option', { value: q.code, text: qualityLabel(q), selected: q.code === state.config?.defaultQuality }));
  }
  if (select.value === '' && select.options.length > 0) select.selectedIndex = 0;
  return select;
}

function currentQualities() {
  const qs = state.config && Array.isArray(state.config.qualities) ? state.config.qualities : [];
  return qs;
}

/** 点击下载：POST /api/downloads { mid, quality } */
async function onDownload(song, quality) {
  const body = { mid: song.mid };
  if (quality) body.quality = quality;
  try {
    const res = await api(API.downloads, { method: 'POST', body: JSON.stringify(body) });
    if (res && res.deduped) {
      toast(`《${song.title || ''}》${res.message || '已存在，未重复下载'}`, 'info');
    } else {
      toast(`已加入下载队列：${song.title || song.mid}`, 'success');
      refreshTaskBadge();
    }
  } catch (err) {
    if (err.code === 'NOT_LOGGED_IN') {
      openLoginGuide(err);
    } else {
      toast(err.message, 'error');
    }
  }
}

function updatePager() {
  const pager = $('#search-pager');
  pager.hidden = !state.search.searched;
  $('#page-info').textContent = `第 ${state.search.page} 页`;
  $('#page-prev').disabled = state.search.page <= 1;
  $('#page-next').disabled = !state.search.hasNext;
}

/* ============================================================
   7. 任务页
   ============================================================ */

const taskRows = new Map(); // taskId -> 行元素引用缓存（原地更新，保证进度条过渡动画连续）

function startTaskPolling() {
  if (state.tasks.timer) return;
  if (taskRows.size === 0) $('#tasks-loading').hidden = false;
  loadTasks();
  state.tasks.timer = setInterval(loadTasks, TASK_POLL_MS);
}

function stopTaskPolling() {
  if (state.tasks.timer) {
    clearInterval(state.tasks.timer);
    state.tasks.timer = null;
  }
}

/** 拉取全部任务并渲染（不带 status 参数取全部） */
async function loadTasks() {
  try {
    const data = await api(API.tasks);
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    state.tasks.everLoaded = true;
    renderTasks(tasks);
    updateTaskBadge(tasks);
  } catch (err) {
    if (!state.tasks.everLoaded) {
      $('#tasks-empty').hidden = false;
      toast(err.message, 'error');
    }
    // 轮询期间的失败静默处理，避免 toast 轰炸
  } finally {
    $('#tasks-loading').hidden = true;
  }
}

/** 已结束状态集合（清空按钮的作用范围） */
const FINISHED_STATUSES = ['success', 'failed', 'canceled'];

function renderTasks(tasks) {
  const box = $('#task-list');
  const alive = new Set();
  let hasFresh = false;
  for (const t of tasks) {
    alive.add(t.id);
    const entry = taskRows.get(t.id);
    if (entry) {
      // 已有行原地更新：宽度变化才能触发 CSS 过渡动画（重新插入 DOM 会重置过渡）
      updateTaskRow(entry, t);
    } else {
      const created = createTaskRow(t);
      taskRows.set(t.id, created);
      // 新行先入 DOM，使 currentOrder 能感知到它的存在并触发下方重排
      box.appendChild(created.row);
      hasFresh = true;
    }
  }
  // 排序与接口一致：进行中/等待中置顶，其次已结束；组内新的在前。
  // 只有顺序真正变化才搬动 DOM，避免轮询期间打断进度条 CSS 过渡。
  const sorted = [...tasks].sort((a, b) => taskSortKey(a) - taskSortKey(b));
  const currentOrder = [...box.children].map((el) => el.dataset.taskId);
  const desiredOrder = sorted.map((t) => t.id);
  const orderChanged =
    hasFresh ||
    currentOrder.length !== desiredOrder.length ||
    desiredOrder.some((id, i) => currentOrder[i] !== id);
  if (orderChanged) {
    // 单次 appendChild 重排：既有行移动不会打断进度条 CSS 过渡
    for (const t of sorted) {
      const entry = taskRows.get(t.id);
      if (entry) box.appendChild(entry.row);
    }
  }
  // 移除已不在列表中的任务行
  for (const [id, entry] of [...taskRows]) {
    if (!alive.has(id)) {
      entry.row.remove();
      taskRows.delete(id);
    }
  }
  $('#tasks-empty').hidden = tasks.length > 0;
}

/** 排序权重：下载中(0) > 等待/处理中(1) > 已结束(2)，与后端 listTasks 保持一致。
 *  同档内保持接口给的创建时间倒序（Array#sort 稳定排序）。 */
const TASK_SORT_RANK = { downloading: 0, active: 1, pending: 1 };
function taskSortKey(t) {
  return TASK_SORT_RANK[t.status] ?? 2;
}

function createTaskRow(t) {
  const id = t.id;
  const badge = h('span', { class: 'badge badge-gray' });
  const quality = h('span', { class: 'task-quality' });
  const head = h('div', { class: 'task-head' },
    h('span', { class: 'task-title', text: t.title || t.mid || '未知歌曲' }),
    badge,
    quality,
  );
  const fill = h('div', { class: 'progress-fill' });
  const progress = h('div', { class: 'progress' }, fill);
  const sub = h('div', { class: 'task-sub' });
  const error = h('div', { class: 'task-error', hidden: true });
  const cancelBtn = h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', hidden: true,
    onclick: () => onCancelTask(id),
  }, '取消');
  const retryBtn = h('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', hidden: true,
    onclick: () => onRetryTask(id),
  }, '重试');
  const actions = h('div', { class: 'task-actions' }, cancelBtn, retryBtn);
  const row = h('div', { class: 'task', dataset: { taskId: id } }, h('div', { class: 'task-body' }, head, progress, sub, error), actions);
  const entry = { row, badge, quality, progress, fill, sub, error, actions, cancelBtn, retryBtn };
  updateTaskRow(entry, t);
  return entry;
}

/** 原地更新任务行（进度条宽度变化带 CSS 过渡动画） */
function updateTaskRow(entry, t) {
  entry.status = t.status;
  const st = TASK_STATUS[t.status] || { label: String(t.status || '未知'), cls: 'badge-gray' };
  entry.badge.className = `badge ${st.cls}`;
  entry.badge.textContent = st.label;
  entry.quality.textContent = t.qualityLabel || '';
  entry.quality.hidden = !t.qualityLabel;

  // 进度：progress 为 null 时切换为 indeterminate 条纹动画
  if (t.progress == null) {
    entry.progress.classList.add('is-indeterminate');
    entry.fill.style.width = '';
  } else {
    entry.progress.classList.remove('is-indeterminate');
    entry.fill.style.width = `${Math.min(100, Math.max(0, t.progress * 100))}%`;
  }

  // 副信息：已接收/总量、百分比、重试次数（total 为 0/未知时不显示 0 B）
  const parts = [];
  const knownTotal = Number(t.total) > 0;
  if (knownTotal) {
    parts.push(`${formatSize(t.received)} / ${formatSize(t.total)}`);
    if (t.progress != null) parts.push(`${Math.round(t.progress * 100)}%`);
  } else if (Number(t.received) > 0) {
    parts.push(`已下载 ${formatSize(t.received)}`);
  } else {
    parts.push('大小未知');
  }
  if (typeof t.attempts === 'number' && t.attempts > 1) parts.push(`重试 ${t.attempts - 1} 次`);
  entry.sub.textContent = parts.join(' · ');

  // 失败原因
  const showError = t.status === 'failed' && t.error;
  entry.error.textContent = showError ? t.error : '';
  entry.error.hidden = !showError;

  // 操作按钮可用性
  const canCancel = ACTIVE_STATUSES.includes(t.status);
  const canRetry = RETRYABLE_STATUSES.includes(t.status);
  entry.cancelBtn.hidden = !canCancel;
  entry.retryBtn.hidden = !canRetry;
  entry.actions.hidden = !canCancel && !canRetry;
}

async function onCancelTask(id) {
  try {
    await api(API.taskCancel(id), { method: 'POST' });
    toast('任务已取消', 'success');
    loadTasks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function onRetryTask(id) {
  try {
    await api(API.taskRetry(id), { method: 'POST' });
    toast('任务已重新入队', 'success');
    loadTasks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 清空已结束任务（成功/失败/取消），进行中的任务保留 */
async function onClearTasks() {
  const n = [...taskRows.values()].filter((e) => e.status && FINISHED_STATUSES.includes(e.status)).length;
  if (!window.confirm(n > 0 ? `将移除 ${n} 条已结束的任务记录（下载中的任务不受影响），确定继续？` : '将移除所有已结束的任务记录，确定继续？')) return;
  try {
    const res = await api(API.taskClear, { method: 'POST', body: '{}' });
    toast(`已清空 ${res.removed} 条任务记录`, 'success');
    loadTasks();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 侧边栏任务角标（未完成任务数） */
function updateTaskBadge(tasks) {
  const n = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
  const badge = $('#nav-task-badge');
  badge.textContent = n > 0 ? String(n) : '';
  badge.hidden = n === 0;
}

/** 下载成功后轻量刷新角标（不启动轮询） */
async function refreshTaskBadge() {
  try {
    const data = await api(API.tasks);
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    updateTaskBadge(tasks);
    if (state.tab === 'tasks') renderTasks(tasks);
  } catch { /* 忽略 */ }
}

/* ============================================================
   8. 媒体库页
   ============================================================ */

async function loadLibrary() {
  $('#library-loading').hidden = false;
  $('#library-empty').hidden = true;
  try {
    const params = new URLSearchParams({ limit: '100' });
    if (state.library.q) params.set('q', state.library.q);
    const data = await api(`${API.library}?${params.toString()}`);
    const files = Array.isArray(data.files) ? data.files : [];
    renderLibrary(files, data.total != null ? data.total : files.length);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    $('#library-loading').hidden = true;
  }
}

function renderLibrary(files, total) {
  const box = $('#library-list');
  box.replaceChildren();
  state.library.list = files;
  const missing = files.filter((f) => f.exists === false).length;
  state.library.missing = missing;
  $('#library-count').textContent = total > 0 ? `· 共 ${total} 个文件` : '';
  const cleanupBtn = $('#library-cleanup-btn');
  if (cleanupBtn) {
    cleanupBtn.hidden = missing === 0;
    cleanupBtn.textContent = `清理失效记录（${missing}）`;
  }
  if (!files.length) {
    $('#library-empty-text').textContent = state.library.q ? '没有匹配的文件' : '媒体库还是空的';
    $('#library-empty').hidden = false;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const f of files) frag.append(renderLibraryRow(f));
  box.append(frag);
  highlightPlayingRow();
}

function renderLibraryRow(f) {
  const missing = f.exists === false;
  // 封面缩略图（内嵌封面接口，失败降级为 ♪ 占位）
  const cover = h('div', { class: 'lib-cover' });
  const img = h('img', { src: API.fileCover(f.id), alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    cover.replaceChildren(h('span', { 'aria-hidden': 'true' }, '♪'));
  });
  cover.append(img);

  const sub = h('div', { class: 'lib-sub' },
    h('span', { text: f.artist || '未知歌手' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { text: f.album || '未知专辑' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { text: f.quality || '--' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { text: formatSize(f.size) }),
  );
  const badges = h('div', { class: 'lib-badges' });
  if (missing) badges.append(h('span', { class: 'badge badge-red', text: '文件缺失' }));
  const playIcon = h('span', { class: 'lib-play', 'aria-hidden': 'true' }, '▶');
  // 行内悬停操作：定位 / 删除
  const actions = h('div', { class: 'lib-actions' },
    h('button', {
      class: 'lib-action', type: 'button', title: '在资源管理器中定位',
      onclick: (ev) => { ev.stopPropagation(); onLocateFile(f); },
    }, '定位'),
    h('button', {
      class: 'lib-action lib-action-danger', type: 'button', title: '删除',
      onclick: (ev) => { ev.stopPropagation(); onDeleteFile(f); },
    }, '删除'),
  );
  return h('div', {
    class: missing ? 'lib-row is-missing' : 'lib-row',
    dataset: { id: String(f.id) },
    role: missing ? undefined : 'button',
    tabindex: missing ? undefined : '0',
    title: missing ? '文件已被移动或删除' : '点击播放',
    onclick: missing ? undefined : () => playFile(f, state.library.list.filter((x) => x.exists !== false), state.library.list.filter((x) => x.exists !== false).indexOf(f)),
    onkeydown: missing ? undefined : (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        const ok = state.library.list.filter((x) => x.exists !== false);
        playFile(f, ok, ok.indexOf(f));
      }
    },
  },
    cover,
    h('div', { class: 'lib-main' },
      h('div', { class: 'lib-title', text: f.title || '未知歌曲' }),
      sub,
      h('div', { class: 'lib-path', text: f.filePath || '--' }),
    ),
    badges,
    missing ? undefined : playIcon,
    actions,
  );
}

/** 定位文件（资源管理器中选中） */
async function onLocateFile(f) {
  try {
    await api(API.fileLocate(f.id), { method: 'POST', body: '{}' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 打开删除确认弹窗 */
function onDeleteFile(f) {
  state.library.pendingDelete = f;
  $('#delete-message').textContent = `确定删除《${f.title || '未知歌曲'}》？`;
  $('#delete-remove-file').checked = true;
  $('#delete-modal').hidden = false;
  document.body.classList.add('no-scroll');
}

function closeDeleteModal() {
  state.library.pendingDelete = null;
  $('#delete-modal').hidden = true;
  document.body.classList.remove('no-scroll');
}

/** 确认删除 */
async function onConfirmDelete() {
  const f = state.library.pendingDelete;
  if (!f) return;
  const removeFile = $('#delete-remove-file').checked;
  try {
    const res = await api(API.fileDelete(f.id), {
      method: 'POST',
      body: JSON.stringify({ removeFile }),
    });
    // 正在播放被删的文件时停止播放
    if (state.player.file && String(state.player.file.id) === String(f.id)) {
      closePlayer();
    }
    closeDeleteModal();
    toast(`已删除《${res.title || ''}》${res.fileRemoved ? '（含磁盘文件）' : '（仅记录）'}`, 'success');
    loadLibrary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 清理失效的媒体库记录 */
async function onLibraryCleanup() {
  if (!window.confirm('将删除所有“文件缺失”的媒体库记录（不影响磁盘文件），确定继续？')) return;
  try {
    const res = await api('/api/library/cleanup', { method: 'POST' });
    toast(`已清理 ${res.removed} 条失效记录`, 'success');
    loadLibrary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 在资源管理器中打开下载目录 */
async function onOpenDownloadDir() {
  try {
    await api(API.openDownloadDir, { method: 'POST', body: '{}' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ============================================================
   8.7 内置播放器
   ============================================================ */

/** 播放指定文件；list/index 用于上一首/下一首队列 */
function playFile(file, list = [], index = -1) {
  const audio = $('#audio-el');
  state.player.file = file;
  state.player.list = list;
  state.player.index = index;

  audio.src = API.fileAudio(file.id);
  audio.play().catch((e) => toast(`播放失败: ${e.message}`, 'error'));

  // 播放条信息与封面
  $('#player-title').textContent = file.title || '未知歌曲';
  $('#player-sub').textContent = [file.artist, file.album, file.quality].filter(Boolean).join(' · ');
  const cover = $('#player-cover');
  cover.replaceChildren();
  const img = h('img', { src: API.fileCover(file.id), alt: '' });
  img.addEventListener('error', () => {
    cover.replaceChildren(h('span', { 'aria-hidden': 'true' }, '♪'));
  });
  cover.append(img);

  $('#player').hidden = false;
  document.body.classList.add('has-player');
  highlightPlayingRow();
  // 歌词面板/悬浮窗开启状态下，换歌时重新加载歌词
  if (state.lyrics.panelOpen || state.lyrics.pip) loadLyricsFor(file.id);
}

function togglePlay() {
  const audio = $('#audio-el');
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function playNext() {
  const { list, index } = state.player;
  if (index >= 0 && index < list.length - 1) playFile(list[index + 1], list, index + 1);
}

function playPrev() {
  const { list, index } = state.player;
  if (index > 0) playFile(list[index - 1], list, index - 1);
}

function closePlayer() {
  const audio = $('#audio-el');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.player.file = null;
  state.player.list = [];
  state.player.index = -1;
  $('#player').hidden = true;
  document.body.classList.remove('has-player');
  highlightPlayingRow();
  // 清理歌词状态
  closeLyricsPanel();
  closeDesktopLyrics();
}

/** 播放/暂停图标切换 */
function updatePlayerToggleIcon() {
  const audio = $('#audio-el');
  const playing = Boolean(audio.src) && !audio.paused && !audio.ended;
  $('#player-toggle').querySelector('.icon-play').hidden = playing;
  $('#player-toggle').querySelector('.icon-pause').hidden = !playing;
}

/** 播放进度刷新 */
function onPlayerTime() {
  const audio = $('#audio-el');
  const cur = audio.currentTime;
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  $('#player-current').textContent = formatDuration(cur);
  $('#player-duration').textContent = formatDuration(dur);
  const seek = $('#player-seek');
  if (!state.player.seeking && dur > 0) {
    seek.value = String(Math.round((cur / dur) * 1000));
  }
}

/** 拖动进度条（预览时间） */
function onPlayerSeekInput() {
  const audio = $('#audio-el');
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (dur <= 0) return;
  state.player.seeking = true;
  const ratio = Number($('#player-seek').value) / 1000;
  $('#player-current').textContent = formatDuration(dur * ratio);
}

/** 松开进度条（跳转） */
function onPlayerSeekCommit() {
  const audio = $('#audio-el');
  const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
  if (dur > 0) {
    audio.currentTime = dur * (Number($('#player-seek').value) / 1000);
  }
  state.player.seeking = false;
}

/** 媒体库当前播放行高亮 */
function highlightPlayingRow() {
  const currentId = state.player.file ? String(state.player.file.id) : null;
  document.querySelectorAll('.lib-row').forEach((row) => {
    row.classList.toggle('is-playing', row.dataset.id === currentId);
  });
}

/* ============================================================
   8.8 歌词（页面面板 + 桌面悬浮窗 Document PiP）
   ============================================================ */

/** 解析 LRC 文本 -> [{time, text}]（支持一行多时间戳，过滤元数据行） */
function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const times = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const content = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
    if (times.length === 0 || !content) continue;
    for (const t of times) {
      lines.push({ time: parseInt(t[1], 10) * 60 + parseFloat(t[2]), text: content });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** 加载并解析当前歌曲歌词 */
async function loadLyricsFor(fileId) {
  const st = state.lyrics;
  st.fileId = fileId;
  st.lines = [];
  st.loaded = false;
  st.activeIndex = -1;
  if (!fileId) return;
  try {
    const res = await fetch(API.fileLrc(fileId));
    if (res.ok) st.lines = parseLrc(await res.text());
  } catch {
    /* 无歌词 */
  }
  st.loaded = true;
  renderLyricsPanel();
  syncLyrics(true);
}

/** 当前时间对应的歌词行索引 */
function currentLyricIndex(t) {
  const lines = state.lyrics.lines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) idx = i;
    else break;
  }
  return idx;
}

/** 打开/关闭页面内歌词面板 */
function toggleLyricsPanel() {
  if (state.lyrics.panelOpen) closeLyricsPanel();
  else openLyricsPanel();
}

async function openLyricsPanel() {
  const st = state.lyrics;
  if (!state.player.file) {
    toast('先播放一首歌曲再查看歌词', 'error');
    return;
  }
  st.panelOpen = true;
  $('#lyrics-panel').hidden = false;
  document.body.classList.add('no-scroll');
  $('#player-lyrics-btn').classList.add('is-on');
  await loadLyricsFor(state.player.file.id);
  startLyricsSync();
}

function closeLyricsPanel() {
  state.lyrics.panelOpen = false;
  $('#lyrics-panel').hidden = true;
  document.body.classList.remove('no-scroll');
  $('#player-lyrics-btn').classList.remove('is-on');
  stopLyricsSyncIfIdle();
}

/** 渲染歌词面板（封面/标题/歌词列表） */
function renderLyricsPanel() {
  const st = state.lyrics;
  const file = state.player.file;
  if (!file) return;
  $('#lyrics-title').textContent = file.title || '未知歌曲';
  $('#lyrics-sub').textContent = [file.artist, file.album, file.quality].filter(Boolean).join(' · ');
  const cover = $('#lyrics-cover');
  cover.replaceChildren();
  const img = h('img', { src: API.fileCover(file.id), alt: '' });
  img.addEventListener('error', () => cover.replaceChildren(h('span', { 'aria-hidden': 'true' }, '♪')));
  cover.append(img);

  const box = $('#lyrics-scroll');
  box.replaceChildren();
  if (!st.lines.length) {
    box.append(h('p', { class: 'lyrics-none', text: '暂无歌词' }));
    return;
  }
  const frag = document.createDocumentFragment();
  st.lines.forEach((line, i) => {
    frag.append(h('div', {
      class: 'lyric-line',
      dataset: { index: String(i) },
      onclick: () => seekToLyricLine(i),
    }, line.text));
  });
  box.append(frag);
}

/** 点击歌词行跳转 */
function seekToLyricLine(i) {
  const line = state.lyrics.lines[i];
  if (line && Number.isFinite(line.time)) {
    $('#audio-el').currentTime = line.time;
    syncLyrics(true);
  }
}

/** 歌词同步：更新页面面板与桌面悬浮窗（200ms 轮询） */
function syncLyrics(force = false) {
  const st = state.lyrics;
  const audio = $('#audio-el');
  if (!st.loaded) return;
  const t = audio.currentTime;
  const idx = currentLyricIndex(t);
  if (force || idx !== st.activeIndex) {
    st.activeIndex = idx;
    // 页面面板高亮 + 居中滚动
    const box = $('#lyrics-scroll');
    const lines = box.querySelectorAll('.lyric-line');
    lines.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    const active = lines[idx];
    if (active && box.clientHeight > 0) {
      const target = active.offsetTop - box.clientHeight / 2 + active.clientHeight / 2;
      box.scrollTo({ top: Math.max(0, target), behavior: force ? 'auto' : 'smooth' });
    }
  }
  // 桌面悬浮窗
  if (st.pip && st.pip.document) {
    const set = (id, text) => {
      const el = st.pip.document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const cur = idx >= 0 ? st.lines[idx].text : (state.player.file?.title || '');
    const prev = idx > 0 ? st.lines[idx - 1].text : '';
    const next = idx >= 0 && idx < st.lines.length - 1 ? st.lines[idx + 1].text : '';
    set('pip-cv', cur);
    set('pip-pv', prev);
    set('pip-nv', next);
    const pf = st.pip.document.getElementById('pip-pf');
    if (pf && Number.isFinite(audio.duration) && audio.duration > 0) {
      pf.style.width = `${(t / audio.duration) * 100}%`;
    }
  }
}

function startLyricsSync() {
  if (state.lyrics.timer) return;
  state.lyrics.timer = setInterval(syncLyrics, 200);
}

function stopLyricsSync() {
  if (state.lyrics.timer) {
    clearInterval(state.lyrics.timer);
    state.lyrics.timer = null;
  }
}

/* —— 桌面歌词（Document Picture-in-Picture 置顶悬浮窗） —— */

const PIP_STYLE = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif;
  background: rgba(24, 28, 24, 0.92);
  color: #fff;
  overflow: hidden;
  user-select: none;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
#pip { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 10px 16px 6px; cursor: pointer; }
.pip-line { text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .2s; }
#pip-pv { font-size: calc(var(--fs) * 0.55); opacity: .45; margin-bottom: 4px; min-height: 1em; }
#pip-cv { font-size: var(--fs); font-weight: 600; color: #d9f0d4; min-height: 1.2em; }
#pip-nv { font-size: calc(var(--fs) * 0.55); opacity: .45; margin-top: 4px; min-height: 1em; }
#pip-bar { height: 2px; background: rgba(255,255,255,.15); margin: 0 16px 6px; border-radius: 2px; overflow: hidden; }
#pip-pf { height: 100%; width: 0; background: #8bb08f; border-radius: 2px; }
#pip-ctrl { position: absolute; top: 4px; right: 6px; display: flex; gap: 2px; opacity: 0; transition: opacity .2s; }
body:hover #pip-ctrl { opacity: .8; }
#pip-ctrl button {
  border: 0; background: rgba(255,255,255,.12); color: #fff; border-radius: 5px;
  font-size: 11px; padding: 2px 7px; cursor: pointer;
}
#pip-ctrl button:hover { background: rgba(255,255,255,.25); }
`;

async function toggleDesktopLyrics() {
  if (state.lyrics.pip) {
    closeDesktopLyrics();
    return;
  }
  if (!('documentPictureInPicture' in window)) {
    toast('当前浏览器不支持桌面歌词（需 Chrome/Edge 116+），已打开页面歌词', 'error');
    openLyricsPanel();
    return;
  }
  if (!state.player.file) {
    toast('先播放一首歌曲再开启桌面歌词', 'error');
    return;
  }
  try {
    const pipWin = await documentPictureInPicture.requestWindow({ width: 560, height: 150 });
    state.lyrics.pip = pipWin;

    const doc = pipWin.document;
    doc.title = '桌面歌词';
    const style = doc.createElement('style');
    style.textContent = PIP_STYLE;
    doc.head.append(style);

    // 当前行：保留元素引用（不可在 append 之前用 getElementById 获取）
    const curLine = h('div', { class: 'pip-line', id: 'pip-cv', text: state.player.file.title || '' });
    curLine.addEventListener('click', () => {
      const idx = state.lyrics.activeIndex;
      if (idx >= 0 && state.lyrics.lines[idx]) $('#audio-el').currentTime = state.lyrics.lines[idx].time;
    });

    const wrap = doc.createElement('div');
    wrap.id = 'pip';
    wrap.style.setProperty('--fs', `${state.lyrics.pipFont}px`);
    wrap.append(
      h('div', { class: 'pip-line', id: 'pip-pv' }),
      curLine,
      h('div', { class: 'pip-line', id: 'pip-nv' }),
    );

    const bar = doc.createElement('div');
    bar.id = 'pip-bar';
    bar.append(h('div', { id: 'pip-pf' }));

    const ctrl = doc.createElement('div');
    ctrl.id = 'pip-ctrl';
    const mkBtn = (label, title, fn) => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
      return b;
    };
    ctrl.append(
      mkBtn('A−', '减小字号', () => setPipFont(state.lyrics.pipFont - 2)),
      mkBtn('A+', '增大字号', () => setPipFont(state.lyrics.pipFont + 2)),
      mkBtn('✕', '关闭桌面歌词', () => closeDesktopLyrics()),
    );

    doc.body.append(wrap, bar, ctrl);
    pipWin.addEventListener('pagehide', () => {
      state.lyrics.pip = null;
      $('#player-desktop-lyrics-btn').classList.remove('is-on');
      stopLyricsSyncIfIdle();
    });

    $('#player-desktop-lyrics-btn').classList.add('is-on');
    await loadLyricsFor(state.player.file.id);
    startLyricsSync();
    syncLyrics(true);
  } catch (e) {
    toast(`桌面歌词开启失败: ${e.message}`, 'error');
  }
}

function setPipFont(size) {
  state.lyrics.pipFont = Math.min(48, Math.max(14, size));
  const wrap = state.lyrics.pip?.document.getElementById('pip');
  if (wrap) wrap.style.setProperty('--fs', `${state.lyrics.pipFont}px`);
}

function closeDesktopLyrics() {
  if (state.lyrics.pip) state.lyrics.pip.close();
  state.lyrics.pip = null;
  $('#player-desktop-lyrics-btn').classList.remove('is-on');
  stopLyricsSyncIfIdle();
}

/** 面板与悬浮窗都关闭时停止同步轮询 */
function stopLyricsSyncIfIdle() {
  if (!state.lyrics.panelOpen && !state.lyrics.pip) stopLyricsSync();
}

/* ============================================================
   8.5 歌单页（解析 / 勾选 / 批量下载）
   ============================================================ */

/** 进入歌单页：填充音质下拉 */
function initPlaylistPage() {
  const select = $('#playlist-quality');
  if (select.options.length === 0) {
    fillQualityOptions(select, currentQualities(), state.config?.defaultQuality);
  }
}

/** 解析歌单：GET /api/playlist/resolve?input= */
async function runResolvePlaylist() {
  const input = $('#playlist-input').value.trim();
  if (!input) {
    toast('请输入歌单链接或 ID', 'error');
    $('#playlist-input').focus();
    return;
  }
  state.playlist.input = input;
  $('#playlist-loading').hidden = false;
  $('#playlist-empty').hidden = true;
  $('#playlist-card').hidden = true;
  $('#playlist-resolve-btn').disabled = true;
  try {
    const data = await api(`${API.playlistResolve}?${new URLSearchParams({ input })}`);
    state.playlist.info = {
      id: data.id,
      title: data.title,
      creator: data.creator,
      trackCount: data.trackCount,
      cover: data.cover,
    };
    state.playlist.songs = Array.isArray(data.songs) ? data.songs : [];
    // 默认全选
    state.playlist.selected = new Set(state.playlist.songs.map((s) => s.mid));
    renderPlaylist();
  } catch (err) {
    $('#playlist-empty').hidden = false;
    $('#playlist-empty-text').textContent = err.message;
    toast(err.message, 'error');
  } finally {
    $('#playlist-loading').hidden = true;
    $('#playlist-resolve-btn').disabled = false;
  }
}

function renderPlaylist() {
  const info = state.playlist.info;
  const songs = state.playlist.songs;
  // 头部：封面 + 标题 + 元信息
  const cover = $('#playlist-cover');
  cover.replaceChildren();
  if (safeHttpUrl(info.cover)) {
    cover.append(h('img', { src: info.cover, alt: '', loading: 'lazy' }));
  } else {
    cover.append(h('span', { 'aria-hidden': 'true' }, '♪'));
  }
  $('#playlist-title').textContent = info.title || '未命名歌单';
  const metaParts = [];
  if (info.creator) metaParts.push(`创建者：${info.creator}`);
  metaParts.push(`共 ${info.trackCount} 首`);
  if (info.trackCount > songs.length) metaParts.push(`可解析 ${songs.length} 首`);
  $('#playlist-meta').textContent = metaParts.join(' · ');

  // 歌曲列表（带勾选框）
  const box = $('#playlist-songs');
  box.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const song of songs) frag.append(renderPlaylistSongRow(song));
  box.append(frag);

  updatePlaylistSelectionUI();
  $('#playlist-card').hidden = false;
}

function renderPlaylistSongRow(song) {
  const checked = state.playlist.selected.has(song.mid);
  const cover = h('div', { class: 'song-cover' });
  if (safeHttpUrl(song.cover)) {
    cover.append(h('img', { src: song.cover, alt: '', loading: 'lazy' }));
  } else {
    cover.append(h('span', { 'aria-hidden': 'true' }, '♪'));
  }
  const checkbox = h('input', {
    type: 'checkbox',
    class: 'song-check',
    checked,
    'aria-label': `选择 ${song.title || ''}`,
    onchange: (ev) => {
      if (ev.target.checked) state.playlist.selected.add(song.mid);
      else state.playlist.selected.delete(song.mid);
      updatePlaylistSelectionUI();
    },
  });
  const sub = h('div', { class: 'song-sub' },
    h('span', { text: song.artist || '未知歌手' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { text: song.album || '未知专辑' }),
    h('span', { class: 'dot', text: '·' }),
    h('span', { class: 'song-duration', text: formatDuration(song.duration) }),
  );
  return h('div', { class: checked ? 'song is-checked' : 'song' },
    checkbox,
    cover,
    h('div', { class: 'song-body' }, h('div', { class: 'song-title', text: song.title || '未知歌曲' }), sub),
  );
}

/** 刷新工具栏选中计数与全选框状态 */
function updatePlaylistSelectionUI() {
  const total = state.playlist.songs.length;
  const n = state.playlist.selected.size;
  $('#playlist-count').textContent = `已选 ${n} / ${total} 首`;
  $('#playlist-select-all').checked = total > 0 && n === total;
  $('#playlist-download-btn').disabled = n === 0;
  $('#playlist-download-btn').textContent = n > 0 ? `下载所选（${n}）` : '下载所选';
}

/** 全选 / 取消全选 */
function onPlaylistSelectAll(ev) {
  const checked = ev.target.checked;
  state.playlist.selected = checked
    ? new Set(state.playlist.songs.map((s) => s.mid))
    : new Set();
  // 逐行更新勾选框与高亮
  const rows = $('#playlist-songs').children;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cb = row.querySelector('.song-check');
    if (cb) cb.checked = checked;
    row.classList.toggle('is-checked', checked);
  }
  updatePlaylistSelectionUI();
}

/** 批量下载所选：POST /api/playlist/download */
async function onPlaylistDownload() {
  const mids = [...state.playlist.selected];
  if (mids.length === 0) {
    toast('请先勾选要下载的歌曲', 'error');
    return;
  }
  const quality = $('#playlist-quality').value || undefined;
  const btn = $('#playlist-download-btn');
  btn.disabled = true;
  try {
    const res = await api(API.playlistDownload, {
      method: 'POST',
      body: JSON.stringify({ input: state.playlist.input, mids, quality }),
    });
    const parts = [`已加入 ${res.tasks.length} 个下载任务`];
    if (res.deduped?.length) parts.push(`${res.deduped.length} 个已存在，自动跳过`);
    if (res.skipped?.length) parts.push(`${res.skipped.length} 个已有更高音质，不降级`);
    if (res.errors?.length) parts.push(`${res.errors.length} 个失败`);
    toast(parts.join('，'), res.errors?.length ? 'info' : 'success');
    refreshTaskBadge();
  } catch (err) {
    if (err.code === 'NOT_LOGGED_IN') openLoginGuide(err);
    else toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    updatePlaylistSelectionUI();
  }
}

/* ============================================================
   9. 设置页
   ============================================================ */

/** 拉取配置并填充表单与音质下拉 */
async function loadConfig() {
  try {
    const cfg = await api(API.config);
    state.config = cfg;
    fillSettingsForm(cfg);
  } catch (err) {
    toast(`配置加载失败：${err.message}`, 'error');
  }
}

function fillSettingsForm(cfg) {
  $('#cfg-naming').value = cfg.namingTemplate != null ? cfg.namingTemplate : '';
  $('#cfg-dir').value = cfg.downloadDir != null ? cfg.downloadDir : '';
  $('#cfg-concurrency').value = cfg.concurrency != null ? cfg.concurrency : 2;
  $('#cfg-fallback').checked = cfg.fallback !== false;
  $('#cfg-retries').value = cfg.maxRetries != null ? cfg.maxRetries : 3;
  fillQualityOptions($('#cfg-quality'), cfg.qualities, cfg.defaultQuality);
}

function fillQualityOptions(select, qualities, selected) {
  select.replaceChildren();
  for (const q of (Array.isArray(qualities) ? qualities : [])) {
    select.append(h('option', { value: q.code, text: qualityLabel(q), selected: q.code === selected }));
  }
  if (select.value === '' && select.options.length > 0) select.selectedIndex = 0;
}

/** 保存设置：PUT /api/config（全量提交） */
async function onSaveSettings(ev) {
  ev.preventDefault();
  const errorBox = $('#settings-error');
  errorBox.hidden = true;
  const body = {
    namingTemplate: $('#cfg-naming').value.trim(),
    downloadDir: $('#cfg-dir').value.trim(),
    concurrency: Number($('#cfg-concurrency').value),
    defaultQuality: $('#cfg-quality').value,
    fallback: $('#cfg-fallback').checked,
    maxRetries: Number($('#cfg-retries').value),
  };
  try {
    const cfg = await api(API.config, { method: 'PUT', body: JSON.stringify(body) });
    state.config = cfg;
    fillSettingsForm(cfg);
    toast('设置已保存', 'success');
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.hidden = false;
  }
}

/* ============================================================
   10. 事件绑定与启动
   ============================================================ */

function bindEvents() {
  // 导航切换
  $('#nav').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.nav-item');
    if (btn) switchTab(btn.dataset.tab);
  });

  // 搜索：按钮 + 回车
  $('#search-btn').addEventListener('click', () => runSearch(1));
  $('#search-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') runSearch(1);
  });

  // 分页
  $('#page-prev').addEventListener('click', () => runSearch(state.search.page - 1));
  $('#page-next').addEventListener('click', () => runSearch(state.search.page + 1));

  // 任务页手动刷新
  $('#tasks-refresh').addEventListener('click', () => loadTasks());
  $('#tasks-clear').addEventListener('click', onClearTasks);

  // 媒体库过滤（防抖后按 q 参数重新请求）
  $('#library-filter').addEventListener('input', debounce((ev) => {
    state.library.q = ev.target.value.trim();
    loadLibrary();
  }, 300));

  // 媒体库：清理失效记录
  $('#library-cleanup-btn').addEventListener('click', onLibraryCleanup);

  // 任务页：打开下载目录
  $('#open-download-dir-btn').addEventListener('click', onOpenDownloadDir);

  // 删除弹窗
  $('#delete-confirm').addEventListener('click', onConfirmDelete);
  $('#delete-cancel').addEventListener('click', closeDeleteModal);
  $('#delete-close').addEventListener('click', closeDeleteModal);
  $('#delete-mask').addEventListener('click', closeDeleteModal);

  // 歌单：解析 / 全选 / 批量下载
  $('#playlist-resolve-btn').addEventListener('click', runResolvePlaylist);
  $('#playlist-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') runResolvePlaylist();
  });
  $('#playlist-select-all').addEventListener('change', onPlaylistSelectAll);
  $('#playlist-download-btn').addEventListener('click', onPlaylistDownload);

  // 设置保存
  $('#settings-form').addEventListener('submit', onSaveSettings);

  // 扫码模态框：关闭按钮 / 点击遮罩
  $('#qr-close').addEventListener('click', () => closeQrModal());
  $('#qr-mask').addEventListener('click', () => closeQrModal());

  // 播放器
  $('#player-toggle').addEventListener('click', togglePlay);
  $('#player-prev').addEventListener('click', playPrev);
  $('#player-next').addEventListener('click', playNext);
  $('#player-close').addEventListener('click', closePlayer);
  $('#player-seek').addEventListener('input', onPlayerSeekInput);
  $('#player-seek').addEventListener('change', onPlayerSeekCommit);

  // 歌词
  $('#player-lyrics-btn').addEventListener('click', toggleLyricsPanel);
  $('#player-desktop-lyrics-btn').addEventListener('click', toggleDesktopLyrics);
  $('#lyrics-close').addEventListener('click', closeLyricsPanel);
  $('#lyrics-mask').addEventListener('click', closeLyricsPanel);
  const audio = $('#audio-el');
  audio.addEventListener('timeupdate', onPlayerTime);
  audio.addEventListener('loadedmetadata', onPlayerTime);
  audio.addEventListener('play', updatePlayerToggleIcon);
  audio.addEventListener('pause', updatePlayerToggleIcon);
  audio.addEventListener('ended', () => { updatePlayerToggleIcon(); playNext(); });
  // 加载/解码失败（如浏览器不支持的格式）：提示而不静默，也不自动跳下一首
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    updatePlayerToggleIcon();
    toast('播放失败：浏览器可能不支持该音频格式（如杜比 mp4）', 'error');
  });

  // 登录引导模态框
  $('#guide-close').addEventListener('click', closeLoginGuide);
  $('#guide-cancel').addEventListener('click', closeLoginGuide);
  $('#guide-mask').addEventListener('click', closeLoginGuide);
  $('#guide-goto').addEventListener('click', () => {
    closeLoginGuide();
    openQrModal();
  });

  // Esc 关闭模态框
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#qr-modal').hidden) closeQrModal();
    else if (!$('#login-guide-modal').hidden) closeLoginGuide();
    else if (!$('#lyrics-panel').hidden) closeLyricsPanel();
    else if (!$('#delete-modal').hidden) closeDeleteModal();
  });
}

async function init() {
  bindEvents();
  // 并行加载登录状态与配置（音质下拉依赖配置）
  await Promise.all([refreshAuth(), loadConfig()]);
  switchTab('search');
}

init();
