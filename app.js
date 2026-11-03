/**
 * 龙虾脑 LobsterBrain — 通用 Mac 自然语言遥控器 v3
 * 手机网页输入/语音说一句话 → 智能解析 → 驱动这台 Mac 执行 → 手机端回传状态与结果
 * 零依赖：node app.js（Node 18+）
 *
 * 能力矩阵（动作 × 对象）：
 *   search  在任意平台搜索任意关键词（百度/Google/B站/知乎/微博/GitHub/淘宝/京东/优酷/爱奇艺/腾讯视频/YouTube/豆瓣）
 *   play    视频站搜索并尝试自动播放（B站可自动点击首个视频）
 *   open    打开 Mac 应用 / 文件夹 / 网站首页 / 指定网址
 *   rating  豆瓣查电影评分
 *   system  音量±/静音、亮度（开显示设置）、截图、锁屏、清废纸篓（确认）、系统设置
 *   note    记内容到剪贴板并打开备忘录
 *
 * 智能：内置增强 NLU（动作/平台/内容类型/对象四维解析）+ 可选接真 LLM（LLM_BASE_URL/LLM_API_KEY/LLM_MODEL，OpenAI 兼容）
 * 输入：语音输入（实时反馈）、实时联想、多场景卡片、历史可重发、回车提交
 *
 * 页面：/ 手机任务页   /dashboard 运营看板
 * API：POST /api/task   GET /api/task/:id   GET /api/tasks
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, 'tasks.json');
const HOT_MOVIES = ['哪吒之魔童闹海', '流浪地球', '唐探1900', '封神第二部', '沙丘2', '奥本海默', '碟中谍8', '雄狮少年2'];

/* ---------------- 字典：应用 / 文件夹 / 站点 ---------------- */
const APPS = {
  '微信': 'WeChat', 'wechat': 'WeChat', 'qq': 'QQ', 'QQ': 'QQ',
  'safari': 'Safari', '浏览器': 'Safari', 'chrome': 'Google Chrome', '谷歌浏览器': 'Google Chrome',
  '邮件': 'Mail', '备忘录app': 'Notes', '计算器': 'Calculator',
  '访达': 'Finder', 'finder': 'Finder', '终端': 'Terminal', 'terminal': 'Terminal',
  'vscode': 'Visual Studio Code', '代码编辑器': 'Visual Studio Code', 'vs code': 'Visual Studio Code',
  '网易云音乐': 'NeteaseMusic', 'spotify': 'Spotify', '飞书': 'Feishu', '钉钉': 'DingTalk',
  '企业微信': 'WeCom', '日历': 'Calendar', '提醒事项': 'Reminders', '地图': 'Maps',
  '预览': 'Preview', '文本编辑': 'TextEdit', '截图': 'Screenshot', 'quicktime': 'QuickTime Player',
};
const FOLDERS = {
  '下载': '~/Downloads', '桌面': '~/Desktop', '文档': '~/Documents',
  '主目录': '~', '家目录': '~', '应用程序': '/Applications',
  '图片': '~/Pictures', '影片': '~/Movies', '音乐': '~/Music',
};
const SITES = {
  baidu: { label: '百度', home: 'https://www.baidu.com', search: k => 'https://www.baidu.com/s?wd=' + encodeURIComponent(k), keys: ['百度', 'baidu'] },
  google: { label: 'Google', home: 'https://www.google.com', search: k => 'https://www.google.com/search?q=' + encodeURIComponent(k), keys: ['google', '谷歌'] },
  bilibili: { label: 'B站', home: 'https://www.bilibili.com', search: k => 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(k), keys: ['b站', '哔哩', 'bilibili'] },
  youku: { label: '优酷', home: 'https://www.youku.com', search: k => 'https://so.youku.com/search_video/q_' + encodeURIComponent(k), keys: ['优酷'] },
  iqiyi: { label: '爱奇艺', home: 'https://www.iqiyi.com', search: k => 'https://so.iqiyi.com/so/q_' + encodeURIComponent(k), keys: ['爱奇艺'] },
  tencent: { label: '腾讯视频', home: 'https://v.qq.com', search: k => 'https://v.qq.com/x/search?search_key=' + encodeURIComponent(k), keys: ['腾讯视频', '腾讯'] },
  youtube: { label: 'YouTube', home: 'https://www.youtube.com', search: k => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(k), keys: ['youtube', '油管'] },
  douban: { label: '豆瓣', home: 'https://movie.douban.com', search: k => 'https://search.douban.com/movie/subject_search?search_text=' + encodeURIComponent(k), keys: ['豆瓣'] },
  zhihu: { label: '知乎', home: 'https://www.zhihu.com', search: k => 'https://www.zhihu.com/search?q=' + encodeURIComponent(k), keys: ['知乎'] },
  weibo: { label: '微博', home: 'https://weibo.com', search: k => 'https://s.weibo.com/weibo?q=' + encodeURIComponent(k), keys: ['微博'] },
  github: { label: 'GitHub', home: 'https://github.com', search: k => 'https://github.com/search?q=' + encodeURIComponent(k), keys: ['github'] },
  taobao: { label: '淘宝', home: 'https://www.taobao.com', search: k => 'https://s.taobao.com/search?q=' + encodeURIComponent(k), keys: ['淘宝'] },
  jd: { label: '京东', home: 'https://www.jd.com', search: k => 'https://search.jd.com/Search?keyword=' + encodeURIComponent(k), keys: ['京东'] },
};
const VIDEO_SITES = ['bilibili', 'youku', 'iqiyi', 'tencent', 'youtube'];
const CONTENT_TYPES = { '预告片': ['预告片', '预告', 'trailer', 'teaser'], '正片': ['正片', '完整版', '全片'], '花絮': ['花絮', '幕后', '彩蛋'], '解说': ['解说', '影评', 'reaction'] };
const ACTION_LABEL = { search: '搜索', play: '播放', open: '打开', rating: '查评分', system: '系统操作', note: '记备忘录' };

/* ---------------- 数据层 ---------------- */
let tasks = [];
function load() { try { tasks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { seed(); save(); } }
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2)); }
function pick(id) { return tasks.find(t => t.id === id); }

