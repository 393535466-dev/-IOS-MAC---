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
 *   close   关闭/退出：退出当前应用、退出指定应用、关闭窗口、关闭标签页
 *   window  窗口管理：最小化、隐藏、全屏切换、显示桌面
 *   media   媒体控制：播放/暂停、上一首、下一首（驱动音乐 App）
 *   edit    编辑与导航：全选/复制/剪切/粘贴/撤销/重做/回车/刷新/后退/前进
 *
 * 智能：内置增强 NLU（动作/平台/内容类型/对象四维解析）+ 可选接真 LLM（LLM_BASE_URL/LLM_API_KEY/LLM_MODEL，OpenAI 兼容）
 * 输入：语音输入（实时反馈）、实时联想、多场景卡片、历史可重发、回车提交
 *
 * 页面：/ 手机任务页   /dashboard 运营看板   /manage 控制台   /config 配置   /setup 首次配置向导
 * API：POST /api/task   GET /api/task/:id   GET /api/tasks
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const { execSync, execFileSync } = require('child_process');
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
const VERSION = '3.5.0';
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
const ACTION_LABEL = { search: '搜索', play: '播放', open: '打开', rating: '查评分', system: '系统操作', note: '记备忘录', type: '应用内输入', close: '关闭/退出', window: '窗口', media: '媒体', edit: '编辑/导航' };

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
let TRUST_LAN = true; // 默认开启：同一 Wi-Fi 下的手机免令牌直连（个人工具，安全可接受）
function loadAuth() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (j && j.token) { AUTH_TOKEN = j.token; }
    if (j && typeof j.trustLan === 'boolean') TRUST_LAN = j.trustLan;
    if (AUTH_TOKEN) return;
  } catch (e) {}
  // 首次运行：生成随机令牌并持久化
  AUTH_TOKEN = crypto.randomBytes(12).toString('hex');
  saveAuth();
}
function saveAuth() {
  try { fs.writeFileSync(AUTH_FILE, JSON.stringify({ token: AUTH_TOKEN, trustLan: TRUST_LAN }, null, 2)); } catch (e) {}
}
function isLocalhost(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a === 'localhost';
}
function isPrivateLAN(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  if (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') return false;
  // IPv4 私有网段
  const m = a.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [_, b1, b2] = m.map(Number);
    if (b1 === 10) return true;
    if (b1 === 172 && b2 >= 16 && b2 <= 31) return true;
    if (b1 === 192 && b2 === 168) return true;
    if (b1 === 169 && b2 === 254) return true; // 链路本地
  }
  // IPv6 唯一本地地址 fc00::/7
  if (a.startsWith('fd') || a.startsWith('fc')) return true;
  return false;
}
function checkAuth(url, req) {
  if (isLocalhost(req)) return true;                 // 本机即本人，免令牌
  if (TRUST_LAN && isPrivateLAN(req)) return true;   // 同一 Wi-Fi 信任设备，免令牌
  const t = url.searchParams.get('t') || (req.headers && req.headers['x-lb-token']) || '';
  return !!t && t === AUTH_TOKEN;
}
function lanIP() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const k in ifaces) for (const i of ifaces[k]) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  // 优先家用路由器网段，避免误取 Docker / 虚拟网卡地址（如 172.19.0.1）导致手机链接打不开
  return ips.find(a => /^192\.168\./.test(a)) || ips.find(a => /^10\./.test(a)) || ips[0] || 'localhost';
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
/* ---------------- 本机应用自发现：不再靠硬编码字典猜应用名 ----------------
 * 扫描 /Applications 等目录，读 Info.plist 拿到真实的 CFBundleName / DisplayName /
 * BundleId / 图标文件；解析时把「飞书」「Feishu」等都映射到真实 .app 路径，
 * 直接用 open "<完整路径>" 打开，绕开 open -a 名称匹配的坑。 */
const APP_CACHE = path.join(__dirname, 'installed-apps.json');
const QUICK_APPS_FILE = path.join(__dirname, 'quick-apps.json');
const ICON_DIR = path.join(__dirname, 'public', 'icons');
let INSTALLED_APPS = [];
let APP_INDEX = new Map();

// 本机没装时的智能兜底：自动打开网页版，而不是冷冰冰报「执行失败」
const WEB_FALLBACK = [
  { keys: ['抖音', 'douyin', 'tiktok'], label: '抖音网页版', url: 'https://www.douyin.com' },
  { keys: ['快手', 'kuaishou'], label: '快手网页版', url: 'https://www.kuaishou.com' },
  { keys: ['哔哩哔哩', 'bilibili', 'b站'], label: 'B站网页版', url: 'https://www.bilibili.com' },
  { keys: ['小红书', 'xiaohongshu'], label: '小红书网页版', url: 'https://www.xiaohongshu.com' },
  { keys: ['微博', 'weibo'], label: '微博网页版', url: 'https://weibo.com' },
  { keys: ['知乎', 'zhihu'], label: '知乎网页版', url: 'https://www.zhihu.com' },
  { keys: ['淘宝', 'taobao'], label: '淘宝网页版', url: 'https://www.taobao.com' },
  { keys: ['京东', 'jd.com'], label: '京东网页版', url: 'https://www.jd.com' },
  { keys: ['腾讯视频', 'v.qq'], label: '腾讯视频网页版', url: 'https://v.qq.com' },
  { keys: ['爱奇艺', 'iqiyi'], label: '爱奇艺网页版', url: 'https://www.iqiyi.com' },
  { keys: ['优酷', 'youku'], label: '优酷网页版', url: 'https://www.youku.com' },
  { keys: ['网易云音乐', 'neteasemusic', 'music.163'], label: '网易云音乐网页版', url: 'https://music.163.com' },
  { keys: ['qq音乐', 'qqmusic'], label: 'QQ音乐网页版', url: 'https://y.qq.com' },
  { keys: ['飞书', 'feishu', 'lark'], label: '飞书网页版', url: 'https://www.feishu.cn' },
  { keys: ['钉钉', 'dingtalk'], label: '钉钉网页版', url: 'https://www.dingtalk.com' },
];
const PREFERRED_APPS = ['微信', '豆包', 'WorkBuddy', '浏览器', '飞书', '备忘录', 'B站', '网易云音乐', 'Cursor', 'Obsidian', 'Kimi', '元宝'];

function normAppKey(s) {
  return String(s || '').toLowerCase().replace(/\.app$/, '').replace(/[\s_\-·.]/g, '');
}
function buildAppIndex() {
  APP_INDEX = new Map();
  for (const a of INSTALLED_APPS) for (const k of (a.keys || [])) if (k && !APP_INDEX.has(k)) APP_INDEX.set(k, a);
}
function appEntryFromPath(appPath) {
  const base = path.basename(appPath, '.app');
  let info = {};
  try {
    const out = execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 2500, maxBuffer: 2e6 });
    info = JSON.parse(out);
  } catch (e) {}
  const bundleName = info.CFBundleName || '';
  const displayName = info.CFBundleDisplayName || '';
  const bundleId = info.CFBundleIdentifier || '';
  const iconFile = info.CFBundleIconFile || 'AppIcon.icns';
  const name = displayName || bundleName || base;
  const keys = [base, bundleName, displayName, bundleId, name].map(normAppKey).filter(Boolean);
  return { name, base, path: appPath, bundleName, displayName, bundleId, iconFile, keys,
    searchText: [base, bundleName, displayName, bundleId].join(' ').toLowerCase() };
}
function scanInstalledApps() {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications'), '/System/Applications',
    '/Applications/Utilities', '/System/Applications/Utilities'];
  const seen = new Set(), list = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir).filter(n => n.endsWith('.app')); } catch (e) { continue; }
    for (const n of names) {
      const p = path.join(dir, n);
      if (seen.has(p)) continue;
      seen.add(p);
      try { list.push(appEntryFromPath(p)); } catch (e) {}
    }
  }
  INSTALLED_APPS = list;
  buildAppIndex();
  try { fs.writeFileSync(APP_CACHE, JSON.stringify(list, null, 2)); } catch (e) {}
  return list;
}
function loadAppCache() {
  try {
    const j = JSON.parse(fs.readFileSync(APP_CACHE, 'utf8'));
    if (Array.isArray(j) && j.length) { INSTALLED_APPS = j; buildAppIndex(); }
  } catch (e) {}
}
function findInstalledApp(name) {
  if (!name || !INSTALLED_APPS.length) return null;
  const q = normAppKey(name);
  if (!q) return null;
  if (APP_INDEX.has(q)) return APP_INDEX.get(q);
  let best = null, bestLen = Infinity;
  for (const a of INSTALLED_APPS) for (const k of a.keys) {
    if (k.length >= 3 && (k.includes(q) || q.includes(k)) && k.length < bestLen) { best = a; bestLen = k.length; }
  }
  return best;
}
// 任意写法 → 本机真实存在的应用。精确匹配优先，避免「浏览器」被模糊到「豆包工作浏览器」
function resolveAppEntry(name) {
  if (!name) return null;
  const dict = APPS[name] || APPS[String(name).toLowerCase()];
  if (dict) { const hit = APP_INDEX.get(normAppKey(dict)); if (hit) return hit; }   // 飞书→Feishu、浏览器→Safari
  const self = APP_INDEX.get(normAppKey(name)); if (self) return self;              // 真实应用名/中文名直接命中
  if (dict) { const hit = findInstalledApp(dict); if (hit) return hit; }
  return findInstalledApp(name);
}
const CN_LABEL = {
  WeChat: '微信', Lark: '飞书', Feishu: '飞书', DoubaoWork: '豆包', Notes: '备忘录', Music: '音乐',
  Safari: '浏览器', Finder: '访达', Photos: '照片', Mail: '邮件', Calendar: '日历', Maps: '地图',
  Terminal: '终端', Reminders: '提醒事项', Contacts: '通讯录', 'Google Chrome': '浏览器',
  'Visual Studio Code': 'VS Code', WorkBuddy: 'WorkBuddy', Cursor: 'Cursor', Obsidian: 'Obsidian'
};
function cnAppLabel(a) {
  if (CN_LABEL[a.base]) return CN_LABEL[a.base];
  for (const k in APPS) if (APPS[k] === a.base && /[\u4e00-\u9fa5]/.test(k)) return k;
  return a.name;
}
function findWebFallback(it) {
  const hay = [it.target, it.app, it.raw].filter(Boolean).join(' ').toLowerCase();
  return WEB_FALLBACK.find(w => w.keys.some(k => hay.includes(k.toLowerCase()))) || null;
}
function similarApps(name, n) {
  const q = String(name || '').toLowerCase();
  const chars = [...new Set(q.replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').split(''))];
  if (!chars.length) return [];
  return INSTALLED_APPS
    .map(a => ({ a, s: chars.reduce((s, c) => s + (a.searchText.includes(c) ? 1 : 0), 0) }))
    .filter(x => x.s > 0).sort((x, y) => y.s - x.s || x.a.name.length - y.a.name.length)
    .slice(0, n || 3).map(x => x.a.name);
}
function appUsageStats() {
  const m = {};
  try {
    for (const t of tasks) {
      const mm = /^打开\s*(.+?)\s*$/.exec(String(t.instruction || ''));
      if (mm && t.status === 'success') m[mm[1]] = (m[mm[1]] || 0) + 1;
    }
  } catch (e) {}
  return m;
}
function toClientApp(a) {
  return {
    id: a.bundleId || a.base, name: a.name, base: a.base, path: a.path,
    label: (() => { const s = cnAppLabel(a); return s.length > 8 ? s.slice(0, 7) + '…' : s; })(),
    cmd: '打开' + a.base,
    icon: '/api/app-icon?p=' + encodeURIComponent(a.path),
    color: '#' + crypto.createHash('md5').update(a.name).digest('hex').slice(0, 6)
  };
}
function pickQuickApps() {
  const usage = appUsageStats();
  const byUsage = Object.keys(usage).sort((a, b) => usage[b] - usage[a]);
  let pinned = [];
  try { pinned = JSON.parse(fs.readFileSync(QUICK_APPS_FILE, 'utf8')); } catch (e) {}
  if (!Array.isArray(pinned)) pinned = [];
  const chosen = [], seen = new Set();
  for (const key of pinned.concat(byUsage, PREFERRED_APPS)) {
    const e = resolveAppEntry(key);
    if (e && !seen.has(e.path)) { seen.add(e.path); chosen.push(e); }
    if (chosen.length >= 10) break;
  }
  return chosen;
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
  // 优先用本机真实安装的应用名（如「飞书」→ Lark），字典只作为兜底
  const hit = resolveAppEntry(name);
  if (hit) return hit.base;
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

/* ---------------- 指令检测：关闭 / 窗口 / 媒体 / 编辑 ---------------- */
// 关闭类：退出当前应用 / 退出指定应用 / 关闭窗口 / 关闭标签页
function detectClose(text) {
  // 单字「关」与语音同音词也收进来：sanitizeSpeech 会先规范，这里是给「直输逃逸」等
  // 直接调 localParse 的路径兜底。刻意不收裸「退」，否则「后退/退回一步」会被误判。
  const verb = /(关闭|关掉|关了|关上|退出|退掉|quit|exit|close|结束|停掉|杀掉|干掉|不要了|guan\s*bi|^关(?![注于系心键照怀闭掉了上门灯]))/i;
  if (!verb.test(text) || /全屏|最大化|最小化|隐藏/.test(text)) return null;
  // 明确"退出应用"
  if (/(?:退出|关闭|结束|关掉)(?:当前|整个)?(?:应用|程序|软件|app)|退出应用|退出程序|关闭应用|关掉应用|退出当前应用|结束进程|杀进程/i.test(text)) return { sub: 'quit_front' };
  const app = detectApp(text);
  // 指定应用 + 关闭/退出（无窗口/标签页限定词）→ 退出该应用
  if (app && !/(窗口|标签页|网页|标签|这个页)/.test(text)) {
    return { sub: 'quit_app', app: app.key, appName: app.name };
  }
  if (/(标签页|网页|标签|这个网页|这个页|当前页)/.test(text)) return { sub: 'close_tab' };
  if (/(窗口|这个窗口|当前窗口)/.test(text)) return { sub: 'close_window' };
  // 裸 关闭/关掉/退出 → 退出当前应用（符合预期：关闭=退出当前应用/页面）
  return { sub: 'quit_front' };
}
function detectWindow(text) {
  if (/最小化|最小|收起窗口|收起|缩小窗口/.test(text)) return 'minimize';
  if (/隐藏|藏起来|隐藏当前/.test(text)) return 'hide';
  if (/全屏|最大化|铺满|最大化窗口|全屏显示/.test(text)) return 'fullscreen';
  if (/显示桌面|回到桌面|回到主屏幕|回到主页|显示主屏幕/.test(text)) return 'show_desktop';
  return null;
}
function detectMedia(text) {
  if (/下一首|下首歌|后一首|切歌|换一首|切到下一首/.test(text)) return 'next';
  if (/上一首|前一首|上一曲|切到上一首/.test(text)) return 'prev';
  if (/播放暂停|暂停播放|暂停$|暂停音乐|停止播放|歌暂停|暂停一下|暂停歌曲|继续播放|开始播放|恢复播放|播放音乐|放歌/.test(text)) return 'playpause';
  return null;
}
function detectEdit(text) {
  if (/全选|选中全部|选择所有|全部选中/.test(text)) return 'select_all';
  if (/复制|拷贝/.test(text)) return 'copy';
  if (/剪切|剪下|剪贴/.test(text)) return 'cut';
  if (/粘贴/.test(text)) return 'paste';
  if (/撤销|反悔|退回一步|撤回/.test(text)) return 'undo';
  if (/重做|恢复操作|重新做/.test(text)) return 'redo';
  if (/回车|按回车|点发送|点确定|确认发送|提交表单|提交/.test(text)) return 'enter';
  if (/刷新|重新加载|刷新页面|刷新一下/.test(text)) return 'refresh';
  if (/后退|返回上一页|返回上页|返回|回上一页/.test(text)) return 'back';
  if (/前进|前进一页/.test(text)) return 'forward';
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

  // 1.5 关闭 / 窗口 / 媒体 / 编辑 类基础指令（无需 LLM，规则秒级命中）
  const cl = detectClose(raw);
  if (cl) return { action: 'close', sub: cl.sub, target: cl.appName || null, app: cl.app || null, appName: cl.appName || null, platform: null, contentType: null, raw, source: 'rule' };
  const wd = detectWindow(raw);
  if (wd) return { action: 'window', sub: wd, target: null, platform: null, contentType: null, raw, source: 'rule' };
  const md = detectMedia(raw);
  if (md) return { action: 'media', sub: md, target: null, platform: null, contentType: null, raw, source: 'rule' };
  const ed = detectEdit(raw);
  if (ed) return { action: 'edit', sub: ed, target: null, platform: null, contentType: null, raw, source: 'rule' };

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
          { role: 'system', content: '你是龙虾脑的指令解析器。把用户自然语言解析为JSON：{action,target,platform,contentType,sub,app,appName,contact}。\naction取值：search(搜索)/play(播放视频)/open(打开)/rating(查评分)/system(系统操作)/note(记备忘录)/type(在应用里输入文字)/send_msg(给指定联系人发消息)/close(关闭或退出，sub=quit_front退出当前应用、quit_app退出指定应用、close_window关闭窗口、close_tab关闭标签页)/window(窗口操作，sub=minimize最小化、hide隐藏、fullscreen全屏、show_desktop显示桌面)/media(媒体控制，sub=playpause播放暂停、next下一首、prev上一首)/edit(编辑与导航，sub=select_all全选、copy复制、cut剪切、paste粘贴、undo撤销、redo重做、enter回车发送、refresh刷新、back后退、forward前进)。\ntarget是主要对象(影片名/关键词/应用名/要记的内容/要输入的文字/要发送的消息正文)或null。\nplatform取值baidu/google/bilibili/youku/iqiyi/tencent/youtube/douban/zhihu/weibo/github/taobao/jd或null，搜索默认baidu，播放默认bilibili，查评分默认douban。\ncontentType取值预告片/正片/花絮/解说或null。\nsub在action=open时为open_app/open_folder/open_site/open_url，action=system时为volume_up/volume_down/mute/brightness/screenshot/lock/trash/settings。\napp/appName在action=open/open_app/type/send_msg时指定目标应用名(如"浏览器"→Safari、"谷歌浏览器/Chrome"→Google Chrome、"微信"→WeChat、"WorkBuddy"、"豆包"→DoubaoWork、"备忘录"→Notes、"终端"→Terminal)，无指定应用时app=null；send_msg时默认app="微信"。打开浏览器类：默认浏览器=Safari，谷歌浏览器/Chrome=Google Chrome。\ncontact仅在action=send_msg时使用，为收信人姓名(如"张三")。\n复合指令如"打开微信然后输入你好"解析为type动作，app="微信",target="你好"。\n发消息给联系人如"发微信给张三：晚点到"解析为send_msg，contact="张三",target="晚点到",app="微信"。\n只输出JSON，不要解释。' },
          { role: 'user', content: text },
        ],
      }),
    });
    const j = await r.json();
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return c ? JSON.parse(c) : null;
  } catch (e) { console.log('[LLM] 降级本地:', e.message); return null; }
}

