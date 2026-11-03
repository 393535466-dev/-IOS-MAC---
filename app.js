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
const { execSync } = require('child_process');
const crypto = require('crypto');
// ---- 鼠标控制（手机触控板 → 远程控制 Mac 光标）----
const MOUSECTL = path.join(__dirname, 'bin', 'mousectl.py');
const MOUSE_SENS = 2.5; // 触控板灵敏度：手指滑动 1px → Mac 光标移动 2.5px
const mouseState = { x: 0, y: 0, w: 0, h: 0, ready: false };
function initMouse() {
  try {
    const p = execSync(`python3 "${MOUSECTL}" get`).toString().trim().split(/\s+/);
    const s = execSync(`python3 "${MOUSECTL}" screensize`).toString().trim().split(/\s+/);
    mouseState.x = parseInt(p[0]) || 0; mouseState.y = parseInt(p[1]) || 0;
    mouseState.w = parseInt(s[0]) || 1920; mouseState.h = parseInt(s[1]) || 1080;
    mouseState.ready = true;
    console.log(`[mouse] 初始光标 ${mouseState.x},${mouseState.y} 屏幕 ${mouseState.w}x${mouseState.h}`);
  } catch (e) { console.log('[mouse] 初始化失败:', e.message); }
}
initMouse();

const PORT = process.env.PORT || 8787;
const DATA_FILE = path.join(__dirname, 'tasks.json');
const HOT_MOVIES = ['哪吒之魔童闹海', '流浪地球', '唐探1900', '封神第二部', '沙丘2', '奥本海默', '碟中谍8', '雄狮少年2'];

/* ---------------- 字典：应用 / 文件夹 / 站点 ---------------- */
const APPS = {
  // 通讯
  '微信': 'WeChat', 'wechat': 'WeChat', 'qq': 'QQ', 'QQ': 'QQ',
  '企业微信': 'WeCom', '信息': 'Messages', '短信': 'Messages', 'iMessage': 'Messages',
  '钉钉': 'DingTalk', '飞书': 'Feishu', 'slack': 'Slack', 'telegram': 'Telegram', '电报': 'Telegram',
  'skype': 'Skype', 'discord': 'Discord', 'whatsapp': 'WhatsApp', 'line': 'LINE',
  // 浏览器
  'safari': 'Safari', '浏览器': 'Safari', 'chrome': 'Google Chrome', '谷歌浏览器': 'Google Chrome', 'google浏览器': 'Google Chrome', 'chrome浏览器': 'Google Chrome', '谷歌': 'Google Chrome',
  'firefox': 'Firefox', '火狐': 'Firefox', 'edge': 'Microsoft Edge', '微软edge': 'Microsoft Edge', '微软浏览器': 'Microsoft Edge',
  'arc': 'Arc', 'brave': 'Brave', 'opera': 'Opera',
  // 系统应用
  '邮件': 'Mail', '备忘录': 'Notes', '提醒事项': 'Reminders', '日历': 'Calendar', '地图': 'Maps',
  '计算器': 'Calculator', '预览': 'Preview', '文本编辑': 'TextEdit', '截图': 'Screenshot',
  '访达': 'Finder', 'finder': 'Finder', '终端': 'Terminal', 'terminal': 'Terminal',
  '照片': 'Photos', '图库': 'Photos', '音乐': 'Music', '播客': 'Podcasts', '图书': 'Books',
  '通讯录': 'Contacts', '联系人': 'Contacts', '语音备忘录': 'Voice Memos', '录音': 'Voice Memos',
  '便签': 'Stickies', '字体册': 'Font Book', '活动监视器': 'Activity Monitor',
  '磁盘工具': 'Disk Utility', '控制台': 'Console', '钥匙串': 'Keychain Access', '钥匙串访问': 'Keychain Access',
  '时间机器': 'Time Machine', 'facetime': 'FaceTime', 'faceTime': 'FaceTime', 'face time': 'FaceTime',
  // 办公 / 笔记
  'wps': 'WPS Office', 'word': 'Microsoft Word', 'excel': 'Microsoft Excel',
  'ppt': 'Microsoft PowerPoint', 'powerpoint': 'Microsoft PowerPoint', 'outlook': 'Microsoft Outlook',
  'onenote': 'OneNote', 'teams': 'Microsoft Teams', 'notion': 'Notion', 'obsidian': 'Obsidian', 'obsidian笔记': 'Obsidian',
  '印象笔记': 'Evernote', 'evernote': 'Evernote', '有道云笔记': 'YoudaoNote', '有道笔记': 'YoudaoNote',
  'typora': 'Typora', '熊掌记': 'Bear', 'bear': 'Bear', '为知笔记': 'WizNote',
  // 会议 / 协作
  '腾讯会议': 'TencentMeeting', 'zoom': 'Zoom', '腾讯会议国际版': 'VooV Meeting',
  // 开发
  'vscode': 'Visual Studio Code', '代码编辑器': 'Visual Studio Code', 'vs code': 'Visual Studio Code',
  'xcode': 'Xcode', 'android studio': 'Android Studio', 'idea': 'IntelliJ IDEA', 'pycharm': 'PyCharm',
  'webstorm': 'WebStorm', 'cursor': 'Cursor', 'iterm': 'iTerm', 'iTerm2': 'iTerm',
  'docker': 'Docker Desktop', 'postman': 'Postman', 'github desktop': 'GitHub Desktop', 'sourcetree': 'SourceTree',
  // 设计 / 剪辑
  'figma': 'Figma', 'sketch': 'Sketch', 'axure': 'Axure RP', '蓝湖': 'Lanhu', '墨刀': 'Modao', 'mastergo': 'MasterGo',
  '剪映': 'JianyingPro', 'capcut': 'CapCut', '达芬奇': 'DaVinci Resolve',
  'photoshop': 'Adobe Photoshop', 'illustrator': 'Adobe Illustrator',
  'premiere': 'Adobe Premiere Pro', 'after effects': 'Adobe After Effects', 'audition': 'Adobe Audition', 'xd': 'Adobe XD',
  // 影音 / 视频
  '网易云音乐': 'NeteaseMusic', 'spotify': 'Spotify', 'qq音乐': 'QQMusic', '喜马拉雅': 'Ximalaya',
  '抖音': 'Douyin', '快手': 'Kuaishou', '哔哩哔哩': 'bilibili', 'b站客户端': 'bilibili',
  '爱奇艺客户端': 'iQiYi', '优酷客户端': 'Youku', '腾讯视频客户端': 'TencentVideo',
  'iina': 'IINA', 'vlc': 'VLC',
  // 网盘 / 下载
  '百度网盘': 'BaiduNetdisk', '阿里云盘': 'AliyunDrive', '迅雷': 'Thunder', '迅雷下载': 'Thunder',
  'qbittorrent': 'qBittorrent', 'transmission': 'Transmission',
  // 词典 / 翻译 / 输入法
  '有道词典': 'Youdao', '欧路词典': 'Eudic', '欧路': 'Eudic', '金山词霸': 'PowerWord',
  '系统翻译': 'Translate', '翻译': 'Translate', '微信输入法': 'WeType', '搜狗输入法': 'Sogou', '百度输入法': 'BaiduInput',
  // 效率 / 清单
  '滴答清单': 'TickTick', 'ticktick': 'TickTick', 'things': 'Things', 'omnifocus': 'OmniFocus',
  // AI 助手
  '豆包': 'DoubaoWork', 'doubao': 'DoubaoWork', 'workbuddy': 'WorkBuddy', 'WorkBuddy': 'WorkBuddy',
  'kimi': 'Kimi', '元宝': 'Yuanbao', '通义千问': 'Tongyi', '文心一言': 'Wenxin', '智谱': 'ChatGLM', 'chatgpt': 'ChatGPT',
};
const FOLDERS = {
  '下载': '~/Downloads', '桌面': '~/Desktop', '文档': '~/Documents',
  '主目录': '~', '家目录': '~', '应用程序': '/Applications',
  '图片': '~/Pictures', '影片': '~/Movies', '音乐': '~/Music',
  '回收站': '~/.Trash', '废纸篓文件夹': '~/.Trash', '用户目录': '~',
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
const ACTION_LABEL = { search: '搜索', play: '播放', open: '打开', rating: '查评分', system: '系统操作', note: '记备忘录', type: '应用内输入' };

/* ---------------- 数据层 ---------------- */
let tasks = [];
function load() { try { tasks = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { seed(); save(); } }
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2)); }