function seed() {
  const demo = [
    ['搜索《流浪地球》预告片并播放', 'success'], ['在B站搜沙丘2的花絮', 'success'],
    ['帮我查一下奥本海默的评分', 'success'], ['百度一下 Python 异步编程', 'success'],
    ['打开微信', 'success'], ['截个屏', 'success'], ['把明天开会带电脑记到备忘录', 'success'],
    ['找一部最近热门的电影看看', 'success'], ['音量调大一点', 'success'], ['打开爱奇艺', 'failed'],
  ];
  const now = Date.now();
  demo.forEach((d, i) => {
    const it = localParse(d[0]);
    const createdAt = now - (7 - Math.floor(i / 2)) * 86400000 - Math.floor(Math.random() * 50000000);
    const dur = d[1] === 'success' ? 2200 + Math.floor(Math.random() * 1800) : 1300 + Math.floor(Math.random() * 700);
    tasks.push(makeTask(d[0], {
      movie: it.target, platform: it.platform, action: it.action,
      status: d[1], createdAt, finishedAt: createdAt + dur,
      result: d[1] === 'success' ? `已在 Mac 执行：${describeIntent(it)}` : null,
      error: d[1] === 'failed' ? '模拟异常：Mac 端「屏幕控制」权限未授权，任务中止' : null,
      intent: it, demo: true,
    }));
  });
}
function makeTask(instruction, extra = {}) {
  return Object.assign({
    id: 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    instruction: String(instruction || ''), movie: null, platform: null, action: null, intent: null,
    status: 'processing',
    stages: mkStages(), createdAt: Date.now(), finishedAt: null, result: null, error: null, demo: false,
  }, extra);
}
const mkStages = () => ([
  { name: '意图解析', state: 'pending', note: '' },
  { name: '任务规划', state: 'pending', note: '' },
  { name: '驱动 Mac 执行', state: 'pending', note: '' },
  { name: '结果回传', state: 'pending', note: '' },
]);

/* ---------------- 意图解析（增强 NLU + 可选 LLM） ---------------- */
function detectSite(text) {
  const lower = text.toLowerCase();
  for (const p in SITES) if (SITES[p].keys.some(k => lower.includes(k))) return p;
  return null;
}
function detectApp(text) {
  const lower = text.toLowerCase();
  for (const cn in APPS) if (lower.includes(cn.toLowerCase())) return { name: cn, key: APPS[cn] };
  return null;
}
function detectFolder(text) {
  for (const f in FOLDERS) if (text.includes(f)) return { name: f, path: FOLDERS[f] };
  return null;
}
function detectSystem(text) {
  if (/静音/.test(text)) return { sub: 'mute' };
  if (/音量.*调大|调大.*音量|音量.*大|声音.*大|调大声音|大声/.test(text)) return { sub: 'volume_up' };
  if (/音量.*调小|调小.*音量|音量.*小|声音.*小|调小声音|小声/.test(text)) return { sub: 'volume_down' };
  if (/亮度/.test(text)) return { sub: 'brightness' };
  if (/截图|截屏|截个屏|screen ?shot/i.test(text)) return { sub: 'screenshot' };
  if (/锁屏|锁定屏幕/.test(text)) return { sub: 'lock' };
  if (/清空废纸篓|清废纸篓|empty.*trash/.test(text)) return { sub: 'trash' };
  if (/系统设置|打开设置|系统偏好/.test(text)) return { sub: 'settings' };
  return null;
}
function extractQuoted(text) {
  let m = text.match(/《(.+?)》/);
  if (m) return m[1];
  m = text.match(/["“”‘’](.+?)["“”‘’]/);
  if (m) return m[1];
  return null;
}
const STOP_PHRASES = ['帮我','请','一下','搜索','搜','查找','找','查','播放','看','放','观看','听一下','听歌','并','的','百度','google','谷歌','b站','哔哩','bilibili','优酷','爱奇艺','腾讯视频','腾讯','youtube','油管','豆瓣','知乎','微博','github','淘宝','京东','相关','视频','电影','一部','最近','热门','随便','来一部','啥','什么','打开','启动','唤起','进','首页','网站','官网','记到备忘录','记到','备忘录','便签','记一下','提醒我','音量','声音','调大','调小','静音','亮度','截图','截屏','截个屏','锁屏','清空废纸篓','废纸篓','系统设置','设置','预告片','预告','正片','完整版','全片','花絮','幕后','彩蛋','解说','影评','trailer','teaser','用','在','上','去','个','下'];
function extractKeyword(text) {
  let t = extractQuoted(text);
  if (t) return t;
  for (const name of HOT_MOVIES) if (text.includes(name)) return name;
  t = text.replace(/[《》"“”'‘’]/g, '');
  for (const p of STOP_PHRASES) t = t.split(p).join('');
  t = t.replace(/[，。！？、\s]/g, '').trim();
  return t.length >= 2 ? t : null;
}

function localParse(text) {
  const raw = (text || '').trim();
  const lower = raw.toLowerCase();

  // 1. 系统操作
  const sys = detectSystem(raw);
  if (sys) return { action: 'system', sub: sys.sub, target: null, platform: null, contentType: null, raw, source: 'rule' };

  // 2. 记备忘录
  if (/备忘录|记一下|便签|记到|提醒我/.test(raw)) {
    let body = extractQuoted(raw) || raw.replace(/帮我|请|把|记到备忘录|记到备忘录里|记一下|记到|备忘录|便签|提醒我/g, '').trim();
    return { action: 'note', target: body, platform: null, contentType: null, raw, source: 'rule' };
  }

  // 3. 打开类
  if (/打开|启动|唤起|进.*首页|打开.*网站/.test(raw)) {
    const app = detectApp(raw);
    if (app) return { action: 'open', sub: 'open_app', target: app.name, app: app.key, platform: null, contentType: null, raw, source: 'rule' };
    const folder = detectFolder(raw);
    if (folder) return { action: 'open', sub: 'open_folder', target: folder.name, folder: folder.path, platform: null, contentType: null, raw, source: 'rule' };
    if (/^https?:\/\//.test(raw) || /\.(com|cn|org|net|io|dev)(\/|$)/.test(lower)) {
      const m = raw.match(/https?:\/\/\S+/);
      if (m) return { action: 'open', sub: 'open_url', target: m[0], url: m[0], platform: null, contentType: null, raw, source: 'rule' };
    }
    const p = detectSite(raw);
    if (p) return { action: 'open', sub: 'open_site', target: SITES[p].label, platform: p, contentType: null, raw, source: 'rule' };
    // 兜底：尝试当应用名
    const kw = extractKeyword(raw);
    if (kw) return { action: 'open', sub: 'open_app', target: kw, app: kw, platform: null, contentType: null, raw, source: 'rule' };
  }

  // 4. 查评分
  if (/评分|打分|评价|几分|豆瓣/.test(raw)) {
    const movie = extractKeyword(raw);
    return { action: 'rating', target: movie, platform: 'douban', contentType: null, raw, source: 'rule' };
  }

  // 5. 播放（视频）
  if (/播放|看|放|观看|听歌|听一下/.test(raw)) {
    const p = detectSite(raw) || 'bilibili';
    let ct = null;
    for (const c in CONTENT_TYPES) if (CONTENT_TYPES[c].some(k => lower.includes(k))) { ct = c; break; }
    let movie = extractKeyword(raw);
    if (!movie && /热门|推荐|随便|最近|来一部/.test(raw)) movie = HOT_MOVIES[Math.floor(Math.random() * HOT_MOVIES.length)];
    return { action: 'play', target: movie, platform: VIDEO_SITES.includes(p) ? p : 'bilibili', contentType: ct, raw, source: 'rule' };
  }

  // 6. 搜索（默认）
  const p = detectSite(raw);
  let ct = null;
  for (const c in CONTENT_TYPES) if (CONTENT_TYPES[c].some(k => lower.includes(k))) { ct = c; break; }
  const kw = extractKeyword(raw);
  return { action: 'search', target: kw, platform: p || 'baidu', contentType: ct, raw, source: 'rule' };
}

async function callLLM(text) {
  const base = process.env.LLM_BASE_URL, key = process.env.LLM_API_KEY;
  if (!base || !key) return null;
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini', temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是龙虾脑的指令解析器。把用户自然语言解析为JSON：{action,target,platform,contentType,sub}。action取值search(搜索)/play(播放视频)/open(打开)/rating(查评分)/system(系统操作)/note(记备忘录)；target是主要对象(影片名/关键词/应用名/要记的内容)或null；platform取值baidu/google/bilibili/youku/iqiyi/tencent/youtube/douban/zhihu/weibo/github/taobao/jd或null，搜索默认baidu，播放默认bilibili，查评分默认douban；contentType取值预告片/正片/花絮/解说或null；sub在action=open时为open_app/open_folder/open_site/open_url，action=system时为volume_up/volume_down/mute/brightness/screenshot/lock/trash/settings。只输出JSON。' },
          { role: 'user', content: text },
        ],
      }),
    });
    const j = await r.json();
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return c ? JSON.parse(c) : null;
  } catch (e) { console.log('[LLM] 降级本地:', e.message); return null; }
}

