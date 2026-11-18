/* ============ 投行信息速览 · 核心逻辑 ============ */
const EXTERNAL = {
  bse:  { name: '北交所',    url: 'https://www.bse.cn/audit/project_news.html' },
  szse: { name: '深交所',    url: 'https://www.szse.cn/listing/projectdynamic/ipo/index.html' },
  sse:  { name: '上交所',    url: 'http://www.sse.com.cn/listing/renewal/ipo/' },
  sac:  { name: '证券业协会', url: 'https://www.sac.net.cn' },
  wudao:{ name: '吾道',      base: 'https://www.iwudao.tech/app/response/event?company=' }
};
function wudaoUrl(companyName) { return EXTERNAL.wudao.base + encodeURIComponent(companyName); }

/* ============ 工具 ============ */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dash = v => (v == null || v === '') ? '—' : esc(v);
function badge(text, cls) { return `<span class="badge ${cls}"><span class="dot"></span>${esc(text)}</span>`; }

function statusClass(status) {
  const s = String(status || '');
  if (/(终止|撤回|未通过)/.test(s)) return 'b-bad';
  if (/(注册|通过|上市)/.test(s)) return 'b-good';
  if (/(问询|会议|审议)/.test(s)) return 'b-warn';
  if (/(受理|提交注册)/.test(s)) return 'b-info';
  if (/(中止|暂缓)/.test(s)) return 'b-muted';
  return 'b-muted';
}

function boardFromCode(code) {
  const c = String(code || '').toUpperCase().replace(/\s/g, '');
  if (!c) return '';
  if (c.startsWith('688')) return '科创板';
  if (c.startsWith('300') || c.startsWith('301')) return '创业板';
  if (c.startsWith('60')) return '上证主板';
  if (c.startsWith('00')) return '深证主板';
  if (c.startsWith('8') || c.startsWith('4') || c.includes('BJ')) return '北交所';
  return '';
}

/* ============ 状态 ============ */
let query = '';
let exTab = '全部';
let typeFilter = '全部';

const AUDIT = (window.AUDIT_DATA && window.AUDIT_DATA.rows) ? window.AUDIT_DATA.rows : [];
const AUDIT_UPDATED = (window.AUDIT_DATA && window.AUDIT_DATA.updatedAt) || '';

const EXCHANGES = ['上交所', '深交所', '北交所'];
const TYPES = ['IPO', '再融资', '并购重组'];

/* ============ 审核状态总览 ============ */
function renderSubTabs() {
  const exChips = ['全部', ...EXCHANGES].map(e =>
    `<button class="sub-tab ${e === exTab ? 'active' : ''}" onclick="setExTab('${e}')">${e}</button>`
  ).join('');
  const typeChips = ['全部', ...TYPES].map(t =>
    `<button class="sub-tab type-chip ${t === typeFilter ? 'active' : ''}" onclick="setTypeFilter('${t}')">${t}</button>`
  ).join('');
  $('#sub-tabs').innerHTML =
    `<span style="font-size:12px;color:var(--ink-3);margin-right:2px">交易所</span>` + exChips +
    `<span style="width:1px;height:20px;background:var(--line);margin:0 8px;display:inline-block"></span>` +
    `<span style="font-size:12px;color:var(--ink-3);margin-right:2px">业务类型</span>` + typeChips;
}
function setExTab(k) { exTab = k; renderSubTabs(); renderAudit(); }
function setTypeFilter(t) { typeFilter = t; renderSubTabs(); renderAudit(); }

function auditCols() {
  return [
    { k: 'company', label: '发行人' },
    { k: 'code', label: '代码', mono: true },
    { k: 'board', label: '板块' },
    { k: 'status', label: '审核状态', badge: true },
    { k: 'region', label: '注册地' },
    { k: 'industry', label: '行业' },
    { k: 'sponsor', label: '保荐机构' },
    { k: 'law', label: '律师事务所' },
    { k: 'acc', label: '会计师事务所' },
    { k: 'update', label: '更新日期', mono: true },
    { k: 'accept', label: '受理日期', mono: true },
  ];
}