// 直输模式下的「指令逃逸」：用户输入的其实是一条明确指令时，按指令执行，
// 而不是当成文字填进输入框。判定刻意保守：只认以明确动作词开头的短句，
// 且排除 type（输入/写）——否则「写一份周报」会被剥词后误当指令。
const ESCAPE_CMD_RE = /^(?:请|帮我|麻烦|给我|能不能|可以|我想|我要|想要|想|把|将|顺便|来个?)?\s*(?:打开|启动|唤起|截屏|截图|截个屏|截一张|拍个照|抓屏|锁屏|锁定屏幕|锁电脑|静音|调大|调小|大声|小声|音量|声音|亮度|清空废纸篓|清废纸篓|清空垃圾|清垃圾|系统设置|打开设置|系统偏好|偏好设置|搜索|搜一下|搜搜|搜个|检索|查询|查一下|查查|查找|百度一下|谷歌一下|播放|放一下|听歌|听一下|发微信给|发消息给|发短信给|发信息给|给.+发(?:微信|消息|短信|信息)|用微信给|提醒我|记到备忘录|关闭|关掉|退出|最小化|隐藏|全屏|切换全屏|暂停|下一首|上一首|切歌|全选|复制|剪切|粘贴|撤销|重做|刷新|返回|后退|前进|回车|显示桌面)/;
function commandEscape(raw) {
  const s = (raw || '').trim();
  if (!s || s.length > 60 || !ESCAPE_CMD_RE.test(s)) return null;
  const p = localParse(s);
  if (!p || p.lowConfidence || !p.action || p.action === 'type') return null;
  // close/window/media/edit/system 天生没有 target（退出前台应用、最小化窗口…）。
  // 旧逻辑一律要求 target，导致直输模式下说「关闭」被当成文字填进输入框 —— 这里放行。
  if (!['system', 'close', 'window', 'media', 'edit'].includes(p.action) && !p.target) return null;
  return p;
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
    case 'close': return { quit_front: '退出当前应用', quit_app: '退出「' + (it.appName || it.app || '') + '」', close_window: '关闭当前窗口', close_tab: '关闭当前标签页' }[it.sub] || '关闭';
    case 'window': return { minimize: '最小化当前窗口', hide: '隐藏当前应用', fullscreen: '切换全屏', show_desktop: '显示桌面' }[it.sub] || '窗口操作';
    case 'media': return { playpause: '播放/暂停', next: '下一首', prev: '上一首' }[it.sub] || '媒体控制';
    case 'edit': return { select_all: '全选', copy: '复制', cut: '剪切', paste: '粘贴', undo: '撤销', redo: '重做', enter: '回车/发送', refresh: '刷新', back: '后退', forward: '前进' }[it.sub] || '编辑操作';
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

/* ---------------- 语音指令净化（ASR 短词 / 同音错字 / 标点 / 指代） ----------------
 * 只作用于「指令」链路；原文直输 direct 必须逐字保留，绝不经过这里。
 * 起因：手机说「关闭」「关闭微信」经常没反应，除了识别层掐断，还有三类文本问题：
 *   ① iOS 听写把「关闭」听成「关必/关毕/关闭昂」，句尾带「。」；
 *   ② 口语只说一个「关」字，规则引擎的动词表命不中；
 *   ③ 「关 闭」「关微信」这类断词/省略，detectClose 认不出。
 * 统一在入口净化，键盘听写、网页识别、手打文字三条链路共用，不改动执行引擎。 */
let lastAppContext = '';   // 最近一次指令涉及的真实应用名，供「把它关了」这类指代使用

// 整句精确别名：只在这些「没有宾语」的裸动词上补全，避免误伤搜索关键词
const SPEECH_BARE_ALIAS = {
  '关': '关闭', '关了': '关闭', '关掉': '关闭', '关上': '关闭', '关一下': '关闭',
  '关闭一下': '关闭', '关闭它': '关闭', '关掉它': '关闭', '关了它': '关闭',
  '把它关了': '关闭', '把它关掉': '关闭', '把它关闭': '关闭', '关了吧': '关闭',
  '退': '退出', '退出去': '退出', '退掉': '退出', '退出它': '退出', '退了吧': '退出',
  '结束它': '关闭', '杀掉它': '关闭', '退粗': '退出',
  '关必': '关闭', '关毕': '关闭', 'guanbi': '关闭',
};
// ASR 高频同音错字：只修句首动作词，绝不碰后面的搜索词
const SPEECH_TYPO_RE = /^(?:guan\s*bi|关必|关毕|关璧|关币|关碧|关臂|观必|观毕|官必|关闭昂|关必昂|关掉昂|关掉啊|关闭啊|退出啊|退出昂|退粗)/i;
// 必须带明确指代词才启用上下文，否则裸「关闭」会被误替换成「关闭微信」
const SPEECH_CONTEXT_CLOSE = /^(?:把它关了|把它关掉|把它关闭|把它退出|把它给关了|把这个关了|把那个关了|关掉它|关闭它|退出它|关了它|结束它|刚才那个关掉|刚才的关掉|再关一次|再关一遍|又关一次|关掉刚才那个|关闭刚才那个)$/;
const SPEECH_CONTEXT_OPEN = /^(?:打开它|再打开|再开一次|打开刚才那个|打开刚才的)$/;

function sanitizeSpeech(text) {
  const original = String(text == null ? '' : text).trim();
  let s = original;
  if (!s) return s;
  // ① 句尾语气标点（只去尾部，保留「原文:」「——」等中间结构）
  s = s.replace(/[。．.!！?？,，、;；…~～\s]+$/g, '')
       .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2'); // 「关 闭」→「关闭」
  // ② 同音错字 → 规范动词
  s = s.replace(SPEECH_TYPO_RE, m => /退/.test(m) ? '退出' : '关闭');
  // ③ 裸动词别名（整句精确匹配，最安全）
  if (SPEECH_BARE_ALIAS[s]) return SPEECH_BARE_ALIAS[s];
  // ④ 「关微信」补成「关闭微信」，但避开「关注/关于/关系/关心/关键…」等正常词
  if (/^关(?!注|于|系|心|键|照|怀|闭|掉|了|上|门|灯)/.test(s)) s = '关闭' + s.slice(1);
  return s || original;
}
function resolveContextRef(text) {
  const s = String(text || '').trim();
  if (!lastAppContext) return s;
  if (SPEECH_CONTEXT_CLOSE.test(s)) return '关闭' + lastAppContext;
  if (SPEECH_CONTEXT_OPEN.test(s)) return '打开' + lastAppContext;
  return s;
}
function rememberAppContext(text) {
  try {
    const it = localParse(text);
    if (it && !it.lowConfidence && it.appName) lastAppContext = it.appName;
  } catch (e) { /* 上下文只是增强，失败不影响主流程 */ }
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
  const cleaned = sanitizeSpeech(text);
  // 明确的系统短指令直接返回，绝不过 LLM。
  // 实测 LLM 会把单字「关」幻觉成「打开《关》」（把指令当影片名），短指令交给规则引擎更准更快。
  if (cleaned.length <= 12) {
    try {
      const it = localParse(cleaned);
      if (it && !it.lowConfidence && ['close', 'window', 'media', 'edit', 'system'].includes(it.action)) return cleaned;
    } catch (e) { /* 继续走 LLM */ }
  }
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
            { role: 'user', content: cleaned },
          ],
        }),
      });
      const j = await r.json();
      const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      // LLM 输出也可能带语气标点或把短动词改坏，回来再净化一次
      if (c) return sanitizeSpeech(c.trim().replace(/^["“”]|["“”]$/g, ''));
    } catch (e) { /* 降级本地 */ }
  }
  return normalizeSpeech(cleaned);
}