async function parseInstruction(text) {
  const raw = (text || '').trim();
  const llm = await callLLM(raw);
  if (llm && llm.action) { llm.raw = raw; llm.source = 'llm'; return llm; }
  return localParse(raw);
}

function describeIntent(it) {
  if (!it) return '';
  const site = it.platform ? SITES[it.platform].label : '';
  switch (it.action) {
    case 'system': {
      const map = { volume_up: '调大音量', volume_down: '调小音量', mute: '静音', brightness: '调节亮度', screenshot: '截屏', lock: '锁屏', trash: '清空废纸篓', settings: '打开系统设置' };
      return '系统操作：' + (map[it.sub] || it.sub);
    }
    case 'note': return '记到备忘录：「' + (it.target || '') + '」';
    case 'open':
      if (it.sub === 'open_app') return '打开应用 ' + (it.target || '');
      if (it.sub === 'open_folder') return '打开' + (it.target || '') + '文件夹';
      if (it.sub === 'open_url') return '打开网址 ' + (it.url || it.target || '');
      return '打开 ' + site + ' 网站';
    case 'rating': return '查「' + (it.target || '') + '」的评分 @ 豆瓣';
    case 'play': return '播放「' + (it.target || '') + '」' + (it.contentType ? ' ' + it.contentType : '') + ' @ ' + site;
    case 'search': default: return '在' + site + '搜索「' + (it.target || '') + '」';
  }
}

/* ---------------- 语音指令规范化（口语 → 清晰自然语言指令） ---------------- */
function normalizeSpeech(text) {
  let s = (text || '').trim();
  // 动词 + "一下/个" 统一为规范动词
  s = s.replace(/播放一下|放一下|播一下|放个|播个/g, '播放');
  s = s.replace(/看下|看一下|看个|瞅一下|瞅瞅/g, '播放');
  s = s.replace(/搜下|搜一下|搜个/g, '搜索');
  // 去口水词、冗余语气（此时动词已规范，剩余"一下"安全去除）
  s = s.replace(/那个啥|那个|这那个|呃|嗯|啊|嘛|哦|就是|然后|一下|帮我看|帮我去|麻烦|请|来一下|给我|稍微|特别|就是说|对吧/g, '');
  // 影片名补书名号（便于解析与展示）
  for (const name of HOT_MOVIES) {
    if (s.includes(name) && !s.includes('《' + name + '》')) s = s.split(name).join('《' + name + '》');
  }
  // 引号统一为书名号
  s = s.replace(/["“”](.+?)["“”]/g, '《$1》');
  // "预告片播放" → "预告片并播放"，更通顺
  s = s.replace(/(预告片|正片|花絮|解说)播放/g, '$1并播放');
  // 结尾孤立动词补全（避免误伤已规范的"播放"）
  s = s.replace(/([^播])放$/, '$1播放');
  // 整理空白与重复标点
  s = s.replace(/\s+/g, ' ').replace(/，，|。。/g, '，').replace(/^，|，$/g, '').trim();
  return s || (text || '').trim();
}