/* ---------------- LLM 配置（文件持久化，网页可配） ---------------- */
const LLM_CFG_FILE = path.join(__dirname, 'llm-config.json');
const LLM_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek（推荐·国内直连·便宜）', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'kimi', name: 'Kimi / 月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-turbo' },
  { id: 'openai', name: 'OpenAI（需代理）', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'custom', name: '自定义（OpenAI 兼容）', baseUrl: '', model: '' },
];
function readLLMConfig() {
  try { return JSON.parse(fs.readFileSync(LLM_CFG_FILE, 'utf8')); }
  catch { return null; }
}
function writeLLMConfig(cfg) {
  fs.writeFileSync(LLM_CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
/* ---------------- 访问控制：局域网令牌（防止同 Wi-Fi 他人操控本机） ---------------- */
const AUTH_FILE = path.join(__dirname, 'auth.json');
let AUTH_TOKEN = '';
function loadAuth() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (j && j.token) { AUTH_TOKEN = j.token; return; }
  } catch (e) {}
  // 首次运行：生成随机令牌并持久化
  AUTH_TOKEN = crypto.randomBytes(12).toString('hex');
  try { fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: AUTH_TOKEN }, null, 2)); } catch (e) {}
}
function isLocalhost(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a === 'localhost';
}
function checkAuth(url, req) {
  if (isLocalhost(req)) return true; // 本机即本人，免令牌
  const t = url.searchParams.get('t') || (req.headers && req.headers['x-lb-token']) || '';
  return !!t && t === AUTH_TOKEN;
}
function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const k in ifaces) for (const i of ifaces[k]) if (i.family === 'IPv4' && !i.internal) return i.address;
  return 'localhost';
}
const HTTPS_PORT_OF = () => Number(PORT) + 1;

function llmConfig() {
  const cfg = readLLMConfig() || {};
  return {
    baseUrl: cfg.baseUrl || process.env.LLM_BASE_URL || '',
    apiKey: cfg.apiKey || process.env.LLM_API_KEY || '',
    model: cfg.model || process.env.LLM_MODEL || 'deepseek-chat',
    enabled: !!(cfg.apiKey || process.env.LLM_API_KEY),
  };
}

