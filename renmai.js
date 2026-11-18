/* ============ 人脉检索（SheetJS 前端解析 + 机构归一化 + 拆分重名） ============ */
/* 依赖 app.js 的 esc / $ / boardFromCode / linkChip（app.js 先于本文件加载） */

const ORG_ALIAS = {
  '海通证券股份有限公司': '国泰海通证券股份有限公司',
  '海通证券': '国泰海通证券',
};
function normOrg(s) {
  if (!s) return '';
  return String(s).trim().split(/[,，]/).map(x => ORG_ALIAS[x.trim()] || x.trim()).filter(Boolean).join(',');
}
function splitPeople(s) {
  if (!s) return [];
  s = String(s).trim();
  if (!s || ['—', '-', '无', '/', '暂无'].includes(s)) return [];
  return s.split(/[、,，;；/\s]+/).map(x => x.trim()).filter(x => x && !/^\d+(\.\d+)?$/.test(x));
}
function roleOrgType(role) {
  if (role === '保荐代表人' || role === '项目组成员') return '保荐机构';
  if (role === '财务顾问主办人') return '财务顾问';
  if (role === '签字会计师') return '会计师事务所';
  if (role === '签字律师') return '律师事务所';
  if (role === '签字评估师') return '资产评估机构';
  return '企业';
}

function parseXlsx(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) return { projects: {} };

  let header = rows[0].map(x => String(x).trim());
  let start = 1;
  if (rows.length > 1 && rows[0].some(x => String(x).includes('中介机构'))) {
    header = rows[1].map(x => String(x).trim());
    start = 2;
  }
  const col = {};
  header.forEach((n, i) => { if (n) col[n] = i; });

  const isMerger = ('独立财务顾问主办人' in col) || ('申请人' in col) || ('上市公司简称' in col && !('保荐代表人' in col));
  const isListed = '首发保荐机构' in col;

  let companyField, boardField, sponsorField, roleFields, type;
  if (isMerger) {
    type = '并购重组';
    companyField = ('申请人' in col) ? '申请人' : '上市公司简称';
    boardField = null;
    sponsorField = '独立财务顾问';
    roleFields = [
      ['财务顾问主办人', '独立财务顾问主办人', '独立财务顾问'],
      ['财务顾问主办人', '财务顾问主办人', '财务顾问'],
      ['签字律师', '签字律师', '律师事务所'],
      ['签字会计师', '签字会计师', '会计师事务所'],
      ['签字评估师', '签字评估师', '资产评估机构'],
    ];
  } else if (isListed) {
    type = 'IPO';
    companyField = '证券简称';
    boardField = '证券代码';
    sponsorField = '首发保荐机构';
    roleFields = [
      ['保荐代表人', '首发保荐人代表', '首发保荐机构'],
      ['项目组成员', '首发保荐机构项目组成员', '首发保荐机构'],
      ['签字会计师', '首发签字会计师', '首发审计机构'],
      ['签字律师', '首发经办律师', '首发经办律所'],
    ];
  } else {
    type = ('融资类型' in col) ? '再融资' : 'IPO';
    companyField = '企业名称';
    boardField = ('融资类型' in col) ? '上市板' : '拟上市板';
    sponsorField = '保荐机构';
    roleFields = [
      ['保荐代表人', '保荐代表人', '保荐机构'],
      ['项目组成员', '保荐项目组成员', '保荐机构'],
      ['签字会计师', '签字会计师', '会计师事务所'],
      ['签字律师', '签字律师', '律师事务所'],
      ['董事会秘书', '董事会秘书', '企业'],
    ];
  }

  function getOrg(orgField, r, companyName) {
    if (orgField === '企业') return companyName;
    if (!(orgField in col)) return '未知';
    const v = r[col[orgField]];
    if (!v) return '未知';
    return String(v).trim().split(/[,，]/).map(x => ORG_ALIAS[x.trim()] || x.trim()).filter(Boolean).join(',') || '未知';
  }

  const projects = {};
  let seq = 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const companyName = String(r[col[companyField]] || '').trim();
    if (!companyName) continue;
    const sponsor = sponsorField ? getOrg(sponsorField, r, companyName) : '';
    const acc = ('会计师事务所' in col) ? String(r[col['会计师事务所']] || '').trim() : '';
    const law = ('律师事务所' in col) ? String(r[col['律师事务所']] || '').trim() : '';
    const appraisal = ('资产评估机构' in col) ? String(r[col['资产评估机构']] || '').trim() : '';
    const projPeople = {};
    for (const [role, field, orgField] of roleFields) {
      if (!(field in col)) continue;
      const org = getOrg(orgField, r, companyName);
      for (const p of splitPeople(r[col[field]])) {
        if (!(p in projPeople)) projPeople[p] = { role, org };
      }
    }
    if (Object.keys(projPeople).length) {
      const projKey = companyName + '｜' + type + '｜' + (++seq);
      const board = boardField ? (boardField === '证券代码' ? boardFromCode(r[col[boardField]]) : String(r[col[boardField]] || '').trim()) : '';
      projects[projKey] = { type, company: companyName, board, sponsor, acc, law, appraisal, people: projPeople };
    }
  }
  return { projects };
}