async function normalizeInstruction(text) {
  // 配置了 LLM 时，用大模型把口语改写为简洁指令；否则本地规则规范化
  const base = process.env.LLM_BASE_URL, key = process.env.LLM_API_KEY;
  if (base && key) {
    try {
      const r = await fetch(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'gpt-4o-mini', temperature: 0.2,
          messages: [
            { role: 'system', content: '把用户语音识别出的口语改写为一句简洁、规范的中文指令：去掉口水词(那个/呃/嗯/就是/然后/一下)，影片名用书名号《》，动词明确(搜索/播放/打开/查评分)。只输出改写后的指令本身，不要解释。例：「那个帮我搜一下流浪地球的预告片然后放一下」→「搜索《流浪地球》预告片并播放」' },
            { role: 'user', content: text },
          ],
        }),
      });
      const j = await r.json();
      const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (c) return c.trim().replace(/^["“”]|["“”]$/g, '');
    } catch (e) { /* 降级本地 */ }
  }
  return normalizeSpeech(text);
}

/* ---------------- 执行引擎 ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = (cmd) => new Promise((res, rej) => {
  exec(cmd, { timeout: 9000 }, (err, stdout, stderr) => err ? rej(Object.assign(err, { stderr })) : res(stdout.trim()));
});
function setStage(t, i, state, note) { t.stages[i].state = state; if (note) t.stages[i].note = note; save(); }
function fail(t, i, msg) { setStage(t, i, 'failed', msg); t.status = 'failed'; t.error = msg; t.finishedAt = Date.now(); save(); console.log(`[FAIL] ${t.id}: ${msg}`); }

function planText(it) {
  switch (it.action) {
    case 'system': return { volume_up: 'osascript 调高系统音量 +10', volume_down: 'osascript 调低系统音量 -10', mute: 'osascript 静音', brightness: '打开「显示设置」', screenshot: 'screencapture 截图保存到桌面', lock: '调用 CGSession 锁屏', trash: '高危操作，提示用户手动确认', settings: '打开系统设置' }[it.sub];
    case 'note': return '把内容写入剪贴板 → 打开备忘录 → 提示粘贴';
    case 'open':
      if (it.sub === 'open_app') return `open -a "${it.app}"`;
      if (it.sub === 'open_folder') return `open ${it.folder}`;
      if (it.sub === 'open_url') return `open ${it.url}`;
      return `open ${SITES[it.platform].home}`;
    case 'rating': return `open 豆瓣搜索「${it.target}」`;
    case 'play': return `open ${SITES[it.platform].label} 搜索「${it.target}${it.contentType ? ' ' + it.contentType : ''}」` + (it.platform === 'bilibili' ? ' → AppleScript 点击首个视频' : '');
    case 'search': default: return `open ${SITES[it.platform].label} 搜索「${it.target}」`;
  }
}

async function runTask(t) {
  try {
    setStage(t, 0, 'running'); await sleep(380);
    if (!t.instruction.trim()) return fail(t, 0, '指令为空，请说出你想让 Mac 做什么');
    const it = await parseInstruction(t.instruction);
    it._desc = describeIntent(it);
    t.intent = it; t.movie = it.target; t.platform = it.platform; t.action = it.action; save();

    if (it.action !== 'system' && it.action !== 'open_site' && !it.target) {
      return fail(t, 0, '没识别到操作对象，试试「百度一下 Python 教程」「打开微信」「截个屏」');
    }
    setStage(t, 0, 'done', '理解：' + it._desc + ' · 解析：' + (it.source === 'llm' ? '大模型' : '规则引擎'));

    setStage(t, 1, 'running'); await sleep(480);
    if (/失败|异常|权限|崩|报错/.test(t.instruction)) return fail(t, 1, '模拟异常：Mac 端「屏幕控制」权限未授权，任务中止（演示失败反馈）');
    setStage(t, 1, 'done', '策略：' + planText(it));

    setStage(t, 2, 'running'); await sleep(380);
    let execNote, result;
    try {
      if (it.action === 'system') {
        const sub = it.sub;
        if (sub === 'volume_up') { await sh(`osascript -e 'set volume output volume ((output volume of (get volume settings))+10)'`); execNote = result = '系统音量已调大 +10'; }
        else if (sub === 'volume_down') { await sh(`osascript -e 'set volume output volume ((output volume of (get volume settings))-10)'`); execNote = result = '系统音量已调小 -10'; }
        else if (sub === 'mute') { await sh(`osascript -e 'set volume output muted true'`); execNote = result = '已静音'; }
        else if (sub === 'brightness') { await sh(`open "x-apple.systempreferences:com.apple.Displays-Settings.extension"`); execNote = result = '已打开显示设置，亮度请手动调节（macOS 不支持脚本直接改亮度）'; }
        else if (sub === 'screenshot') { const f = `~/Desktop/龙虾脑截图_$(date +%Y%m%d_%H%M%S).png`; await sh(`screencapture ${f}`); execNote = result = '截图已保存到桌面'; }
        else if (sub === 'lock') { await sh(`/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend`); execNote = result = '已锁屏'; }
        else if (sub === 'trash') { execNote = result = '清空废纸篓属高危操作，请到 Mac 手动确认（演示版不自动执行）'; }
        else if (sub === 'settings') { await sh(`open "x-apple.systempreferences:"`); execNote = result = '已打开系统设置'; }
        else throw new Error('未知系统操作');
      } else if (it.action === 'note') {
        const tmp = path.join(os.tmpdir(), 'lb_note_' + Date.now() + '.txt');
        fs.writeFileSync(tmp, String(it.target || ''), 'utf8');
        await sh(`pbcopy < "${tmp}"`); fs.unlinkSync(tmp);
        await sh(`open -a "Notes"`);
        execNote = result = '内容已复制到剪贴板，备忘录已打开，按 Cmd+V 粘贴';
      } else if (it.action === 'open') {
        if (it.sub === 'open_app') { await sh(`open -a "${it.app}"`); execNote = result = '已打开应用：' + it.target; }
        else if (it.sub === 'open_folder') { await sh(`open ${it.folder}`); execNote = result = '已打开文件夹：' + it.target; }
        else if (it.sub === 'open_url') { await sh(`open "${it.url}"`); execNote = result = '已打开网址'; }
        else { await sh(`open "${SITES[it.platform].home}"`); execNote = result = '已打开 ' + SITES[it.platform].label + ' 首页'; }
      } else if (it.action === 'rating') {
        await sh(`open "${SITES.douban.search(it.target)}"`); execNote = result = '已在豆瓣打开「' + it.target + '」评分页';
      } else if (it.action === 'play') {
        const kw = it.target + (it.contentType ? ' ' + it.contentType : '');
        await sh(`open "${SITES[it.platform].search(kw)}"`);
        execNote = '已在 ' + SITES[it.platform].label + ' 打开「' + kw + '」搜索结果';
        result = execNote;
        if (it.platform === 'bilibili') {
          try {
            const js = '(function(){var a=document.querySelector(".bili-video-card a")||document.querySelector("a[title]");if(a){a.click();return "clicked"}return "none"})()';
            const out = await sh(`osascript -e 'tell application "Google Chrome" to tell active tab of front window to execute javascript "${js.replace(/"/g, '\\"')}"'`);
            if (out === 'clicked') { execNote = '已自动点击首个视频，开始播放'; result = '「' + kw + '」已在 Mac 自动播放'; }
          } catch (e) { /* 降级 */ }
        }
      } else { // search
        await sh(`open "${SITES[it.platform].search(it.target)}"`);
        execNote = result = '已在 ' + SITES[it.platform].label + ' 搜索「' + it.target + '」';
      }
    } catch (e) {
      return fail(t, 2, '执行失败：' + (e.message || '未知错误') + '（可能是应用未安装或需要授权辅助功能）');
    }
    setStage(t, 2, 'done', execNote);

    setStage(t, 3, 'running'); await sleep(360);
    setStage(t, 3, 'done', result);
    t.status = 'success'; t.result = result; t.finishedAt = Date.now(); save();
    console.log(`[DONE] ${t.id} -> ${it._desc} (${t.finishedAt - t.createdAt}ms)`);
  } catch (e) { fail(t, 3, '未知异常：' + (e.message || e)); }
}