/* ---------------- 执行引擎 ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = (cmd) => new Promise((res, rej) => {
  // LB_DRY_RUN=1 用于自测/演示：走完整流程但不真的操控 Mac，默认关闭
  if (process.env.LB_DRY_RUN) {
    console.log('[dry-run] ' + cmd);
    // 模拟真实行为：open -a 找不到应用时应失败，以便验证「未安装 → 网页版」回退
    const m = /^open -a "([^"]+)"/.exec(cmd);
    if (m && !resolveAppEntry(m[1])) return rej(new Error('Unable to find application named ' + m[1]));
    return res('dry-run');
  }
  exec(cmd, { timeout: 9000 }, (err, stdout, stderr) => err ? rej(Object.assign(err, { stderr })) : res(stdout.trim()));
});
// AppleScript 键击：mod 为 'command' / 'command,shift' / 'control,command'；
// key 为单个字符/'return'（keystroke）或纯数字（key code，用于功能键如 F11=103）
function keystroke(mod, key) {
  const using = mod ? ` using {${mod.split(',').map(m => m + ' down').join(', ')}}` : '';
  const k = /^\d+$/.test(key) ? `key code ${key}` : `keystroke "${key}"`;
  return sh(`osascript -e 'tell application "System Events" to ${k}${using}'`);
}
// 需要辅助功能权限的键击：先探测权限，无权限则打开设置引导
async function runKeystroke(mod, key, okNote) {
  const hasPermission = await checkAccessibility();
  if (!hasPermission) {
    await openAccessibilityPrefs();
    return { note: '检测到辅助功能未授权，已自动打开系统设置。请在「隐私与安全 → 辅助功能」中添加并开启当前终端后重试。', needPermission: true };
  }
  await keystroke(mod, key);
  return { note: okNote };
}
// 媒体控制：优先驱动正在运行的主流音乐 App，兜底发送系统媒体键
async function mediaControl(sub) {
  const verb = { playpause: 'playpause', next: 'next track', prev: 'previous track' }[sub];
  if (!verb) return '未知媒体操作';
  const label = sub === 'playpause' ? '播放/暂停' : sub === 'next' ? '下一首' : '上一首';
  const apps = ['Spotify', 'Music', 'NeteaseMusic', 'QQMusic'];
  for (const app of apps) {
    try {
      const isRun = (await sh(`osascript -e 'tell application "System Events" to get exists process "${app}"' 2>/dev/null`)).trim();
      if (isRun === 'true') {
        await sh(`osascript -e 'tell application "${app}" to ${verb}'`).catch(() => {});
        return `已对「${app}」执行${label}`;
      }
    } catch (e) {}
  }
  // 兜底：系统媒体键（需辅助功能）
  try {
    const code = sub === 'next' ? 101 : sub === 'prev' ? 98 : 100;
    const hasPermission = await checkAccessibility();
    if (!hasPermission) { await openAccessibilityPrefs(); return '未检测到正在播放的音乐 App，且辅助功能未授权（已打开设置）。播放/暂停依赖 Spotify / 音乐 / 网易云 / QQ音乐，请先授权后再试。'; }
    await sh(`osascript -e 'tell application "System Events" to key code ${code}'`);
    return '已发送系统媒体键（未检测到常驻音乐 App）';
  } catch (e) {
    return '未检测到正在播放的音乐 App（播放/暂停依赖 Spotify / 音乐 / 网易云 / QQ音乐）';
  }
}
function setStage(t, i, state, note) { t.stages[i].state = state; if (note) t.stages[i].note = note; save(); }
function fail(t, i, msg) { setStage(t, i, 'failed', msg); t.status = 'failed'; t.error = msg; t.finishedAt = Date.now(); save(); console.log(`[FAIL] ${t.id}: ${msg}`); }

function planText(it) {
  switch (it.action) {
    case 'system': return { volume_up: 'osascript 调高系统音量 +10', volume_down: 'osascript 调低系统音量 -10', mute: 'osascript 静音', brightness: '打开「显示设置」', screenshot: 'screencapture 截图保存到桌面', lock: '调用 CGSession 锁屏', trash: '高危操作，提示用户手动确认', settings: '打开系统设置' }[it.sub];
    case 'close': return {
      quit_front: 'osascript 取前台应用 → quit 退出',
      quit_app: 'osascript quit application "' + (it.app || it.appName) + '"',
      close_window: 'System Events 发送 Cmd+W 关闭窗口',
      close_tab: 'System Events 发送 Cmd+W 关闭标签页'
    }[it.sub];
    case 'window': return {
      minimize: 'System Events 发送 Cmd+M 最小化',
      hide: 'System Events 发送 Cmd+H 隐藏',
      fullscreen: 'System Events 发送 Ctrl+Cmd+F 切换全屏',
      show_desktop: 'System Events 触发显示桌面'
    }[it.sub];
    case 'media': return {
      playpause: 'AppleScript 控制音乐 App 播放/暂停',
      next: 'AppleScript 控制音乐 App 下一首',
      prev: 'AppleScript 控制音乐 App 上一首'
    }[it.sub];
    case 'edit': return {
      select_all: 'System Events 发送 Cmd+A', copy: 'System Events 发送 Cmd+C', cut: 'System Events 发送 Cmd+X',
      paste: 'System Events 发送 Cmd+V', undo: 'System Events 发送 Cmd+Z', redo: 'System Events 发送 Cmd+Shift+Z',
      enter: 'System Events 发送 Return', refresh: 'System Events 发送 Cmd+R', back: 'System Events 发送 Cmd+[', forward: 'System Events 发送 Cmd+]'
    }[it.sub];
    case 'note': return '把内容写入剪贴板 → 打开备忘录 → 提示粘贴';
    case 'type': return it.app
      ? `open -a "${it.app}" → 等待 1.5s → pbcopy 写入剪贴板 → osascript 模拟 Cmd+V 粘贴`
      : '直输模式：向当前前台应用直接粘贴文字（不打开应用、不解析指令）';
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
  const fast = !!t.direct;   // 直输模式跳过演示性等待，连续输入不卡顿
  try {
    setStage(t, 0, 'running'); await sleep(fast ? 60 : 380);
    if (!t.instruction.trim()) return fail(t, 0, '指令为空，请说出你想让 Mac 做什么');
    // 直输：默认把原话填进当前前台应用；若它其实是一条明确指令（且未标记「原文」），
    // 自动逃逸成指令并退出直输——用户永远不会被困在输入框里下不了指令。
    let it, escaped = false;
    if (t.direct) {
      const cmd = t.forceText ? null : commandEscape(t.instruction);
      if (cmd) {
        it = cmd; it.source = 'rule'; escaped = true; t.escaped = true; t.direct = false; save();
      } else {
        it = { action: 'type', target: t.instruction, app: null, appName: '当前应用', platform: null, contentType: null, raw: t.instruction, source: 'direct' };
      }
    } else {
      it = await parseInstruction(t.instruction);
    }
    it._desc = describeIntent(it);
    t.intent = it; t.movie = it.target; t.platform = it.platform; t.action = it.action; save();

    if (it.action !== 'system' && it.action !== 'open_site' && it.action !== 'close' && it.action !== 'window' && it.action !== 'media' && it.action !== 'edit' && !it.target) {
      return fail(t, 0, '没识别到操作对象，试试「百度一下 Python 教程」「打开微信」「截个屏」');
    }
    setStage(t, 0, 'done', (escaped ? '识别为指令 · 已自动退出直输 · ' : '') + '理解：' + it._desc + ' · 解析：' + (it.source === 'llm' ? '大模型' : it.source === 'direct' ? '直输（跳过解析）' : '规则引擎'));

    setStage(t, 1, 'running'); await sleep(fast ? 60 : 480);
    if (!t.direct && !escaped && /失败|异常|权限|崩|报错/.test(t.instruction)) return fail(t, 1, '模拟异常：Mac 端「屏幕控制」权限未授权，任务中止（演示失败反馈）');
    setStage(t, 1, 'done', '策略：' + planText(it));

    setStage(t, 2, 'running'); await sleep(fast ? 60 : 380);
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
      } else if (it.action === 'close') {
        const sub = it.sub;
        if (sub === 'quit_app') {
          const realName = resolveApp(it.app);
          await sh(`osascript -e 'quit application "${realName}"'`);
          execNote = result = '已退出应用：' + (it.appName || realName);
        } else if (sub === 'quit_front') {
          // 优先走 AppKit 取前台应用：不依赖「辅助功能」权限，裸「关闭」在未授权时也能生效。
          // 旧实现只用 System Events，权限一丢就把错误文本当成应用名，回报「已退出」但其实什么都没做。
          let front = '';
          try {
            front = (await sh(`osascript -l JavaScript -e 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.localizedName.js'`)).trim();
          } catch (e) { front = ''; }
          if (!front || /execution error|权限|-10004|-1743|not allowed/i.test(front)) {
            try { front = (await sh(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`)).trim(); }
            catch (e2) { front = ''; }
          }
          if (!front || /execution error|权限|-10004|-1743|not allowed/i.test(front)) {
            await openAccessibilityPrefs();
            t.needPermission = true;
            throw new Error('取不到前台应用，需要辅助功能权限。已在 Mac 上打开「隐私与安全 → 辅助功能」，勾选后重试。');
          }
          await sh(`osascript -e 'quit application "${front}"'`).catch(() => {});
          execNote = result = '已退出当前应用：' + front;
        } else if (sub === 'close_window' || sub === 'close_tab') {
          const r = await runKeystroke('command', 'w', sub === 'close_tab' ? '已关闭当前标签页（Cmd+W）' : '已关闭当前窗口（Cmd+W）');
          execNote = result = r.note; if (r.needPermission) t.needPermission = true;
        } else throw new Error('未知关闭操作');
      } else if (it.action === 'window') {
        const sub = it.sub;
        if (sub === 'minimize') { const r = await runKeystroke('command', 'm', '已最小化当前窗口（Cmd+M）'); execNote = result = r.note; if (r.needPermission) t.needPermission = true; }
        else if (sub === 'hide') { const r = await runKeystroke('command', 'h', '已隐藏当前应用（Cmd+H）'); execNote = result = r.note; if (r.needPermission) t.needPermission = true; }
        else if (sub === 'fullscreen') { const r = await runKeystroke('control,command', 'f', '已切换全屏状态（Ctrl+Cmd+F）'); execNote = result = r.note; if (r.needPermission) t.needPermission = true; }
        else if (sub === 'show_desktop') { const r = await runKeystroke(null, '103', '已尝试显示桌面（F11 功能键）'); execNote = result = r.note; if (r.needPermission) t.needPermission = true; }
        else throw new Error('未知窗口操作');
      } else if (it.action === 'media') {
        const m = await mediaControl(it.sub);
        execNote = result = m;
      } else if (it.action === 'edit') {
        const sub = it.sub;
        const map = { select_all: ['command', 'a'], copy: ['command', 'c'], cut: ['command', 'x'], paste: ['command', 'v'], undo: ['command', 'z'], redo: ['command,shift', 'z'], enter: [null, 'return'], refresh: ['command', 'r'], back: ['command', '['], forward: ['command', ']'] };
        const m = map[sub];
        if (!m) throw new Error('未知编辑操作');
        const r = await runKeystroke(m[0], m[1], '已执行：' + ({ select_all: '全选', copy: '复制', cut: '剪切', paste: '粘贴', undo: '撤销', redo: '重做', enter: '回车/发送', refresh: '刷新', back: '后退', forward: '前进' }[sub]));
        execNote = result = r.note; if (r.needPermission) t.needPermission = true;
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
        if (it.sub === 'open_app') {
          // 1) 用自发现到的真实 .app 路径打开（最稳，绕开 open -a 名称匹配）
          const hit = resolveAppEntry(it.app || it.target);
          let done = false;
          if (hit) {
            try { await sh(`open "${hit.path}"`); done = true; execNote = result = '已打开应用：' + hit.name; } catch (e) {}
          }
          // 2) 退回字典名
          if (!done) {
            try { await sh(`open -a "${resolveApp(it.app)}"`); done = true; execNote = result = '已打开应用：' + it.target; } catch (e) {}
          }
          // 3) 仍未打开 → 智能兜底：网页版 / 相似应用建议，而不是干巴巴报失败
          if (!done) {
            const web = findWebFallback(it);
            if (web) {
              try { await sh(`open "${web.url}"`); execNote = result = `本机未安装「${it.target}」，已为你打开${web.label}`; }
              catch (e) { execNote = result = `本机未安装「${it.target}」，网页版也未能打开`; }
            } else {
              const cands = similarApps(it.target || it.app);
              execNote = result = `未找到应用「${it.target}」` +
                (cands.length ? `。本机有：${cands.join('、')}，可以说「打开${cands[0]}」` : '，请先在 Mac 上安装后重试');
            }
          }
        }
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

    setStage(t, 3, 'running'); await sleep(fast ? 60 : 360);
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
<title>龙虾脑</title><script>try{var _t=localStorage.getItem('lb_theme')||'light';document.documentElement.setAttribute('data-theme',_t);}catch(e){}</script><style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#fff;--fg:#1A1A1A;--muted:#888;--line:#E5E5E5;--card:#F7F7F7;--accent:#1A1A1A;--icon-fg:#fff;--fab-bg:rgba(255,255,255,.9);--fab-fg:#999;--pad:#EDEDED;--knob:#fff;--knob-bd:#CCC}
[data-theme="dark"]{--bg:#0B0B0B;--fg:#F2F2F2;--muted:#9A9A9A;--line:#2A2A2A;--card:#1A1A1A;--accent:#F2F2F2;--icon-fg:#0B0B0B;--fab-bg:rgba(28,28,28,.86);--fab-fg:#BBB;--pad:#222;--knob:#333;--knob-bd:#444}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;position:fixed;inset:0;width:100%;height:100vh;height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.main{flex:1;min-height:0;overflow-y:auto;padding:12px 18px 10px;display:flex;flex-direction:column;-webkit-overflow-scrolling:touch}
.voice-area{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 0 16px}
.mic-btn{width:80px;height:80px;border-radius:50%;border:none;cursor:pointer;position:relative;flex-shrink:0;-webkit-user-select:none;user-select:none;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:radial-gradient(circle at 33% 27%, #A98CFF 0%, #7B5BFF 32%, #5B7CF5 64%, #46C8E8 100%);
  box-shadow:0 6px 20px rgba(91,92,245,.40), inset 0 2px 6px rgba(255,255,255,.45), inset 0 -7px 14px rgba(0,0,0,.22);
  transition:transform .15s}
.mic-btn::after{content:'';position:absolute;top:11px;left:19px;width:32px;height:20px;border-radius:50%;background:radial-gradient(circle at 40% 35%, rgba(255,255,255,.9), rgba(255,255,255,0) 70%);pointer-events:none}
.orb{position:relative;display:flex;gap:7px;align-items:center;justify-content:center;z-index:1}
.orb-pill{width:6px;height:27px;border-radius:4px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.mic-btn.recording{transform:scale(1.1);box-shadow:0 6px 28px rgba(91,92,245,.6), inset 0 2px 6px rgba(255,255,255,.45), inset 0 -7px 14px rgba(0,0,0,.22)}
.mic-btn.recording::before{content:'';position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(123,91,255,.35);animation:ripple 1.2s infinite}
.mic-btn.disabled{background:#B9B9B9;box-shadow:none;cursor:default}
.mic-btn.disabled::after{display:none}
@keyframes ripple{0%{transform:scale(1);opacity:.5}100%{transform:scale(1.5);opacity:0}}
.mic-label{margin-top:12px;font-size:13px;color:var(--muted);text-align:center;min-height:20px}
.mic-label.recording{color:var(--fg);font-weight:500}
.mic-hint{margin-top:3px;font-size:11px;color:#BBB;text-align:center;max-width:260px;line-height:1.5}
.mic-hint a{color:var(--fg);text-decoration:underline;cursor:pointer;font-weight:500}
.status-area{margin-top:4px}
.task-card{background:var(--card);border-radius:12px;padding:14px;margin-bottom:8px}
.task-card .echo{font-size:14px;font-weight:500;color:var(--fg);margin-bottom:6px}
.understand{background:var(--card);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--muted);margin:6px 0}
.understand b{font-weight:600;color:var(--fg)}
.cmd-chip{flex:0 0 auto;padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:13px;color:var(--fg);white-space:nowrap;cursor:pointer;font-family:inherit}
.cmd-chip:active{background:var(--accent);color:var(--icon-fg)}
.app-ic svg{width:26px;height:26px;display:block}
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
.apps{display:flex;gap:10px;overflow-x:auto;margin-bottom:8px;padding:2px 0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.apps::-webkit-scrollbar{display:none}
.app-tile{flex-shrink:0;width:54px;display:flex;flex-direction:column;align-items:center;gap:4px;background:none;border:none;padding:0;font-family:inherit;cursor:pointer}
.app-ic{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12);transition:transform .12s}
.app-tile:active .app-ic{transform:scale(.9)}
.app-lb{font-size:11px;color:var(--muted);white-space:nowrap}
.mode-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:6px 10px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:12px;color:#666}
.mode-bar.direct{background:#1A1A1A;border-color:#1A1A1A;color:#fff}
.mode-txt{flex:1;line-height:1.35}
.mode-btn{flex-shrink:0;border:1px solid currentColor;border-radius:14px;background:transparent;color:inherit;font-size:11px;font-family:inherit;padding:4px 10px;cursor:pointer;white-space:nowrap}
.mode-bar.direct .mode-btn{background:#fff;color:#1A1A1A;border-color:#fff}
.mode-sub{display:block;font-size:10.5px;opacity:.7;margin-top:2px;line-height:1.35}
.input-bar{display:flex;gap:8px;align-items:center}
.input-bar input{flex:1;border:1px solid var(--line);border-radius:20px;padding:10px 14px;font-size:15px;font-family:inherit;outline:none;background:var(--card);transition:border-color .15s}
.input-bar input:focus{border-color:var(--fg);background:var(--bg)}
.send-btn{width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:var(--icon-fg);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:opacity .15s}
.send-btn:active{opacity:.7}
.send-btn svg{width:18px;height:18px;fill:var(--icon-fg)}
.dash-fab{position:absolute;top:8px;right:14px;font-size:11px;color:var(--fab-fg);text-decoration:none;padding:3px 10px;border:1px solid var(--line);border-radius:12px;background:var(--fab-bg);z-index:51}
.cfg-fab{position:absolute;top:8px;right:62px;font-size:11px;color:var(--fab-fg);text-decoration:none;padding:3px 10px;border:1px solid var(--line);border-radius:12px;background:var(--fab-bg);z-index:51}
.theme-switch{position:absolute;top:9px;left:14px;width:40px;height:22px;display:inline-block;z-index:52;cursor:pointer}
.theme-switch input{opacity:0;width:0;height:0;margin:0}
.theme-switch .slider{position:absolute;inset:0;background:#C8C8C8;border-radius:999px;transition:.2s}
.theme-switch .slider::before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.theme-switch input:checked + .slider{background:#1A1A1A}
.theme-switch input:checked + .slider::before{transform:translateX(18px)}
.topbar{position:relative;flex-shrink:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 14px;box-sizing:border-box;margin:0}
.trackpad-title{font-size:12px;color:#888;margin-bottom:8px;text-align:center}
.pad-row{display:flex;gap:10px;align-items:stretch;height:clamp(110px,20dvh,160px)}
.trackpad{position:relative;flex:1;height:100%;background:var(--pad);border-radius:10px;overflow:hidden;touch-action:none}
.trackpad-hint{position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);text-align:center;color:var(--muted);font-size:12px;pointer-events:none}
.wheel{width:58px;flex-shrink:0;height:100%;display:flex;flex-direction:column;gap:4px;touch-action:none}
.wheel-btn{height:28px;flex-shrink:0;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--muted);font-size:15px;font-family:inherit;cursor:pointer;line-height:1}
.wheel-btn:active{background:var(--accent);color:var(--icon-fg)}
.wheel-track{position:relative;flex:1;min-height:0;background:var(--pad);border-radius:8px;overflow:hidden;touch-action:none}
.wheel-knob{position:absolute;left:7px;right:7px;height:24px;top:50%;transform:translateY(-50%);border-radius:6px;background:var(--knob);border:1px solid var(--knob-bd);box-shadow:0 1px 3px rgba(0,0,0,.12);pointer-events:none}
.wheel-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);font-size:10px;line-height:1.45;pointer-events:none}
</style></head><body>
<div class="topbar" id="topbar">
  <label class="theme-switch" id="themeSwitch" title="深色 / 浅色切换"><input type="checkbox" id="themeToggle" onchange="toggleTheme()"><span class="slider"></span></label>
  <div class="trackpad-title">鼠标控制（触控板 · 滚轮）</div>
  <a href="/config" class="cfg-fab" target="_blank">配置</a>
  <a href="/dashboard" class="dash-fab" target="_blank">看板</a>
  <div class="pad-row">
    <div class="trackpad" id="trackpad">
      <div class="trackpad-hint">手指滑动移动光标 · 轻点=点击</div>
    </div>
    <div class="wheel">
      <button class="wheel-btn" id="wheelUp" type="button" aria-label="向上滚动">▲</button>
      <div class="wheel-track" id="wheelTrack">
        <div class="wheel-knob" id="wheelKnob"></div>
        <div class="wheel-hint">上滑向上<br>下滑向下</div>
      </div>
      <button class="wheel-btn" id="wheelDown" type="button" aria-label="向下滚动">▼</button>
    </div>
  </div>
</div>
<div class="main" id="main">
  <div class="voice-area">
    <button class="mic-btn" id="mic" type="button"><span class="orb"><span class="orb-pill"></span><span class="orb-pill"></span></span></button>
    <div class="mic-label" id="micLabel">按住说话</div>
    <div class="mic-hint" id="micHint"></div>
  </div>
  <div class="status-area" id="statusArea"></div>
</div>

<div id="lock" style="display:none;position:fixed;inset:0;background:rgba(255,255,255,.97);z-index:100;flex-direction:column;align-items:center;justify-content:center;padding:24px">
  <div style="font-size:16px;font-weight:600;margin-bottom:6px">需要访问令牌</div>
  <div style="font-size:13px;color:#888;margin-bottom:18px;text-align:center;line-height:1.6">龙虾脑已开启局域网保护。<br>请在 Mac 本机打开 <b style="color:#222">控制台 /manage</b>，复制带 <b style="color:#222">?t=</b> 的「.local 手机链接」重新打开；<br>或把下方令牌粘贴进来。</div>
  <input id="lockPwd" type="password" placeholder="访问令牌" style="width:100%;max-width:300px;border:1px solid #DDD;border-radius:10px;padding:12px;font-size:15px;outline:none;text-align:center" onkeydown="if(event.key==='Enter')doUnlock()">
  <button onclick="doUnlock()" style="margin-top:12px;width:100%;max-width:300px;padding:12px;border:none;border-radius:10px;background:#1A1A1A;color:#fff;font-size:15px;cursor:pointer">解锁</button>
</div>
<div class="bottom-bar">
  <div class="apps" id="apps"></div>
  <div style="display:flex;gap:8px;padding:0 12px 8px;overflow-x:auto">
    <button class="cmd-chip" onclick="quickSend('关闭')">关闭当前应用</button>
    <button class="cmd-chip" onclick="quickSend('最小化')">最小化窗口</button>
    <button class="cmd-chip" onclick="quickSend('全屏')">切换全屏</button>
    <button class="cmd-chip" onclick="quickSend('锁屏')">锁屏</button>
    <button class="cmd-chip" onclick="quickSend('截个屏')">截图</button>
    <button class="cmd-chip" onclick="quickSend('刷新')">刷新</button>
  </div>
  <div class="mode-bar" id="modeBar">
    <span class="mode-txt" id="modeText"><b>指令模式</b> · 输入会被解析成任务</span>
    <button class="mode-btn" id="modeBtn" onclick="toggleDirect()" type="button">连续直输</button>
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
function connStatus(html, type){
  var el=document.getElementById('statusArea'); if(!el) return;
  if(!html){ el.innerHTML=''; return; }
  var color = type==='ok' ? '#0A7' : type==='err' ? '#D33' : '#E08A00';
  var bg = type==='ok' ? '#EAF7EE' : type==='err' ? '#FDECEC' : '#FFF6E6';
  var retry = type==='err' ? ' <a href="javascript:probe()" style="color:inherit;text-decoration:underline;margin-left:4px">重试</a>' : '';
  el.innerHTML='<div style="font-size:12px;color:'+color+';text-align:center;padding:5px 10px;margin:2px 0;background:'+bg+';border-radius:8px;line-height:1.45">'+html+retry+'</div>';
}
function onAuthFail(){ try{ localStorage.removeItem('lb_token'); }catch(e){} LB_TOKEN=''; showLock(); connStatus('令牌无效或已变更：请在 Mac 控制台 /manage 复制带 ?t= 的新链接重新打开','err'); }
function lbFetch(p, o){ o=o||{}; o.headers=Object.assign({'Content-Type':'application/json'}, o.headers||{}); if(LB_TOKEN) o.headers['x-lb-token']=LB_TOKEN; return fetch(p,o).then(function(r){ if(r.status===401) onAuthFail(); return r; }).catch(function(err){ connStatus('操作失败：无法连接 Mac 服务，请确认服务正在运行后重试','err'); throw err; }); }
function showLock(){ var el=document.getElementById('lock'); if(el) el.style.display='flex'; }
function doUnlock(){ var e=document.getElementById('lockPwd'); var v=e?e.value.trim():''; if(!v) return; LB_TOKEN=v; try{localStorage.setItem('lb_token',v);}catch(e){} location.search='?t='+encodeURIComponent(v); }
function probe(){
  connStatus('正在连接 Mac…');
  fetch('/api/tasks', {headers:{'x-lb-token':LB_TOKEN,'Content-Type':'application/json'}})
    .then(function(r){ if(r.ok){ connStatus('已连接 Mac ✓','ok'); setTimeout(function(){connStatus('');},1500); } else if(r.status===401){ onAuthFail(); } else { connStatus('服务返回异常（HTTP '+r.status+'）','err'); } })
    .catch(function(){ connStatus('无法连接 Mac 服务：请确认 Mac 上的「龙虾脑」正在运行，然后刷新本页','err'); });
}
var cur=null,timer=null;
var rec=null,recognizing=false,voiceReady=false;
// 直输不再是粘性全局开关：默认只对「下一条」生效，发完自动回到指令模式。
var directLeft=0;       // 剩余一次性直输条数（点 App 图标后置 1）
var directLock=false;   // 用户显式开启的连续直输
var directLabel='';
function isDirect(){ return directLock || directLeft>0; }
// 客户端即时判定：直输状态下说的是短指令，立刻按指令执行并退出（服务端 commandEscape 为兜底）
var QUICK_CMD=/^(?:请|帮我|麻烦|给我|能不能|可以|我想|我要|想要|想|把|将|顺便)?\s*(?:打开|启动|唤起|截屏|截图|截个屏|截一张|拍个照|锁屏|锁定屏幕|锁电脑|静音|调大|调小|大声|小声|音量|声音|亮度|清空废纸篓|清废纸篓|系统设置|打开设置|搜索|搜一下|搜搜|检索|查询|查一下|查找|百度一下|谷歌一下|播放|放一下|听歌|发微信给|发消息给|通知.+[:：]|告诉.+[:：]|给.+发(?:微信|消息|短信|信息)|提醒我|记到备忘录|关闭|关掉|退出|最小化|隐藏|全屏|切换全屏|暂停|下一首|上一首|切歌|全选|复制|剪切|粘贴|撤销|重做|刷新|返回|后退|前进|回车|显示桌面)/;
function looksLikeCmd(s){ return s.length<=28 && QUICK_CMD.test(s); }
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
          if(isDirect()){
            // 直输：保留原话，不做口语规范化（规范化会把口语改写成指令式文本）
            document.getElementById('input').value=raw;
            label.innerHTML='直输：'+esc(raw);
            setTimeout(submit,300);
          }else{
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
          }
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

/* ---- 直输：默认只对「下一条」生效，发完自动回到指令模式 ---- */
function renderMode(){
  var bar=document.getElementById('modeBar'),txt=document.getElementById('modeText');
  var btn=document.getElementById('modeBtn'),inp=document.getElementById('input');
  if(!bar)return;
  if(isDirect()){
    bar.classList.add('direct');
    var scope=directLock?'连续直输（点右侧退出）':'本次直输 · 发完自动回指令模式';
    txt.innerHTML='<b>'+scope+'</b>'+(directLabel?' · 已打开「'+esc(directLabel)+'」':'')+
      '<span class="mode-sub">下指令直接说会自动识别并退出；想把指令当文字输入，前面加「原文：」</span>';
    btn.textContent=directLock?'退出直输':'取消本次';
    if(inp)inp.placeholder='输入文字（原样填写）…';
  }else{
    bar.classList.remove('direct');
    txt.innerHTML='<b>指令模式</b> · 输入会被解析成任务';
    btn.textContent='连续直输';
    if(inp)inp.placeholder='输入指令，或按住上方麦克风说话…';
  }
}
function setDirect(on,label,once){
  if(on){
    directLabel=label||'';
    if(once){ directLock=false; directLeft=1; }
    else{ directLock=true; directLeft=0; }
  }else{ directLock=false; directLeft=0; directLabel=''; }
  renderMode();
}
function consumeDirect(){
  if(directLock)return;                       // 连续直输由用户显式退出
  if(directLeft>0){ directLeft--; if(directLeft<=0)setDirect(false); }
}
function toggleDirect(){ setDirect(!isDirect(),'',false); }
/* ---- 应用快捷图标（彩色圆角方块 + 白色 SVG 品牌图标）---- */
var QUICK_APPS=[
 {n:'微信',l:'微信',c:'#07C160',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 3.5C5.4 3.5 2.5 5.9 2.5 8.9c0 1.6.9 3 2.3 3.9L3.8 14l2.2-1.1c.7.2 1.4.3 2.2.3h.4c-.1-.5-.2-1-.2-1.5 0-3 2.8-5.3 6.2-5.3h.5C14.3 5.6 11.9 3.5 9 3.5z"/><path d="M21 13.2c0-2.4-2.3-4.3-5.2-4.3s-5.2 1.9-5.2 4.3 2.3 4.3 5.2 4.3c.6 0 1.2-.1 1.7-.2l1.6.8-.4-1.4c1.1-.7 1.9-1.8 1.9-2.5z"/></svg>'},
 {n:'豆包',l:'豆包',c:'#5B6CF5',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.9 5.3L19 9l-5.1 1.7L12 16l-1.9-5.3L5 9l5.1-1.7z"/><path d="M18 13l.9 2.5L21.5 16l-2.6.9L18 19l-.9-2.6L14.5 16l2.6-.9z" opacity=".75"/></svg>'},
 {n:'抖音',l:'抖音',c:'#161823',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M14 3c.4 2.1 1.8 3.7 3.8 4.1V10c-1.3 0-2.6-.4-3.8-1.2V15a5 5 0 1 1-5-5c.3 0 .7 0 1 .1V13a1.9 1.9 0 1 0 1 1.7V3z"/></svg>'},
 {n:'WorkBuddy',l:'WorkBuddy',c:'#FF5900',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><circle cx="9" cy="11" r="1.4" fill="#FF5900"/><circle cx="15" cy="11" r="1.4" fill="#FF5900"/></svg>'},
 {n:'浏览器',l:'浏览器',c:'#1E9BF0',g:'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M15.2 8.8l-2 5.4-5.4 2 2-5.4z" fill="#fff" stroke="none"/></svg>'},
 {n:'备忘录',l:'备忘录',c:'#F5A623',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 9h6M9 13h6M9 17h4" stroke="#F5A623" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>'},
 {n:'哔哩哔哩',l:'B站',c:'#FB7299',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M8 3.5L6 1.5M16 3.5l2-2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="3" y="4.5" width="18" height="13" rx="3"/><path d="M9.5 9.5l4.2 2.3-4.2 2.3z" fill="#FB7299"/></svg>'},
 {n:'网易云音乐',l:'网易云',c:'#E03A3A',g:'<svg viewBox="0 0 24 24" fill="#fff"><path d="M9 4v10.6a3 3 0 1 0 2 2.8V8l7-2.2V14a3 3 0 1 0 2 2.8V4z"/></svg>'}
];
function renderApps(){var box=document.getElementById('apps');if(!box)return;box.innerHTML=QUICK_APPS.map(function(a){return '<button class="app-tile" onclick="openApp(\''+a.n+'\',\''+a.l+'\')"><span class="app-ic" style="background:'+a.c+'">'+a.g+'</span><span class="app-lb">'+a.l+'</span></button>';}).join('');}
function toggleTheme(){var cur=document.documentElement.getAttribute('data-theme');var next=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',next);try{localStorage.setItem('lb_theme',next);}catch(e){}var tg=document.getElementById('themeToggle');if(tg)tg.checked=(next==='dark');}

function openApp(name,label){
  setDirect(false);                           // 确保「打开X」作为指令执行
  quickSend('打开'+name);
  setDirect(true,label,true);                 // 仅下一条输入直输，之后自动复原
}

/* ---- 提交任务：指令模式走 NLU；直输原样填写，且发完自动复原 ---- */
async function submit(){
  var inp=document.getElementById('input');
  var v=inp.value.trim();
  if(!v){inp.focus();return}
  // 逃生：任何时候提到这些词都立刻回到指令模式（包含匹配，语音带语气词也能命中）
  if(isDirect() && /退出直输|退出输入|返回指令|指令模式|结束直输|取消直输|不要直输|别直输/.test(v)){
    inp.value=''; setDirect(false); return;
  }
  var payload,echoTag;
  var forceCmd=v.match(/^(?:指令|执行)[:：]\s*(.+)$/);
  var forceText=v.match(/^(?:原文|照抄|输入)[:：]\s*(.+)$/);
  if(forceCmd){
    // 强制按指令执行：无论当前在哪个模式，并立刻退出直输
    v=forceCmd[1].trim(); payload={instruction:v}; echoTag='指令：';
    if(isDirect())setDirect(false);
  }else if(forceText){
    // 强制当成原文输入：即使这句话长得像指令，也不做逃逸判定
    v=forceText[1].trim(); payload={instruction:v,direct:true,forceText:true}; echoTag='原文：';
  }else if(isDirect() && looksLikeCmd(v)){
    // 直输状态下说的是明确指令：直接按指令执行，并立刻退出直输
    payload={instruction:v}; echoTag='指令：';
    setDirect(false);
  }else if(isDirect()){
    payload={instruction:v,direct:true}; echoTag='直输：';
  }else{
    payload={instruction:v}; echoTag='指令：';
  }
  // 一次性直输发完立即复原，界面马上变回「指令模式」
  if(payload.direct)consumeDirect();
  inp.value='';
  document.getElementById('send').style.opacity='.5';
  try{
    var r=await lbFetch('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    cur=(await r.json()).id;
    var sa=document.getElementById('statusArea');
    sa.innerHTML='<div class="task-card"><div class="echo">'+echoTag+'「'+esc(v)+'」</div><div id="understand"></div><div id="stages"></div><div class="task-time" id="meta"></div></div><div id="resultBox"></div>';
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
  // 服务端判定「这条其实是指令」并逃逸执行 → 手机端立刻跟着退出直输
  if(t.escaped&&isDirect())setDirect(false);
  var u=document.getElementById('understand');
  if(t.intent&&t.intent._desc&&t.stages[0].state==='done'){
    u.innerHTML='<div class="understand"><b>我理解：</b>'+esc(t.intent._desc)+(t.escaped?'<br><span style="color:#0A7">已识别为指令，自动退出直输</span>':'')+'</div>';
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
renderMode();
renderApps();
(function(){var tg=document.getElementById('themeToggle');if(tg)tg.checked=(document.documentElement.getAttribute('data-theme')==='dark');})();
probe();
// 切回页面（从 /manage 复制链接回来）时自动复检连接/令牌
document.addEventListener('visibilitychange', function(){ if(!document.hidden) probe(); });
window.addEventListener('focus', function(){ setTimeout(probe, 300); });

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

/* ---- 固定顶部控制板：软键盘弹出时也不被顶出屏幕 ---- */
/* 控制板已是 body(flex) 的首个固定块，不再用 position:fixed；
   再用 visualViewport 把 body 对齐到「键盘上方」的可见区，
   并持续把页面滚回原点，彻底避免 iOS 把整页上推。 */
(function(){
  var body=document.body, vv=window.visualViewport, raf=null;
  function fit(){
    if(vv){
      body.style.height=vv.height+'px';
      body.style.transform='translateY('+(vv.offsetTop||0)+'px)';
    }
    if(window.scrollX||window.scrollY) window.scrollTo(0,0);
  }
  function schedule(){ if(raf) return; raf=requestAnimationFrame(function(){raf=null;fit();}); }
  if(vv){ vv.addEventListener('resize',schedule); vv.addEventListener('scroll',schedule); }
  window.addEventListener('resize',schedule);
  window.addEventListener('focusin',function(){schedule();setTimeout(schedule,300);setTimeout(schedule,600);});
  fit();
})();

/* ---- 滚轮：上下滑动 / 单步按钮 → Mac 页面滚动 ---- */
(function(){
  var track=document.getElementById('wheelTrack');
  var knob=document.getElementById('wheelKnob');
  var up=document.getElementById('wheelUp');
  var down=document.getElementById('wheelDown');
  if(!track) return;
  function send(n){ lbFetch('/api/mouse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scroll:n})}); }
  if(up) up.addEventListener('click',function(){send(3);});
  if(down) down.addEventListener('click',function(){send(-3);});
  var lastY=0,pend=0,timer=null,off=0;
  function flush(){
    if(pend===0) return;
    var n=Math.max(-20,Math.min(20,Math.round(-pend*0.22))); pend=0;
    if(n!==0) send(n);
  }
  function resetKnob(){ off=0; if(knob) knob.style.top='50%'; }
  track.addEventListener('touchstart',function(e){e.preventDefault();var t=e.touches[0];lastY=t.clientY;},{passive:false});
  track.addEventListener('touchmove',function(e){
    e.preventDefault();var t=e.touches[0];var dy=t.clientY-lastY;lastY=t.clientY;pend+=dy;
    off=Math.max(-30,Math.min(30,off+dy*0.5)); if(knob) knob.style.top=(50+off)+'%';
    if(!timer) timer=setInterval(flush,45);
  },{passive:false});
  track.addEventListener('touchend',function(e){e.preventDefault();if(timer){clearInterval(timer);timer=null;}flush();resetKnob();},{passive:false});
  track.addEventListener('touchcancel',function(){if(timer){clearInterval(timer);timer=null;}flush();resetKnob();});
})();
</script></body></html>`;

/* ---------------- 全新极简手机入口 /m（每一步都显示结果/错误，独立于旧模板） ---------------- */
const MINI_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="龙虾脑">
<link rel="apple-touch-icon" href="/public/icon.png">
<title>龙虾脑</title>
<script>try{var _t=localStorage.getItem('lb_theme');if(_t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}</script>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#17171a;--muted:#8b8b92;--line:#e3e4e8;--sub:#f7f7f9;--pad1:#2c2c30;--pad2:#3a3a40;--accent:#17171a;--accentfg:#fff;--ok:#0a8a4a;--okbg:#e8f7ee;--err:#c0392b;--errbg:#fdece9}
[data-theme="dark"]{--bg:#121215;--card:#1d1d21;--fg:#f2f2f4;--muted:#8b8b93;--line:#33333a;--sub:#26262c;--pad1:#26262b;--pad2:#323238;--accent:#f2f2f4;--accentfg:#121215;--ok:#4fd18b;--okbg:#17382a;--err:#ff8a80;--errbg:#3a1f1e}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;font-size:14px}
.dock{position:sticky;top:0;z-index:20;background:var(--bg);padding:calc(8px + env(safe-area-inset-top)) 14px 10px;border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;gap:7px;height:36px}
.brand{font-size:15px;font-weight:700;white-space:nowrap;flex-shrink:0}
.status{flex:1;min-width:0;height:34px;display:flex;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--line);border-radius:9px;background:var(--card);overflow:hidden}
.status.ok{color:var(--ok);background:var(--okbg);border-color:currentColor}
.status.err{color:var(--err);background:var(--errbg);border-color:currentColor}
.dot{width:7px;height:7px;border-radius:50%;background:#b9b9c0;flex-shrink:0}
.stxt{font-size:12px;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.status:not(.ok):not(.err) .stxt{color:var(--muted)}
.mini{flex-shrink:0;height:30px;min-width:38px;padding:0 9px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--fg);font-size:12px;font-family:inherit;line-height:28px;text-align:center;text-decoration:none;cursor:pointer}
.mini:active{opacity:.6}
.padrow{display:flex;gap:8px;margin-top:9px;height:152px}
.pad{flex:1;min-width:0;border-radius:12px;background:linear-gradient(135deg,var(--pad1),var(--pad2));border:1px solid rgba(255,255,255,.06);color:#a9a9b2;display:flex;align-items:center;justify-content:center;font-size:12px;touch-action:none;position:relative;overflow:hidden}
.pad:active{opacity:.92}
.wheel{width:52px;flex-shrink:0;border-radius:12px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;padding:5px;gap:5px;touch-action:none}
.track{flex:1;min-height:0;border-radius:8px;background:var(--sub);color:var(--muted);font-size:10px;letter-spacing:2px;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;touch-action:none}
.wb{display:flex;gap:4px;flex-shrink:0}
.wbt{flex:1;height:26px;border:1px solid var(--line);border-radius:7px;background:var(--sub);color:var(--fg);font-size:12px;font-family:inherit;line-height:1;padding:0}
.wbt:active{background:var(--accent);color:var(--accentfg)}
.main{padding:0 14px}
.voice{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 0 20px}
.orb-btn{width:76px;height:76px;border-radius:50%;border:none;position:relative;overflow:hidden;cursor:pointer;-webkit-user-select:none;user-select:none;
  background:radial-gradient(circle at 34% 26%, #cba9ff 0%, #9568f6 28%, #6f3ad8 60%, #3a1a90 100%);
  box-shadow:0 9px 24px rgba(109,59,214,.42), inset -6px -9px 17px rgba(0,0,0,.3), inset 5px 6px 14px rgba(255,255,255,.35)}
.orb-btn::after{content:'';position:absolute;top:9px;left:18px;width:34px;height:19px;border-radius:50%;background:radial-gradient(circle at 40% 35%, rgba(255,255,255,.85), rgba(255,255,255,0) 70%);pointer-events:none}
.orb-bars{position:relative;z-index:1;display:flex;gap:6px;align-items:center;justify-content:center;height:100%}
.orb-bars i{display:block;width:6px;height:23px;border-radius:6px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7)}
.orb-bars i:nth-child(2){height:31px}
.orb-btn.rec{transform:scale(1.07)}
.orb-btn.off{filter:grayscale(.45);opacity:.8}
.voice-tip{font-size:11px;color:var(--muted);text-align:center;line-height:1.5;min-height:16px}
.voice-links{display:flex;gap:16px;justify-content:center;align-items:center}
.voice-alt{font-size:11px;color:var(--muted);text-decoration:underline;background:none;border:none;padding:0;font-family:inherit;cursor:pointer}
.app .ic img{width:100%;height:100%;object-fit:cover;border-radius:14px;display:block}
.strip{display:flex;gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 -14px;padding:2px 14px 6px}
.strip::-webkit-scrollbar{display:none}
.app{flex:0 0 auto;width:66px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer}
.app:active{opacity:.65}
.app .ic{width:54px;height:54px;border-radius:14px;display:flex;align-items:center;justify-content:center}
.app .ic svg{width:28px;height:28px;fill:#fff;display:block}
.app .lb{font-size:11px;color:var(--fg);white-space:nowrap}
.gap{height:16px}
.chip{flex:0 0 auto;height:36px;display:flex;align-items:center;padding:0 15px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--fg);font-size:13px;white-space:nowrap;cursor:pointer}
.chip:active{opacity:.6}
.composer{display:flex;gap:9px;align-items:center;margin-top:18px}
.cmd{flex:1;min-width:0;height:46px;border:1px solid var(--line);border-radius:23px;background:var(--card);color:var(--fg);padding:0 16px;font-size:15px;font-family:inherit;outline:none}
.cmd:focus{border-color:var(--muted)}
.send{width:46px;height:46px;flex-shrink:0;border:none;border-radius:50%;background:var(--accent);color:var(--accentfg);font-size:21px;line-height:1;font-family:inherit;cursor:pointer}
.send:active{opacity:.65}
.spacer{height:calc(150px + env(safe-area-inset-bottom))}
</style>
</head>
<body>
  <div class="dock">
    <div class="bar">
      <span class="brand">龙虾脑</span>
      <div class="status" id="statusBox"><span class="dot" id="dot"></span><span class="stxt" id="statusText">等待指令…</span></div>
      <a class="mini" href="/dashboard" id="dashLink">看板</a>
      <button class="mini" id="themeBtn" type="button">深色</button>
    </div>
    <div class="padrow">
      <div class="pad" id="pad"><span id="padHint">滑动移动 · 轻点单击</span></div>
      <div class="wheel">
        <div class="track" id="track">上下滑动</div>
        <div class="wb"><button class="wbt" id="sup" type="button">▲</button><button class="wbt" id="sdown" type="button">▼</button></div>
      </div>
    </div>
  </div>

  <div class="main">
    <div class="voice">
      <button class="orb-btn" id="mic" type="button"><span class="orb-bars"><i></i><i></i></span></button>
      <div class="voice-tip" id="voiceTip">短按说话，说完自动执行；长按说完松手</div>
      <div class="voice-links">
        <a class="voice-alt" id="voiceAlt" href="#">切换语音方式</a>
        <button class="voice-alt" id="speakBtn" type="button">播报开</button>
      </div>
    </div>

    <div class="strip" id="apps"></div>
    <div class="gap"></div>
    <div class="strip" id="chips"></div>

    <div class="composer">
      <input class="cmd" id="cmd" placeholder="输入指令，例如：打开微信" />
      <button class="send" id="sendBtn" type="button">↑</button>
    </div>
    <div class="spacer"></div>
  </div>

<script>
var TOKEN = new URLSearchParams(location.search).get('t') || localStorage.getItem('lb_token') || '';
if(TOKEN) try{localStorage.setItem('lb_token',TOKEN);}catch(e){}
var $ = function(id){return document.getElementById(id);};
function api(p, body){
  var h = {'Content-Type':'application/json'};
  if(TOKEN) h['x-lb-token']=TOKEN;
  return fetch(p, {method: body?'POST':'GET', headers:h, body: body?JSON.stringify(body):undefined});
}
/* 只改文字，不调用 scrollIntoView —— 避免操作时页面被强行滚回顶端 */
function log(msg, kind){
  $('statusText').textContent = msg;
  $('statusBox').className = 'status' + (kind ? ' ' + kind : '');
}
function setConn(ok, msg){
  $('dot').style.background = ok ? '#22b573' : '#d9534f';
  if(!ok && msg) log(msg, 'err');
}
async function checkConn(){
  try{
    var r = await api('/api/status');
    if(r.ok) setConn(true);
    else setConn(false, '服务异常 ' + r.status);
  }catch(e){ setConn(false, '无法连接 Mac 服务'); }
}
async function poll(id, label){
  for(var i=0;i<24;i++){
    await new Promise(function(r){setTimeout(r,350);});
    var t;
    try{ var r = await api('/api/task/'+id); if(!r.ok) break; t = await r.json(); }catch(e){ break; }
    if(t.status==='success'){ log('✓ '+(t.result||'已完成'), 'ok'); if(window.lbSpeak) window.lbSpeak(t.result||'已完成'); return; }
    if(t.status==='failed'){ log('✗ '+(t.error||'执行失败'), 'err'); if(window.lbSpeak) window.lbSpeak('执行失败：'+(t.error||'')); return; }
  }
  log('… 仍在执行：'+label);
}
async function sendTask(text){
  text = String(text||'').trim();
  if(!text){ log('请输入指令', 'err'); return; }
  log('发送：'+text);
  try{
    var r = await api('/api/task', {instruction:text});
    var j = await r.json().catch(function(){return {};});
    if(!r.ok || !j.id){ log('✗ 发送失败 '+r.status, 'err'); return; }
    // 服务端会把「关必 / 关 / 把它关了」理解成规范指令，回显出来让用户看得见、可纠正
    if(j.normalized && j.normalized !== text) log('理解成：'+j.normalized);
    poll(j.id, j.normalized || text);
  }catch(e){ log('✗ 网络错误：'+e.message, 'err'); }
}
$('sendBtn').addEventListener('click', function(){ sendTask($('cmd').value); $('cmd').value=''; $('cmd').blur(); });
$('cmd').addEventListener('keydown', function(e){ if(e.key==='Enter'){ sendTask($('cmd').value); $('cmd').value=''; $('cmd').blur(); } });

var BUILTIN_APPS = [
  {n:'微信', k:'打开微信', c:'#07C160', s:'<svg viewBox="0 0 24 24"><path d="M9.2 3C5.1 3 1.8 5.8 1.8 9.3c0 2 1.1 3.8 2.9 5L3.8 16.5l2.4-1.2c.9.3 1.9.4 3 .4h.6a5.6 5.6 0 0 1-.2-1.5c0-3.4 3.2-6.1 7.2-6.1h.6C16.8 4.7 13.4 3 9.2 3zM6.7 7.9a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm5 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"/><path d="M22.2 13.9c0-3-2.9-5.4-6.5-5.4s-6.5 2.4-6.5 5.4 2.9 5.4 6.5 5.4c.8 0 1.6-.1 2.3-.4l2 1-.5-1.8c1.6-1 2.7-2.5 2.7-4.2zm-8.8-.9a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6zm4.6 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6z"/></svg>'},
  {n:'豆包', k:'打开豆包', c:'#5B6CF5', s:'<svg viewBox="0 0 24 24"><path d="M12 2c.5 3.9 2.1 5.5 6 6-3.9.5-5.5 2.1-6 6-.5-3.9-2.1-5.5-6-6 3.9-.5 5.5-2.1 6-6z"/><path d="M18.5 13c.3 2.2 1.2 3.1 3.5 3.5-2.3.3-3.2 1.2-3.5 3.5-.3-2.3-1.2-3.2-3.5-3.5 2.3-.4 3.2-1.3 3.5-3.5z" opacity=".85"/></svg>'},
  {n:'抖音', k:'打开抖音', c:'#161823', s:'<svg viewBox="0 0 24 24"><path d="M16.6 2h-3v13.1a2.9 2.9 0 1 1-2.3-2.8V9.2a5.9 5.9 0 1 0 5.3 5.9V8.4a6.4 6.4 0 0 0 3.7 1.2V6.6a3.7 3.7 0 0 1-3.7-3.7V2z"/></svg>'},
  {n:'WorkBuddy', k:'打开WorkBuddy', c:'#FF5900', s:'<svg viewBox="0 0 24 24"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><circle cx="12" cy="10" r="2.1" fill="#FF5900"/></svg>'},
  {n:'浏览器', k:'打开浏览器', c:'#1E9BF0', s:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1z"/><circle cx="12" cy="12" r="1.2" fill="#1E9BF0"/></svg>'},
  {n:'备忘录', k:'打开备忘录', c:'#F5A623', s:'<svg viewBox="0 0 24 24"><path d="M4 3h16v18H4z" opacity=".25"/><path d="M4 3h16v4H4z"/><path d="M7 10h10v1.6H7zm0 3.4h10v1.6H7zm0 3.4h7v1.6H7z" opacity=".95"/></svg>'},
  {n:'B站', k:'打开哔哩哔哩', c:'#FB7299', s:'<svg viewBox="0 0 24 24"><path d="M6.3 2.6l2.5 2.4h6.4l2.5-2.4a1 1 0 0 1 1.4 1.4l-1.5 1.5H18a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h-.6L3.9 4a1 1 0 0 1 1.4-1.4zM8.5 10.6a1.2 1.2 0 0 0-1.2 1.2v2.4a1.2 1.2 0 0 0 2.4 0v-2.4a1.2 1.2 0 0 0-1.2-1.2zm7 0a1.2 1.2 0 0 0-1.2 1.2v2.4a1.2 1.2 0 0 0 2.4 0v-2.4a1.2 1.2 0 0 0-1.2-1.2z"/></svg>'},
  {n:'网易云', k:'打开网易云音乐', c:'#E03A3A', s:'<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm3.9 8.1c-.2 2-1.7 3.4-3.5 4.4-1.2.7-2.5 1.3-2.9 2.6-.3 1 .2 2.1 1.3 2.1 1.3 0 2-1.4 1.7-2.6a1.4 1.4 0 0 1 2.7-.7c.5 2.3-1.1 4.6-3.6 4.9-2.7.3-5-1.9-4.6-4.6.4-2.6 2.4-3.7 4.3-4.9 1.5-.9 2.4-1.6 2.5-3 .1-1-.7-1.8-1.7-1.7-1 .1-1.7.9-1.9 1.8a1.4 1.4 0 0 1-2.7-.5c.4-2.5 2.6-4.3 5.1-4.1 2.5.2 4.1 2.1 3.8 4.3z"/></svg>'}
];
/* 快捷应用：优先显示 Mac 上真实安装的应用 + 真实图标；接口不可用时回退内置图标 */
function renderApps(list){
  var el = $('apps'); el.innerHTML='';
  list.forEach(function(a){
    var b=document.createElement('div'); b.className='app';
    var ic=document.createElement('div'); ic.className='ic';
    ic.style.background = a.color || a.c || '#8a8a90';
    if(a.icon){
      var img=document.createElement('img'); img.src=a.icon; img.alt='';
      img.onerror=function(){ if(img.parentNode) img.parentNode.removeChild(img); ic.textContent=(a.label||a.n||'?').slice(0,1); ic.style.color='#fff'; ic.style.fontSize='22px'; ic.style.fontWeight='700'; };
      ic.appendChild(img);
    } else if(a.s){ ic.style.background=a.c; ic.innerHTML=a.s; }
    else { ic.textContent=(a.label||a.n||'?').slice(0,1); ic.style.color='#fff'; ic.style.fontSize='22px'; }
    var lb=document.createElement('div'); lb.className='lb'; lb.textContent=a.label||a.n||a.name;
    b.appendChild(ic); b.appendChild(lb);
    b.addEventListener('click', function(){ sendTask(a.cmd||a.k||('打开'+a.name)); });
    el.appendChild(b);
  });
}
renderApps(BUILTIN_APPS);
api('/api/apps').then(function(r){ return r.json(); }).then(function(d){
  if(d && d.quick && d.quick.length) renderApps(d.quick);
}).catch(function(){});

var CHIPS = ['关闭当前应用','最小化窗口','切换全屏','锁屏','截个屏','刷新','下一首','复制'];
var chipsEl = $('chips');
CHIPS.forEach(function(c){
  var b = document.createElement('div'); b.className='chip'; b.textContent=c;
  b.addEventListener('click', function(){ sendTask(c); });
  chipsEl.appendChild(b);
});

/* 触控板：只发请求 + 面板内轻反馈，不写状态条、不滚动页面 */
var flashTimer = 0;
function flash(msg){
  $('padHint').textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(function(){ $('padHint').textContent='滑动移动 · 轻点单击'; }, 700);
}
(function(){
  var pad = $('pad'), lastX=0, lastY=0, moved=false, lastSent=0, SPEED=1.6;
  pad.addEventListener('touchstart', function(e){ var t=e.touches[0]; lastX=t.clientX; lastY=t.clientY; moved=false; e.preventDefault(); }, {passive:false});
  pad.addEventListener('touchmove', function(e){
    var t=e.touches[0]; var dx=(t.clientX-lastX), dy=(t.clientY-lastY);
    lastX=t.clientX; lastY=t.clientY;
    if(Math.abs(dx)>2||Math.abs(dy)>2) moved=true;
    var now=Date.now();
    if(now-lastSent>35){ lastSent=now; api('/api/mouse', {dx:Math.round(dx*SPEED), dy:Math.round(dy*SPEED)}); }
    e.preventDefault();
  }, {passive:false});
  pad.addEventListener('touchend', function(e){
    if(!moved){ api('/api/mouse', {tap:true}); flash('已单击'); }
    e.preventDefault();
  }, {passive:false});
})();

/* 滚轮：位于控制面板右侧的窄竖条 */
(function(){
  var track = $('track'), wy=0;
  track.addEventListener('touchstart', function(e){ wy=e.touches[0].clientY; e.preventDefault(); }, {passive:false});
  track.addEventListener('touchmove', function(e){
    var dy = e.touches[0].clientY - wy; wy=e.touches[0].clientY;
    api('/api/mouse', {scroll: -Math.round(dy/3)});
    e.preventDefault();
  }, {passive:false});
})();
function scrollBy(n){ api('/api/mouse', {scroll:n}); }
$('sup').addEventListener('click', function(){ scrollBy(4); });
$('sdown').addEventListener('click', function(){ scrollBy(-4); });

/* 主题 */
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  $('themeBtn').textContent = (t === 'dark') ? '浅色' : '深色';
  try{ localStorage.setItem('lb_theme', t); }catch(e){}
}
applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
$('themeBtn').addEventListener('click', function(){
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
if(TOKEN){ var dl=$('dashLink'); dl.href = dl.href.split('?')[0] + '?t=' + encodeURIComponent(TOKEN); }

/* 语音：按住说话 */
(function(){
  var btn = $('mic'), tip = $('voiceTip'), rec = null, recognizing = false;
  var finalParts = [], interimText = '', pressStart = 0, tapMode = false, gotError = '', suppressClick = false;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /* 结果播报：说话下指令 → Mac 执行 → 手机读回结果，形成「对讲机」闭环 */
  function speak(text){
    try{
      if(localStorage.getItem('lb_speak')==='off') return;
      if(!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text||'').slice(0,90));
      u.lang='zh-CN'; u.rate=1.05;
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  window.lbSpeak = speak;
  function keyboardDictation(){
    $('cmd').focus();
    tip.textContent = '点键盘上的麦克风说话，说完点发送';
    log('已唤起输入框，点键盘上的麦克风说话');
  }
  var speakBtn = $('speakBtn');
  function syncSpeakBtn(){ speakBtn.textContent = localStorage.getItem('lb_speak')==='off' ? '播报关' : '播报开'; }
  syncSpeakBtn();
  speakBtn.addEventListener('click', function(){
    var wasOff = localStorage.getItem('lb_speak')==='off';
    try{ localStorage.setItem('lb_speak', wasOff ? 'on' : 'off'); }catch(e){}
    syncSpeakBtn();
    if(wasOff) speak('语音播报已开启');
    else try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){}
  });
  function httpsUrl(){
    return 'https://' + location.hostname + ':8788' + location.pathname + (location.search || '');
  }
  if(!window.isSecureContext || !SR){
    // HTTP 或浏览器不支持网页语音识别：圆球改为一键唤起 iOS 键盘听写
    // 系统级中文听写，零证书、零权限、零配置，任何网络下都能「说话控制电脑」
    tip.textContent = '点圆球说话（用键盘听写，零配置）';
    $('voiceAlt').textContent = '切到 HTTPS 语音入口 →';
    $('voiceAlt').addEventListener('click', function(e){
      e.preventDefault();
      log('正在切换到 HTTPS 语音入口…');
      setTimeout(function(){ location.href = httpsUrl(); }, 300);
    });
    btn.addEventListener('click', function(){ keyboardDictation(); });
    return;
  }
  // HTTPS + 浏览器支持识别：按住说话；键盘听写始终作为备选
  $('voiceAlt').textContent = '或用键盘听写';
  $('voiceAlt').addEventListener('click', function(e){ e.preventDefault(); keyboardDictation(); });
  /* 短词「关闭」只有两三个字：按住说话时手指一松就 stop()，iOS Safari 往往
   * 还没来得及把结果标成 isFinal，旧逻辑 finalText 为空 → 静默什么都不做。
   * 现在：① 每次 onresult 重建完整 final 文本，不依赖「最后一个 result 是否 final」；
   *      ② interim 也作为兜底；③ 短按不打断，交给识别引擎自动收尾；
   *      ④ 无结果时明确提示 + 一键降级键盘听写，不再「看起来点了没反应」。 */
  function cleanHeard(s){
    return String(s||'').replace(/[。．.!！?？,，、;；…~～\s]+$/g,'')
      .replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g,'$1$2').trim();
  }
  function finishHeard(){
    var heard = cleanHeard(finalParts.join('') || interimText);
    if(heard){
      tip.textContent = '听到：' + heard + ' → 执行中';
      $('cmd').value = heard;   // 留在输入框：识别错了可直接改写重发
      log('听到：' + heard);
      finalParts = []; interimText = '';
      sendTask(heard);
    }else{
      tip.textContent = gotError === 'no-speech'
        ? '没听清，短按圆球再说一次（或用键盘听写）'
        : '没收到指令，短按圆球再说一次（或用键盘听写）';
      $('voiceAlt').textContent = '改用键盘听写';
      log('语音没拾取到内容，可重说或用键盘听写', 'err');
    }
  }
  function startRec(){
    if(recognizing) return;
    finalParts = []; interimText = ''; gotError = '';
    try{
      rec = new SR(); rec.lang = 'zh-CN'; rec.interimResults = true; rec.continuous = false;
      rec.onresult = function(ev){
        var finals = '', interim = '';
        for(var i=0;i<ev.results.length;i++){
          var r = ev.results[i], t = (r[0] && r[0].transcript) || '';
          if(r.isFinal) finals += t; else interim += t;
        }
        finalParts = [finals];   // 每次重建，避免同一段 final 被重复累加
        interimText = interim;
        tip.textContent = '识别中：' + cleanHeard(finals + interim);
      };
      rec.onerror = function(ev){
        gotError = ev.error || '';
        if(gotError === 'not-allowed' || gotError === 'service-not-allowed') tip.textContent = '麦克风权限被拒，可点下方「用键盘听写」';
        else if(gotError === 'no-speech') tip.textContent = '没听到，再说一次或稍等自动收尾';
        else tip.textContent = '识别不可用（'+gotError+'），请改用键盘听写';
      };
      rec.onend = function(){
        recognizing = false; btn.classList.remove('rec'); rec = null; tapMode = false;
        finishHeard();
      };
      rec.start(); recognizing = true; btn.classList.add('rec');
      tip.textContent = '聆听中…说完自动结束';
    }catch(e){ tip.textContent = '启动失败：' + e.message; recognizing = false; btn.classList.remove('rec'); }
  }
  function stopRec(){ if(rec && recognizing){ try{ rec.stop(); }catch(e){} } }
  function pressDown(e){ if(e && e.preventDefault) e.preventDefault(); pressStart = Date.now(); tapMode = false; startRec(); }
  function pressUp(e){
    if(e && e.preventDefault) e.preventDefault();
    suppressClick = true; setTimeout(function(){ suppressClick = false; }, 550);
    if(Date.now() - pressStart < 400 && recognizing){
      // 短按 = 自由聆听：不 stop，等识别引擎判定说完；再点一下可提前结束
      tapMode = true;
      tip.textContent = '正在听…说完自动结束，再点一下可提前结束';
      return;
    }
    stopRec();
  }
  btn.addEventListener('touchstart', pressDown, {passive:false});
  btn.addEventListener('touchend', pressUp, {passive:false});
  btn.addEventListener('touchcancel', function(){ stopRec(); });
  btn.addEventListener('mousedown', function(e){ pressDown(e); });
  btn.addEventListener('mouseup', function(e){ pressUp(e); });
  btn.addEventListener('mouseleave', function(){ if(!tapMode) stopRec(); });
  btn.addEventListener('click', function(e){
    e.preventDefault();
    if(suppressClick) return;              // 忽略 touchend/mouseup 带来的合成 click
    if(recognizing && tapMode) stopRec();  // 自由聆听中：再点一下提前结束
    else if(!recognizing) startRec();      // 桌面单击也能直接开始听
  });
})();

checkConn();
setInterval(checkConn, 8000);
document.addEventListener('visibilitychange', function(){ if(!document.hidden) checkConn(); });
</script>
</body></html>
`;

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

/* ---------------- 首次配置向导 /setup ----------------
 * 设计原则：向导只做「检测 + 固定脚本 + 文档引导」，不接受任何用户传入的 shell 命令；
 * 所有写操作仅允许 Mac 本机（localhost）发起，局域网一律 403。
 */
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.lobsterbrain.plist');
const ASR_CFG_FILE = path.join(__dirname, 'asr-config.json');
const SETUP_SCRIPTS = {
  install: path.join(__dirname, 'bin', 'install-launchd.sh'),
  uninstall: path.join(__dirname, 'bin', 'uninstall-launchd.sh'),
  cert: path.join(__dirname, 'bin', 'gen-cert.sh'),
};

function parentProcessName() {
  try {
    const out = execSync('ps -o comm= -p ' + process.ppid, { encoding: 'utf8', timeout: 2000 }).trim();
    return out.includes('/') ? out.split('/').pop().replace(/\.app$/, '') : (out || '运行本服务的程序');
  } catch (e) { return '运行本服务的程序'; }
}
function readAsrConfig() {
  try { return JSON.parse(fs.readFileSync(ASR_CFG_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeAsrConfig(cfg) { fs.writeFileSync(ASR_CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); }
function findBin(names) {
  for (const n of names) {
    if (!n) continue;
    if (n.includes('/')) { try { if (fs.existsSync(n)) return n; } catch (e) {} }
    else {
      try {
        const p = execFileSync('/bin/bash', ['-lc', 'command -v ' + n], { encoding: 'utf8', timeout: 2500, maxBuffer: 1e5 }).trim();
        if (p) return p;
      } catch (e) {}
    }
  }
  return '';
}

/* ASR：可插拔适配层。默认 provider=none —— 用 iOS 键盘听写（系统级 ASR），
 * 不引入任何依赖、不联网、不上传音频。需要自建/云引擎时才在向导里启用。 */
function asrStatus() {
  const cfg = readAsrConfig();
  const provider = cfg.provider || process.env.LB_ASR_PROVIDER || 'none';
  const ffmpegPath = findBin(['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
  const whisperCliPath = findBin([cfg.whisperBin, process.env.LB_WHISPER_BIN, 'whisper-cli', 'whisper-cpp', '/opt/homebrew/bin/whisper-cli']);
  const modelPath = cfg.whisperModel || process.env.LB_WHISPER_MODEL || '';
  const hasModel = !!modelPath && fs.existsSync(modelPath);
  const baseUrl = cfg.baseUrl || process.env.LB_ASR_BASE_URL || process.env.LLM_BASE_URL || '';
  const apiKey = cfg.apiKey || process.env.LB_ASR_API_KEY || process.env.LLM_API_KEY || '';
  const cloudModel = cfg.model || process.env.LB_ASR_MODEL || 'whisper-1';
  const reasons = [];
  let ready = false;
  if (provider === 'none') reasons.push('未启用服务端 ASR（默认：iOS 键盘听写就是系统级 ASR，零配置、最稳）');
  else if (provider === 'whisper') {
    if (!ffmpegPath) reasons.push('缺少 ffmpeg（音频转 16k wav）');
    if (!whisperCliPath) reasons.push('缺少 whisper-cli（whisper.cpp 命令行）');
    if (!hasModel) reasons.push('未配置模型文件 whisperModel');
    ready = !!(ffmpegPath && whisperCliPath && hasModel);
  } else if (provider === 'openai') {
    if (!baseUrl) reasons.push('缺少 ASR Base URL');
    if (!apiKey) reasons.push('缺少 API Key');
    ready = !!(baseUrl && apiKey);
  } else reasons.push('未知引擎：' + provider);
  return {
    provider, ready, reasons,
    deps: { ffmpeg: !!ffmpegPath, whisperCli: !!whisperCliPath, model: hasModel, apiKey: !!apiKey },
    paths: { ffmpegPath, whisperCliPath, modelPath: modelPath || '', baseUrl: baseUrl || '', cloudModel },
    privacy: provider === 'openai' ? '音频会离开本机发往第三方服务' : (provider === 'whisper' ? '音频仅在本机转写，不出网' : '不采集、不上传任何音频'),
  };
}

/* 把手机录下的音频转成文字；provider=none 时明确报错（绝不静默假装识别成功） */
async function transcribeAudio(buf, mime) {
  const st = asrStatus();
  if (st.provider === 'none') throw new Error('服务端 ASR 未启用。推荐直接用 iOS 键盘听写；若要自建引擎，请在向导「语音输入」里选好引擎。');
  if (!st.ready) throw new Error('ASR 引擎未就绪：' + st.reasons.join('；'));
  const cfg = readAsrConfig();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-asr-'));
  const ext = /m4a|mp4/.test(mime) ? '.m4a' : (/wav|wave/.test(mime) ? '.wav' : '.webm');
  const inFile = path.join(tmp, 'audio' + ext);
  try {
    fs.writeFileSync(inFile, buf);
    if (st.provider === 'openai') {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'audio' + ext);
      fd.append('model', st.paths.cloudModel);
      fd.append('language', 'zh');
      const key = cfg.apiKey || process.env.LB_ASR_API_KEY || process.env.LLM_API_KEY || '';
      const r = await fetch(st.paths.baseUrl.replace(/\/$/, '') + '/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && j.error.message) || ('ASR 服务返回 HTTP ' + r.status));
      return String(j.text || '').trim();
    }
    // 本地 whisper.cpp：ffmpeg 统一转 16k 单声道 wav，再交给 whisper-cli
    const wav = path.join(tmp, 'audio.wav');
    execFileSync(st.paths.ffmpegPath, ['-y', '-loglevel', 'error', '-i', inFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 30000, maxBuffer: 1e6 });
    const outPrefix = path.join(tmp, 'out');
    execFileSync(st.paths.whisperCliPath, ['-m', st.paths.modelPath, '-l', 'zh', '-f', wav, '-otxt', '-of', outPrefix, '-nt'], { timeout: 90000, maxBuffer: 1e6 });
    return fs.readFileSync(outPrefix + '.txt', 'utf8').trim();
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
}

function certSan() {
  const pem = path.join(__dirname, 'cert', 'cert.pem');
  if (!fs.existsSync(pem)) return { exists: false, ips: [], dns: [], line: '' };
  try {
    const out = execFileSync('openssl', ['x509', '-in', pem, '-noout', '-text'], { encoding: 'utf8', timeout: 3000, maxBuffer: 1e6 });
    const line = (out.split('\n').find(l => /DNS:|IP Address/.test(l)) || '').trim();
    return {
      exists: true, line,
      ips: Array.from(line.matchAll(/IP Address:?\s*([\d.]+)/g)).map(m => m[1]),
      dns: Array.from(line.matchAll(/DNS:([^,\s]+)/g)).map(m => m[1]),
    };
  } catch (e) { return { exists: true, ips: [], dns: [], line: '', error: e.message }; }
}

async function setupStatus() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const k in ifaces) for (const i of ifaces[k]) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  const ip = lanIP();
  const localName = os.hostname().split('.')[0] + '.local';
  const cert = certSan();
  const cfg = llmConfig();
  let granted = false;
  try { granted = await checkAccessibility(); } catch (e) {}
  return {
    version: VERSION, node: process.version, arch: process.arch, os: 'macOS ' + os.release(),
    pid: process.pid, uptime: Math.round(process.uptime()),
    launchedByLaunchd: !!process.env.LB_LAUNCHED,
    httpPort: Number(PORT), httpsPort: Number(PORT) + 1,
    lanIP: ip, ips, localName,
    parentProcess: parentProcessName(),
    nodePath: process.execPath,
    accessibility: granted,
    launchd: fs.existsSync(PLIST_PATH),
    cert: { exists: cert.exists, ips: cert.ips, dns: cert.dns, line: cert.line, coversCurrentIp: cert.ips.includes(ip), coversLocalName: cert.dns.includes(localName) },
    llm: { enabled: cfg.enabled, model: cfg.model },
    apps: INSTALLED_APPS.length,
    trustLan: TRUST_LAN, tokenMasked: AUTH_TOKEN.slice(0, 4) + '••••' + AUTH_TOKEN.slice(-4),
    asr: asrStatus(),
    links: {
      http: 'http://' + ip + ':' + PORT + '/?t=' + AUTH_TOKEN,
      https: 'https://' + ip + ':' + (Number(PORT) + 1) + '/?t=' + AUTH_TOKEN,
      local: 'http://' + localName + ':' + PORT + '/?t=' + AUTH_TOKEN,
      localHttps: 'https://' + localName + ':' + (Number(PORT) + 1) + '/?t=' + AUTH_TOKEN,
      cert: 'http://' + ip + ':' + PORT + '/cert.crt',
      manage: 'http://localhost:' + PORT + '/manage',
    },
  };
}

function runSetupScript(kind, args) {
  return new Promise(resolve => {
    execFile('/bin/bash', [SETUP_SCRIPTS[kind]].concat(args || []),
      { cwd: __dirname, timeout: 25000, maxBuffer: 1e6 },
      (err, stdout, stderr) => resolve({
        ok: !err,
        output: ((stdout || '') + (stderr || '')).trim().slice(0, 2000),
        error: err ? err.message : '',
      }));
  });
}

/* ---------------- 常驻控制台 /manage ---------------- */
const MANAGE_PAGE = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>龙虾脑 · 控制台</title>
<style>
  :root{ --bg:#FAFAF8; --fg:#1A1A1A; --muted:#6B6B6B; --line:#E3E1DB; --ember:#E8451F; --ok:#1E9E6A; --err:#A32D2D; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:24px;line-height:1.6}
  .wrap{max-width:720px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px}
  .card h2{font-size:14px;margin:0 0 12px;font-weight:600}
  .kv{display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:5px 0;border-bottom:1px dashed var(--line)}
  .kv:last-child{border-bottom:none}
  .kv .k{color:var(--muted)}
  .kv .v{text-align:right;word-break:break-all}
  .pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600}
  .pill.ok{background:#E7F5EE;color:#1E9E6A}
  .pill.err{background:#FCEBEB;color:#A32D2D}
  .links{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .linkbox{border:1px solid var(--line);border-radius:10px;padding:12px}
  .linkbox .t{font-size:12px;color:var(--muted);margin-bottom:6px}
  .linkbox code{font-size:12px;word-break:break-all;display:block;margin-bottom:8px}
  button{cursor:pointer;font-family:inherit;border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 12px;font-size:13px}
  button.primary{background:var(--ember);color:#fff;border-color:var(--ember)}
  button:active{opacity:.7}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}
  #qr{display:flex;justify-content:center;margin:8px 0}
  .hint{font-size:12px;color:var(--muted)}
  a{color:var(--ember);text-decoration:none}
</style></head>
<body><div class="wrap">
<h1>龙虾脑 · 控制台</h1>
<div class="sub">常驻管理页：开机自启 / 扫码连接 / 连接诊断 / 一键重载。仅限 Mac 本机访问。</div>

<div class="card" style="border-color:var(--ember);background:#FFF7F4">
  <h2 style="color:var(--ember)">第一次用？先走配置向导</h2>
  <div class="hint" style="margin-bottom:10px">3 分钟把开机自启、辅助功能授权、固定 .local 入口、HTTPS 证书与语音一次配好；以后 IP 变了也不用重来。</div>
  <button class="primary" onclick="location.href='/setup'">打开首次配置向导 →</button>
  <a href="/setup" style="margin-left:12px;font-size:12px">查看 /setup</a>
</div>

<div class="card"><h2>运行状态</h2><div id="status">加载中…</div></div>

<div class="card"><h2>手机连接（扫码或复制）</h2>
  <div class="links">
    <div class="linkbox"><div class="t">文字输入（HTTP，推荐）</div><code id="lkHttp"></code><button onclick="copyText('lkHttp')">复制</button></div>
    <div class="linkbox"><div class="t">语音输入（HTTPS，需装证书）</div><code id="lkHttps"></code><button onclick="copyText('lkHttps')">复制</button></div>
  </div>
  <div id="qr"></div>
  <div class="hint">用手机相机扫上方二维码即可直达（已含访问令牌）。<b>当前已开启「局域网免令牌」，手机连同一 Wi-Fi 时即使不带 ?t= 也能直接用</b>；如需对外更安全，可在下方控制台关闭免令牌。若二维码为空，复制上方链接同样可用。</div>
</div>

<div class="card"><h2>连接诊断</h2>
  <div class="kv"><span class="k">局域网 IP</span><span class="v" id="dIp"></span></div>
  <div class="kv"><span class="k">HTTPS 证书</span><span class="v" id="dCert"></span></div>
  <div class="kv"><span class="k">辅助功能授权</span><span class="v" id="dAcc"></span></div>
  <div class="kv"><span class="k">开机自启（launchd）</span><span class="v" id="dLaunch"></span></div>
  <div class="kv"><span class="k">手机同 Wi-Fi 自检</span><span class="v" id="dWifi">在手机访问上方链接；能打开即同网</span></div>
</div>

<div class="card"><h2>控制</h2>
  <div class="row">
    <button class="primary" onclick="act('reload')">一键重载</button>
    <button onclick="act('stop')">停止服务</button>
    <button onclick="location.href='/cert.crt'">下载证书</button>
    <button onclick="location.href='/api/accessibility'">打开辅助功能设置</button>
    <button onclick="location.href='/dashboard'">运营看板</button>
    <button onclick="location.href='/config'">令牌/配置</button>
    <button id="trustBtn" onclick="toggleTrust()">局域网免令牌：…</button>
  </div>
  <div id="msg" class="hint" style="margin-top:10px"></div>
</div>
</div>
<script src="/public/qrcode.js"></script>
<script>
function copyText(id){var t=document.getElementById(id).textContent;navigator.clipboard.writeText(t).then(function(){setMsg('已复制：'+t.slice(0,42)+'…')});}
function setMsg(m){document.getElementById('msg').textContent=m;}
function pill(ok,label){return '<span class="pill '+(ok?'ok':'err')+'">'+label+'</span>';}
async function toggleTrust(){
  try{
    var cur=document.getElementById('dTrust');
    var turningOn=cur && cur.textContent.indexOf('已关闭')>=0;
    var r=await fetch('/api/trust',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:turningOn})});
    var d=await r.json();
    if(d.ok){ setMsg('局域网免令牌已'+(d.trustLan?'开启':'关闭')+'，手机现在'+(d.trustLan?'可免令牌直连':'需带 ?t= 令牌')); load(); }
    else setMsg('切换失败：'+JSON.stringify(d));
  }catch(e){ setMsg('切换失败：'+e.message); }
}
async function act(a){
  if(a==='stop' && !confirm('确定停止服务？停止后需重新启动才能连接。')) return;
  try{
    await fetch('/api/'+a,{method:'POST'});
    setMsg(a==='reload'?'正在重载，约 1 秒后刷新本页…':'正在停止…');
    setTimeout(function(){location.reload();},1200);
  }catch(e){setMsg('操作失败：'+e.message);}
}
async function load(){
  try{
    var d=await (await fetch('/api/status')).json();
    var html='';
    html+='<div class="kv"><span class="k">版本</span><span class="v">v'+d.version+'</span></div>';
    html+='<div class="kv"><span class="k">进程</span><span class="v">PID '+d.pid+' · 已运行 '+Math.round(d.uptime/60)+' 分钟</span></div>';
    html+='<div class="kv"><span class="k">HTTP 端口</span><span class="v">'+d.httpPort+'</span></div>';
    html+='<div class="kv"><span class="k">HTTPS 端口</span><span class="v">'+d.httpsPort+'</span></div>';
    html+='<div class="kv"><span class="k">访问令牌</span><span class="v">'+d.token+'</span></div>';
    html+='<div class="kv"><span class="k">局域网免令牌</span><span class="v" id="dTrust"></span></div>';
    document.getElementById('status').innerHTML=html;
    document.getElementById('lkHttp').textContent=d.phoneLinkLocal;
    document.getElementById('lkHttps').textContent=d.phoneLinkHttps;
    document.getElementById('dIp').textContent=d.lanIP+(d.ips&&d.ips.length>1?('（多网卡：'+d.ips.join(', ')+'）'):'');
    document.getElementById('dCert').innerHTML=d.hasCert?pill(true,'已生成'):pill(false,'缺失');
    document.getElementById('dLaunch').innerHTML=d.launchd?pill(true,'已启用'):pill(false,'未启用');
    document.getElementById('dTrust').innerHTML=d.trustLan?pill(true,'已开启（同 Wi-Fi 免令牌直连）'):pill(false,'已关闭（需令牌）');
    var tb=document.getElementById('trustBtn'); if(tb) tb.textContent=d.trustLan?'局域网免令牌：已开启（点此关闭）':'局域网免令牌：已关闭（点此开启）';
    try{
      var qr=qrcode(0,'M');qr.addData(d.phoneLinkLocal);qr.make();
      document.getElementById('qr').innerHTML=qr.createSvgTag({cellSize:5,margin:10,alt:'连接二维码'});
    }catch(e){document.getElementById('qr').innerHTML='<span class="hint">二维码生成失败，请复制上方链接</span>';}
  }catch(e){
    document.getElementById('status').innerHTML='<span class="pill err">无法读取状态（需本机访问）</span>';
  }
}
load();
(async function(){try{var a=await (await fetch('/api/accessibility')).json();var el=document.getElementById('dAcc');if(el)el.innerHTML=a.granted?pill(true,'已授权'):pill(false,'未授权');}catch(e){}})();
</script>
</body></html>`;

/* ---------------- 首次配置向导页面 ---------------- */
const SETUP_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>龙虾脑 · 首次配置向导</title>
<style>
:root{--bg:#FAFAF8;--card:#FFF;--fg:#1A1A1A;--muted:#6B6B6B;--line:#E3E1DB;--ember:#E8451F;--ok:#1E9E6A;--warn:#B8761A;--err:#A32D2D;--soft:#F6F4F0}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
.shell{max-width:1080px;margin:0 auto;padding:28px 24px 90px}
.top{display:flex;justify-content:space-between;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:24px}
.brand{display:flex;gap:14px;align-items:center}
.mark{width:46px;height:46px;border-radius:13px;background:var(--ember);color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px;letter-spacing:-.5px;flex:none}
.brand h1{font-size:21px;margin:0;letter-spacing:-.3px}
.brand p{margin:1px 0 0;font-size:13px;color:var(--muted)}
.progress{display:flex;align-items:center;gap:12px;min-width:220px;flex:1;max-width:320px}
.pbar{flex:1;height:6px;background:#EAE7E0;border-radius:6px;overflow:hidden}
.pbar i{display:block;height:100%;width:0;background:var(--ember);transition:width .3s ease}
#ptext{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.grid{display:grid;grid-template-columns:230px minmax(0,1fr);gap:24px;align-items:start}
.nav{position:sticky;top:28px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px}
.nitem{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:10px;cursor:pointer;font-size:13px;transition:background .15s}
.nitem:hover{background:var(--soft)}
.nitem.on{background:#FDEEE9}
.nitem.on b{color:var(--ember)}
.num{width:22px;height:22px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:11px;flex:none;background:#fff;color:var(--muted)}
.nitem.on .num{background:var(--ember);border-color:var(--ember);color:#fff}
.nitem.done .num{background:var(--ok);border-color:var(--ok);color:#fff}
.nitem small{display:block;color:var(--muted);font-size:11px;font-weight:400;line-height:1.45;margin-top:1px}
.main{min-width:0}
.banner{display:none;padding:11px 14px;border-radius:10px;font-size:13px;margin-bottom:14px;border:1px solid var(--line);background:#fff;word-break:break-word}
.banner.ok{background:#E7F5EE;border-color:#BFE6D3;color:#146B48}
.banner.warn{background:#FFF6E6;border-color:#F0DDB4;color:#8A5A12}
.banner.err{background:#FCEBEB;border-color:#F0C7C7;color:var(--err)}
.banner.info{background:#EEF3FA;border-color:#CFDCEC;color:#33517A}
.panel{display:none;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 28px}
.panel.on{display:block}
.panel h2{font-size:19px;margin:0 0 5px;letter-spacing:-.2px}
.lead{font-size:13px;color:var(--muted);margin:0 0 20px}
h3{font-size:14px;margin:22px 0 10px;font-weight:600}
h3:first-of-type{margin-top:0}
.kv{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:13px}
.kv:last-child{border-bottom:none}
.kv>span:first-child{color:var(--muted);flex:none}
.kv>span:last-child{text-align:right;word-break:break-all}
.pill{display:inline-block;padding:1px 9px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
.pill.ok{background:#E7F5EE;color:var(--ok)}
.pill.warn{background:#FFF1D9;color:var(--warn)}
.pill.err{background:#FCEBEB;color:var(--err)}
.pill.idle{background:#F0EEE9;color:var(--muted)}
.box{border:1px solid var(--line);border-left:3px solid var(--line);border-radius:9px;padding:12px 14px;font-size:13px;margin:14px 0;background:var(--soft);color:#444}
.box.info{border-left-color:#5A7DB0;background:#F3F6FC}
.box.ok{border-left-color:var(--ok);background:#F1F9F5}
.box.warn{border-left-color:var(--warn);background:#FFF8EA;color:#6E4B12}
.box b{color:var(--fg)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:inherit;font-size:13px;padding:9px 15px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--fg);cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{border-color:#B9B5AC}
.btn:active{opacity:.75}
.btn.primary{background:var(--ember);border-color:var(--ember);color:#fff;font-weight:600}
.btn.ghost{background:transparent}
.btn.small{padding:6px 10px;font-size:12px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.row{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin:12px 0}
ol,ul{margin:8px 0;padding-left:20px;font-size:13px;color:#444}
li{margin:5px 0}
.linkbox{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#fff}
.linkbox .t{font-size:12px;color:var(--muted);margin-bottom:6px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.linkbox code{display:block;font-size:12px;word-break:break-all;background:var(--soft);padding:8px 10px;border-radius:6px;margin-bottom:8px;color:#333}
.tag{font-size:11px;padding:1px 7px;border-radius:5px;background:#FDEEE9;color:var(--ember);font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.mini{border:1px solid var(--line);border-radius:10px;padding:14px;background:#fff}
.mini h4{font-size:13px;margin:0 0 6px}
.mini p{font-size:12px;color:var(--muted);margin:0 0 8px;line-height:1.6}
.field{margin:10px 0}
.field label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.field input,.field select{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit;background:#fff;color:var(--fg);outline:none}
.field input:focus,.field select:focus{border-color:var(--ember)}
#qr{display:flex;justify-content:center;margin:14px 0 4px}
#qr svg{max-width:190px;height:auto}
.foot{display:flex;gap:9px;align-items:center;margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
.foot .spacer{flex:1}
.tail{font-size:12px;color:var(--muted);text-align:center;margin-top:18px;line-height:1.7}
code.inline{background:var(--soft);padding:1px 5px;border-radius:4px;font-size:12px}
.chk{display:flex;gap:9px;align-items:flex-start;font-size:13px;padding:7px 0}
.chk .dot{width:18px;height:18px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11px;color:#fff;margin-top:2px}
@media(max-width:780px){.shell{padding:18px 14px 60px}.grid{grid-template-columns:1fr;gap:14px}.nav{position:static;display:flex;overflow-x:auto;padding:6px}.nitem{min-width:132px}.nitem small{display:none}.panel{padding:20px 16px}.grid2{grid-template-columns:1fr}.progress{max-width:none}}
</style></head><body>
<div class="shell">
  <header class="top">
    <div class="brand"><div class="mark">LB</div><div><h1>首次配置向导</h1><p>约 3 分钟 · 一次配好，IP 再变也不用重来</p></div></div>
    <div class="progress"><div class="pbar"><i id="pbar"></i></div><span id="ptext">0 / 6</span></div>
  </header>
  <div class="grid">
    <aside class="nav" id="nav"></aside>
    <main class="main">
      <div class="banner" id="banner"></div>

      <section class="panel on" id="s0">
        <h2>1 · 环境体检</h2><p class="lead">先看清这台 Mac 的真实状态，再决定要配什么。下面的每一项都是实时检测，不是写死的说明。</p>
        <div id="checks"></div>
        <div class="box info"><b>必做 3 项</b>：开机自启 → 辅助功能授权 → 固定连接。<br>其余（大模型、服务端 ASR）都是可选增强，不配也能正常使用。</div>
        <div class="box warn" id="envIpBox"></div>
        <div class="row"><button class="btn" onclick="refresh()">重新检测</button><a class="btn ghost" href="/manage" >打开控制台</a></div>
      </section>

      <section class="panel" id="s1">
        <h2>2 · 开机自启</h2><p class="lead">让服务由 macOS 托管：登录后自动启动、崩溃后自动拉起。<b>先做这一步</b>，下一步的辅助功能授权对象才不会变。</p>
        <div id="autoBox"></div>
        <h3>这一步会做什么</h3>
        <ol><li>写入 <code class="inline">~/Library/LaunchAgents/com.lobsterbrain.plist</code>（用户级，不需要 sudo）</li><li>由 <code class="inline">launchd</code> 拉起服务，并把当前手动实例交接出去</li><li>页面会在约 3 秒后自动刷新，向导进度会保留</li></ol>
        <div class="box warn"><b>切换会短暂重启服务</b>。若 5 秒后页面没有自动恢复，请双击项目里的 <code class="inline">start.command</code> 手动启动，再回来刷新本页。</div>
      </section>

      <section class="panel" id="s2">
        <h2>3 · 辅助功能授权</h2><p class="lead">「往应用里自动打字」「窗口管理」「复制粘贴」依赖 macOS 辅助功能权限。不授权也能打开应用、搜索、控制鼠标。</p>
        <div id="permBox"></div>
        <h3>授权步骤</h3>
        <ol id="permSteps"></ol>
        <div class="row"><button class="btn primary" onclick="openPerm()">打开系统设置</button><button class="btn" onclick="refresh()">重新检测</button></div>
      </section>

      <section class="panel" id="s3">
        <h2>4 · 固定连接与证书</h2><p class="lead">IP 会变，<code class="inline">.local</code> 域名不会。把固定入口加到手机主屏，之后无论路由器怎么分配 IP 都不用换链接。</p>
        <div id="certBox"></div>
        <h3>手机入口（含访问令牌，别发到公开场合）</h3>
        <div id="linkBox"></div>
        <div id="qr"></div>
        <h3>让 iPhone 信任证书（仅 HTTPS 语音需要，做一次）</h3>
        <ol><li>手机 Safari 打开 <span id="certUrl"></span>，下载描述文件</li><li>「设置 → 通用 → VPN 与设备管理」安装 <b>LobsterBrain</b></li><li>「设置 → 通用 → 关于本机 → 证书信任设置」开启<b>完全信任</b></li><li>重签过证书的话，必须重新做一遍这三步</li></ol>
        <h3>添加到主屏幕</h3>
        <ol><li>手机 Safari 打开上面的「文字入口（推荐）」</li><li>点底部「分享 → 添加到主屏幕」</li><li>之后点桌面图标即可全屏打开，像原生 App</li></ol>
      </section>

      <section class="panel" id="s4">
        <h2>5 · 语音输入</h2><p class="lead">手机遥控电脑的语音链路。<b>默认不需要任何服务端 ASR</b> —— iOS 键盘听写本身就是系统级中文识别。</p>
        <div class="grid2">
          <div class="mini"><h4>① 键盘听写 <span class="tag">推荐主力</span></h4><p>点手机页紫色圆球 → 唤起输入框 → 点 iOS 键盘上的麦克风 → 说话 → 点发送。零证书、零权限、任何网络都可用。</p><span class="pill ok">零配置</span></div>
          <div class="mini"><h4>② 网页识别（短按说话）</h4><p>用 <code class="inline">.local:8788</code> 的 HTTPS 入口：<b>短按</b>圆球说完自动收尾、<b>长按</b>说完松手。两字词「关闭」不再被松手掐断；听到的原话会留在输入框可改写。需先信任证书，iOS Safari 支持度不一致。</p><span class="pill warn">需 HTTPS</span></div>
          <div class="mini"><h4>③ 结果语音播报</h4><p>执行完成后手机把结果读回来，形成「说话 → Mac 执行 → 手机回读」闭环，语音区可一键开关。</p><span class="pill idle">可选</span></div>
          <div class="mini"><h4>④ 服务端 ASR（实验）</h4><p>自己接转写引擎，把手机录音上传给 Mac 或云 API。准确可控，但要装依赖 / 配密钥，音频可能出网。</p><span class="pill idle">默认关闭</span></div>
        </div>
        <h3>服务端 ASR 引擎状态</h3>
        <div id="asrBox"></div>
        <div id="asrForm"></div>
        <div class="box info" id="asrNote"></div>
        <div class="row"><button class="btn" id="asrTestBtn" onclick="testAsr()">录音 3 秒测试转写</button><span id="asrResult" style="font-size:13px"></span></div>
      </section>

      <section class="panel" id="s5">
        <h2>6 · 验收与完成</h2><p class="lead">先做无副作用的解析演练，再决定是否真实跑一条指令。所有结果都来自服务真实返回，不假装成功。</p>
        <h3>① 解析演练（不操控 Mac）</h3>
        <div id="parseOut" style="font-size:13px;color:var(--muted)">正在检测…</div>
        <h3>② 真机试跑（可选）</h3>
        <p class="lead" style="margin-bottom:10px">会真的在 Mac 上「打开访达」，无破坏性；不想让电脑动一下可以跳过。</p>
        <div class="row"><button class="btn" id="runBtn" onclick="realRun()">试跑「打开访达」</button><span id="runOut" style="font-size:13px"></span></div>
        <h3>配置完成度</h3>
        <div id="finalList"></div>
        <div class="box ok" id="finalBox"></div>
        <div class="row"><a class="btn primary" id="openPhone" href="#" target="_blank">打开手机遥控页</a><a class="btn" href="/manage">回到控制台</a><button class="btn ghost" onclick="resetWizard()">重新开始向导</button></div>
      </section>

      <div class="foot">
        <button class="btn" id="prev">← 上一步</button><div class="spacer"></div>
        <button class="btn ghost" id="skip">跳过这步</button>
        <button class="btn primary" id="next">下一步 →</button>
      </div>
      <div class="tail">本向导仅允许 Mac 本机操作，所有写操作只调用项目内固定脚本，不接受任意命令。<br>龙虾脑 <span id="ver"></span> · 数据全部留在这台 Mac</div>
    </main>
  </div>
</div>
<script src="/public/qrcode.js"></script>
<script>
var S=null, step=0, DONE={};
var STEPS=[
 {t:'环境体检',s:'看清这台 Mac 的状态'},
 {t:'开机自启',s:'交给 launchd 托管'},
 {t:'辅助功能授权',s:'让自动输入生效'},
 {t:'固定连接与证书',s:'IP 变了也能打开'},
 {t:'语音输入',s:'键盘听写 / ASR'},
 {t:'验收与完成',s:'解析演练 + 真机试跑'}
];
function el(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function pill(k,t){return '<span class="pill '+k+'">'+esc(t)+'</span>';}
function box(k,html){return '<div class="box '+k+'">'+html+'</div>';}
function kv(k,v,p){return '<div class="kv"><span>'+k+'</span><span>'+v+' '+p+'</span></div>';}
function showBanner(k,m){var b=el('banner');b.className='banner '+k;b.innerHTML=esc(m);b.style.display='block';}
function hideBanner(){el('banner').style.display='none';}
async function api(p,o){var r=await fetch(p,o||{});var d=await r.json().catch(function(){return {};});if(!r.ok)throw new Error(d.error||('HTTP '+r.status));return d;}
function saveState(){try{localStorage.setItem('lb_setup_v1',JSON.stringify({step:step,done:DONE}));}catch(e){}}
function loadState(){try{var j=JSON.parse(localStorage.getItem('lb_setup_v1')||'{}');DONE=j.done||{};step=Math.max(0,Math.min(5,Number(j.step)||0));}catch(e){}}
function go(i){step=Math.max(0,Math.min(5,i));saveState();render();window.scrollTo({top:0,behavior:'smooth'});if(step===5)selftest();}
function renderNav(){
  el('nav').innerHTML=STEPS.map(function(s,i){
    var c='nitem'+(i===step?' on':'')+(DONE[i]?' done':'');
    var n=DONE[i]&&i!==step?'✓':(i+1);
    return '<div class="'+c+'" onclick="go('+i+')"><span class="num">'+n+'</span><span><b>'+esc(s.t)+'</b><small>'+esc(s.s)+'</small></span></div>';
  }).join('');
  var n=Object.keys(DONE).filter(function(k){return DONE[k];}).length;
  el('pbar').style.width=Math.round(n/6*100)+'%';
  el('ptext').textContent=n+' / 6 已完成';
  for(var i=0;i<6;i++) el('s'+i).className='panel'+(i===step?' on':'');
  el('prev').disabled=(step===0);
  el('next').textContent=(step===5?'完成配置':'下一步 →');
  el('ver').textContent=S?('v'+S.version):'';
}
function renderChecks(){
  if(!S)return;
  var c=S.cert;
  var certOk=c.exists&&c.coversCurrentIp;
  el('checks').innerHTML=[
    kv('服务', 'v'+esc(S.version)+' · PID '+S.pid, pill('ok','运行中')),
    kv('运行环境', esc(S.node)+' · '+esc(S.os), pill('ok','就绪')),
    kv('运行方式', S.launchedByLaunchd?'launchd 系统托管':'手动启动', pill(S.launchedByLaunchd?'ok':'warn',S.launchedByLaunchd?'稳定':'待切换')),
    kv('辅助功能授权', S.accessibility?'已授权':'未授权', pill(S.accessibility?'ok':'warn',S.accessibility?'可用':'待办')),
    kv('HTTPS 证书', certOk?'已生成 · 覆盖当前 IP':(c.exists?'已生成 · 当前 IP 不在 SAN 里':'未生成'), pill(certOk?'ok':'warn',certOk?'可用':'待处理')),
    kv('开机自启', S.launchd?'已安装':'未安装', pill(S.launchd?'ok':'warn',S.launchd?'已配置':'待办')),
    kv('本机应用识别', S.apps+' 个', pill('ok','已扫描')),
    kv('智能解析', S.llm.enabled?'大模型 '+esc(S.llm.model):'本地规则引擎', pill(S.llm.enabled?'ok':'idle',S.llm.enabled?'增强':'够用')),
    kv('服务端 ASR', S.asr.provider==='none'?'未启用（系统听写）':esc(S.asr.provider), pill(S.asr.ready?'ok':'idle',S.asr.ready?'就绪':'可选'))
  ].join('');
  el('envIpBox').innerHTML='<b>注意 IP 会变。</b>当前局域网 IP 是 <b>'+esc(S.lanIP)+'</b>，固定域名是 <b>'+esc(S.localName)+'</b>。手机主屏请一定用第 4 步的 .local 链接，别存带 IP 的书签。';
}
function renderAuto(){
  if(!S)return;
  var h='';
  if(S.launchd&&S.launchedByLaunchd){
    h=box('ok','<b>已由 launchd 托管。</b>登录自动启动、崩溃自动拉起，这一步不用再做。')+'<div class="row"><a class="btn" href="/manage">去控制台管理开机自启</a></div>';
  }else if(S.launchd){
    h=box('warn','<b>开机自启已安装，但当前仍是手动启动的实例。</b>需要把进程交接给系统，配置才算真正生效。')+'<div class="row"><button class="btn primary" onclick="autostart(\\'handover\\')">切换为系统托管</button></div>';
  }else{
    h=box('warn','<b>尚未启用开机自启。</b>现在服务是手动跑起来的，关掉终端 / 重启 Mac 后手机就打不开了。')+'<div class="row"><button class="btn primary" id="autoBtn" onclick="autostart(\\'install\\')">一键安装并切换为系统托管</button></div>';
  }
  el('autoBox').innerHTML=h;
}
function renderPerm(){
  if(!S)return;
  var who=S.launchedByLaunchd?('<b>node 可执行文件</b>（'+esc(S.nodePath||'which node')+'）'):('<b>'+esc(S.parentProcess)+'</b>（当前运行本服务的程序）');
  var h=(S.accessibility?box('ok','<b>已授权。</b>自动输入、窗口管理、复制粘贴都可以用。'):box('warn','<b>未授权。</b>现在能打开应用 / 搜索 / 控制鼠标，但「往应用里打字」不会生效。'))
    +kv('当前授权对象',who,pill(S.accessibility?'ok':'warn',S.accessibility?'已授权':'待授权'));
  el('permBox').innerHTML=h;
  el('permSteps').innerHTML='<li>点「打开系统设置」，进入 <b>系统设置 → 隐私与安全性 → 辅助功能</b></li>'
    +'<li>在列表里找到并开启 '+who+'</li>'
    +'<li><b>完全退出该程序再重新打开</b>（或在控制台点「一键重载」），权限才生效</li>'
    +'<li>回到这里点「重新检测」，显示已授权即可</li>';
}
function linkCard(title,tag,url,note){
  return '<div class="linkbox"><div class="t"><span>'+esc(title)+'</span><span class="tag">'+esc(tag)+'</span></div><code>'+esc(url)+'</code>'
    +'<div class="row" style="margin:0"><button class="btn small" onclick="copyUrl(this)">复制链接</button><span style="font-size:11px;color:var(--muted)">'+esc(note)+'</span></div></div>';
}
function renderLinks(){
  if(!S)return;
  var L=S.links,c=S.cert;
  el('linkBox').innerHTML=
    linkCard('文字入口（推荐加到主屏）','固定 .local',L.local,'IP 变了也不失效')+
    linkCard('语音入口（短按说话）','HTTPS',L.localHttps,'需先在手机上信任证书')+
    linkCard('备用：当前 IP 直连','IP',L.http,'临时排障用，IP 会变');
  el('certUrl').innerHTML='<code class="inline">'+esc(L.cert)+'</code>';
  var h='';
  if(!c.exists) h=box('warn','<b>还没有 HTTPS 证书。</b>文字入口可用，但网页语音不可用。')+'<div class="row"><button class="btn" onclick="regenCert()">生成证书</button></div>';
  else if(!c.coversCurrentIp) h=box('warn','<b>当前 IP '+esc(S.lanIP)+' 不在证书里。</b>证书 SAN 只有：'+esc(c.line||'（读取失败）')+'。用 IP 打开 HTTPS 会报证书不匹配；用 .local 域名不受影响，但若想用 IP 的 HTTPS 入口，建议重签。')+'<div class="row"><button class="btn" onclick="regenCert()">重签证书（保留旧 IP）</button></div>';
  else h=box('ok','<b>证书已覆盖当前 IP 与 .local 域名。</b>SAN：'+esc(c.line));
  h+='<div class="row"><a class="btn small" href="/cert.crt" download>下载根证书（本机）</a><a class="btn small ghost" href="/api/reload" onclick="doReload(event)">重载服务</a></div>';
  h+='<div class="box info">重签证书会生成新的自签证书，<b>手机需要重新下载并安装 cert.crt、重开完全信任</b>；重签后还要重载服务才生效。若不想折腾，直接用 .local 文字入口 + 键盘听写即可。</div>';
  el('certBox').innerHTML=h;
  try{var q=qrcode(0,'M');q.addData(L.local);q.make();el('qr').innerHTML=q.createSvgTag({cellSize:5,margin:8,alt:'手机连接二维码'});}
  catch(e){el('qr').innerHTML='<span style="font-size:12px;color:var(--muted)">二维码生成失败，请直接复制链接</span>';}
}
function renderVoice(){
  if(!S)return;
  var a=S.asr,d=a.deps;
  el('asrBox').innerHTML=
    kv('当前引擎',a.provider==='none'?'关闭（推荐）':esc(a.provider),pill(a.ready?'ok':'idle',a.ready?'就绪':'未启用'))
    +kv('依赖检测','ffmpeg '+(d.ffmpeg?'✓':'—')+' · whisper-cli '+(d.whisperCli?'✓':'—')+' · 模型 '+(d.model?'✓':'—')+' · Key '+(d.apiKey?'✓':'—'),pill('idle','本机'))
    +kv('隐私边界',esc(a.privacy),pill(a.provider==='openai'?'warn':'ok',a.provider==='openai'?'出网':'本地'))
    +(a.reasons.length?box('info',a.reasons.map(function(r){return '· '+esc(r);}).join('<br>')):'');
  var sel=a.provider;
  el('asrForm').innerHTML='<div class="grid2">'
    +'<div class="field"><label>引擎（保存后立即生效）</label><select id="asrProvider">'
      +'<option value="none"'+(sel==='none'?' selected':'')+'>关闭 · 用 iOS 键盘听写</option>'
      +'<option value="whisper"'+(sel==='whisper'?' selected':'')+'>本机 whisper.cpp（离线）</option>'
      +'<option value="openai"'+(sel==='openai'?' selected':'')+'>云端 OpenAI 兼容 /audio/transcriptions</option>'
    +'</select></div>'
    +'<div class="field"><label>云端模型名</label><input id="asrModel" value="'+esc(a.paths.cloudModel)+'" placeholder="whisper-1"></div>'
    +'<div class="field"><label>ASR Base URL（云端）</label><input id="asrBase" value="'+esc(a.paths.baseUrl)+'" placeholder="https://api.openai.com/v1"></div>'
    +'<div class="field"><label>API Key（云端，留空保留原值）</label><input id="asrKey" type="password" placeholder="sk-..."></div>'
    +'<div class="field"><label>whisper-cli 路径（本机，留空自动找）</label><input id="asrBin" value="'+esc(a.paths.whisperCliPath)+'" placeholder="自动检测"></div>'
    +'<div class="field"><label>模型文件路径（本机 .bin）</label><input id="asrModelPath" value="'+esc(a.paths.modelPath)+'" placeholder="ggml-small.bin 的完整路径"></div>'
    +'</div><div class="row"><button class="btn" onclick="saveAsr()">保存引擎设置</button><span style="font-size:12px;color:var(--muted)">写入 asr-config.json（已 gitignore）</span></div>';
  el('asrNote').innerHTML='<b>产品判断：</b>服务端 ASR 好做但不一定划算。键盘听写由 iOS 系统提供，中文识别质量最好、零延迟、零成本、零隐私风险；自建 whisper 要装依赖 + 下载模型（small 约 500MB），云 API 要密钥和费用且语音出网。所以默认关闭，只在你需要「长语音 / 自定义热词 / 离线转写 / 唤醒词」时才启用。';
  el('asrTestBtn').disabled=!a.ready;
}
function renderFinal(){
  if(!S)return;
  var items=[
    ['开机自启',S.launchd&&S.launchedByLaunchd],
    ['辅助功能授权',S.accessibility],
    ['固定 .local 入口（已确认）',!!DONE[3]],
    ['证书覆盖当前 IP',S.cert.exists&&S.cert.coversCurrentIp],
    ['解析链路正常',!!window.LB_PARSE_OK],
    ['真机试跑通过',!!window.LB_RUN_OK]
  ];
  var ok=items.filter(function(x){return x[1];}).length;
  el('finalList').innerHTML=items.map(function(x){
    return '<div class="chk"><span class="dot" style="background:'+(x[1]?'var(--ok)':'#C9C5BC')+'">'+(x[1]?'✓':'·')+'</span><span>'+esc(x[0])+'</span>'+pill(x[1]?'ok':'idle',x[1]?'完成':'可跳过')+'</div>';
  }).join('');
  el('finalBox').innerHTML='<b>'+ok+' / '+items.length+' 项就绪。</b>'+(ok>=4?'核心链路已经配好，可以开始用了。证书 / 试跑属于可选增强，不影响文字遥控。':'建议回到前面把标灰的必做项补完。');
  el('openPhone').href=S.links.local;
}
function render(){renderNav();if(!S)return;renderChecks();renderAuto();renderPerm();renderLinks();renderVoice();renderFinal();}
async function refresh(){try{S=await api('/api/setup/status');hideBanner();render();if(step===5&&!window.LB_PARSE_OK)selftest();}catch(e){showBanner('err','读取本机状态失败：'+e.message+'。请在 Mac 本机浏览器打开 http://localhost:8787/setup');}}
async function autostart(action){
  var b=el('autoBtn');if(b)b.disabled=true;
  try{
    var d=await api('/api/setup/autostart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action})});
    if(!d.ok)throw new Error(d.output||d.error||'脚本执行失败');
    showBanner('ok','已安装开机自启，正在交接给 launchd，页面约 3 秒后自动刷新…');
    DONE[1]=true;saveState();
    setTimeout(function(){location.reload();},3200);
  }catch(e){showBanner('err','操作失败：'+e.message);if(b)b.disabled=false;}
}
async function openPerm(){try{await api('/api/accessibility',{method:'POST'});showBanner('info','已打开系统设置。授权后请完全退出该程序再重开，然后点「重新检测」。');}catch(e){showBanner('err','打开失败：'+e.message);}}
async function regenCert(){
  if(!confirm('重签证书会生成新的自签证书，手机需要重新安装 cert.crt 并重新开启完全信任。继续？'))return;
  try{
    var d=await api('/api/setup/cert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
    if(!d.ok)throw new Error(d.output||d.error||'重签失败');
    showBanner('ok','证书已重签。请点「重载服务」生效，并让手机重新安装证书。');
    await refresh();
  }catch(e){showBanner('err','重签失败：'+e.message);}
}
async function doReload(e){
  if(e)e.preventDefault();
  if(!confirm('重载服务？页面会在约 2 秒后自动刷新。'))return;
  try{await api('/api/reload',{method:'POST'});showBanner('ok','正在重载…');setTimeout(function(){location.reload();},2200);}catch(err){showBanner('err','重载失败：'+err.message);}
}
function copyUrl(btn){
  var t=btn.parentNode.parentNode.querySelector('code').textContent;
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){showBanner('ok','已复制：'+t.slice(0,46)+'…');},function(){fallbackCopy(t);});}
  else fallbackCopy(t);
}
function fallbackCopy(t){var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');showBanner('ok','已复制');}catch(e){showBanner('err','复制失败，请长按选择文本');}document.body.removeChild(a);}
async function saveAsr(){
  var d={provider:el('asrProvider').value,baseUrl:el('asrBase').value.trim(),apiKey:el('asrKey').value.trim(),model:el('asrModel').value.trim(),whisperBin:el('asrBin').value.trim(),whisperModel:el('asrModelPath').value.trim()};
  try{var r=await api('/api/asr/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});showBanner('ok','已保存，当前引擎：'+r.provider);await refresh();}
  catch(e){showBanner('err','保存失败：'+e.message);}
}
async function testAsr(){
  if(!S||!S.asr.ready){showBanner('warn','引擎未就绪，请先保存并确认依赖齐全');return;}
  try{
    var stream=await navigator.mediaDevices.getUserMedia({audio:true});
    var mime=MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'audio/mp4';
    var chunks=[],rec=new MediaRecorder(stream,{mimeType:mime});
    rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data);};
    rec.onstop=async function(){
      stream.getTracks().forEach(function(t){t.stop();});
      el('asrResult').textContent='正在转写…';
      try{
        var r=await fetch('/api/asr',{method:'POST',headers:{'Content-Type':mime},body:new Blob(chunks,{type:mime})});
        var d=await r.json();
        el('asrResult').innerHTML=d.ok?('<b>识别结果：</b>'+esc(d.text||'（没听清）')):('<b>失败：</b>'+esc(d.error));
      }catch(e){el('asrResult').textContent='失败：'+e.message;}
    };
    rec.start();showBanner('info','正在录音，说一句「打开访达」，3 秒后自动结束…');
    setTimeout(function(){if(rec.state!=='inactive')rec.stop();},3000);
  }catch(e){showBanner('err','无法录音：'+e.message+'（需在本机 localhost / HTTPS 打开，并允许麦克风）');}
}
async function selftest(){
  el('parseOut').textContent='正在检测…';
  try{
    var d=await api('/api/normalize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'帮我在 B 站搜一下大模型微调'})});
    window.LB_PARSE_OK=true;
    el('parseOut').innerHTML=kv('你说的',esc(d.raw),'')+kv('龙虾脑理解成','<b>'+esc(d.normalized)+'</b>',pill('ok','解析链路正常'));
  }catch(e){window.LB_PARSE_OK=false;el('parseOut').innerHTML=box('err','解析演练失败：'+esc(e.message));}
  renderFinal();
}
async function realRun(){
  var btn=el('runBtn');btn.disabled=true;el('runOut').textContent='正在执行…';
  try{
    var d=await api('/api/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({instruction:'打开访达'})});
    for(var i=0;i<24;i++){
      await new Promise(function(r){setTimeout(r,350);});
      var t=await api('/api/task/'+d.id);
      if(t.status==='success'){window.LB_RUN_OK=true;el('runOut').innerHTML=pill('ok','成功')+' '+esc(t.result||'已完成');break;}
      if(t.status==='failed'){el('runOut').innerHTML=pill('err','失败')+' '+esc(t.error||'执行失败');break;}
      if(i===23)el('runOut').textContent='仍在执行，可在 /dashboard 查看结果';
    }
  }catch(e){el('runOut').innerHTML=pill('err','失败')+' '+esc(e.message);}
  btn.disabled=false;renderFinal();
}
function resetWizard(){DONE={};step=0;saveState();go(0);showBanner('info','向导已重置，检测数据保持实时。');}
el('prev').onclick=function(){if(step>0)go(step-1);};
el('skip').onclick=function(){if(step<5)go(step+1);else finish();};
el('next').onclick=function(){DONE[step]=true;saveState();if(step<5)go(step+1);else finish();};
function finish(){DONE[5]=true;saveState();renderNav();showBanner('ok','配置完成。点「打开手机遥控页」或把第 4 步的链接加到手机主屏。');}
loadState();renderNav();refresh();
</script></body></html>`;

/* 启动辅助：带 EADDRINUSE 重试的监听（重载/重启时旧进程可能短暂占用端口） */
function listenWithRetry(srv, port, host, label, onSuccess) {
  let tries = 40;
  const attempt = () => {
    srv.once('error', (e) => {
      if (e.code === 'EADDRINUSE' && tries-- > 0) { setTimeout(attempt, 300); }
      else console.error(label + ' 监听失败:', e.message);
    });
    srv.listen(port, host, () => { console.log(label + ' 已启动: ' + host + ':' + port); if (onSuccess) onSuccess(); });
  };
  attempt();
}

/* 软重载：launchd 托管时直接退出由系统拉起（单实例）；手动启动时派生新进程再退出 */
function restartSelf() {
  if (process.env.LB_LAUNCHED) { setTimeout(() => process.exit(0), 200); return; }
  try {
    const cp = require('child_process');
    const child = cp.spawn(process.execPath, [__filename], { detached: true, stdio: 'ignore', cwd: __dirname, env: process.env });
    child.unref();
  } catch (e) {}
  setTimeout(() => process.exit(0), 250);
}

function startHttps() {
  const certDir = path.join(__dirname, 'cert');
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile = path.join(certDir, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    try {
      const sslOpts = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
      const hsrv = https.createServer(sslOpts, server.listeners('request')[0]);
      listenWithRetry(hsrv, HTTPS_PORT, '0.0.0.0', '龙虾脑 HTTPS');
      console.log('  手机端（语音输入）:  https://' + lanIP() + ':' + HTTPS_PORT + '  注意：首次打开需点「高级→继续」信任证书');
      console.log('  本机 / 看板:         https://localhost:' + HTTPS_PORT + '/dashboard');
    } catch (e) { console.log('  HTTPS 启动失败（不影响文字输入）:', e.message); }
  } else {
    console.log('  未找到 cert/ 证书，语音输入不可用。运行 bin/gen-cert.sh 后重启。');
  }
}

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 关键：禁用一切缓存，避免 iPhone Safari 缓存旧版手机页（表现为「重载后仍点不动」）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 证书下载：手机 Safari 打开后可安装为受信任根证书（公钥文件，无需令牌）
  if (req.method === 'GET' && url.pathname === '/cert.crt') {
    const f = path.join(__dirname, 'cert', 'lobsterbrain.crt');
    if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('cert not found'); }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="LobsterBrain.crt"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(fs.readFileSync(f));
  }
  // 静态资源（仅 public/ 下，防目录穿越）
  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const base = path.join(__dirname, 'public');
    const f = path.join(base, url.pathname.replace(/^\/public\//, ''));
    if (f.startsWith(base) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      const ct = ext === '.js' ? 'text/javascript; charset=utf-8'
        : ext === '.css' ? 'text/css; charset=utf-8'
        : (ext === '.html' || ext === '.htm') ? 'text/html; charset=utf-8'
        : ext === '.svg' ? 'image/svg+xml'
        : ext === '.png' ? 'image/png'
        : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
        : 'application/octet-stream';
      res.setHeader('Content-Type', ct);
      // 页面不缓存（防手机吃旧版），图片/静态资源可缓存
      res.setHeader('Cache-Control', /^\.(png|jpe?g|svg|css|js)$/.test(ext) ? 'public, max-age=3600' : 'no-store');
      return res.end(fs.readFileSync(f));
    }
    res.statusCode = 404; return res.end('not found');
  }
  // 服务状态：本机返回完整信息（含令牌）；局域网只返回精简状态，供手机连接自检，不泄露令牌/IP
  if (req.method === 'GET' && url.pathname === '/api/status') {
    if (!isLocalhost(req)) return res.end(JSON.stringify({ running: true, version: VERSION, trustLan: TRUST_LAN }));
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const k in ifaces) for (const i of ifaces[k]) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    const hasCert = fs.existsSync(path.join(__dirname, 'cert', 'cert.pem'));
    const launchd = fs.existsSync(path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.lobsterbrain.plist'));
    const localName = (os.hostname().split('.')[0]) + '.local';
    return res.end(JSON.stringify({
      running: true, version: VERSION, pid: process.pid, uptime: Math.round(process.uptime()),
      lanIP: lanIP(), ips, httpPort: HTTP_PORT, httpsPort: HTTPS_PORT, token: AUTH_TOKEN, hasCert, launchd,
      trustLan: TRUST_LAN,
      phoneLinkHttp: 'http://' + lanIP() + ':' + HTTP_PORT + '/?t=' + AUTH_TOKEN,
      phoneLinkHttps: 'https://' + lanIP() + ':' + HTTPS_PORT + '/?t=' + AUTH_TOKEN,
      phoneLinkLocal: 'http://' + localName + ':' + HTTP_PORT + '/?t=' + AUTH_TOKEN,
    }));
  }
  // ===== 首次配置向导：所有写操作只允许 Mac 本机发起 =====
  if (req.method === 'GET' && url.pathname === '/api/setup/status') {
    if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden', hint: '请在 Mac 本机打开 /setup' })); }
    (async () => {
      try { res.end(JSON.stringify(await setupStatus())); }
      catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    })();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/setup/autostart') {
    if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', async () => {
      let action = 'install';
      try { action = (JSON.parse(body || '{}').action) || 'install'; } catch (e) {}
      if (action !== 'install' && action !== 'handover') { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: 'bad action' })); }
      // 已托管时不能再跑 install 脚本（脚本会 unload/load，等于把正在服务的自己杀掉）
      if (action === 'install' && process.env.LB_LAUNCHED) return res.end(JSON.stringify({ ok: false, error: '当前已由 launchd 托管，无需重复安装' }));
      let r = { ok: true, output: '' };
      if (action === 'install') {
        r = await runSetupScript('install');
        if (!r.ok) return res.end(JSON.stringify({ ok: false, output: r.output, error: r.error }));
      }
      // 确认 launchd 任务真的加载成功了，才敢让当前进程退出（否则服务会断）
      let loaded = false;
      try { execSync('launchctl list com.lobsterbrain', { encoding: 'utf8', timeout: 2500 }); loaded = true; } catch (e) {}
      if (!loaded) return res.end(JSON.stringify({ ok: false, output: r.output, error: 'launchd 任务未加载成功，为安全起见没有交接当前进程' }));
      if (process.env.LB_LAUNCHED) return res.end(JSON.stringify({ ok: true, handover: false, output: r.output, note: '当前已由 launchd 托管' }));
      // 新进程已在 listenWithRetry 等待端口，旧进程退出后 300ms 内自动接管
      res.end(JSON.stringify({ ok: true, handover: true, output: r.output, note: '服务正在交接给 launchd，约 1 秒后恢复' }));
      setTimeout(() => process.exit(0), 900);
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/setup/cert') {
    if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }
    req.resume();
    (async () => {
      const oldIps = certSan().ips.filter(x => x !== '127.0.0.1');
      const extra = Array.from(new Set([lanIP()].concat(oldIps))).filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x)).join(',');
      const r = await runSetupScript('cert', extra ? [extra] : []);
      res.end(Object.assign({}, r, { san: certSan().line, note: '重签后需重载服务，并让手机重新安装 cert.crt 并重新开启完全信任' }));
    })();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/asr/status') return res.end(JSON.stringify(asrStatus()));
  if (req.method === 'POST' && url.pathname === '/api/asr/config') {
    if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
    req.on('end', () => {
      let d = {};
      try { d = JSON.parse(body || '{}'); } catch (e) { return res.end(JSON.stringify({ ok: false, error: 'bad body' })); }
      const old = readAsrConfig();
      const cfg = {
        provider: ['none', 'whisper', 'openai'].includes(d.provider) ? d.provider : 'none',
        baseUrl: String(d.baseUrl || '').trim(),
        apiKey: String(d.apiKey || '').trim() || old.apiKey || '',
        model: String(d.model || '').trim() || 'whisper-1',
        whisperBin: String(d.whisperBin || '').trim(),
        whisperModel: String(d.whisperModel || '').trim(),
      };
      try { writeAsrConfig(cfg); } catch (e) { return res.end(JSON.stringify({ ok: false, error: e.message })); }
      const st = asrStatus();
      res.end(JSON.stringify({ ok: true, provider: cfg.provider, ready: st.ready, reasons: st.reasons }));
    });
    return;
  }
  // 软重载（本机或带令牌）
  if (req.method === 'POST' && url.pathname === '/api/reload') {
    if (!isLocalhost(req) && !checkAuth(url, req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthorized' })); }
    res.end(JSON.stringify({ ok: true, restarting: true }));
    restartSelf();
    return;
  }
  // 停止服务（仅本机；若由 launchd 管理则先卸载，否则仅退出）
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    if (!isLocalhost(req)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }
    try { require('child_process').execSync('launchctl unload "$HOME/Library/LaunchAgents/com.lobsterbrain.plist" 2>/dev/null'); } catch (e) {}
    res.end(JSON.stringify({ ok: true, stopping: true }));
    setTimeout(() => process.exit(0), 200);
    return;
  }
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
          try { saveAuth(); } catch (e) {}
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
    if (url.pathname === '/api/trust' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let on;
        try { const d = JSON.parse(body || '{}'); on = !!d.enabled; } catch (e) { return res.end(JSON.stringify({ ok: false, error: 'bad body' })); }
        TRUST_LAN = on; saveAuth();
        res.end(JSON.stringify({ ok: true, trustLan: TRUST_LAN }));
      });
      return;
    }
  }
  // 手机主入口：干净重写的页面（无 fixed/dvh/visualViewport，避免 iOS Safari 交互层塌陷）
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/m' || url.pathname === '/index.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(MINI_PAGE);
  }
  // 旧版界面保留，供对比/回退
  if (req.method === 'GET' && url.pathname === '/old') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(MOBILE_PAGE); }
  if (req.method === 'GET' && url.pathname === '/dashboard') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(DASH_PAGE); }
  if (req.method === 'GET' && url.pathname === '/config') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(CONFIG_PAGE); }
  if (req.method === 'GET' && url.pathname === '/manage') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(MANAGE_PAGE); }
  if (req.method === 'GET' && url.pathname === '/setup') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(SETUP_PAGE); }
  // 服务端 ASR：手机录音 → 转文字 → 回到既有指令链路。默认 provider=none，会明确报错而不是假装识别
  if (req.method === 'POST' && url.pathname === '/api/asr') {
    const chunks = [];
    let size = 0, dead = false;
    req.on('data', c => { size += c.length; if (size > 12e6) { dead = true; req.destroy(); } else chunks.push(c); });
    req.on('end', async () => {
      if (dead) return;
      try {
        let buf = Buffer.concat(chunks);
        let mime = (req.headers['content-type'] || '').split(';')[0].trim() || 'audio/webm';
        if (mime === 'application/json') {
          const j = JSON.parse(buf.toString('utf8'));
          buf = Buffer.from(j.audio || '', 'base64');
          mime = j.mime || 'audio/webm';
        }
        if (!buf.length) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, error: '没有收到音频' })); }
        const text = await transcribeAudio(buf, mime);
        res.end(JSON.stringify({ ok: true, text, provider: asrStatus().provider }));
      } catch (e) { res.end(JSON.stringify({ ok: false, error: e.message })); }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/tasks') return res.end(JSON.stringify(tasks.slice().reverse()));
  // 本机真实安装的应用清单（手机快捷应用由它动态生成）
  if (req.method === 'GET' && url.pathname === '/api/apps') {
    if (!INSTALLED_APPS.length) { try { scanInstalledApps(); } catch (e) {} }
    const quick = pickQuickApps().map(toClientApp);
    return res.end(JSON.stringify({ total: INSTALLED_APPS.length, quick, apps: INSTALLED_APPS.map(toClientApp) }));
  }
  if (req.method === 'POST' && url.pathname === '/api/apps/refresh') {
    let list = [];
    try { list = scanInstalledApps(); } catch (e) {}
    return res.end(JSON.stringify({ ok: true, total: list.length }));
  }
  // 真实应用图标：按需用系统自带 sips 把 .icns 转成 png 并缓存（无需第三方依赖）
  if (req.method === 'GET' && url.pathname === '/api/app-icon') {
    const p = url.searchParams.get('p') || '';
    const e = INSTALLED_APPS.find(a => a.path === p);
    if (!e) { res.statusCode = 404; return res.end('not found'); }
    try {
      fs.mkdirSync(ICON_DIR, { recursive: true });
      const out = path.join(ICON_DIR, crypto.createHash('md5').update(p).digest('hex') + '.png');
      if (!fs.existsSync(out)) {
        let ic = e.iconFile || 'AppIcon.icns';
        if (!/\.icns$/i.test(ic)) ic += '.icns';
        const src = path.join(e.path, 'Contents', 'Resources', ic);
        execFileSync('sips', ['-s', 'format', 'png', src, '--out', out, '--resampleHeightWidth', '96', '96'], { timeout: 6000, stdio: 'ignore' });
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.end(fs.readFileSync(out));
    } catch (err) { res.statusCode = 404; return res.end('no icon'); }
  }
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
        if (typeof d.scroll === 'number' && d.scroll !== 0) {
          const n = Math.max(-30, Math.min(30, Math.round(d.scroll)));
          await sh(`python3 "${MOUSECTL}" scroll ${n}`);
          return res.end(JSON.stringify({ ok: true, action: 'scroll', amount: n }));
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
        const { instruction, text, direct, forceText } = JSON.parse(body || '{}');
        // 兼容 text 字段：手机页/第三方客户端可能用 text 传指令，避免退化成「指令为空」
        const raw = String(instruction ?? text ?? '');
        // 指令链路统一净化：ASR 同音错字 / 裸动词 / 标点，以及「把它关了」这类上下文指代。
        // 原文直输(direct/forceText)必须逐字保留，绝不净化。
        const cmd = direct ? raw : sanitizeSpeech(resolveContextRef(raw));
        if (!direct) rememberAppContext(cmd);
        const extra = direct ? { direct: true, forceText: !!forceText } : {};
        if (!direct && cmd !== raw) extra.spoken = raw;   // 保留听到的原话，便于回溯与纠错
        const t = makeTask(cmd, extra); tasks.push(t); save(); runTask(t);
        res.end(JSON.stringify({ id: t.id, normalized: cmd }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: 'bad request' })); }
    });
    return;
  }
  res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
});