function mergeData(list) {
  const projects = {};
  for (const d of list) {
    for (const [k, p] of Object.entries(d.projects)) {
      let key = k, n = 1;
      while (key in projects) key = k + '#' + (++n);
      projects[key] = p;
    }
  }
  const people = {};
  for (const [key, p] of Object.entries(projects)) {
    for (const [person, info] of Object.entries(p.people)) {
      const pkey = person + '｜' + info.org;
      if (!(pkey in people)) people[pkey] = { name: person, org: info.org, orgType: roleOrgType(info.role), roles: {}, projects: [] };
      people[pkey].roles[info.role] = (people[pkey].roles[info.role] || 0) + 1;
      people[pkey].projects.push(key);
    }
  }
  return { projects, people };
}

let RM = null;
let rmFileCount = 0;
function rmLoadFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  const parsed = [];
  let done = 0;
  files.forEach(f => {
    const rd = new FileReader();
    rd.onload = e => { parsed.push(parseXlsx(e.target.result)); if (++done === files.length) { RM = mergeData(RM ? [RM, ...parsed] : parsed); rmFileCount += files.length; rmReady(); } };
    rd.readAsArrayBuffer(f);
  });
}
function rmReady() {
  const n = RM ? Object.keys(RM.people).length : 0;
  document.getElementById('rm-status').textContent = RM ? `已加载 ${rmFileCount} 个文件 / ${Object.keys(RM.projects).length} 家企业 / ${n} 个身份` : '未加载数据';
  document.getElementById('rm-empty').style.display = RM ? 'none' : 'block';
  document.getElementById('cnt-renmai').textContent = RM ? n : 0;
}

const EXCEL_FILES = [
  'IPO审核申报企业情况20260823.xlsx',
  '再融资审核申报企业情况20261015.xlsx',
  '并购重组审核进程20261015.xlsx',
  '已上市企业项目组情况.xlsx',
];
(async function autoLoadAll() {
  const parsed = [];
  for (const n of EXCEL_FILES) {
    try { const r = await fetch(n); if (r.ok) parsed.push(parseXlsx(await r.arrayBuffer())); } catch (e) {}
  }
  if (parsed.length) { RM = mergeData(parsed); rmFileCount = parsed.length; rmReady(); }
})();

const RM_ROLE_ORDER = ['保荐代表人', '财务顾问主办人', '项目组成员', '签字会计师', '签字律师', '签字评估师', '董事会秘书'];
const RM_ROLE_BAR = {
  '保荐代表人': '#1F5C8B', '财务顾问主办人': '#0F7B6C', '项目组成员': '#1E8E3E',
  '签字会计师': '#D98E04', '签字律师': '#D93025', '签字评估师': '#6B4A7E', '董事会秘书': '#8A97A5'
};
const RM_ORG_BADGE = {
  '保荐机构': ['保荐', '#1F5C8B'], '财务顾问': ['财顾', '#0F7B6C'], '会计师事务所': ['会计所', '#D98E04'],
  '律师事务所': ['律所', '#D93025'], '资产评估机构': ['评估', '#6B4A7E'], '企业': ['企业', '#8A97A5']
};