/* ---------------- CSS ---------------- */
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:#F7F5F1;color:#2C2C2A;line-height:1.6}
.wrap{max-width:480px;margin:0 auto;padding:20px 16px 48px}
.logo{display:flex;align-items:center;gap:10px;margin-bottom:4px}
.logo .dot{width:34px;height:34px;border-radius:10px;background:#D85A30;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:500;font-size:17px}
.logo h1{font-size:17px;font-weight:500}
.slogan{font-size:12px;color:#888780;margin-bottom:16px}
.card{background:#fff;border:1px solid rgba(44,44,42,.12);border-radius:14px;padding:16px;margin-bottom:14px}
.input-row{display:flex;gap:8px;align-items:flex-start}
textarea{flex:1;border:1px solid rgba(44,44,42,.18);border-radius:10px;padding:12px;font-size:15px;font-family:inherit;resize:none;min-height:54px;outline:none}
textarea:focus{border-color:#D85A30}
.mic{width:54px;height:54px;border:1px solid rgba(44,44,42,.18);border-radius:10px;background:#fff;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.mic.on{background:#D85A30;color:#fff;border-color:#D85A30;animation:pulse 1s infinite}
.btn{display:block;width:100%;margin-top:12px;background:#D85A30;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;font-family:inherit;cursor:pointer}
.btn:disabled{opacity:.5}
.btn.ghost{background:#fff;color:#D85A30;border:1px solid #D85A30}
.voice-hint{font-size:12px;color:#D85A30;margin-top:8px;min-height:16px}
.suggest{margin-top:6px;border:1px solid rgba(44,44,42,.12);border-radius:10px;overflow:hidden}
.suggest div{padding:10px 12px;font-size:13px;border-bottom:1px solid rgba(44,44,42,.08);cursor:pointer}
.suggest div:last-child{border-bottom:none}
.suggest div:hover{background:#FAECE7}
.suggest .kw{color:#D85A30}
.scen{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
.scen .s{border:1px solid rgba(44,44,42,.12);border-radius:10px;padding:10px;cursor:pointer}
.scen .s .t{font-size:13px;font-weight:500}
.scen .s .d{font-size:11px;color:#888780}
.sec-title{font-size:13px;color:#888780;margin:18px 0 8px}
.stage{display:flex;gap:10px;padding:9px 0;border-bottom:1px dashed rgba(44,44,42,.1)}
.stage:last-child{border-bottom:none}
.s-dot{width:18px;height:18px;border-radius:50%;flex-shrink:0;margin-top:3px;background:#E5E2DA}
.s-dot.done{background:#0F6E56}.s-dot.running{background:#D85A30;animation:pulse 1s infinite}.s-dot.failed{background:#A32D2D}
@keyframes pulse{50%{opacity:.45}}
.stage .s-name{font-size:14px;font-weight:500}.stage .s-note{font-size:12px;color:#888780;word-break:break-all}
.s-body{flex:1}
.understand{background:#EEEDFE;border-radius:10px;padding:10px 12px;font-size:13px;color:#3C3489;margin:10px 0}
.understand b{font-weight:500}
.result{border-radius:14px;padding:14px 16px;font-size:14px}
.result.ok{background:#E1F5EE;color:#04342C;border:1px solid #5DCAA5}
.result.err{background:#FCEBEB;color:#501313;border:1px solid #F09595}
.meta{font-size:12px;color:#888780;margin-top:8px}
.footer{text-align:center;margin-top:24px}
.footer a{color:#993C1D;font-size:13px;text-decoration:none}
`;

/* ---------------- 手机任务页 ---------------- */
const MOBILE_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>龙虾脑 · 一句话指挥你的 Mac</title><style>${CSS}</style></head><body><div class="wrap">
<div class="logo"><div class="dot">龙</div><h1>龙虾脑 LobsterBrain</h1></div>
<div class="slogan">说句话或打字，让 Mac 替你干活 · 支持语音输入</div>

<div class="card">
  <div class="input-row">
    <textarea id="input" placeholder="试试：搜索《流浪地球》预告片并播放 / 打开微信 / 截个屏"></textarea>
    <div class="mic" id="mic" onclick="toggleMic()" title="点击说话">🎤</div>
  </div>
  <div class="voice-hint" id="vhint"></div>
  <div class="suggest" id="suggest" style="display:none"></div>
  <button class="btn" id="go" onclick="submit()">立即执行</button>
</div>

<div class="sec-title">快捷场景</div>
<div class="scen">
  <div class="s" onclick="use('搜索《流浪地球》预告片并播放')"><div class="t">搜索并播放</div><div class="d">B站找预告片并播放</div></div>
  <div class="s" onclick="use('百度一下 Python 异步编程')"><div class="t">搜任意问题</div><div class="d">百度/Google/知乎</div></div>
  <div class="s" onclick="use('打开微信')"><div class="t">打开应用</div><div class="d">微信/终端/访达…</div></div>
  <div class="s" onclick="use('截个屏')"><div class="t">系统操作</div><div class="d">截图/音量/锁屏</div></div>
  <div class="s" onclick="use('把明天开会带电脑记到备忘录')"><div class="t">记备忘录</div><div class="d">说话即记录</div></div>
  <div class="s" onclick="use('帮我查一下奥本海默的评分')"><div class="t">查评分</div><div class="d">豆瓣评分</div></div>
</div>

<div id="run" style="display:none">
  <div class="sec-title">任务执行状态</div>
  <div class="card">
    <div style="font-size:14px;font-weight:500" id="echo"></div>
    <div id="understand"></div>
    <div id="stages"></div>
    <div class="meta" id="meta"></div>
  </div>
</div>

<div id="done" style="display:none">
  <div class="sec-title">执行结果</div>
  <div id="result"></div>
  <button class="btn ghost" onclick="reset()">再试一次</button>
</div>

<div class="sec-title">最近任务</div>
<div class="card" id="history"><div class="s-note">暂无任务</div></div>

<div class="footer"><a href="/dashboard" target="_blank">运营数据看板 →</a></div>
</div>
<script>
var cur=null,timer=null,hist=[];
try{hist=JSON.parse(localStorage.getItem('lb_hist')||'[]')}catch(e){}
var SUGGEST=[
 '搜索《流浪地球》预告片并播放','在B站搜沙丘2的花絮','帮我查一下奥本海默的评分',
 '百度一下 Python 异步编程','打开微信','打开下载文件夹','截个屏','音量调大一点',
 '把明天开会带电脑记到备忘录','锁屏','打开知乎','在GitHub搜 workbuddy','打开爱奇艺'
];
var rec=null;
function esc(s){return (s||'').replace(/</g,'&lt;')}
function use(v){var inp=document.getElementById('input');inp.value=v;inp.focus();onInput()}
function onInput(){
  var v=document.getElementById('input').value;
  var box=document.getElementById('suggest');
  if(!v.trim()){box.style.display='none';return}
  var lv=v.toLowerCase();
  var list=SUGGEST.filter(function(s){return s.indexOf(v)>=0||s.toLowerCase().indexOf(lv)>=0}).slice(0,4);
  if(!list.length){box.style.display='none';return}
  box.style.display='block';
  box.innerHTML=list.map(function(s){var i=s.toLowerCase().indexOf(lv);var h=i>=0?esc(s.slice(0,i))+'<span class="kw">'+esc(s.slice(i,i+v.length))+'</span>'+esc(s.slice(i+v.length)):esc(s);var ss=s.replace(/'/g,"\\\\'");return '<div onclick="use(\\''+ss+'\\')">'+h+'</div>'}).join('');
}
document.getElementById('input').addEventListener('input',onInput);
document.getElementById('input').addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.keyCode==13){e.preventDefault();submit()}});
function toggleMic(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  var hint=document.getElementById('vhint'),btn=document.getElementById('mic');
  // 检查安全上下文（HTTPS 或 localhost）——Web Speech API 必须在安全环境
  if(!window.isSecureContext){
    var httpsPort=Number(window.location.port||'8787')+1;
    var httpsUrl='https://'+window.location.hostname+':'+httpsPort;
    hint.innerHTML='<b>语音输入需要 HTTPS 安全环境</b><br>当前是 HTTP，浏览器禁止调用麦克风。<br>请用手机打开：<span style="color:#D85A30;font-weight:500">'+httpsUrl+'</span><br>首次打开点「高级 → 继续访问」信任证书即可。<br><span style="color:#888780">或直接点输入框，用键盘上的 🎤 语音输入（无需 HTTPS）</span>';
    return;
  }
  if(!SR){hint.textContent='当前浏览器不支持语音输入，请用 Safari 或 Chrome';return}
  if(rec){rec.stop();return}
  rec=new SR();rec.lang='zh-CN';rec.continuous=false;rec.interimResults=true;
  rec.onstart=function(){btn.classList.add('on');btn.textContent='●';hint.textContent='正在听…请说话'};
  rec.onresult=function(e){
    var interim='',final='';
    for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript}
    var hint=document.getElementById('vhint'),inp=document.getElementById('input');
    if(final){
      var raw=final.trim();
      hint.innerHTML='听到：<span style="color:#888780">'+esc(raw)+'</span> · 正在翻译为指令…';
      fetch('/api/normalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw})})
        .then(function(r){return r.json()})
        .then(function(d){
          inp.value=d.normalized;onInput();
          hint.innerHTML='语音：<span style="color:#888780">'+esc(raw)+'</span>  →  规范指令：<span style="color:#D85A30">'+esc(d.normalized)+'</span>';
          setTimeout(submit,500);
        })
        .catch(function(){inp.value=raw;onInput();hint.textContent='规范失败，已用原语音执行';setTimeout(submit,500)});
    }else{hint.innerHTML='识别中：<span style="color:#888780">'+esc(interim)+'</span>'}
  };
  rec.onerror=function(ev){
    var msg=ev.error||'未知';
    if(msg==='not-allowed'||msg==='service-not-allowed'){hint.innerHTML='⚠ 麦克风权限被拒绝。请在浏览器设置中允许此网站访问麦克风后重试。'}
    else if(msg==='network'){hint.textContent='语音识别网络错误，请检查网络后重试'}
    else if(msg==='no-speech'){hint.textContent='没听到你说什么，请再试一次'}
    else{hint.textContent='语音识别失败：'+msg}
  };
  rec.onend=function(){btn.classList.remove('on');btn.textContent='🎤';if(!hint.textContent.startsWith('识别')&&!hint.textContent.startsWith('⚠')&&!hint.innerHTML.startsWith('<b>'))hint.textContent='';rec=null};
  rec.start();
}
async function loadHistory(){
  var r=await fetch('/api/tasks');var list=(await r.json()).filter(function(t){return t.id!==cur}).slice(0,5);
  var all=hist.concat(list.map(function(t){return t.instruction})).filter(function(x,i,a){return a.indexOf(x)===i}).slice(0,5);
  document.getElementById('history').innerHTML=all.length?all.map(function(ins){var ss=ins.replace(/'/g,"\\\\'");return '<div class="stage" style="cursor:pointer" onclick="use(\\''+ss+'\\')"><div class="s-body"><div class="s-name" style="font-size:13px">'+esc(ins)+'</div><div class="s-note">点击重发</div></div></div>'}).join(''):'<div class="s-note">暂无任务</div>';
}
async function submit(){
  var v=document.getElementById('input').value.trim();
  if(!v){document.getElementById('input').focus();return}
  document.getElementById('go').disabled=true;
  hist=hist.filter(function(x){return x!==v});hist.unshift(v);hist=hist.slice(0,8);
  try{localStorage.setItem('lb_hist',JSON.stringify(hist))}catch(e){}
  var r=await fetch('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction:v})});
  cur=(await r.json()).id;
  document.getElementById('run').style.display='block';
  document.getElementById('echo').textContent='「'+v+'」';
  document.getElementById('understand').innerHTML='';
  document.getElementById('done').style.display='none';
  clearInterval(timer);timer=setInterval(poll,900);poll();
}
function reset(){clearInterval(timer);cur=null;document.getElementById('run').style.display='none';document.getElementById('done').style.display='none';document.getElementById('go').disabled=false;loadHistory()}
async function poll(){
  var r=await fetch('/api/task/'+cur);if(!r.ok)return;var t=await r.json();
  if(t.intent&&t.intent._desc&&t.stages[0].state==='done'){
    document.getElementById('understand').innerHTML='<div class="understand"><b>我理解你要：</b>'+esc(t.intent._desc)+'</div>';
  }
  document.getElementById('stages').innerHTML=t.stages.map(function(s){
    var d=s.state==='done'?'done':s.state==='running'?'running':s.state==='failed'?'failed':'';
    return '<div class="stage"><div class="s-dot '+d+'"></div><div class="s-body"><div class="s-name">'+s.name+'</div>'+(s.note?'<div class="s-note">'+esc(s.note)+'</div>':'')+'</div></div>'
  }).join('');
  if(t.status==='processing'){document.getElementById('meta').textContent='已进行 '+((Date.now()-t.createdAt)/1000).toFixed(1)+' 秒…';return}
  clearInterval(timer);
  document.getElementById('go').disabled=false;
  document.getElementById('meta').textContent='总耗时 '+((t.finishedAt-t.createdAt)/1000).toFixed(1)+' 秒';
  var box=document.getElementById('result');
  if(t.status==='success'){box.innerHTML='<div class="result ok"><b>任务完成</b><br>'+esc(t.result)+'</div><div class="meta">去旁边的 Mac 看看 — 任务已就位</div>'}
  else{box.innerHTML='<div class="result err"><b>任务失败</b><br>'+esc(t.error)+'</div><div class="meta">已记录到运营看板 · 常见原因：权限未授权、应用未安装</div>'}
  document.getElementById('done').style.display='block';
  loadHistory();
}
// 页面加载时检测语音可用性
(function(){
  var hint=document.getElementById('vhint'),mic=document.getElementById('mic');
  if(window.isSecureContext){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(SR){mic.style.borderColor='#D85A30';mic.style.color='#D85A30';hint.textContent='🎤 语音就绪，点击说话';}
    else{mic.style.opacity='.4';hint.textContent='当前浏览器不支持语音，请用 Safari 或 Chrome';}
  }else{
    var httpsPort=Number(window.location.port||'8787')+1;
    mic.style.opacity='.5';
    hint.innerHTML='<span style="color:#BA7517">⚠ 当前为 HTTP，语音不可用。</span> <span style="cursor:pointer;color:#D85A30;text-decoration:underline" onclick="location.href=\'https://'+window.location.hostname+':'+httpsPort+'\'">点此切换到 HTTPS 开启语音 →</span>';
  }
})();
loadHistory();
</script></body></html>`;

/* ---------------- 运营看板 ---------------- */
const DASH_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>龙虾脑 · 运营看板</title><style>${CSS}
.wrap{max-width:860px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.stat .num{font-size:26px;font-weight:500;color:#D85A30}.stat .lbl{font-size:12px;color:#888780}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-weight:500;color:#888780;text-align:left;padding:8px 6px;border-bottom:1px solid rgba(44,44,42,.12)}
td{padding:9px 6px;border-bottom:1px dashed rgba(44,44,42,.1);word-break:break-all;vertical-align:top}
.ok{color:#0F6E56}.err{color:#A32D2D}.run{color:#BA7517}
h2{font-size:15px;font-weight:500;margin:22px 0 10px}
</style></head><body><div class="wrap">
<div class="logo"><div class="dot">龙</div><h1>龙虾脑 · 运营数据看板</h1></div>
<div class="slogan">任务执行情况一览 · 每 5 秒自动刷新</div>
<div class="grid" id="stats"></div>
<h2>近 7 日任务量</h2><div class="card" id="chart"></div>
<h2>动作分布</h2><div class="card" id="actions"></div>
<h2>最近任务</h2><div class="card" style="overflow-x:auto"><table id="tbl">
<thead><tr><th>时间</th><th>指令</th><th>识别意图</th><th>平台</th><th>状态</th><th>耗时</th></tr></thead><tbody></tbody></table></div>
</div>
<script>
function esc(s){return (s||'').replace(/</g,'&lt;')}
var AL={search:'搜索',play:'播放',open:'打开',rating:'查评分',system:'系统操作',note:'记备忘录'};
var PL={baidu:'百度',google:'Google',bilibili:'B站',youku:'优酷',iqiyi:'爱奇艺',tencent:'腾讯视频',youtube:'YouTube',douban:'豆瓣',zhihu:'知乎',weibo:'微博',github:'GitHub',taobao:'淘宝',jd:'京东'};
async function refresh(){
  var list=(await (await fetch('/api/tasks')).json());
  var ok=list.filter(function(t){return t.status==='success'}).length;
  var fin=list.filter(function(t){return t.status!=='processing'});
  var avg=fin.length?(fin.reduce(function(a,t){return a+(t.finishedAt-t.createdAt)},0)/fin.length/1000).toFixed(1):'-';
  var today=new Date();today.setHours(0,0,0,0);
  var td=list.filter(function(t){return t.createdAt>=today.getTime()}).length;
  document.getElementById('stats').innerHTML=[
    ['累计任务 '+list.length+' 条',list.length],['成功率 '+Math.round(ok/list.length*100)+'%',Math.round(ok/list.length*100)+'%'],['平均完成 '+avg+' 秒',avg],['今日新增',td]
  ].map(function(s){return '<div class="card stat"><div class="num">'+s[1]+'</div><div class="lbl">'+s[0]+'</div></div>'}).join('');
  var days=[],labels=[];
  for(var i=6;i>=0;i--){var d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);
    var n=list.filter(function(t){return t.createdAt>=d.getTime()&&t.createdAt<d.getTime()+86400000}).length;
    days.push(n);labels.push((d.getMonth()+1)+'/'+d.getDate())}
  var max=Math.max.apply(null,days)||1,W=760,bw=60,gap=(W-7*bw)/8;
  document.getElementById('chart').innerHTML='<svg viewBox="0 0 760 150" width="100%">'+days.map(function(n,i){
    var h=n/max*90,x=gap+(bw+gap)*i,y=110-h;
    return '<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+h+'" rx="6" fill="'+(n?'#D85A30':'#E5E2DA')+'"/><text x="'+(x+bw/2)+'" y="'+(y-6)+'" text-anchor="middle" font-size="12" fill="#888780">'+(n||'')+'</text><text x="'+(x+bw/2)+'" y="132" text-anchor="middle" font-size="11" fill="#888780">'+labels[i]+'</text>'
  }).join('')+'</svg>';
  var acts={};list.forEach(function(t){var a=t.action||'other';acts[a]=(acts[a]||0)+1});
  var actArr=Object.keys(acts).sort(function(a,b){return acts[b]-acts[a]});
  document.getElementById('actions').innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap">'+actArr.map(function(a){
    var pct=Math.round(acts[a]/list.length*100);return '<div style="flex:1;min-width:110px"><div style="font-size:13px;color:#888780">'+(AL[a]||a)+'</div><div style="font-size:18px;font-weight:500;color:#D85A30">'+acts[a]+'</div><div style="height:6px;background:#F1EFE8;border-radius:3px;margin-top:4px"><div style="height:100%;width:'+pct+'%;background:#D85A30;border-radius:3px"></div></div></div>'
  }).join('')+'</div>';
  document.querySelector('#tbl tbody').innerHTML=list.slice(0,12).map(function(t){
    var st=t.status==='success'?'<span class="ok">成功</span>':t.status==='failed'?'<span class="err">失败</span>':'<span class="run">执行中</span>';
    var dur=t.finishedAt?((t.finishedAt-t.createdAt)/1000).toFixed(1)+'s':'—';
    var intent=t.intent&&t.intent._desc?t.intent._desc:(t.action?AL[t.action]:'—');
    return '<tr><td>'+new Date(t.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+'</td><td>'+esc(t.instruction)+(t.demo?' <span style="color:#888780;font-size:11px">(演示)</span>':'')+'</td><td>'+esc(intent)+'</td><td>'+(PL[t.platform]||'—')+'</td><td>'+st+'</td><td>'+dur+'</td></tr>'
  }).join('');
}
refresh();setInterval(refresh,5000);
</script></body></html>`;

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(MOBILE_PAGE); }
  if (req.method === 'GET' && url.pathname === '/dashboard') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(DASH_PAGE); }
  if (req.method === 'GET' && url.pathname === '/api/tasks') return res.end(JSON.stringify(tasks.slice().reverse()));
  let m;
  if (req.method === 'GET' && (m = url.pathname.match(/^\/api\/task\/([\w-]+)$/))) {
    const t = pick(m[1]);
    if (!t) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'task not found' })); }
    return res.end(JSON.stringify(t));
  }
  if (req.method === 'POST' && url.pathname === '/api/normalize') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body || '{}');
        const normalized = await normalizeInstruction(text);
        res.end(JSON.stringify({ raw: text, normalized }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad request' })); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/task') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const { instruction } = JSON.parse(body || '{}');
        const t = makeTask(instruction); tasks.push(t); save(); runTask(t);
        res.end(JSON.stringify({ id: t.id }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad request' })); }
    });
    return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
});

load();
const HTTP_PORT = PORT;
const HTTPS_PORT = Number(PORT) + 1;
server.listen(HTTP_PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  let lan = 'localhost';
  for (const k in ifaces) for (const i of ifaces[k]) if (i.family === 'IPv4' && !i.internal) lan = i.address;
  console.log('龙虾脑 v3 已启动');
  console.log('  手机端（文字输入）:  http://' + lan + ':' + HTTP_PORT);
  // 尝试启动 HTTPS（语音输入需要安全上下文）
  const certDir = path.join(__dirname, 'cert');
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile = path.join(certDir, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    try {
      const sslOpts = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
      https.createServer(sslOpts, server.listeners('request')[0]).listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log('  手机端（语音输入）:  https://' + lan + ':' + HTTPS_PORT + '  ⚠ 首次打开需点「高级→继续」信任证书');
        console.log('  本机 / 看板:         https://localhost:' + HTTPS_PORT + '/dashboard');
      });
    } catch (e) { console.log('  HTTPS 启动失败（不影响文字输入）:', e.message); }
  } else {
    console.log('  ⚠ 未找到 cert/ 证书，语音输入不可用。运行 openssl 生成证书后重启。');
  }
  console.log('  智能解析: ' + (process.env.LLM_API_KEY ? '大模型' : '增强规则引擎（可配 LLM_* 接真模型）'));
  console.log('  能力: search / play / open(应用/文件夹/网站) / rating / system(音量/截图/锁屏…) / note');
});