/* ---------------- 辅助功能权限检测（type 自动输入需要） ---------------- */
async function checkAccessibility() {
  try {
    // 用一个需要辅助功能权限的无害操作来探测——获取前台进程属性
    await sh(`osascript -e 'tell application "System Events" to get name of process 1 whose frontmost is true' 2>&1`);
    // 检查输出是否包含权限错误
    const r2 = await sh(`osascript -e 'tell application "System Events" to keystroke ""' 2>&1`);
    return !r2.includes('not allowed') && !r2.includes('-10004') && !r2.includes('-1743');
  } catch { return false; }
}
async function openAccessibilityPrefs() {
  try { await sh(`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"`); } catch {}
}
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
  // 按 key 长度从长到短匹配，避免短词(如"浏览器")抢先匹配长词(如"谷歌浏览器")
  const keys = Object.keys(APPS).sort((a, b) => b.length - a.length);
  for (const cn of keys) if (lower.includes(cn.toLowerCase())) return { name: cn, key: APPS[cn] };
  return null;
}
// 把 LLM / 用户输入的中文或各种写法统一映射成系统能识别的应用名（如 微信→WeChat、备忘录→Notes）
function resolveApp(name) {
  if (!name) return name;
  if (APPS[name]) return APPS[name];
  const low = String(name).toLowerCase();
  if (APPS[low]) return APPS[low];
  return name;
}
function detectFolder(text) {
  for (const f in FOLDERS) if (text.includes(f)) return { name: f, path: FOLDERS[f] };
  return null;
}
function detectSystem(text) {
  if (/静音|mute|静音模式/.test(text)) return { sub: 'mute' };
  if (/音量.*调大|调大.*音量|音量.*大|声音.*大|调大声音|大声|声音大一点|音量加大|音量升高|调高音量|把声音调大|音量拉高|音量调到最大|音量最大|最大音量/.test(text)) return { sub: 'volume_up' };
  if (/音量.*调小|调小.*音量|音量.*小|声音.*小|调小声音|小声|声音小一点|音量减小|音量降低|调低音量|把声音调小|音量拉低|音量调到最小|音量最小|最小音量/.test(text)) return { sub: 'volume_down' };
  if (/亮度|调亮|调暗|屏幕亮度|亮度调高|亮度调低|把亮度/.test(text)) return { sub: 'brightness' };
  if (/截图|截屏|截个屏|screen ?shot|拍个照|截一张|抓屏|截图一下|截屏一下/i.test(text)) return { sub: 'screenshot' };
  if (/锁屏|锁定屏幕|锁电脑|锁住屏幕|锁定/.test(text)) return { sub: 'lock' };
  if (/清空废纸篓|清废纸篓|清空垃圾|清垃圾|empty.*trash/.test(text)) return { sub: 'trash' };
  if (/系统设置|打开设置|系统偏好|偏好设置|设置/.test(text)) return { sub: 'settings' };
  return null;
}
function extractQuoted(text) {
  let m = text.match(/《(.+?)》/);
  if (m) return m[1];
  m = text.match(/["“”‘’](.+?)["“”‘’]/);
  if (m) return m[1];
  return null;
}
const STOP_PHRASES = ['帮我','请','一下','搜索','搜','查找','找','查','播放','看','放','观看','听一下','听歌','并','的','百度','google','谷歌','b站','哔哩','bilibili','优酷','爱奇艺','腾讯视频','腾讯','youtube','油管','豆瓣','知乎','微博','github','淘宝','京东','相关','视频','电影','一部','最近','热门','随便','来一部','啥','什么','打开','启动','唤起','进','首页','网站','官网','记到备忘录','记到','备忘录','便签','记一下','提醒我','音量','声音','调大','调小','静音','亮度','截图','截屏','截个屏','锁屏','清空废纸篓','废纸篓','系统设置','设置','预告片','预告','正片','完整版','全片','花絮','幕后','彩蛋','解说','影评','trailer','teaser','用','在','上','去','个','下','我想要','我想','我要','麻烦你','麻烦','可以吗','能不能','能否','顺便','想要','希望','需要','请问','帮忙','帮忙把','去查','来看','看看','瞧瞧','整一个','来一个','搞一个','弄一个','帮我把','请帮','一个','一些','那个','这个','它','内容','东西','关于','话题','如何','怎么','怎样','使','到','让','给'];
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

  // 0. 复合指令：打开XX——输入YY / 打开XX然后输入YY / 打开XX，输入YY
  {
    const parts = raw.split(/——|—|--|然后|之后|接着|并且|以及|，再|，然后|,再|顺便|顺手/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const openPart = parts.find(p => /打开|启动|唤起/.test(p));
      const inputPart = parts.find(p => /^(输入|写|发送|打)/.test(p) && p !== openPart);
      if (openPart && inputPart) {
        const am = openPart.match(/(?:打开|启动|唤起)(.+)/);
        const tm = inputPart.match(/(?:输入|写|发送|打)(.*)/);
        if (am && tm) {
          const appName = am[1].trim();
          const textToType = tm[1].trim().replace(/[。！？，\s]+$/g, '');
          const app = detectApp(appName);
          if (app && textToType) {
            return { action: 'type', target: textToType, app: app.key, appName: app.name, platform: null, contentType: null, raw, source: 'rule' };
          }
        }
      }
    }
  }

  // 0.5 发消息给指定联系人：发微信给X：Y / 给X发微信：Y / 用微信给X发：Y / 通知X：Y / 告诉X：Y
  {
    const isSMS = /短信|iMessage|信息/.test(raw);
    const appKey = isSMS ? 'Messages' : 'WeChat';
    const appName = isSMS ? '信息' : '微信';
    let contact = null, msg = null;
    const VERB = '(?:微信|消息|短信|信息|通知|告诉)';
    const m1 = raw.match(new RegExp('发' + VERB + '?给(.+?)[：:：](.+)'));
    const m2 = raw.match(new RegExp('给(.+?)发' + VERB + '[:：](.+)'));
    const m3 = raw.match(/用微信给(.+?)发[:：](.+)/);
    const m4 = raw.match(new RegExp('(?:通知|告诉)(.+?)[：:：](.+)'));
    if (m1) { contact = m1[1].trim(); msg = m1[2].trim(); }
    else if (m2) { contact = m2[1].trim(); msg = m2[2].trim(); }
    else if (m3) { contact = m3[1].trim(); msg = m3[2].trim(); }
    else if (m4) { contact = m4[1].trim(); msg = m4[2].trim(); }
    if (contact && msg) {
      return { action: 'send_msg', target: msg, app: appKey, appName, contact, raw, source: 'rule' };
    }
  }

  // 1. 系统操作
  const sys = detectSystem(raw);
  if (sys) return { action: 'system', sub: sys.sub, target: null, platform: null, contentType: null, raw, source: 'rule' };

  // 2. 在应用里输入/写/打文字（优先于备忘录，避免"在备忘录里写..."被备忘录截获）
  {
    let s2 = raw.replace(/^(帮我|请|麻烦|给我)\s*/, '');
    // 模式A：在/用 [应用] 里/中 输入/写/发送 [文字]
    let tm = s2.match(/(?:在|用)?(.+?)[里中](输入|打字|写|发送|打(?!开))(.+)/);
    // 模式B：用 [应用] 发送/输入 [文字]（无"里/中"）
    if (!tm) tm = s2.match(/用(.+?)(发送|输入)(.+)/);
    if (tm) {
      const appRaw = tm[1].trim();
      const textToType = tm[3].trim().replace(/[。！？，\s]+$/g, '');
      const app = detectApp(appRaw);
      if (app && textToType) {
        return { action: 'type', target: textToType, app: app.key, appName: app.name, platform: null, contentType: null, raw, source: 'rule' };
      }
      if (appRaw.length >= 1 && appRaw.length <= 10 && textToType) {
        return { action: 'type', target: textToType, app: appRaw, appName: appRaw, platform: null, contentType: null, raw, source: 'rule' };
      }
    }
    // 模式C：单独"输入/写[文字]"（无应用上下文→输入到当前前台应用）
    {
      let sm = s2.match(/^(输入|写)(.+)/);
      if (sm && !/搜索|搜|百度|google/.test(s2)) {
        const textToType = sm[2].trim().replace(/[。！？，\s]+$/g, '');
        if (textToType && textToType.length >= 1) {
          return { action: 'type', target: textToType, app: null, appName: '当前应用', platform: null, contentType: null, raw, source: 'rule' };
        }
      }
    }
  }

  // 3. 记备忘录
  if (/备忘录|记一下|便签|记到|提醒我/.test(raw)) {
    let body = extractQuoted(raw) || raw.replace(/帮我|请|把|记到备忘录|记到备忘录里|记一下|记到|备忘录|便签|提醒我/g, '').trim();
    return { action: 'note', target: body, platform: null, contentType: null, raw, source: 'rule' };
  }

  // 3. 打开类（含「搜索 / 查」等自然语言说法；若同时含「播放/看/评分」则交给对应分支）
  if (/打开|启动|唤起|进.*首页|打开.*网站|搜索|搜一下|搜搜|检索|查询|查找/.test(raw) && !/播放|看|放|观看|听歌|听一下|评分|打分|评价|几分|豆瓣/.test(raw)) {
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
    // 含「搜索 / 查」但没识别到具体平台 → 默认用百度搜索
    if (/搜索|搜一下|搜搜|检索|查询|查找/.test(raw)) {
      const kw = extractKeyword(raw);
      if (kw) return { action: 'search', target: kw, platform: 'baidu', contentType: null, raw, source: 'rule' };
    }
    // 兜底：尝试当应用名（低置信，交给 LLM 更准）
    const kw = extractKeyword(raw);
    if (kw) return { action: 'open', sub: 'open_app', target: kw, app: kw, platform: null, contentType: null, raw, source: 'rule', lowConfidence: true };
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
  const cfg = llmConfig();
  if (!cfg.enabled) return null;
  try {
    const r = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model, temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '你是龙虾脑的指令解析器。把用户自然语言解析为JSON：{action,target,platform,contentType,sub,app,appName,contact}。\naction取值：search(搜索)/play(播放视频)/open(打开)/rating(查评分)/system(系统操作)/note(记备忘录)/type(在应用里输入文字)/send_msg(给指定联系人发消息)。\ntarget是主要对象(影片名/关键词/应用名/要记的内容/要输入的文字/要发送的消息正文)或null。\nplatform取值baidu/google/bilibili/youku/iqiyi/tencent/youtube/douban/zhihu/weibo/github/taobao/jd或null，搜索默认baidu，播放默认bilibili，查评分默认douban。\ncontentType取值预告片/正片/花絮/解说或null。\nsub在action=open时为open_app/open_folder/open_site/open_url，action=system时为volume_up/volume_down/mute/brightness/screenshot/lock/trash/settings。\napp/appName在action=open/open_app/type/send_msg时指定目标应用名(如"浏览器"→Safari、"谷歌浏览器/Chrome"→Google Chrome、"微信"→WeChat、"WorkBuddy"、"豆包"→DoubaoWork、"备忘录"→Notes、"终端"→Terminal)，无指定应用时app=null；send_msg时默认app="微信"。打开浏览器类：默认浏览器=Safari，谷歌浏览器/Chrome=Google Chrome。\ncontact仅在action=send_msg时使用，为收信人姓名(如"张三")。\n复合指令如"打开微信然后输入你好"解析为type动作，app="微信",target="你好"。\n发消息给联系人如"发微信给张三：晚点到"解析为send_msg，contact="张三",target="晚点到",app="微信"。\n只输出JSON，不要解释。' },
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
  // 先跑规则引擎：打开/系统/输入/发消息等明确指令秒级响应，避免每条都等待 LLM（既慢又易翻译错）
  const rule = localParse(raw);
  if (rule && !rule.lowConfidence) { rule.source = 'rule'; return rule; }
  // 规则拿不准 → 才交给 LLM 解析
  const llm = await callLLM(raw);
  if (llm && llm.action) { llm.raw = raw; llm.source = 'llm'; return llm; }
  // LLM 也失败 → 退回规则（哪怕低置信）
  return rule || localParse(raw);
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
    case 'send_msg': return '发' + (it.appName || '微信') + '给「' + (it.contact || '') + '」：「' + (it.target || '') + '」';
    case 'type': return '在「' + (it.appName || it.app || '') + '」里输入：「' + (it.target || '') + '」';
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
  const cfg = llmConfig();
  if (cfg.enabled) {
    try {
      const r = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({
          model: cfg.model, temperature: 0.2,
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
    case 'type': return `open -a "${it.app}" → 等待 1.5s → pbcopy 写入剪贴板 → osascript 模拟 Cmd+V 粘贴`;
    case 'send_msg': return `open -a "${it.app || 'WeChat'}" → Cmd+F 搜「${it.contact}」→ 回车进会话 → 粘贴消息 → 回车发送`;
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
      } else if (it.action === 'type') {
        const textToType = String(it.target || '');
        const appName = it.appName || it.app || '当前应用';
        // 1. 打开应用（如果有指定）
        if (it.app) {
          const realName = resolveApp(it.app);
          await sh(`open -a "${realName}"`);
          // 留足启动时间（Electron/聊天类应用冷启动较慢）
          await sleep(2000);
          // 强制激活到前台，确保焦点落在应用窗口（输入框）上
          try { await sh(`osascript -e 'tell application "${realName}" to activate'`); } catch (e) {}
          await sleep(400);
        } else {
          await sleep(300);
        }
        // 2. 检测辅助功能权限
        const hasPermission = await checkAccessibility();
        if (!hasPermission) {
          // 自动打开设置页引导授权
          await openAccessibilityPrefs();
          // 同时把文字写入剪贴板作为降级
          const tmp = path.join(os.tmpdir(), 'lb_type_' + Date.now() + '.txt');
          fs.writeFileSync(tmp, textToType, 'utf8');
          await sh(`pbcopy < "${tmp}"`); fs.unlinkSync(tmp);
          execNote = result = '检测到辅助功能未授权，已自动打开系统设置。请在「隐私与安全 → 辅助功能」中添加并开启当前终端，然后重新执行此指令即可自动输入。文字已暂存剪贴板，你也可以先手动按 Cmd+V。';
          t.needPermission = true;  // 标记需要权限，前端可展示引导
        } else {
          // 3. 有权限：用 AppleScript 直接输入文字（不污染剪贴板）
          // 转义 AppleScript 字符串中的特殊字符
          const escaped = textToType.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          try {
            // 先用 clipboard 设置内容，再 keystroke "v" —— 比 keystroke 文字更可靠（支持中文）
            const script = `osascript -e 'set the clipboard to "${escaped}"' -e 'tell application "System Events" to keystroke "v" using command down'`;
            await sh(script);
            execNote = result = '已在「' + appName + '」中自动输入：「' + textToType + '」';
          } catch (e) {
            // 降级：写文件到剪贴板 + 粘贴
            const tmp = path.join(os.tmpdir(), 'lb_type_' + Date.now() + '.txt');
            fs.writeFileSync(tmp, textToType, 'utf8');
            await sh(`pbcopy < "${tmp}"`); fs.unlinkSync(tmp);
            try {
              await sh(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
              execNote = result = '已在「' + appName + '」中自动输入：「' + textToType + '」';
            } catch (e2) {
              execNote = result = '输入失败：' + (e2.message || '未知错误') + '。文字已复制到剪贴板，请手动按 Cmd+V';
            }
          }
        }
      } else if (it.action === 'send_msg') {
        const appKey = it.app || 'WeChat';
        const realName = resolveApp(appKey);
        const contact = String(it.contact || '');
        const msg = String(it.target || '');
        await sh(`open -a "${realName}"`);
        await sleep(2000);
        try { await sh(`osascript -e 'tell application "${realName}" to activate'`); } catch (e) {}
        await sleep(500);
        const hasPermission = await checkAccessibility();
        if (!hasPermission) {
          await openAccessibilityPrefs();
          execNote = result = '检测到辅助功能未授权，已自动打开系统设置。授权后重新执行即可自动发送。';
          t.needPermission = true;
        } else {
          // 1) 聚焦搜索（WeChat Mac: Cmd+F；信息 App 同样适用）
          await sh(`osascript -e 'tell application "System Events" to keystroke "f" using command down'`);
          await sleep(700);
          // 2) 粘贴联系人名并回车打开首个匹配会话
          const cEsc = contact.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          await sh(`osascript -e 'set the clipboard to "${cEsc}"' -e 'tell application "System Events" to keystroke "v" using command down'`);
          await sleep(1000);
          await sh(`osascript -e 'tell application "System Events" to key code 36'`);
          await sleep(1200);
          // 3) 粘贴消息并发送（回车）
          const mEsc = msg.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          await sh(`osascript -e 'set the clipboard to "${mEsc}"' -e 'tell application "System Events" to keystroke "v" using command down'`);
          await sleep(500);
          await sh(`osascript -e 'tell application "System Events" to key code 36'`);
          execNote = result = `已向「${contact}」发送${it.appName || '微信'}：「${msg}」`;
        }
      } else if (it.action === 'open') {
        if (it.sub === 'open_app') { await sh(`open -a "${resolveApp(it.app)}"`); execNote = result = '已打开应用：' + it.target; }
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
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>龙虾脑</title><style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#fff;--fg:#1A1A1A;--muted:#888;--line:#E5E5E5;--card:#F7F7F7;--accent:#1A1A1A}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.main{flex:1;overflow-y:auto;padding:214px 18px 10px;display:flex;flex-direction:column;-webkit-overflow-scrolling:touch}
.voice-area{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 0 16px}
.mic-btn{width:80px;height:80px;border-radius:50%;border:none;background:var(--accent);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.15);transition:transform .15s;position:relative;-webkit-user-select:none;user-select:none}
.mic-btn svg{width:30px;height:30px;fill:#fff}
.mic-btn.recording{transform:scale(1.1);box-shadow:0 4px 24px rgba(0,0,0,.25)}
.mic-btn.recording::before{content:'';position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(0,0,0,.2);animation:ripple 1.2s infinite}
.mic-btn.disabled{background:#CCC;box-shadow:none;cursor:default}
@keyframes ripple{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.5);opacity:0}}
.mic-label{margin-top:12px;font-size:13px;color:var(--muted);text-align:center;min-height:20px}
.mic-label.recording{color:var(--fg);font-weight:500}
.mic-hint{margin-top:3px;font-size:11px;color:#BBB;text-align:center;max-width:260px;line-height:1.5}
.mic-hint a{color:var(--fg);text-decoration:underline;cursor:pointer;font-weight:500}
.status-area{margin-top:4px}
.task-card{background:var(--card);border-radius:12px;padding:14px;margin-bottom:8px}
.task-card .echo{font-size:14px;font-weight:500;color:var(--fg);margin-bottom:6px}
.understand{background:#EEE;border-radius:8px;padding:8px 12px;font-size:12px;color:#555;margin:6px 0}
.understand b{font-weight:600;color:var(--fg)}
.stage-row{display:flex;align-items:flex-start;gap:8px;padding:5px 0}
.stage-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:3px;background:#DDD;transition:background .3s}
.stage-dot.done{background:#555}.stage-dot.running{background:var(--fg);animation:pulse 1s infinite}.stage-dot.failed{background:#999}
@keyframes pulse{50%{opacity:.4}}
.stage-body{flex:1}
.stage-name{font-size:13px;font-weight:500;color:var(--fg)}
.stage-note{font-size:11px;color:var(--muted);word-break:break-all;margin-top:1px}
.result-box{border-radius:12px;padding:12px 14px;font-size:13px;margin-top:6px}
.result-box.ok{background:var(--card);color:var(--fg);border:1px solid var(--line)}
.result-box.err{background:var(--card);color:#666;border:1px solid var(--line)}
.result-meta{font-size:11px;color:#BBB;margin-top:4px}
.perm-alert{background:#F4F4F4;border:1.5px solid #555;border-radius:10px;padding:11px 13px;font-size:12.5px;color:#222;margin-top:8px;line-height:1.55}
.perm-alert .at{font-weight:700;color:#000}
.perm-alert .row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.mini-btn{display:inline-block;padding:8px 13px;border-radius:18px;border:1px solid #555;background:#fff;color:#222;font-size:12px;font-family:inherit;cursor:pointer;text-decoration:none;transition:all .12s}
.mini-btn:active{background:#555;color:#fff}
.mini-btn.ghost{background:transparent}
.task-time{font-size:11px;color:#CCC;margin-top:4px}
.bottom-bar{flex-shrink:0;background:var(--bg);border-top:1px solid var(--line);padding:8px 14px calc(10px + env(safe-area-inset-bottom) + 52px)}
.chips{display:flex;gap:6px;overflow-x:auto;margin-bottom:8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;padding:5px 12px;border:1px solid var(--line);border-radius:14px;background:var(--bg);color:#555;font-size:12px;font-family:inherit;cursor:pointer;transition:all .12s}
.chip:active{background:var(--accent);color:#fff;border-color:var(--accent)}
.input-bar{display:flex;gap:8px;align-items:center}
.input-bar input{flex:1;border:1px solid var(--line);border-radius:20px;padding:10px 14px;font-size:15px;font-family:inherit;outline:none;background:var(--card);transition:border-color .15s}
.input-bar input:focus{border-color:var(--fg);background:var(--bg)}
.send-btn{width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:#fff;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:opacity .15s}
.send-btn:active{opacity:.7}
.send-btn svg{width:18px;height:18px;fill:#fff}
.dash-fab{position:absolute;top:8px;right:14px;font-size:11px;color:#999;text-decoration:none;padding:3px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.9);z-index:51}
.cfg-fab{position:absolute;top:8px;right:62px;font-size:11px;color:#999;text-decoration:none;padding:3px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.9);z-index:51}
.topbar{position:fixed;top:0;left:0;right:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 14px;box-sizing:border-box;margin:0}
.trackpad-title{font-size:12px;color:#888;margin-bottom:8px;text-align:center}
.trackpad{position:relative;width:100%;height:160px;background:#EDEDED;border-radius:10px;overflow:hidden;touch-action:none}
.trackpad-hint{position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);text-align:center;color:#aaa;font-size:12px;pointer-events:none}
</style></head><body>
<div class="topbar" id="topbar">
  <div class="trackpad-title">🖱 鼠标控制（触控板）</div>
  <a href="/config" class="cfg-fab" target="_blank">配置</a>
  <a href="/dashboard" class="dash-fab" target="_blank">看板</a>
  <div class="trackpad" id="trackpad">
    <div class="trackpad-hint">手指滑动移动光标 · 轻点=点击</div>
  </div>
</div>
<div class="main" id="main">
  <div class="voice-area">
    <button class="mic-btn" id="mic" type="button">
      <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.79-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-.98 1.14C5.66 15.22 8.03 17.5 11 17.92V20H8c-.55 0-1 .45-1 1s.45 1 1 1h8c.55 0 1-.45 1-1s-.45-1-1-1h-3v-2.08c2.97-.42 5.34-2.7 5.89-5.78.11-.6-.37-1.14-.98-1.14z"/></svg>
    </button>
    <div class="mic-label" id="micLabel">按住说话</div>
    <div class="mic-hint" id="micHint"></div>
  </div>
  <div class="status-area" id="statusArea"></div>
</div>

<div id="lock" style="display:none;position:fixed;inset:0;background:rgba(255,255,255,.97);z-index:100;flex-direction:column;align-items:center;justify-content:center;padding:24px">
  <div style="font-size:16px;font-weight:600;margin-bottom:6px">需要访问令牌</div>
  <div style="font-size:13px;color:#888;margin-bottom:18px;text-align:center;line-height:1.6">龙虾脑已开启局域网保护。<br>请在 Mac 本机「配置」页复制手机链接，或输入令牌。</div>
  <input id="lockPwd" type="password" placeholder="访问令牌" style="width:100%;max-width:300px;border:1px solid #DDD;border-radius:10px;padding:12px;font-size:15px;outline:none;text-align:center" onkeydown="if(event.key==='Enter')doUnlock()">
  <button onclick="doUnlock()" style="margin-top:12px;width:100%;max-width:300px;padding:12px;border:none;border-radius:10px;background:#1A1A1A;color:#fff;font-size:15px;cursor:pointer">解锁</button>
</div>
<div class="bottom-bar">
  <div class="chips">
    <button class="chip" onclick="quickSend('打开微信')">打开微信</button>
    <button class="chip" onclick="quickSend('截个屏')">截个屏</button>
    <button class="chip" onclick="quickSend('锁屏')">锁屏</button>
    <button class="chip" onclick="quickSend('发微信给张三：晚点到')">发微信给张三</button>
    <button class="chip" onclick="quickSend('打开微信——输入你好')">微信输入你好</button>
    <button class="chip" onclick="quickSend('搜索《流浪地球》预告片并播放')">搜电影</button>
  </div>
  <div class="input-bar">
    <input type="text" id="input" placeholder="输入指令，或按住上方麦克风说话…" autocomplete="off" enterkeyhint="send">
    <button class="send-btn" id="send" onclick="submit()" type="button">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
  </div>
</div>

<script>
var LB_TOKEN = new URLSearchParams(location.search).get('t') || (function(){try{return localStorage.getItem('lb_token');}catch(e){return'';}})() || '';
if (LB_TOKEN) { try { localStorage.setItem('lb_token', LB_TOKEN); } catch(e){} }
['cfg-fab','dash-fab'].forEach(function(id){var a=document.getElementById(id);if(a&&LB_TOKEN){var h=a.getAttribute('href').split('?')[0];a.href=h+'?t='+encodeURIComponent(LB_TOKEN);}});
function lbFetch(p, o){ o=o||{}; o.headers=Object.assign({'Content-Type':'application/json'}, o.headers||{}); if(LB_TOKEN) o.headers['x-lb-token']=LB_TOKEN; return fetch(p,o).then(function(r){ if(r.status===401) showLock(); return r; }); }
function showLock(){ var el=document.getElementById('lock'); if(el) el.style.display='flex'; }
function doUnlock(){ var e=document.getElementById('lockPwd'); var v=e?e.value.trim():''; if(!v) return; LB_TOKEN=v; try{localStorage.setItem('lb_token',v);}catch(e){} location.search='?t='+encodeURIComponent(v); }
var cur=null,timer=null;
var rec=null,recognizing=false,voiceReady=false;
function esc(s){return (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

/* ---- 语音输入：按住说话，松开转文字 ---- */
function initVoice(){
  var btn=document.getElementById('mic'),label=document.getElementById('micLabel'),hint=document.getElementById('micHint');
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!window.isSecureContext){
    var hp=Number(window.location.port||'8787')+1;
    var url='https://'+window.location.hostname+':'+hp;
    btn.classList.add('disabled');
    label.textContent='语音不可用';
    hint.innerHTML='需 HTTPS 才能用语音<br><a href="'+url+'">点此切换 →</a><br><span style="color:#CCC">或用键盘语音输入</span>';
    return;
  }
  if(!SR){
    btn.classList.add('disabled');
    label.textContent='浏览器不支持';
    hint.textContent='请用 Safari 或 Chrome';
    return;
  }
  voiceReady=true;
  label.textContent='按住说话';

  function startRec(){
    if(!voiceReady||recognizing)return;
    try{
      rec=new SR();rec.lang='zh-CN';rec.continuous=false;rec.interimResults=true;
      rec.onstart=function(){recognizing=true;btn.classList.add('recording');label.classList.add('recording');label.textContent='正在听…'};
      rec.onresult=function(e){
        var interim='',final='';
        for(var i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)final+=e.results[i][0].transcript;else interim+=e.results[i][0].transcript}
        if(final){
          var raw=final.trim();
          label.innerHTML='正在翻译…';
          lbFetch('/api/normalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw})})
            .then(function(r){return r.json()})
            .then(function(d){
              document.getElementById('input').value=d.normalized;
              label.innerHTML='已输入：'+esc(d.normalized);
              setTimeout(submit,300);
            })
            .catch(function(){
              document.getElementById('input').value=raw;
              label.textContent='已输入';
              setTimeout(submit,300);
            });
        }else{label.innerHTML='识别中：'+esc(interim)}
      };
      rec.onerror=function(ev){
        var m=ev.error||'';
        if(m==='not-allowed'||m==='service-not-allowed'){label.innerHTML='麦克风权限被拒<br>请在设置中允许';}
        else if(m==='no-speech'){label.textContent='没听到，再试一次';}
        else{label.textContent='语音错误：'+m;}
      };
      rec.onend=function(){
        recognizing=false;btn.classList.remove('recording');label.classList.remove('recording');
        if(label.textContent.indexOf('已输入')<0&&label.textContent.indexOf('翻译')<0){label.textContent='按住说话';}
        rec=null;
      };
      rec.start();
    }catch(e){label.textContent='启动失败';}
  }
  function stopRec(){if(rec&&recognizing){try{rec.stop()}catch(e){}}}

  // 触摸事件（手机）
  btn.addEventListener('touchstart',function(e){e.preventDefault();startRec()},{passive:false});
  btn.addEventListener('touchend',function(e){e.preventDefault();stopRec()},{passive:false});
  btn.addEventListener('touchcancel',function(e){stopRec()});
  // 鼠标事件（桌面测试）
  btn.addEventListener('mousedown',function(e){e.preventDefault();startRec()});
  btn.addEventListener('mouseup',function(e){e.preventDefault();stopRec()});
  btn.addEventListener('mouseleave',function(){stopRec()});
}

/* ---- 快捷指令 ---- */
function quickSend(v){
  var inp=document.getElementById('input');
  inp.value=v;
  submit();
}

/* ---- 提交任务 ---- */
async function submit(){
  var v=document.getElementById('input').value.trim();
  if(!v){document.getElementById('input').focus();return}
  document.getElementById('input').value='';
  document.getElementById('send').style.opacity='.5';
  try{
    var r=await lbFetch('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction:v})});
    cur=(await r.json()).id;
    var sa=document.getElementById('statusArea');
    sa.innerHTML='<div class="task-card"><div class="echo">「'+esc(v)+'」</div><div id="understand"></div><div id="stages"></div><div class="task-time" id="meta"></div></div><div id="resultBox"></div>';
    clearInterval(timer);timer=setInterval(poll,900);poll();
  }catch(e){
    document.getElementById('statusArea').innerHTML='<div class="task-card"><div class="result-box err">网络错误：'+esc(e.message)+'</div></div>';
  }
  document.getElementById('send').style.opacity='1';
}

/* ---- 轮询任务状态 ---- */
async function poll(){
  if(!cur)return;
  var r=await lbFetch('/api/task/'+cur);if(!r.ok)return;var t=await r.json();
  var u=document.getElementById('understand');
  if(t.intent&&t.intent._desc&&t.stages[0].state==='done'){
    u.innerHTML='<div class="understand"><b>我理解：</b>'+esc(t.intent._desc)+'</div>';
  }
  document.getElementById('stages').innerHTML=t.stages.map(function(s){
    var d=s.state==='done'?'done':s.state==='running'?'running':s.state==='failed'?'failed':'';
    return '<div class="stage-row"><div class="stage-dot '+d+'"></div><div class="stage-body"><div class="stage-name">'+s.name+'</div>'+(s.note?'<div class="stage-note">'+esc(s.note)+'</div>':'')+'</div></div>';
  }).join('');
  if(t.status==='processing'){document.getElementById('meta').textContent='已进行 '+((Date.now()-t.createdAt)/1000).toFixed(1)+' 秒…';return}
  clearInterval(timer);cur=null;
  document.getElementById('meta').textContent='总耗时 '+((t.finishedAt-t.createdAt)/1000).toFixed(1)+' 秒';
  var rb=document.getElementById('resultBox');
  if(t.status==='success'){
    var permHint='';
    if(t.needPermission){
      var permProgTxt = _proc ? ('请授权运行本服务的程序：<b>'+esc(_proc)+'</b>。') : '请授权运行本服务的程序（终端 / VS Code / WorkBuddy 等）。';
      permHint='<div class="perm-alert"><span class="at">⚠️ 自动输入需要「辅助功能」权限，当前未授权。</span><br>文字已暂存剪贴板，你也可先手动按 Cmd+V 粘贴。<br>'+permProgTxt+'<div class="row"><a href="/config" target="_blank" class="mini-btn">去配置页授权</a><button onclick="openMacSettings()" class="mini-btn ghost">在 Mac 上打开设置</button></div></div>'
    }
    rb.innerHTML='<div class="result-box ok"><b>✅ 任务完成</b><br>'+esc(t.result)+'</div>'+permHint;
  }
  else{rb.innerHTML='<div class="result-box err"><b>❌ 任务失败</b><br>'+esc(t.error)+'</div><div class="result-meta">常见原因：权限未授权、应用未安装</div>'}
  document.getElementById('send').style.opacity='1';
}

/* ---- 回车提交 ---- */
document.getElementById('input').addEventListener('keydown',function(e){if(e.keyCode==13){e.preventDefault();submit()}});

let _proc='';
(async function(){try{var d=await (await lbFetch('/api/accessibility')).json();if(d.processName)_proc=d.processName;}catch(e){}})();
async function openMacSettings(){try{await lbFetch('/api/accessibility',{method:'POST'});}catch(e){}}
initVoice();

/* ---- 触控板：手指滑动控制 Mac 鼠标（相对移动，轻点=点击）---- */
(function(){
  var pad=document.getElementById('trackpad');
  if(!pad) return;
  var lastX=0,lastY=0,moved=false,pendX=0,pendY=0,timer=null;
  function flush(){
    if(pendX===0&&pendY===0) return;
    var dx=pendX,dy=pendY; pendX=0; pendY=0;
    lbFetch('/api/mouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dx:dx,dy:dy})});
  }
  pad.addEventListener('touchstart',function(e){e.preventDefault();var t=e.touches[0];lastX=t.clientX;lastY=t.clientY;moved=false;},{passive:false});
  pad.addEventListener('touchmove',function(e){e.preventDefault();var t=e.touches[0];var dx=t.clientX-lastX,dy=t.clientY-lastY;lastX=t.clientX;lastY=t.clientY;if(Math.abs(dx)>2||Math.abs(dy)>2)moved=true;pendX+=dx;pendY+=dy;if(!timer)timer=setInterval(flush,30);},{passive:false});
  pad.addEventListener('touchend',function(e){e.preventDefault();if(timer){clearInterval(timer);timer=null;}flush();if(!moved){lbFetch('/api/mouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tap:true})});}});
})();
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
var LB_TOKEN = new URLSearchParams(location.search).get('t') || (function(){try{return localStorage.getItem('lb_token');}catch(e){return'';}})() || '';
function lbFetch(p, o){ o=o||{}; o.headers=Object.assign({'Content-Type':'application/json'}, o.headers||{}); if(LB_TOKEN) o.headers['x-lb-token']=LB_TOKEN; return fetch(p,o).then(function(r){ if(r.status===401) showLock(); return r; }); }
function showLock(){ var el=document.getElementById('lock'); if(el) el.style.display='flex'; }
function doUnlock(){ var e=document.getElementById('lockPwd'); var v=e?e.value.trim():''; if(!v) return; LB_TOKEN=v; try{localStorage.setItem('lb_token',v);}catch(e){} location.search='?t='+encodeURIComponent(v); }
var AL={search:'搜索',play:'播放',open:'打开',rating:'查评分',system:'系统操作',note:'记备忘录',type:'应用内输入'};
var PL={baidu:'百度',google:'Google',bilibili:'B站',youku:'优酷',iqiyi:'爱奇艺',tencent:'腾讯视频',youtube:'YouTube',douban:'豆瓣',zhihu:'知乎',weibo:'微博',github:'GitHub',taobao:'淘宝',jd:'京东'};
async function refresh(){
  var list=(await (await lbFetch('/api/tasks')).json());
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

/* ---------------- LLM 配置页 ---------------- */
const CONFIG_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>龙虾脑 · 配置</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:#fff;color:#1A1A1A;line-height:1.6;padding:20px;max-width:520px;margin:0 auto}
h1{font-size:20px;font-weight:600;margin-bottom:4px}
.sub{font-size:13px;color:#888;margin-bottom:24px}
.back{font-size:13px;color:#555;text-decoration:none;display:inline-block;margin-bottom:20px}
.section{border:1px solid #E8E5DF;border-radius:12px;padding:16px;margin-bottom:16px}
.section h2{font-size:15px;font-weight:600;margin-bottom:12px}
.field{margin-bottom:12px}
.field label{display:block;font-size:13px;font-weight:500;margin-bottom:4px;color:#555}
.field input,.field select{width:100%;border:1px solid #E8E5DF;border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;background:#FAFAF8}
.field input:focus,.field select:focus{border-color:#1A1A1A;background:#fff}
.row{display:flex;gap:8px;align-items:center}
.row input{flex:1}
.hint{font-size:11px;color:#999;margin-top:4px}
.btn{display:inline-block;padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit}
.btn-primary{background:#1A1A1A;color:#fff}
.btn-primary:active{background:#333}
.btn-ghost{background:#fff;color:#555;border:1px solid #E8E5DF}
.btn-row{display:flex;gap:8px;margin-top:8px}
.status{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px}
.status.on{background:#F7F7F7;color:#333}
.status.off{background:#FAFAF8;color:#999}
.status b{font-weight:600}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.dot.on{background:#333}.dot.off{background:#CCC}
.tag{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:6px}
.tag.llm{background:#EEE;color:#555}
.tag.rule{background:#F5F5F5;color:#999}
.perm-box{font-size:12px;color:#666;padding:12px;border:1px solid #E8E5DF;border-radius:8px;margin-top:8px}
.perm-box.warn{border:1.5px solid #333;background:#FFF;border-left:4px solid #333;color:#222;font-size:13px;line-height:1.65}
.perm-box.ok{border:1.5px solid #333;background:#FFF;color:#222}
.perm-name{display:inline-block;background:#333;color:#FFF;padding:1px 8px;border-radius:4px;font-weight:600;font-size:12px}
.perm-steps{margin:8px 0 0;padding-left:18px}
.perm-steps li{margin:3px 0}
</style></head><body>
<a class="back" href="/">← 返回</a>
<h1>龙虾脑配置</h1>
<div class="sub">接入大模型让龙虾脑更智能 · 配置辅助功能权限让自动输入生效</div>

<div class="section">
  <h2>大模型接入 <span id="llmTag" class="tag rule">规则引擎</span></h2>
  <div id="llmStatus" class="status off"><span class="dot off"></span>未配置，使用本地规则引擎</div>
  <div class="field">
    <label>选择服务</label>
    <select id="preset" onchange="onPreset()">
      <option value="">— 选择预设 —</option>
    </select>
  </div>
  <div class="field">
    <label>API Base URL</label>
    <input id="baseUrl" placeholder="https://api.deepseek.com/v1">
    <div class="hint">OpenAI 兼容接口地址</div>
  </div>
  <div class="field">
    <label>API Key</label>
    <input id="apiKey" type="password" placeholder="sk-...">
    <div class="hint">推荐 DeepSeek（国内直连、便宜）：<a href="https://platform.deepseek.com/api_keys" target="_blank">获取 API Key →</a></div>
  </div>
  <div class="field">
    <label>模型名称</label>
    <input id="model" placeholder="deepseek-chat">
  </div>
  <div class="btn-row">
    <button class="btn btn-primary" onclick="save()">保存配置</button>
    <button class="btn btn-ghost" onclick="testConn()">测试连接</button>
  </div>
  <div id="testResult" style="margin-top:8px;font-size:13px"></div>
</div>

<div class="section">
  <h2>辅助功能权限</h2>
  <div id="permStatus" class="status off"><span class="dot off"></span>检测中…</div>
  <div class="perm-box" id="permBox">
    自动输入文字（在微信/备忘录等应用里打字）需要授权「辅助功能」权限。授权后龙虾脑可自动输入，无需手动粘贴。
  </div>
  <div id="permSteps" style="display:none;margin-top:10px;font-size:13px;color:#222;line-height:1.7">
    <b>授权步骤：</b>
    <ol class="perm-steps">
      <li>点击下方「打开系统设置」按钮（或手动进入 <b>系统设置 → 隐私与安全性 → 辅助功能</b>）</li>
      <li>在程序列表中找到并开启 <span class="perm-name" id="permName">运行本服务的程序</span></li>
      <li><b>完全退出该程序再重新打开</b>（或重启服务），权限才会生效</li>
      <li>回到这里点「重新检测」，显示「已授权」即成功</li>
    </ol>
  </div>
  <div class="btn-row">
    <button class="btn btn-ghost" onclick="checkPerm()">重新检测</button>
    <button class="btn btn-ghost" onclick="openPerm()">打开系统设置</button>
  </div>
</div>

<div class="section">
  <h2>局域网访问保护（令牌）</h2>
  <div id="tokenStatus" class="status off"><span class="dot off"></span>读取中…</div>
  <div id="tokenBox" style="display:none">
    <div style="font-size:13px;color:#555;margin-bottom:8px">手机/其他设备访问需携带此令牌。在本机复制下方「手机链接」加到主屏幕即可（令牌已内置）。</div>
    <div class="field">
      <label>访问令牌</label>
      <input id="tokenVal" readonly style="font-family:monospace;letter-spacing:.5px">
    </div>
    <div class="field">
      <label>手机链接（含令牌，直接加到主屏幕）</label>
      <input id="phoneLink" readonly style="font-size:12px">
      <div class="hint">仅本机(localhost)可读取令牌；从局域网打开本页看不到令牌。</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="copyPhone()">复制手机链接</button>
      <button class="btn btn-ghost" onclick="resetToken()">重置为随机令牌</button>
    </div>
    <div class="field" style="margin-top:14px;border-top:1px solid #EEE;padding-top:14px">
      <label>设置自定义密码（替换随机令牌）</label>
      <input id="customPwd" placeholder="至少 4 位，例如 mymac2026" style="font-family:monospace">
      <div class="hint">设置后，手机链接改用此密码（链接里 ?t= 即此密码），旧令牌立即失效。留空时按「重置为随机令牌」会重新生成随机串。</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary" onclick="setCustomToken()">保存自定义密码</button>
    </div>
  </div>
  <div id="tokenWarn" style="display:none;font-size:12px;color:#999;line-height:1.6">
    当前从局域网打开配置页，出于安全无法显示令牌。请在 <b>Mac 本机</b>用 <b>http://localhost:8787/config</b> 打开以查看令牌与手机链接。
  </div>
</div>

<div class="section">
  <h2>当前能力</h2>
  <div style="font-size:13px;color:#666;line-height:1.8">
    • 搜索（百度/Google/知乎） • 播放（B站/优酷/爱奇艺） • 打开应用/文件夹/网站<br>
    • 查评分（豆瓣） • 系统操作（截图/音量/锁屏） • 记备忘录<br>
    • 在应用里输入文字（需辅助功能权限） • 复合指令（打开微信——输入你好）
  </div>
</div>

<script>
var LB_TOKEN = new URLSearchParams(location.search).get('t') || (function(){try{return localStorage.getItem('lb_token');}catch(e){return'';}})() || '';
function lbFetch(p, o){ o=o||{}; o.headers=Object.assign({'Content-Type':'application/json'}, o.headers||{}); if(LB_TOKEN) o.headers['x-lb-token']=LB_TOKEN; return fetch(p,o).then(function(r){ if(r.status===401) showLock(); return r; }); }
function showLock(){ var el=document.getElementById('lock'); if(el) el.style.display='flex'; }
function doUnlock(){ var e=document.getElementById('lockPwd'); var v=e?e.value.trim():''; if(!v) return; LB_TOKEN=v; try{localStorage.setItem('lb_token',v);}catch(e){} location.search='?t='+encodeURIComponent(v); }
function esc(s){return (s||'').replace(/</g,'&lt;')}
async function load(){
  // 加载预设
  var r=await lbFetch('/api/llm-config');var d=await r.json();
  var sel=document.getElementById('preset');
  (d.presets||[]).forEach(function(p){
    var o=document.createElement('option');o.value=p.id;o.textContent=p.name;
    if(p.baseUrl===d.baseUrl)o.selected=true;sel.appendChild(o);
  });
  document.getElementById('baseUrl').value=d.baseUrl||'';
  document.getElementById('model').value=d.model||'';
  if(d.hasKey){document.getElementById('apiKey').placeholder='已配置（输入新值覆盖）'}
  updateStatus(d.enabled);
  checkPerm();
}
function onPreset(){
  var sel=document.getElementById('preset');
  var r=(window.__presets||[]).find(function(p){return p.id===sel.value});
  if(r&&r.baseUrl){document.getElementById('baseUrl').value=r.baseUrl;document.getElementById('model').value=r.model}
}
function updateStatus(on){
  var tag=document.getElementById('llmTag'),st=document.getElementById('llmStatus');
  if(on){tag.className='tag llm';tag.textContent='大模型';st.className='status on';st.innerHTML='<span class="dot on"></span>已启用大模型解析，指令理解更智能'}
  else{tag.className='tag rule';tag.textContent='规则引擎';st.className='status off';st.innerHTML='<span class="dot off"></span>未配置，使用本地规则引擎'}
}
async function save(){
  var d={baseUrl:document.getElementById('baseUrl').value.trim(),apiKey:document.getElementById('apiKey').value.trim(),model:document.getElementById('model').value.trim()};
  if(!d.baseUrl){alert('请填写 API Base URL');return}
  if(!d.apiKey && !document.getElementById('apiKey').placeholder.startsWith('已配置')){alert('请填写 API Key');return}
  // 如果 apiKey 为空且 placeholder 显示已配置，保留旧 key
  if(!d.apiKey){
    // 不覆盖，只更新 baseUrl 和 model
    var old=await (await lbFetch('/api/llm-config')).json();
    d.apiKey='__KEEP__'; // 标记保留
  }
  var r=await lbFetch('/api/llm-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  var res=await r.json();
  updateStatus(res.enabled);
  alert(res.ok?'保存成功！':'保存失败');
  load();
}
async function testConn(){
  var tr=document.getElementById('testResult');tr.textContent='测试中…';tr.style.color='#999';
  var d={baseUrl:document.getElementById('baseUrl').value.trim(),apiKey:document.getElementById('apiKey').value.trim()||undefined,model:document.getElementById('model').value.trim()};
  if(!d.baseUrl||!d.apiKey){tr.textContent='请先填写 Base URL 和 API Key';tr.style.color='#C00';return}
  var r=await lbFetch('/api/llm-config/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
  var res=await r.json();
  if(res.ok){tr.innerHTML='✅ 连接成功！模型回复：'+esc(res.reply||'(空)');tr.style.color='#333'}
  else{tr.innerHTML='❌ 连接失败：'+esc(res.error||'未知错误');tr.style.color='#C00'}
}
async function checkPerm(){
  var st=document.getElementById('permStatus'),box=document.getElementById('permBox'),steps=document.getElementById('permSteps');
  var r=await lbFetch('/api/accessibility');var d=await r.json();
  if(d.granted){st.className='status on';st.innerHTML='<span class="dot on"></span>已授权，自动输入可用';box.className='perm-box ok';box.textContent='辅助功能已授权。龙虾脑可以在应用里自动输入文字了。';steps.style.display='none';}
  else{
    st.className='status off';st.innerHTML='<span class="dot off"></span>未授权，自动输入不可用';
    var prog = d.processName ? ('<span class="perm-name">'+esc(d.processName)+'</span>') : '运行本服务的程序（终端 / VS Code / WorkBuddy 等）';
    box.className='perm-box warn';
    box.innerHTML='当前<b>未授权</b>，自动输入会降级为「复制到剪贴板 + 手动粘贴」。请在辅助功能列表中开启：'+prog+'。';
    document.getElementById('permName').innerHTML = d.processName ? esc(d.processName) : '运行本服务的程序';
    steps.style.display='block';
  }
}
function openPerm(){lbFetch('/api/accessibility',{method:'POST'}).then(function(){setTimeout(checkPerm,2000)})}
async function loadToken(){
  try{
    var r=await lbFetch('/api/auth/info');
    if(r.status===200){var d=await r.json();document.getElementById('tokenStatus').className='status on';document.getElementById('tokenStatus').innerHTML='<span class="dot on"></span>已开启保护（本机可读令牌）';
      document.getElementById('tokenBox').style.display='block';
      document.getElementById('tokenVal').value=d.token;document.getElementById('phoneLink').value=d.phoneLink;
    } else if(r.status===403){
      document.getElementById('tokenStatus').className='status off';document.getElementById('tokenStatus').innerHTML='<span class="dot off"></span>本机外打开：无法显示令牌';
      document.getElementById('tokenWarn').style.display='block';
    } else { document.getElementById('tokenStatus').innerHTML='状态：'+r.status; }
  }catch(e){ document.getElementById('tokenStatus').innerHTML='读取失败：'+e.message; }
}
function copyPhone(){var v=document.getElementById('phoneLink').value;if(navigator.clipboard)navigator.clipboard.writeText(v);else{document.getElementById('phoneLink').select();document.execCommand('copy');}}
async function resetToken(){ if(!confirm('重置后，所有手机需重新用新链接连接。确定重置？'))return; var r=await lbFetch('/api/auth/reset',{method:'POST'});var d=await r.json();if(d.ok){document.getElementById('tokenVal').value=d.token;document.getElementById('phoneLink').value=d.phoneLink;alert('已重置为随机令牌。请重新复制手机链接并加到主屏幕。');}}
async function setCustomToken(){
  var p=document.getElementById('customPwd').value.trim();
  if(p && p.length<4){alert('密码至少 4 位');return;}
  var r=await lbFetch('/api/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p})});
  var d=await r.json();
  if(d && d.ok){document.getElementById('tokenVal').value=d.token;document.getElementById('phoneLink').value=d.phoneLink;document.getElementById('customPwd').value='';alert(d.random?'已重置为随机令牌。':'已设置为自定义密码。请重新复制手机链接并加到主屏幕。');}
  else{alert('设置失败');}
}
load();
loadToken();
</script></body></html>`;

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // ===== 访问控制：所有 /api/ 接口（非本机）必须携带有效令牌 =====
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/auth/info') {
      if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }
      return res.end(JSON.stringify({ token: AUTH_TOKEN, phoneLink: 'https://' + lanIP() + ':' + HTTPS_PORT_OF() + '/?t=' + AUTH_TOKEN }));
    }
    if (url.pathname === '/api/auth/reset' && req.method === 'POST') {
      if (!isLocalhost(req) && !checkAuth(url, req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthorized' })); }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let custom = '';
        try { const d = JSON.parse(body || '{}'); custom = (d.token || '').toString().trim(); } catch (e) {}
        if (custom.length < 4) {
          // 未提供自定义密码 → 重新生成随机令牌（原有行为）
          AUTH_TOKEN = crypto.randomBytes(12).toString('hex');
          try { fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: AUTH_TOKEN }, null, 2)); } catch (e) {}
          return res.end(JSON.stringify({ ok: true, random: true, token: AUTH_TOKEN, phoneLink: 'https://' + lanIP() + ':' + HTTPS_PORT_OF() + '/?t=' + AUTH_TOKEN }));
        }
        // 用户自定义密码
        AUTH_TOKEN = custom;
        try { fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: AUTH_TOKEN }, null, 2)); } catch (e) {}
        return res.end(JSON.stringify({ ok: true, random: false, token: AUTH_TOKEN, phoneLink: 'https://' + lanIP() + ':' + HTTPS_PORT_OF() + '/?t=' + AUTH_TOKEN }));
      });
      return;
    }
    if (!checkAuth(url, req)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'unauthorized', code: 401, hint: '请在 Mac 本机打开配置页获取手机链接，或在请求中携带令牌 ?t= 或头 x-lb-token' }));
    }
  }
  if (req.method === 'GET' && url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(MOBILE_PAGE); }
  if (req.method === 'GET' && url.pathname === '/dashboard') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(DASH_PAGE); }
  if (req.method === 'GET' && url.pathname === '/config') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(CONFIG_PAGE); }
  if (req.method === 'GET' && url.pathname === '/api/tasks') return res.end(JSON.stringify(tasks.slice().reverse()));
  // LLM 配置
  if (req.method === 'GET' && url.pathname === '/api/llm-config') {
    const cfg = llmConfig();
    return res.end(JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model, enabled: cfg.enabled, hasKey: !!cfg.apiKey, presets: LLM_PRESETS }));
  }
  if (req.method === 'POST' && url.pathname === '/api/llm-config') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        let { baseUrl, apiKey, model } = JSON.parse(body || '{}');
        // __KEEP__ 表示保留旧 key
        if (apiKey === '__KEEP__') {
          const old = readLLMConfig() || {};
          apiKey = old.apiKey || '';
        }
        writeLLMConfig({ baseUrl, apiKey, model });
        const cfg = llmConfig();
        res.end(JSON.stringify({ ok: true, enabled: cfg.enabled, hasKey: !!cfg.apiKey }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad request' })); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/llm-config/test') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', async () => {
      try {
        const { baseUrl, apiKey, model } = JSON.parse(body || '{}');
        const r = await fetch((baseUrl || '').replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({ model: model || 'deepseek-chat', max_tokens: 20, messages: [{ role: 'user', content: '你好，回复OK' }] }),
        });
        const j = await r.json();
        const reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        res.end(JSON.stringify({ ok: true, reply }));
      } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }
  // 辅助功能权限检测
  if (req.method === 'GET' && url.pathname === '/api/accessibility') {
    (async () => {
      const ok = await checkAccessibility();
      let processName = '';
      try {
        const ppid = process.ppid;
        processName = require('child_process').execSync(`ps -o comm= -p ${ppid}`).toString().trim() || '';
        if (processName.includes('/')) processName = processName.split('/').pop().replace(/\.app$/, '');
      } catch {}
      res.end(JSON.stringify({ granted: ok, processName }));
    })();
    return;
  }
  // 鼠标控制：手机触控板 → 移动/点击 Mac 光标
  if (req.method === 'POST' && url.pathname === '/api/mouse') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', async () => {
      try {
        const d = JSON.parse(body || '{}');
        if (!mouseState.ready) return res.end(JSON.stringify({ ok: false, error: 'mouse not ready' }));
        if (d.tap || d.click) {
          await sh(`python3 "${MOUSECTL}" click`);
          return res.end(JSON.stringify({ ok: true, action: 'click', x: Math.round(mouseState.x), y: Math.round(mouseState.y) }));
        }
        if (typeof d.dx === 'number' || typeof d.dy === 'number') {
          const dx = (d.dx || 0) * MOUSE_SENS, dy = (d.dy || 0) * MOUSE_SENS;
          mouseState.x = Math.max(0, Math.min(mouseState.w, mouseState.x + dx));
          mouseState.y = Math.max(0, Math.min(mouseState.h, mouseState.y + dy));
          await sh(`python3 "${MOUSECTL}" move ${Math.round(mouseState.x)} ${Math.round(mouseState.y)}`);
          return res.end(JSON.stringify({ ok: true, action: 'move', x: Math.round(mouseState.x), y: Math.round(mouseState.y) }));
        }
        res.end(JSON.stringify({ ok: false, error: 'invalid payload' }));
      } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/accessibility') {
    (async () => {
      await openAccessibilityPrefs();
      res.end(JSON.stringify({ ok: true }));
    })();
    return;
  }
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
loadAuth();
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
  const cfg = llmConfig();
  console.log('  智能解析: ' + (cfg.enabled ? '大模型 (' + cfg.model + ')' : '增强规则引擎（未配置 LLM）'));
  console.log('  能力: search / play / open(应用/文件夹/网站) / rating / system(音量/截图/锁屏…) / note / type(应用内输入)');
  console.log('  配置页: http://localhost:' + HTTP_PORT + '/config  （接入 LLM + 辅助功能权限）');
});