function rmCandidates(q) {
  q = q.trim();
  if (!q || !RM) return [];
  const out = [];
  for (const key in RM.people) {
    const v = RM.people[key];
    if (v.name.includes(q)) out.push({ key, name: v.name, org: v.org, orgType: v.orgType, n: v.projects.length, roles: Object.keys(v.roles) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || b.n - a.n);
  return out.slice(0, 30);
}
function rmRenderDropdown(q) {
  const dd = document.getElementById('rm-dropdown');
  const list = rmCandidates(q);
  if (!q.trim() || !list.length) { dd.classList.remove('show'); return; }
  dd.innerHTML = list.map(p => `<div class="dd-item" onclick="rmSelect('${esc(p.key)}')"><span class="nm">${esc(p.name)}</span><div class="meta">${esc(p.org)} · ${p.roles.join('/')} · ${p.n} 个项目</div></div>`).join('');
  dd.classList.add('show');
}
function rmSelect(key) { document.getElementById('rm-dropdown').classList.remove('show'); rmRender(key); }

function rmRender(key) {
  const info = RM.people[key];
  const el = document.getElementById('rm-result');
  if (!info) { el.innerHTML = ''; return; }

  const projRows = info.projects.map(pk => {
    const p = RM.projects[pk];
    const my = p.people[info.name] || {};
    return `<tr><td class="co-name">${esc(p.company || '')}${p.type ? ` <span class="type-tag">${esc(p.type)}</span>` : ''}</td><td>${dash(p.board)}</td><td>${dash(p.sponsor)}</td><td>${dash(my.role)}</td></tr>`;
  }).join('');

  const co = {};
  for (const pn of info.projects) {
    const p = RM.projects[pn];
    for (const [p2, v2] of Object.entries(p.people)) {
      const k2 = p2 + '｜' + v2.org;
      if (k2 === key) continue;
      if (!co[k2]) co[k2] = { name: p2, org: v2.org, count: 0, roles: {} };
      co[k2].count++;
      co[k2].roles[v2.role] = (co[k2].roles[v2.role] || 0) + 1;
    }
  }

  const AGG_ROLES = { '签字会计师': '会计师事务所', '签字律师': '律师事务所', '签字评估师': '资产评估机构' };
  const peopleGroup = {}, orgGroup = {};
  for (const [k2, v] of Object.entries(co)) {
    const mainRole = Object.entries(v.roles).sort((a, b) => b[1] - a[1])[0][0];
    if (AGG_ROLES[mainRole]) {
      const og = v.org || '未知';
      if (!orgGroup[mainRole]) orgGroup[mainRole] = {};
      if (!orgGroup[mainRole][og]) orgGroup[mainRole][og] = [];
      orgGroup[mainRole][og].push({ key: k2, name: v.name, count: v.count });
    } else {
      if (!peopleGroup[mainRole]) peopleGroup[mainRole] = [];
      peopleGroup[mainRole].push({ key: k2, name: v.name, org: v.org, count: v.count });
    }
  }
  const chip = x => `<span class="co-chip" onclick="rmSelect('${esc(x.key)}')" title="${esc(x.org || '')}"><span class="nm">${esc(x.name)}</span>${x.org ? `<span class="org2">${esc(x.org)}</span>` : ''}<span class="cnt">${x.count}</span></span>`;

  let coHtml = '';
  for (const r of ['保荐代表人', '财务顾问主办人', '项目组成员', '董事会秘书']) {
    if (!peopleGroup[r]) continue;
    const items = peopleGroup[r].sort((a, b) => b.count - a.count).slice(0, 60).map(chip).join('');
    coHtml += `<div class="co-group"><h3><span class="bar" style="background:${RM_ROLE_BAR[r]}"></span>${r}（${peopleGroup[r].length} 人）</h3><div class="co-chips">${items}</div></div>`;
  }
  for (const r of Object.keys(AGG_ROLES)) {
    const g = orgGroup[r];
    if (!g) continue;
    const orgs = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
    let html = `<div class="co-group"><h3><span class="bar" style="background:${RM_ROLE_BAR[r]}"></span>合作${AGG_ROLES[r]}（${orgs.length} 家）</h3>`;
    for (const og of orgs) {
      const items = g[og].sort((a, b) => b.count - a.count).map(x => `<span class="co-chip" onclick="rmSelect('${esc(x.key)}')" title="${esc(og)}"><span class="nm">${esc(x.name)}</span><span class="cnt">${x.count}</span></span>`).join('');
      html += `<div class="org-block"><div class="org-name">${esc(og)} <span class="org-n">${g[og].length} 人</span></div><div class="co-chips">${items}</div></div>`;
    }
    html += '</div>';
    coHtml += html;
  }

  const roleTags = Object.entries(info.roles).map(([r, c]) => `<span class="tag" style="background:${(RM_ROLE_BAR[r] || '#8A97A5')}1a;color:${RM_ROLE_BAR[r] || '#8A97A5'}">${r} × ${c}</span>`).join('');
  const ob = RM_ORG_BADGE[info.orgType] || ['?', '#8A97A5'];

  el.innerHTML = `
    <div class="person-head">
      <div class="avatar">${esc(info.name[0])}</div>
      <div>
        <div class="who">${esc(info.name)}</div>
        <div class="org"><span class="badge" style="background:${ob[1]}1a;color:${ob[1]}">${ob[0]}</span>${esc(info.org)}</div>
        <div class="stat">参与 ${info.projects.length} 个项目 · 共事 ${Object.keys(co).length} 人</div>
        <div class="role-tags">${roleTags}</div>
      </div>
    </div>
    <div class="cols">
      <div class="card"><h2>参与的项目 <span class="n">${info.projects.length} 个</span></h2><div class="scroll"><table><thead><tr><th>企业</th><th>板块</th><th>主办机构</th><th>角色</th></tr></thead><tbody>${projRows}</tbody></table></div></div>
      <div class="card"><h2>可能认识的人 <span class="n">${Object.keys(co).length} 人</span></h2><div class="scroll">${coHtml}</div></div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('rm-file').addEventListener('change', e => rmLoadFiles(e.target.files));
document.getElementById('rm-search').addEventListener('input', e => rmRenderDropdown(e.target.value));
document.getElementById('rm-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { const c = rmCandidates(e.target.value); document.getElementById('rm-dropdown').classList.remove('show'); if (c.length) rmSelect(c[0].key); }
});
document.addEventListener('click', e => { if (!e.target.closest('.rm-search')) document.getElementById('rm-dropdown').classList.remove('show'); });