function renderAudit() {
  const q = query.toLowerCase();
  const items = AUDIT
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) =>
      (exTab === '全部' || r.exchange === exTab) &&
      (typeFilter === '全部' || r.type === typeFilter) &&
      (!query || JSON.stringify(r).toLowerCase().includes(q))
    );

  const head = `<thead><tr>${auditCols().map(c => `<th${c.mono ? ' class="num"' : ''}>${c.label}</th>`).join('')}</tr></thead>`;
  const body = items.length
    ? `<tbody>${items.map(({ r, idx }) => {
        const board = r.board || boardFromCode(r.code);
        const cells = auditCols().map(c => {
          if (c.k === 'company') return `<td class="co-name">${dash(r.company)}${r.type ? ` <span class="type-tag">${esc(r.type)}</span>` : ''}</td>`;
          if (c.k === 'status') return `<td>${badge(r.status, statusClass(r.status))}</td>`;
          if (c.k === 'board') return `<td class="sub-text">${dash(board)}</td>`;
          if (c.mono) return `<td class="sub-text mono">${dash(r[c.k])}</td>`;
          return `<td class="sub-text">${dash(r[c.k])}</td>`;
        }).join('');
        return `<tr onclick="openAuditDetail(${idx})">${cells}</tr>`;
      }).join('')}</tbody>`
    : `<tbody><tr><td colspan="${auditCols().length}"><div class="empty">没有匹配的项目</div></td></tr></tbody>`;

  $('#audit-table').innerHTML = head + body;
  $('#src-bar').innerHTML = `数据源：见微项目库 · 共 ${AUDIT.length} 条${AUDIT_UPDATED ? ' · 更新于 ' + esc(AUDIT_UPDATED) : ''}`;
  $('#cnt-audit').textContent = AUDIT.length;
}