load();
loadAuth();
loadAppCache();
setTimeout(() => {
  try { const n = scanInstalledApps(); console.log('[apps] 已发现本机应用 ' + n.length + ' 个'); }
  catch (e) { console.log('[apps] 应用扫描失败:', e.message); }
}, 600);
const HTTP_PORT = PORT;
const HTTPS_PORT = Number(PORT) + 1;
// 用带重试的监听：软重载时新进程会与尚未退出的旧进程抢端口，需等待释放后重试
listenWithRetry(server, HTTP_PORT, '0.0.0.0', '龙虾脑 HTTP', () => {
  const lan = lanIP();
  console.log('龙虾脑 v3.5 已启动');
  console.log('  手机端（文字输入）:  http://' + lan + ':' + HTTP_PORT);
  startHttps();
  const cfg = llmConfig();
  console.log('  智能解析: ' + (cfg.enabled ? '大模型 (' + cfg.model + ')' : '增强规则引擎（未配置 LLM）'));
  console.log('  能力: search / play / open(应用/文件夹/网站) / rating / system(音量/截图/锁屏…) / note / type(应用内输入)');
  console.log('  控制台: http://localhost:' + HTTP_PORT + '/manage  （开机自启 / 扫码连接 / 诊断）');
  console.log('  首次配置: http://localhost:' + HTTP_PORT + '/setup  （向导：权限 / 自启 / 固定入口 / 证书 / 语音）');
  console.log('  配置页: http://localhost:' + HTTP_PORT + '/config  （接入 LLM + 辅助功能权限）');
});
