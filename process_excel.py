# -*- coding: utf-8 -*-
"""解析 IPO 申报企业 Excel，按「人名+机构」拆分同名，生成 data.js"""
import openpyxl, json, re, os

wb = openpyxl.load_workbook('IPO审核申报企业情况20260823.xlsx', read_only=True, data_only=True)
ws = wb['sheet1']
rows = list(ws.iter_rows(values_only=True))
header = rows[0]
col = {name: i for i, name in enumerate(header)}

def split_people(s):
    if not s:
        return []
    s = str(s).strip()
    if not s or s in ('—', '-', '无', '/', '暂无'):
        return []
    return [p.strip() for p in re.split(r'[、,，;；/\s]+', s) if p.strip()]

# (角色, Excel 字段名, 归属机构类型)
ROLE_FIELDS = [
    ('保荐代表人', '保荐代表人', '保荐机构'),
    ('项目组成员', '保荐项目组成员', '保荐机构'),
    ('签字会计师', '签字会计师', '会计师事务所'),
    ('签字律师', '签字律师', '律师事务所'),
    ('董事会秘书', '董事会秘书', '企业'),
]

projects = {}
people = {}   # key = 人名｜机构

def org_of(org_type, r, name):
    if org_type == '保荐机构':
        return str(r[col['保荐机构']] or '').strip() or '未知'
    if org_type == '会计师事务所':
        return str(r[col['会计师事务所']] or '').strip() or '未知'
    if org_type == '律师事务所':
        return str(r[col['律师事务所']] or '').strip() or '未知'
    return name  # 董秘归属企业

for r in rows[1:]:
    name = r[col['企业名称']]
    if not name:
        continue
    name = str(name).strip()
    sponsor = str(r[col['保荐机构']] or '').strip()
    acc = str(r[col['会计师事务所']] or '').strip()
    law = str(r[col['律师事务所']] or '').strip()

    proj_people = {}   # 人名 -> 角色
    for role, field, org_type in ROLE_FIELDS:
        org = org_of(org_type, r, name)
        for p in split_people(r[col[field]]):
            if p not in proj_people:
                proj_people[p] = role
                key = p + '｜' + org
                if key not in people:
                    people[key] = {'name': p, 'org': org, 'orgType': org_type, 'roles': {}, 'projects': []}
                people[key]['roles'][role] = people[key]['roles'].get(role, 0) + 1
                people[key]['projects'].append(name)

    if proj_people:
        projects[name] = {
            'board': str(r[col['拟上市板']] or '').strip(),
            'sponsor': sponsor,
            'acc': acc,
            'law': law,
            'people': proj_people,
        }

# 重名统计
name_count = {}
for v in people.values():
    name_count[v['name']] = name_count.get(v['name'], 0) + 1
multi = {n: c for n, c in name_count.items() if c > 1}

print('项目数:', len(projects))
print('身份数(人名+机构去重):', len(people))
print('出现多身份的同名人数:', len(multi))
print('重名示例:', list(multi.items())[:10])

with open('data.js', 'w', encoding='utf-8') as f:
    f.write('window.IPO_DATA = ')
    json.dump({'projects': projects, 'people': people}, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')
print('data.js 大小:', round(os.path.getsize('data.js') / 1024, 1), 'KB')
print('完成')
