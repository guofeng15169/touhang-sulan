# -*- coding: utf-8 -*-
"""抓三大交易所官网 IPO 审核数据 → 生成 data/audit.js（Windows 任务计划程序定时调用）

数据源（三大交易所官网，非见微）：
- 上交所：http://query.sse.com.cn/commonSoaQuery.do  sqlId=SH_XM_LB  issueMarketType=1,2（1=科创板/2=主板）
- 北交所：https://www.bse.cn/projectNewsController/infoResult.do  POST+jsonp
- 深交所：待接（用 StealthyFetcher 浏览器渲染，chromium 装好后启用）

依赖：pip install "scrapling[fetchers]"
"""
import sys
import os
import re
import json
import datetime
from scrapling import Fetcher

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT_PATH = os.path.join(ROOT, 'data', 'audit.js')


# ===== 上交所 =====
def sse_status(currStatus, commitiResult, registeResult, suspendStatus):
    """复刻官网 statusTransform 的状态映射。"""
    s = str(currStatus)
    if s == '1':
        return '已受理'
    if s == '2':
        return '已问询'
    if s == '3':
        return {'1': '上市委会议通过', '2': '有条件通过', '3': '上市委会议未通过', '6': '暂缓审议'}.get(str(commitiResult), '上市委会议')
    if s == '4':
        return '提交注册'
    if s == '5':
        return {'1': '注册生效', '2': '不予注册', '3': '终止注册'}.get(str(registeResult), '注册结果')
    if s == '6':
        return '已发行'
    if s == '7':
        return {'1': '中止(财报更新)', '2': '中止(其他事项)'}.get(str(suspendStatus), '中止及财报更新')
    if s == '8':
        return '终止'
    if s == '9':
        return {'4': '复审委会议通过', '5': '复审委会议未通过'}.get(str(commitiResult), '复审委会议')
    if s == '10':
        return '补充审核'
    return '-'


def fetch_sse():
    rows = []
    page_no = 1
    while True:
        page = Fetcher.get('http://query.sse.com.cn/commonSoaQuery.do', params={
            'jsonCallBack': 'jsonpCallback1', 'sqlId': 'SH_XM_LB', 'issueMarketType': '1,2',
            'isPagination': 'true', 'pageHelp.pageSize': '500', 'pageHelp.pageNo': str(page_no),
            'order': 'updateDate|desc,stockAuditNum|desc',
        }, headers={'Referer': 'http://www.sse.com.cn/'}, impersonate='chrome', timeout=30)
        raw = page.html_content or ''
        d = json.loads(re.search(r'jsonpCallback1\((\{.*\})\)', raw, re.S).group(1))
        ph = d['pageHelp']
        data = ph.get('data', [])
        for row in data:
            iss = row.get('stockIssuer') or [{}]
            b = next((x for x in row.get('intermediary') or [] if x.get('i_intermediaryType') == 1), {})
            a = next((x for x in row.get('intermediary') or [] if x.get('i_intermediaryType') == 2), {})
            l = next((x for x in row.get('intermediary') or [] if x.get('i_intermediaryType') == 3), {})
            rows.append({
                'type': 'IPO', 'exchange': '上交所',
                'company': row.get('stockAuditName') or '',
                'code': '', 'board': '科创板' if row.get('issueMarketType') == 1 else '主板',
                'status': sse_status(row.get('currStatus'), row.get('commitiResult'), row.get('registeResult'), row.get('suspendStatus')),
                'region': (iss[0].get('s_province') if iss else '') or '',
                'industry': (iss[0].get('s_csrcCodeDesc') if iss else '') or '',
                'sponsor': b.get('i_intermediaryName') or '',
                'law': l.get('i_intermediaryName') or '',
                'acc': a.get('i_intermediaryName') or '',
                'update': (row.get('updateDate') or '')[:8],
                'accept': (row.get('auditApplyDate') or '')[:8],
            })
        total = int(ph.get('total', 0))
        if page_no * 500 >= total or not data:
            break
        page_no += 1
    return rows


# ===== 北交所 =====
BSE_STATUS = {
    'P01': '已受理', 'P02': '已问询', 'P03': '上市委会议通过', 'P04': '上市委会议未通过',
    'P05': '上市委会议暂缓', 'P06': '提交注册', 'P07': '注册', 'P08': '不予注册',
    'P09': '中止', 'P10': '终止',
}