/* ============ 项目辅导 ============ */
function renderTutoring() {
  const TUTORING = (window.TUTORING_DATA && window.TUTORING_DATA.rows) ? window.TUTORING_DATA.rows : [];
  const rows = TUTORING.filter(t => !query || (t.company + (t.firm || '')).includes(query));
  $('#list-tutoring').innerHTML = rows.length ? rows.map((t, i) => {
    const cls = t.stage === '辅导验收' ? 'b-info' : 'b-warn';
    return `<tr onclick="openTutoringDetail(${i})">
      <td class="co-name">${dash(t.company)}</td>
      <td>${dash(t.firm)}</td>
      <td>${badge(t.stage, cls)}</td>
      <td class="sub-text mono">${dash(t.date)}</td>
      <td>${t.source ? linkChip('数据源', t.source) : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="empty">暂无数据（数据源待接入）</div></td></tr>`;
  $('#cnt-tutoring').textContent = TUTORING.length;
}
function openTutoringDetail(i) {
  const rows = (window.TUTORING_DATA && window.TUTORING_DATA.rows) ? window.TUTORING_DATA.rows : [];
  const t = rows[i];
  if (!t) return;
  const cls = t.stage === '辅导验收' ? 'b-info' : 'b-warn';
  $('#drawer-head').innerHTML = `
    <div><div class="title">${esc(t.company)}</div><div class="sub">项目辅导</div><div class="tags">${badge(t.stage, cls)}</div></div>
    <button class="close" onclick="closeDrawer()">✕</button>`;
  $('#drawer-body').innerHTML = `
    <div class="section"><h3>辅导信息</h3>
      <div class="kv"><span class="k">保荐券商</span><span class="v">${dash(t.firm)}</span></div>
      <div class="kv"><span class="k">备案日期</span><span class="v">${dash(t.date)}</span></div>
    </div>
    <div class="section"><h3>数据源</h3><div class="links">${t.source ? linkChip('数据源', t.source, true) : '<span class="sub-text">待接入</span>'}</div></div>`;
  openDrawer();
}

/* ============ 保代变更 ============ */
const CHANGE_CLS = { '新增': 'b-good', '转所': 'b-info', '离职': 'b-bad' };
function renderSponsors() {
  const SPONSORS = (window.SPONSOR_DATA && window.SPONSOR_DATA.rows) ? window.SPONSOR_DATA.rows : [];
  const rows = SPONSORS.filter(s => !query || (s.name + (s.firm || '')).includes(query));
  $('#list-sponsor').innerHTML = rows.length ? rows.map((s, i) => {
    const cls = CHANGE_CLS[s.change] || 'b-muted';
    return `<tr onclick="openSponsorDetail(${i})">
      <td class="co-name">${dash(s.name)}</td>
      <td>${dash(s.firm)}</td>
      <td>${badge(s.change, cls)}</td>
      <td class="sub-text mono">${dash(s.date)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="4"><div class="empty">暂无数据（数据源待接入）</div></td></tr>`;
  $('#cnt-sponsor').textContent = SPONSORS.length;
}
function openSponsorDetail(i) {
  const rows = (window.SPONSOR_DATA && window.SPONSOR_DATA.rows) ? window.SPONSOR_DATA.rows : [];
  const s = rows[i];
  if (!s) return;
  const cls = CHANGE_CLS[s.change] || 'b-muted';
  const related = (s.cids || []).map(n => `<div class="kv"><span class="k">项目</span><span class="v">${esc(n)}</span></div>`).join('');
  $('#drawer-head').innerHTML = `
    <div><div class="title">${esc(s.name)}</div><div class="sub">保荐代表人 · ${esc(s.firm)}</div><div class="tags">${badge(s.change, cls)} <span class="badge b-muted">${dash(s.date)}</span></div></div>
    <button class="close" onclick="closeDrawer()">✕</button>`;
  $('#drawer-body').innerHTML = `
    <div class="section"><h3>关联项目</h3>${related || '<div class="empty">暂无关联项目</div>'}</div>
    <div class="section"><h3>数据源</h3><div class="links">${linkChip('证券业协会', EXTERNAL.sac.url)}</div></div>`;
  openDrawer();
}

/* ============ 抽屉 ============ */
function openDrawer() { $('#overlay').classList.add('show'); $('#drawer').classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { $('#overlay').classList.remove('show'); $('#drawer').classList.remove('show'); document.body.style.overflow = ''; }
function linkChip(label, url, primary) {
  return `<span class="link-chip ${primary ? 'primary' : ''}" onclick="window.open('${url}','_blank')">${label} <span class="arr">↗</span></span>`;
}

function openAuditDetail(idx) {
  const r = AUDIT[idx];
  if (!r) return;
  const board = r.board || boardFromCode(r.code);
  const kvs = [
    ['交易所', r.exchange], ['业务类型', r.type], ['证券代码', r.code], ['板块', board],
    ['注册地', r.region], ['行业', r.industry], ['保荐机构', r.sponsor],
    ['律师事务所', r.law], ['会计师事务所', r.acc], ['受理日期', r.accept], ['更新日期', r.update],
  ].map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${dash(v)}</span></div>`).join('');

  $('#drawer-head').innerHTML = `
    <div>
      <div class="title">${esc(r.company)}</div>
      <div class="sub">${esc(r.exchange)} · ${esc(board || '—')}</div>
      <div class="tags">${badge(r.status, statusClass(r.status))}</div>
    </div>
    <button class="close" onclick="closeDrawer()">✕</button>`;

  $('#drawer-body').innerHTML = `
    <div class="section"><h3>审核信息</h3>${kvs}</div>
    <div class="section">
      <h3>时间轴</h3>
      <div class="timeline">
        <div class="tl-item done"><div class="tl-date">${dash(r.accept)}</div><div class="tl-title">申报受理</div></div>
        <div class="tl-item current"><div class="tl-date">${dash(r.update)}</div><div class="tl-title">${esc(r.status)}</div></div>
      </div>
    </div>
    <div class="section">
      <h3>数据源</h3>
      <div class="links">
        ${linkChip('吾道 · 资本市场全时间轴', wudaoUrl(r.company), true)}
        ${linkChip('见微数据', 'https://www.jianweidata.com')}
      </div>
    </div>`;

  openDrawer();
}

/* ============ 页签切换 ============ */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
  $('#panel-' + tab).classList.add('active');
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ============ 搜索 ============ */
$('#search').addEventListener('input', e => { query = e.target.value.trim(); renderAudit(); renderTutoring(); renderSponsors(); });

/* ============ 抽屉事件 ============ */
$('#overlay').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

/* ============ 初始化 ============ */
renderSubTabs();
renderAudit();
renderTutoring();
renderSponsors();