def ms_to_date(ms):
    if not ms:
        return ''
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d')


def fetch_bse():
    need_fields = ["id", "stockCode", "stockName", "companyName", "status", "registerAddress",
                   "sponsorOrg", "appraisalOrg", "lawyerOrg", "accountingOrg", "updateDate", "receiveDate"]
    rows = []
    seen = set()
    page_no = 1
    while True:
        page = Fetcher.post('https://www.bse.cn/projectNewsController/infoResult.do', data={
            'statetypes': '', 'page': str(page_no), 'companyCode': '', 'isNewThree': '1',
            'sortfield': 'updateDate', 'sorttype': 'desc', 'startTime': '', 'endTime': '', 'keyword': '',
            'needFields': ','.join(need_fields),
        }, headers={'Referer': 'https://www.bse.cn/audit/project_news.html'}, impersonate='chrome', timeout=30)
        raw = page.html_content or ''
        m = re.search(r'null\((\[.*\])\)', raw, re.S)
        if not m:
            break
        d = json.loads(m.group(1))[0]
        li = d.get('listInfo', {})
        content = li.get('content', [])
        for row in content:
            rid = row.get('id')
            if rid in seen:
                continue
            seen.add(rid)
            ud = row.get('updateDate') or {}
            rd = row.get('receiveDate') or {}
            rows.append({
                'type': 'IPO', 'exchange': '北交所',
                'company': row.get('companyName') or '',
                'code': row.get('stockCode') or '', 'board': '北交所',
                'status': BSE_STATUS.get(row.get('status') or '', row.get('status') or ''),
                'region': row.get('registerAddress') or '',
                'industry': '',
                'sponsor': row.get('sponsorOrg') or '',
                'law': row.get('lawyerOrg') or '',
                'acc': row.get('accountingOrg') or '',
                'update': ms_to_date(ud.get('time') if isinstance(ud, dict) else None),
                'accept': ms_to_date(rd.get('time') if isinstance(rd, dict) else None),
            })
        total_pages = int(li.get('totalPages', 1))
        if page_no >= total_pages or not content:
            break
        page_no += 1
    return rows


# ===== 深交所 =====
def fetch_szse():
    rows = []
    page_index = 0
    page_size = 100
    while True:
        url = f'https://www.szse.cn/api/ras/projectrends/query?bizType=1&random=0.1&pageIndex={page_index}&pageSize={page_size}'
        page = Fetcher.get(url, headers={'Referer': 'https://www.szse.cn/listing/projectdynamic/ipo/index.html'}, impersonate='chrome', timeout=30)
        data = page.json()
        for d in data.get('data', []):
            rows.append({
                'type': 'IPO', 'exchange': '深交所',
                'company': d.get('cmpnm') or '',
                'code': d.get('cmpcode') or '',
                'board': d.get('boardName') or '',
                'status': d.get('prjst') or '',
                'region': d.get('regloc') or '',
                'industry': d.get('csrcind') or '',
                'sponsor': d.get('sprinst') or '',
                'law': d.get('lawfm') or '',
                'acc': d.get('acctfm') or '',
                'update': d.get('updtdt') or '',
                'accept': d.get('acptdt') or '',
            })
        total_page = int(data.get('totalPage', 1))
        if page_index + 1 >= total_page or not data.get('data'):
            break
        page_index += 1
    return rows


def main():
    rows = []
    for fn, name in [(fetch_sse, '上交所'), (fetch_bse, '北交所'), (fetch_szse, '深交所')]:
        try:
            r = fn()
            rows.extend(r)
            print(f'{name}: {len(r)} 条')
        except Exception as e:
            print(f'{name} 抓取失败: {e}')

    if not rows:
        print('未抓到任何数据，不写入文件')
        sys.exit(1)

    # 按公司+类型去重（保底）
    uniq = {}
    for r in rows:
        k = (r.get('company') or '') + '|' + (r.get('type') or '')
        if k not in uniq:
            uniq[k] = r
    rows = list(uniq.values())

    today = datetime.date.today().isoformat()
    out = 'window.AUDIT_DATA = ' + json.dumps({'updatedAt': today, 'rows': rows}, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(AUDIT_PATH, 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'已写入 {AUDIT_PATH}，共 {len(rows)} 条，更新日期 {today}')


if __name__ == '__main__':
    main()
