/* ===========================================================================
 * 命运（Destiny）功能
 * 两种命运：注定的命运 / 潜在的命运
 * 触发 → 状态胶囊「你触及了 XX 的命运」→ 展开成框
 *   ① 扰动（模型生成：用户做了什么 + 导致了什么情境后果）
 * 常驻「忽略 / 进入主线」按钮：忽略→恢复情绪胶囊；进入→把开场白作为角色气泡发出
 * 依赖 alive-demo.html 中的全局：$、delay、escapeHTML、currentStoryChar、
 *   storyState、API_BASE、MODEL、getStoryContext、CHAR_PROFILES、
 *   formatBubble、scrollChat、chatHistory、renderCapsuleEmotion、saveCurrentStory、
 *   saveAppState、attachLatestNpcActions、addFeedEntry、isAnimating、isAbsentMode
 * =========================================================================== */
(function(){
'use strict';

/* 是否开启「语义/时间」触发的模型判定（每轮多一次请求，默认关，关键词触发始终生效） */
window.DESTINY_SEMANTIC_DETECT = false;
const DESTINY_DETECT_TIMEOUT_MS = 4500;
const DESTINY_REVEAL_TIMEOUT_MS = 10000;
const DESTINY_PRELUDE_VIDEOS = {
  d5: 'video/兜风.mp4',
  d5_motorcycle_secret: 'video/摩托车.mp4'
};

const BUTTERFLY_SVG = `<svg class="dst-bfly-svg" viewBox="0 0 44 38" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="dst-bfly-grad-destined" x1="5" y1="4" x2="39" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFD18B"/>
      <stop offset=".46" stop-color="#FF7B4A"/>
      <stop offset="1" stop-color="#E94B42"/>
    </linearGradient>
  </defs>
  <g class="dst-wing dst-wing-l">
    <ellipse cx="13" cy="12" rx="11" ry="9"/>
    <ellipse cx="14" cy="26" rx="8" ry="7"/>
  </g>
  <g class="dst-wing dst-wing-r">
    <ellipse cx="31" cy="12" rx="11" ry="9"/>
    <ellipse cx="30" cy="26" rx="8" ry="7"/>
  </g>
  <g class="dst-bfly-body">
    <line x1="22" y1="6" x2="22" y2="32"/>
    <line x1="22" y1="6" x2="18" y2="2"/>
    <line x1="22" y1="6" x2="26" y2="2"/>
  </g>
</svg>`;

/* 当前命运揭示的运行态 */
let revealState = null;   // { destiny, reason, title, opening }
let runId = 0;            // 自增，用于中断打字机
let aborted = false;
let pendingNormalReplyText = '';
let countdownTimer = null;
let countdownFrame = null;
let enteringDestiny = false;
let potentialHoldState = null;
let potentialPressState = null;
let pendingDestinyCapsuleFlight = null;
let potentialDestinySuppressClickUntil = 0;
let destinyTaskOpenTimer = null;
const MANUAL_POTENTIAL_PENDING_ID = '__manual_potential_pending__';

function fetchWithTimeout(url, options = {}, timeoutMs = 10000){
  if(typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/* ---------- 数据辅助 ---------- */
function pool(){ return Array.isArray(window.DESTINY_POOL) ? window.DESTINY_POOL : []; }

function triggeredSet(char){
  const st = storyState[char];
  if(!st) return [];
  if(!Array.isArray(st.triggeredDestinies)) st.triggeredDestinies = [];
  return st.triggeredDestinies;
}

function isDestinyTriggerSuppressed(destiny, char, sourceText = ''){
  return !!(typeof window.shouldSuppressDestinyAutoTrigger === 'function'
    && window.shouldSuppressDestinyAutoTrigger(destiny, char, sourceText));
}

function untriggered(char){
  const done = triggeredSet(char);
  return pool().filter(d => d.char === char && !done.includes(d.id) && !isDestinyTriggerSuppressed(d, char, 'untriggered'));
}

function nextPotentialDestiny(char){
  return untriggered(char).find(d => d.typeKey === 'potential' && d.audience !== 'multi') || null;
}

function nextBlackPotentialDestiny(char){
  return untriggered(char).find(d => d.typeKey === 'potential' && d.redBlack === '黑' && d.audience !== 'multi') || null;
}

const DOLO_DESTINY_ID = 'dolo-time-rewind-auditorium';

function createDoloDestiny(char = currentStoryChar){
  return {
    id: DOLO_DESTINY_ID,
    char,
    type: '注定的命运',
    typeKey: 'destined',
    audience: 'single',
    participants: ['周往','钟辰时','夏季','叶恒'],
    redBlack: '红',
    opening: '夜里，你回到家，客厅没有开灯，窗帘却像被风从另一个季节吹动。茶几上蹲着一只你从未见过的奇幻生物：它有半透明的耳羽，尾巴像一截流动的钟摆，眼睛里浮着细碎的星光。它自称 DOLO。你还没来得及问它为什么会出现在这里，它已经抬起爪子，轻轻点在你的眉心。\n\n下一秒，时钟倒转，城市的灯光被拉成长长的线。你听见无数人的声音从身后退去，作业本、校服、十七岁的夏天一起朝你涌来。\n\n你在熟悉又陌生的房间里醒来，镜子里是十七岁的自己。DOLO站在窗台上，语气不容置疑：*礼堂坍塌不是意外。去查清它的秘密，救下周往、钟辰时、夏季、叶恒。时间已经回来了，但机会不会一直等你。*',
    core: '【剧情真相】DOLO是掌管局部时间回溯的奇幻生物，它察觉到原本的时间线里，南一高中礼堂坍塌事故牵连了周往、钟辰时、夏季、叶恒四个人，也改变了用户的一生。它强行把用户带回十七岁，不是为了给她重来一次恋爱，而是让她进入一条可以被改写的世界线。\n【演绎关键点】这条命运是整条主线的起点。开场要有突如其来的奇幻感、时间倒流的失重感，以及“必须去探寻礼堂坍塌秘密”的使命感。DOLO的态度可以神秘、急促、不讲道理，它知道更多真相，但不会一次说完。它只给出明确目标：调查礼堂、拯救四个男生。用户醒来后应意识到自己回到了十七岁，后续可以通过世界探索逐步寻找线索。\n【禁止方向】不要把礼堂坍塌的真相一次性说破；不要让DOLO解释全部规则；不要让四个男生立刻全部出现。重点是把用户推入“回到十七岁、必须行动”的起点。',
    keywords: ['DOLO','时间回溯','礼堂坍塌'],
    semantic: '用户输入 DOLO，触发主线注定命运：DOLO带用户回到17岁，调查礼堂坍塌并拯救四个男生',
    timeNode: '',
    multimodal: ''
  };
}

function ensureDoloDestiny(char = currentStoryChar){
  const list = pool();
  const existing = list.find(d => d.id === DOLO_DESTINY_ID && d.char === char);
  if(existing) return existing;
  const destiny = createDoloDestiny(char);
  if(Array.isArray(window.DESTINY_POOL)) window.DESTINY_POOL.unshift(destiny);
  return destiny;
}

function matchByKeyword(char, userText){
  const text = String(userText || '');
  for(const d of untriggered(char)){
    if(isDestinyTriggerSuppressed(d, char, text)) continue;
    if(!d.keywords || !d.keywords.length) continue;
    if(d.keywords.some(k => k && text.includes(k))) return d;
  }
  return null;
}

function isDestinedType(d){ return d?.audience === 'multi' || d?.typeKey === 'destined'; }
function typeLabel(d){ return isDestinedType(d) ? '注定的命运' : '潜在的命运'; }
function enterActionLabel(d){ return isDestinedType(d) ? '进入主线' : '进入命运'; }
function destinyTypeClass(d){ return isDestinedType(d) ? 'dst-type-destined' : 'dst-type-potential'; }
function destinyAudienceClass(d){ return d?.audience === 'multi' ? 'dst-audience-multi' : 'dst-audience-single'; }
function touchedCapsuleLabel(d){ return isDestinedType(d) ? '触及了注定命运' : '触及了潜在命运'; }
function shouldDelayDestinyCompletionRecord(d){
  return isDestinedType(d) && (d?.audience || 'single') !== 'multi';
}

function isMainlineDestinyInProgress(){
  if(typeof currentStoryChar === 'undefined' || typeof storyState === 'undefined') return false;
  const st = storyState[currentStoryChar];
  if(!st) return false;
  if(st.destinyChoiceGuide && !st.destinyChoiceGuide.completed) return true;
  if(st.multiDestiny && !st.multiDestiny.completed && !st.multiDestiny.completionTipShown) return true;
  if(st.activeDestiny && (isDestinedType(st.activeDestiny) || st.activeDestiny.type === '注定的命运')) return true;
  return false;
}

/* ---------- 语义/时间触发（可选，模型判定） ---------- */
async function detectBySemantic(char, userText){
  const cands = untriggered(char).filter(d => d.semantic || d.timeNode);
  if(!cands.length) return null;
  const list = cands.map(d => `【${d.id}】类型：${typeLabel(d)}\n  语义条件：${d.semantic || '无'}\n  时间节点条件：${d.timeNode || '无'}`).join('\n');
  const prompt = `你是「命运」触发判定器。下面是一组尚未触发的命运情境，每条带有「语义触发条件」「时间节点触发条件」。请根据最近对话判断：用户最新的行为/话语，是否清晰地满足了其中某一条命运的任意一个触发条件。判定要保守——只有明显契合时才触发，宁可不触发。

【最近对话】
${getStoryContext(char, 8) || '（暂无）'}

【用户最新输入】
${userText}

【候选命运】
${list}

只输出 JSON：{"id":"命中的命运id，若都不满足则填 null","why":"一句话说明依据"}`;
  try{
    const res = await fetchWithTimeout(API_BASE, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
      body:JSON.stringify({model:MODEL,messages:[{role:'user',content:prompt}],stream:false,temperature:.2})
    }, DESTINY_DETECT_TIMEOUT_MS);
    if(!res.ok) return null;
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const m = raw.match(/\{[\s\S]*\}/);
    if(!m) return null;
    const data = JSON.parse(m[0]);
    if(!data.id || data.id === 'null') return null;
    return cands.find(d => d.id === data.id) || null;
  }catch(e){
    if(e?.name === 'AbortError') console.warn('Destiny semantic detect timeout; skip semantic trigger.');
    else console.error('Destiny semantic detect error:', e);
    return null;
  }
}

/* ---------- 扰动 + 标题 + 改写开场白 生成 ---------- */
function presetReveal(destiny){
  return {
    reason: String(destiny.revealReason || '你踏入北斗真的视线，也踏入了那场早已埋下的梦。').trim(),
    title: String(destiny.title || typeLabel(destiny)).trim(),
    preview: normalizeDestinyPreview(destiny.preview || makeDestinyPreview(destiny.opening)),
    impact: {
      origin: '这场梦早已藏在北斗家的规训与禁忌里，等待一次靠近让它显形。',
      process: '你的出现会继续扰动北斗真的克制、记忆和对家族秩序的判断。',
      result: '这条命运会沉淀成北斗真无法再完全回避的情感裂缝。',
      echo: '后续剧情里，他会不断用冷静和剑风压下这场梦留下的回响。'
    },
    opening: normalizeDestinyOpeningFormat(destiny.opening)
  };
}

async function generateReveal(destiny, userText){
  if(destiny?.fixedReveal) return presetReveal(destiny);
  const char = destiny.char;
  const prompt = `你在为一个角色扮演剧情生成「命运降临」的内容。当某条预设命运被触发时，需要：① 写出"我的选择如何触及命运"，② 给命运起一个标题，③ 生成这条命运对作品世界造成的多节点影响，④ 把预设开场白改写得与当前剧情连贯。

【角色】${char}
【角色性格】${CHAR_PROFILES[char] || ''}
【命运类型】${typeLabel(destiny)}（${destiny.redBlack || ''}情境）
【预设开场白（原文，需改写）】
${destiny.opening}
【剧情内核 / 演绎指引（仅供你理解这条命运的内涵，不要照搬，不要在输出里暴露这些幕后说明）】
${destiny.core}

【最近对话】
${getStoryContext(char, 8) || '（刚开始，暂无更多上下文）'}
【用户最新输入】
${userText}

请输出 JSON，五个字段：
{
  "reason": "命运浮现：用第二人称'你'，写成一句短提示，概括'你的选择 + 世界/关系开始变化'。20~36字，含蓄、有宿命感，不要完整展开剧情。",
  "title": "为这条命运起的标题，4~12字，凝练有意境，能概括这一幕的氛围。",
  "preview": "可与 reason 相同或略短：一句话概括'你做了什么 + 导致了什么后果'，不要另起一段概要。结尾不需要省略号。",
  "impact": {
    "origin": "世界暗线：这条命运出现前，角色/地点/世界里已经存在的张力。20~46字。",
    "process": "过程扩散：用户的选择接下来会如何影响角色、NPC、地点、日程或后续剧情。20~46字。",
    "result": "阶段结果：这条命运完成后最可能沉淀成什么关系或剧情后果。20~46字。",
    "echo": "后续余波：以后谁可能再次提起，或角色会如何记住这件事。20~46字。"
  },
  "opening": "把预设开场白改写后的版本：必须与【最近对话】在时间、地点、人物状态、剧情上保持连贯，不能出现矛盾（例如已在某地就不要凭空换到别处，时间线要接得上）。保留原开场白的核心事件与那句关键台词的神韵。\n篇幅要求（重要）：精炼克制，总字数控制在 150 字以内，只写这一幕的开场，不要把后续剧情铺满，结尾自然停在关键台词或留白处。\n格式约定（非常重要）：旁白必须用单星号包裹，角色说出口的台词必须写成普通文字，不要加引号、不要用星号包裹台词。正确格式示例：*这里是旁白、动作、环境描写。*这里是角色说的台词。*这里是下一句旁白。*这里是下一句台词。错误格式：这里是旁白。*这里是台词*。"
}
只输出 JSON，不要任何额外说明。`;
  try{
    const res = await fetchWithTimeout(API_BASE, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
      body:JSON.stringify({model:MODEL,messages:[{role:'user',content:prompt}],stream:false,temperature:.85})
    }, DESTINY_REVEAL_TIMEOUT_MS);
    if(res.ok){
      const json = await res.json();
      const raw = json.choices?.[0]?.message?.content || '';
      const m = raw.match(/\{[\s\S]*\}/);
      if(m){
        const data = JSON.parse(m[0]);
        if(data.reason && data.opening){
          return {
            reason: String(data.reason).trim(),
            title: String(data.title || typeLabel(destiny)).trim(),
            preview: normalizeDestinyPreview(data.preview || ''),
            impact: data.impact && typeof data.impact === 'object' ? {
              origin: String(data.impact.origin || '').trim(),
              process: String(data.impact.process || '').trim(),
              result: String(data.impact.result || '').trim(),
              echo: String(data.impact.echo || '').trim()
            } : null,
            opening: normalizeDestinyOpeningFormat(data.opening)
          };
        }
      }
    }
  }catch(e){
    if(e?.name === 'AbortError') console.warn('Destiny reveal generate timeout; using fallback reveal.');
    else console.error('Destiny reveal generate error:', e);
  }
  return fallbackReveal(destiny);
}

function fallbackReveal(destiny){
  return {
    reason: '你刚才的举动，正好落在一条早已埋下的线上；于是命运把你推向了那个本该发生的场景。',
    title: typeLabel(destiny),
    preview: makeDestinyPreview(destiny.opening),
    impact: {
      origin: '这条命运原本藏在世界暗处，等待一次足够重要的选择让它显形。',
      process: '你的选择开始离开当前对话，进入角色、地点和后续剧情里。',
      result: '这条命运会沉淀成一段新的关系结果。',
      echo: '角色会记住这次选择，并在后续对话或剧情里再次回应。'
    },
    opening: normalizeDestinyOpeningFormat(destiny.opening)
  };
}

/* ---------- 潜在命运·黑情境 自动生成（AI 剧情引子） ----------
 * 参照「注定的命运」（红/人工预置）的开场白四拍 + 剧情内核三段式结构，
 * 生成可被推送的「潜在的命运·黑情境」（typeKey:'potential'、redBlack:'黑'、audience:'single'）。
 * 详见 prompts.md 第 16 节。
 */
const DESTINY_GEN_TIMEOUT_MS = 22000;

function existingDestinyDigest(char){
  const lines = pool()
    .filter(d => d.char === char)
    .map(d => {
      const t = String(d.title || typeLabel(d)).trim();
      const kw = Array.isArray(d.keywords) && d.keywords.length ? d.keywords.join('、') : '无';
      return `《${t}》关键词：${kw}`;
    });
  return lines.length ? lines.join('\n') : '（暂无）';
}

function makeBlackDestinyId(){
  const used = new Set(pool().map(d => d.id));
  let id;
  do { id = 'blk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  while(used.has(id));
  return id;
}

function buildBlackDestinyPrompt(char, count, userDisturbance){
  const selfContext = typeof buildSelfExistenceScheduleContext === 'function' ? buildSelfExistenceScheduleContext() : '';
  return `你是沉浸式恋爱/剧情游戏的资深编剧。你的任务是为角色「${char}」生成 ${count} 条「潜在命运」剧情引子（这是 AI 自动生成的「黑情境」）。每条都要像一个让人忍不住想接话的高光开场，目的是把用户自然卷入一幕暧昧/心动/情绪回响的轻剧情，让对话能继续聊下去。

【角色设定】
${CHAR_PROFILES[char] || char}

【近期故事对话（用于保证连贯、判断关系亲密度）】
${getStoryContext(char, 10) || '暂无，可生成日常校园场景'}

【用户近期扰动 / 关注话题（用于贴合用户兴趣，可空）】
${userDisturbance || '（暂无，可自由发挥）'}
${selfContext}

【已存在的命运（标题+关键词，仅用于去重，不要重复其场景）】
${existingDestinyDigest(char)}

【黑情境设计规则（对齐《黑情境生成思路与提示词.md》）】
- 每条先明确一个主作用剧情目标：A 凸显角色魅力 / B 推进关系 / C 体现用户价值 / D 留悬念 / E 制造张力 / F 降温陪伴；目标只用于选择套路，不要在正文里直说。
- 每条必须按「套路标签 × 场景标签 × 基调标签」组合生成；有合适上下文时再自然挂 1 条记忆/近期扰动，没有就不要硬塞。
- 套路标签候选：反差破格、傲娇/嘴硬心软、越界的合理借口、强势守护/护短、慕强能力庇护、共犯独占、暧昧升温、吃醋/占有、创伤倾诉、物理弱势打破防御、用户掌控/被极致偏爱、被记得的暖、悬念伏笔、情敌/第三人介入、烟火日常、情绪/身体陪伴。
- 场景标签候选：校园日常、雨天共伞、停电、机车/兜风、深夜书桌、一起刷题、生病卧床、受伤、衣物错换、节日/活动现场、通勤/接送、咖啡馆。
- 基调标签候选：甜暖治愈、暧昧心动、委屈/误解张力、偏执/危险向、搞笑/反差萌、悬疑/伏笔；同一批要高低浓度轮换，不要连续同质。
- core 末尾另起一行写「【取材】套路 × 场景 × 基调；记忆/扰动：有/无 + 简述」，这行只属于幕后内核，不能泄露进 opening。

【写作要求 —— 开场白（opening，展示给用户）】
- 按四拍节奏写：① 一句话场景锚点（时间/地点/事件）；② 角色登场并给一个可解读的反常细节（一个物件或一个小动作）；③ 一个"该不该靠近/该怎么反应"的犹豫瞬间；④ 用角色的一句克制短台词收尾。
- 收尾台词 2~8 字，表面中性、底下藏情，不要把意思说透，把话头交还给用户。
- 全程第二人称"你"，让用户身处现场、需要做出反应；不要旁观视角，不要交代世界观和人物背景。
- 只截取一个具体的高光瞬间，不要铺设定、不要把后续剧情写满。
- 总字数 ≤150 字。
- 格式（非常重要）：旁白用单星号包裹，例如 *他靠着窗台，没有看你。*；角色说出口的台词写成普通文字，不要加引号、不要用星号包裹台词。

【写作要求 —— 剧情内核（core，幕后导演指引，禁止展示给用户）】
必须用三段式，标题原样保留：
【角色心理真相】写出角色自己都未必承认的真实动机，以及他给自己编的"合理化借口"（行为越界、解释中性，制造落差）。
【演绎关键点】穷举用户的几种走向并给出角色应对（至少写"用户主动追问→…""用户顺着接→…""用户沉默/岔开→…"三类分支），并点名本幕"必须出现的关键台词或动作"。这一段是让用户能聊下去的核心，务必写细。
【禁止方向】划出会让这条命运演崩的红线（如不能让角色主动解释、不能显得刻意热情、不能一次说破、不能描写暴力/露骨细节等）。

【心动机制（每条锚定其中一个，不要写成没有钩子的流水账）】
反差破格 / 共犯独占（"只有我们"） / 创伤倾诉窗口 / 物理弱势打破防御 / 越界的合理借口 / 被动确认心意。

【整体约束】
- 潜在命运是轻剧情：暧昧、关系推进、日常高光或情绪回响，强度低于主线，结尾更开放，给用户更多接话方向。
- 必须与【近期故事对话】在时间、地点、人物状态上连贯，不制造矛盾；关系亲密度要匹配上下文。
- 严格贴合角色性格与说话风格；不得让角色 OOC，不得出现网络流行语（除非该角色设定允许）。
- 如果【照见内心取材】中有用户内在切片，只能作为可选素材自然改写某个犹豫、选择、台词或关系张力；不要每条都引用，不要像心理分析或资料复述。禁止引用城市、职业、年龄等外在资料。
- ${count} 条之间场景、心动机制要彼此不同，且不与【已存在的命运】重复。
- title：4~6 字，有意境，概括情境核心，不要标点、不要写"潜在命运"。
- preview：第二人称"你"，20~36 字，概括"你做了什么 + 让世界或关系哪里开始变化"，含蓄、有宿命感，不剧透。
- keywords：2~4 个触发关键词（名词/短语），用于后续命中触发。
- semantic：一句话语义触发条件，描述"用户做出什么选择时，这条命运会浮现并开始影响世界"。

请只输出严格 JSON 数组，不要输出任何额外文字：
[
  {
    "title": "…",
    "preview": "…",
    "opening": "…",
    "core": "【角色心理真相】…\\n【演绎关键点】…\\n【禁止方向】…",
    "keywords": ["…", "…"],
    "semantic": "…"
  }
]`;
}

function sanitizeBlackDestiny(item, char){
  if(!item || typeof item !== 'object') return null;
  const opening = normalizeDestinyOpeningFormat(limitDestinyOpening(String(item.opening || '').trim(), 150));
  const core = String(item.core || '').trim();
  if(!opening || !core) return null;
  let title = String(item.title || '').trim().replace(/[《》"'「」“”‘’\s]/g, '');
  if(!title || Array.from(title).length > 6){
    const kw0 = Array.isArray(item.keywords) && item.keywords[0] ? String(item.keywords[0]) : '';
    title = kw0 ? Array.from(kw0).slice(0, 6).join('') : '潜在命运';
  }
  const keywords = Array.isArray(item.keywords)
    ? item.keywords.map(k => String(k).trim()).filter(Boolean).slice(0, 4)
    : [];
  const previewRaw = String(item.preview || '').trim() || makeDestinyPreview(opening).replace(/\.{3}$/, '');
  const preview = normalizeDestinyPreview(previewRaw);
  const semantic = String(item.semantic || '').trim();
  return {
    id: makeBlackDestinyId(),
    char,
    type: '潜在的命运',
    typeKey: 'potential',
    audience: 'single',
    participants: [],
    redBlack: '黑',
    opening,
    core,
    title,
    preview,
    keywords,
    semantic,
    timeNode: '',
    multimodal: '无',
    generated: true,
    createdAt: Date.now()
  };
}

/* 生成 N 条潜在命运·黑情境并加入命运池（本会话内可被触发/推送）。
 * @param {string} char  角色名，默认当前对话角色
 * @param {object} options { count=3, userDisturbance='', addToPool=true }
 * @returns {Promise<Array>} 生成并已加入命运池的命运对象数组（失败时返回 []）
 */
async function generateBlackDestinies(char = currentStoryChar, options = {}){
  const count = Math.min(Math.max(parseInt(options.count, 10) || 3, 1), 5);
  const userDisturbance = String(options.userDisturbance || '').trim();
  const addToPool = options.addToPool !== false;
  const prompt = buildBlackDestinyPrompt(char, count, userDisturbance);
  try{
    const res = await fetchWithTimeout(API_BASE, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
      body:JSON.stringify({model:MODEL,messages:[{role:'user',content:prompt}],stream:false,temperature:.92,max_tokens:1800})
    }, DESTINY_GEN_TIMEOUT_MS);
    if(!res.ok){
      console.warn('generateBlackDestinies: 模型返回异常状态', res.status);
      return [];
    }
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const m = raw.match(/\[[\s\S]*\]/);
    if(!m) return [];
    let arr = null;
    try{ arr = JSON.parse(m[0]); }catch(_){ return []; }
    if(!Array.isArray(arr)) return [];
    const created = [];
    for(const item of arr){
      const d = sanitizeBlackDestiny(item, char);
      if(!d) continue;
      if(addToPool){
        if(Array.isArray(window.DESTINY_POOL)) window.DESTINY_POOL.push(d);
        else window.DESTINY_POOL = [d];
      }
      created.push(d);
      if(created.length >= count) break;
    }
    if(addToPool && created.length){
      try{ if(typeof refreshDestinyDebugSelect === 'function') refreshDestinyDebugSelect(); }catch(_){}
    }
    return created;
  }catch(e){
    if(e?.name === 'AbortError') console.warn('generateBlackDestinies 超时');
    else console.error('generateBlackDestinies 出错：', e);
    return [];
  }
}

function buildManualBlackDestinyDisturbance(char){
  const st = storyState?.[char] || {};
  const recent = (Array.isArray(st.chatHistory) ? st.chatHistory : [])
    .filter(m => m.role === 'user' && !String(m.content || '').startsWith('[系统'))
    .map(m => String(m.content || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(-6)
    .join(' / ');
  const phrases = typeof getPotentialDisturbancePhrases === 'function'
    ? getPotentialDisturbancePhrases(char).slice(0, 5).join('、')
    : '';
  return [
    '用户通过长按蝴蝶胶囊主动触及黑情境；本次不需要关键词或语义触发条件。',
    recent ? `近期用户话语：${recent}` : '',
    phrases ? `可参考的近期扰动短语：${phrases}` : ''
  ].filter(Boolean).join('\n');
}

function normalizeDestinyOpeningFormat(text){
  let src = String(text || '').trim();
  if(!src) return '';
  // 旧数据常把台词写成 *台词*。生成提示要求星号只包旁白，这里先处理最常见的「说：*台词*」形态。
  src = src.replace(/(说|开口|问|低声|轻声|淡声|笑着|补了一句|语气[^，。！？!?]*|声音[^，。！？!?]*)[:：]\s*\*([^*]+)\*/g, (_m, lead, quote) => `${lead}：${quote}`);
  src = src.replace(/([。！？!?]\s*)\*([^*“”"「」]+?[。！？!?])\*/g, (_m, punct, quote) => `${punct}${quote}`);
  return src;
}

function rememberDestinyReveal(destiny, reveal){
  const st = storyState?.[destiny?.char];
  if(!st || !destiny?.id || !reveal) return;
  if(!st.destinyReveals || typeof st.destinyReveals !== 'object') st.destinyReveals = {};
  const disturbance = String(reveal.reason || '').trim();
  st.destinyReveals[destiny.id] = {
    disturbance,
    reason: disturbance,
    title: String(reveal.title || typeLabel(destiny)).trim(),
    type: typeLabel(destiny),
    typeKey: destiny.typeKey || '',
    audience: destiny.audience || 'single',
    participants: Array.isArray(destiny.participants) ? destiny.participants.slice() : [],
    preview: String(reveal.preview || '').trim(),
    impact: reveal.impact && typeof reveal.impact === 'object' ? {...reveal.impact} : null,
    opening: String(reveal.opening || destiny.opening || '').trim(),
    updatedAt: Date.now()
  };
}

function makeDestinyPreview(text){
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  const short = cleaned.length <= 96 ? cleaned : cleaned.slice(0, 94);
  return normalizeDestinyPreview(short);
}

function getDestinyDisturbanceText(reveal){
  const reason = String(reveal?.reason || '').trim();
  const preview = String(reveal?.preview || '').trim();
  const text = reason || preview;
  return Array.from(text).slice(0, 42).join('').replace(/[，、；：,\s]*$/g, '') + (Array.from(text).length > 42 ? '…' : '');
}

function normalizeDestinyPreview(text){
  const cleaned = String(text || '').trim().replace(/[.。…]+$/g, '').replace(/[，。！？、；：,\s]*$/g, '');
  return (cleaned || '命运的线已经垂落到你面前') + '...';
}

/* 控制命运开场白气泡字数：尽量在句末断开，最长 max 字 */
function limitDestinyOpening(text, max = 150){
  const src = String(text || '').trim();
  const chars = Array.from(src);
  if(chars.length <= max) return src;
  let slice = chars.slice(0, max).join('');
  const lastStop = Math.max(
    slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'),
    slice.lastIndexOf('…'), slice.lastIndexOf('\n')
  );
  if(lastStop >= Math.floor(max * 0.5)){
    slice = slice.slice(0, lastStop + 1);
  }else{
    slice = slice.replace(/[，、；：,\s]*$/, '') + '…';
  }
  // 避免截断后 *动作* 的星号落单，破坏气泡格式
  if((slice.match(/\*/g) || []).length % 2 === 1) slice += '*';
  return slice.trim();
}

/* ---------- 主入口：在 onSend 中调用 ---------- */
async function maybeTriggerDestiny(userText){
  try{
    if(typeof isAbsentMode !== 'undefined' && isAbsentMode) return false;
    if(isDestinyVisible()) return false;
    const char = currentStoryChar;
    let destiny = matchByKeyword(char, userText);
    if(!destiny && window.DESTINY_SEMANTIC_DETECT){
      destiny = await detectBySemantic(char, userText);
    }
    if(destiny && isDestinyTriggerSuppressed(destiny, char, userText)) destiny = null;
    if(!destiny) return false;
    await runDestiny(destiny, userText);
    return true;
  }catch(e){
    console.error('maybeTriggerDestiny error:', e);
    resetKeywordPotentialButterflySource($('potentialDestinyTrigger'));
    return false;
  }
}

async function runDestiny(destiny, userText, options = {}){
  runId++;
  const myRun = runId;
  aborted = false;
  if(!options.preservePendingCapsuleFlight) clearPendingDestinyCapsuleFlight();
  pendingNormalReplyText = options.suppressNormalReply ? '' : userText;
  const revealUserText = options.revealUserText || userText;
  const revealPromise = generateReveal(destiny, revealUserText);

  if(options.directOpeningOnly){
    const reveal = await revealPromise;
    if(myRun !== runId) return;
    rememberDestinyReveal(destiny, reveal);
    if(typeof window.recordDestinyImpactReveal === 'function') window.recordDestinyImpactReveal(destiny, reveal, { userText: revealUserText });
    revealState = { destiny, reason: reveal.reason, title: reveal.title, preview: reveal.preview || makeDestinyPreview(reveal.opening), opening: reveal.opening, userText: pendingNormalReplyText };
    await enterDestinyWithDirectOpening(options);
    return;
  }

  if(options.skipRevealUI){
    const reveal = await revealPromise;
    if(myRun !== runId) return;
    rememberDestinyReveal(destiny, reveal);
    if(typeof window.recordDestinyImpactReveal === 'function') window.recordDestinyImpactReveal(destiny, reveal, { userText: revealUserText });
    revealState = { destiny, reason: reveal.reason, title: reveal.title, preview: reveal.preview || makeDestinyPreview(reveal.opening), opening: reveal.opening, userText: pendingNormalReplyText };
    await enterDestinyWithoutRevealUI();
    return;
  }

  if(options.directKeywordPotential){
    const sourceButton = await showKeywordPotentialButterflyTakeoffReady(destiny);
    const reveal = await revealPromise;
    if(myRun !== runId) return;
    rememberDestinyReveal(destiny, reveal);
    if(typeof window.recordDestinyImpactReveal === 'function') window.recordDestinyImpactReveal(destiny, reveal, { userText: revealUserText });
    revealState = { destiny, reason: reveal.reason, title: reveal.title, preview: reveal.preview || makeDestinyPreview(reveal.opening), opening: reveal.opening, userText: pendingNormalReplyText };
    await enterKeywordPotentialDestinyDirectly(revealState, sourceButton);
    return;
  }

  // 1) 从当前情绪胶囊变宽成状态小胶囊：你触及了 XX 的命运
  if(options.manualPotentialCapsuleShown){
    // 长按蝴蝶胶囊时，提示胶囊已在手势完成后提前展示，这里复用它继续等待 reveal。
  }else if(options.manualPotentialSource){
    await showManualPotentialCapsule(destiny, options.manualPotentialSource);
  }else{
    await showTriggeredDestinyCapsule(destiny);
  }
  if(myRun !== runId) return;

  // 2) 生成内容（缘由 / 标题 / 改写开场白）
  setCapsuleThinking(true);
  const reveal = await revealPromise;
  if(myRun !== runId) return;
  await finishPendingDestinyCapsuleFlight();
  if(myRun !== runId) return;
  setCapsuleThinking(false);
  rememberDestinyReveal(destiny, reveal);
  if(typeof window.recordDestinyImpactReveal === 'function') window.recordDestinyImpactReveal(destiny, reveal, { userText: revealUserText });
  revealState = { destiny, reason: reveal.reason, title: reveal.title, preview: reveal.preview || makeDestinyPreview(reveal.opening), opening: reveal.opening, userText: pendingNormalReplyText };

  if(options.manualPotentialSource){
    await enterDestiny();
    return;
  }

  // 3) 展开成框
  await expandDestinyBox();
  if(myRun !== runId) return;

  // 4) 单屏输出：你做了什么 + 导致了什么情境后果
  const body = $('dstBody');
  setDstLabel(reveal.title);
  showButterfly();
  showDestinyEnterAction();
  startDestinyCountdown();
  const seg1 = document.createElement('div');
  seg1.className = 'dst-seg';
  seg1.innerHTML = `<div class="dst-seg-text" id="dstReason"></div>`;
  body.appendChild(seg1);
  await typeInto($('dstReason'), getDestinyDisturbanceText(reveal), 30, myRun);
  if(myRun !== runId) return;
  if(typeof window.renderDestinyImpactRevealPreview === 'function'){
    const previewHTML = window.renderDestinyImpactRevealPreview(destiny.id, destiny.char);
    if(previewHTML){
      const seg2 = document.createElement('div');
      seg2.className = 'dst-seg dst-impact-seg';
      seg2.innerHTML = previewHTML;
      body.appendChild(seg2);
    }
  }
  syncDestinyCapsuleHeight();
  await waitForStableDestinyBox();
}

/* ---------- 胶囊 / 展开框 渲染 ---------- */
function isDestinyVisible(){
  const cap = $('emoTag');
  return !!cap && (cap.classList.contains('capsule-destiny') || cap.classList.contains('capsule-destiny-os'));
}

async function showDestinyCapsule(destiny, options = {}){
  const cap = $('emoTag');
  if(!cap) return;
  awakenPotentialDestinyTrigger(destiny);
  hidePotentialDestinyTrigger();
  const parent = $('chatScreen') || cap.offsetParent || document.body;
  const parentRect = parent.getBoundingClientRect ? parent.getBoundingClientRect() : { left:0, width:window.innerWidth };
  const parentW = parent.offsetWidth || parentRect.width || window.innerWidth;
  const scale = parentRect.width && parentW ? parentRect.width / parentW : 1;
  const sourceRect = options.startRect || null;
  const startW = sourceRect ? sourceRect.width / scale : cap.offsetWidth;
  const startH = sourceRect ? sourceRect.height / scale : cap.offsetHeight;
  const startLeft = sourceRect ? (sourceRect.left - parentRect.left) / scale : null;

  if(sourceRect){
    cap.classList.add('dst-no-transition');
    cap.style.left = startLeft + 'px';
    cap.style.right = 'auto';
    cap.style.transform = 'none';
  }
  cap.style.width = startW + 'px';
  cap.style.height = startH + 'px';
  cap.style.overflow = 'hidden';

  cap.classList.remove('has-potential-destiny','capsule-os','capsule-location','capsule-morphing','capsule-expanding','capsule-destiny-os','glow','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly','dst-internal-flight','dst-from-bfly-trigger','destiny-complete-capsule');
  cap.classList.add('capsule-destiny',destinyTypeClass(destiny),destinyAudienceClass(destiny));
  if(sourceRect) cap.classList.add('dst-from-bfly-trigger');
  cap.classList.add('dst-morphing-in');
  if(options.hideButterfly) cap.classList.add('dst-await-return-bfly');
  cap.onclick = e => {
    if(e && e.stopPropagation) e.stopPropagation();
    openDestinyTaskScreenFromTrigger();
  };
  cap.innerHTML = `<span class="dst-cap-bfly on" id="dstButterfly">${BUTTERFLY_SVG}</span>`
    + `<span class="dst-cap-text">${escapeHTML(touchedCapsuleLabel(destiny))}</span>`;
  $('chatScreen')?.classList.remove('has-location-capsule','has-os-capsule');

  if(sourceRect) cap.classList.remove('dst-from-bfly-trigger');
  cap.style.width = 'auto';
  cap.style.height = 'auto';
  const targetW = cap.offsetWidth;
  const targetH = cap.offsetHeight || startH;
  const targetLeft = sourceRect ? Math.max(12, Math.round((parentW - targetW) / 2)) : null;
  if(sourceRect) cap.classList.add('dst-from-bfly-trigger');
  cap.style.width = startW + 'px';
  cap.style.height = startH + 'px';
  void cap.offsetWidth;

  if(sourceRect){
    cap.classList.remove('dst-no-transition');
    cap.classList.remove('dst-from-bfly-trigger');
    cap.style.left = targetLeft + 'px';
    cap.style.transform = 'none';
  }
  cap.style.width = targetW + 'px';
  cap.style.height = targetH + 'px';
  await delay(210);
  cap.classList.remove('dst-morphing-in');
  await delay(230);
  if(sourceRect){
    cap.style.left = '';
    cap.style.right = '';
    cap.style.transform = '';
  }
  cap.style.width = '';
  cap.style.height = '';
  cap.style.overflow = '';
}

function canShowPotentialDestinyTrigger(){
  if(typeof currentStoryChar === 'undefined') return false;
  if(typeof isAbsentMode !== 'undefined' && isAbsentMode) return false;
  if(isDestinyVisible()) return false;
  const cap = $('emoTag');
  if(!cap) return false;
  if(cap.classList.contains('capsule-location') || cap.classList.contains('capsule-os') || cap.classList.contains('capsule-world-explore')) return false;
  return true;
}

function getPotentialDestinyTriggerHTML(){
  return `<svg class="potential-destiny-ring" viewBox="0 0 38 38" aria-hidden="true"><circle cx="19" cy="19" r="18.1" pathLength="1"></circle></svg>${BUTTERFLY_SVG}`;
}

function getReusableDestinyButterflyHTML(){
  return BUTTERFLY_SVG;
}

function getReusableDestinyFlightHTML(){
  return `
    <span class="dst-flight-trail dst-trail-a"></span>
    <span class="dst-flight-trail dst-trail-b"></span>
    <span class="dst-fly-one">${getReusableDestinyButterflyHTML()}</span>`;
}

function renderReusableDestinyButterflies(root = document){
  const scope = root || document;
  scope.querySelectorAll?.('[data-destiny-bfly]').forEach(el => {
    el.innerHTML = getReusableDestinyButterflyHTML();
    el.dataset.destinyBflyRendered = '1';
  });
}

function syncPotentialDestinyTrigger(){
  const btn = $('potentialDestinyTrigger');
  const cap = $('emoTag');
  const screen = $('chatScreen');
  if(!btn || !cap) return;
  if(!btn.innerHTML.trim()) btn.innerHTML = getPotentialDestinyTriggerHTML();
  bindPotentialDestinyTrigger(btn);
  bindEmotionCapsulePotentialHold(cap);
  const visible = canShowPotentialDestinyTrigger();
  btn.disabled = !visible;
  if(!visible){
    screen?.classList.remove('has-potential-destiny-layout');
    btn.classList.add('is-hidden');
    btn.classList.remove('is-busy','complete','destiny-awake','dst-type-potential','dst-type-destined');
    cancelPotentialDestinyHold();
    restoreEmotionCapsuleDefaultPosition(cap);
    return;
  }
  screen?.classList.add('has-potential-destiny-layout');
  if(btn.classList.contains('keyword-direct-active')){
    positionPotentialDestinyTrigger(btn, cap);
    btn.classList.remove('is-hidden');
    return;
  }
  btn.classList.remove('is-busy','complete','destiny-awake','dst-type-potential','dst-type-destined','bfly-departed');
  resetPotentialDestinySourceButterfly(btn);
  positionPotentialDestinyTrigger(btn, cap);
  btn.classList.remove('is-hidden');
}

function positionPotentialDestinyTrigger(btn = $('potentialDestinyTrigger'), cap = $('emoTag')){
  const parent = $('chatScreen') || btn?.offsetParent;
  if(!btn || !cap || !parent) return;
  const parentRect = parent.getBoundingClientRect();
  const parentW = parent.offsetWidth || parentRect.width || 375;
  const scale = parentRect.width && parentW ? parentRect.width / parentW : 1;
  const gap = 8;
  const hadNoTransition = cap.classList.contains('dst-no-transition');
  cap.classList.add('dst-no-transition');
  cap.style.left = '';
  cap.style.right = '';
  cap.style.transform = '';
  void cap.offsetWidth;
  const capRect = cap.getBoundingClientRect();
  const left = (capRect.right - parentRect.left) / scale + gap;
  btn.style.left = Math.round(left) + 'px';
  btn.style.bottom = '151px';
  if(!hadNoTransition){
    requestAnimationFrame(() => cap.classList.remove('dst-no-transition'));
  }
}

function withStablePotentialDestinyLayout(fn){
  const cap = $('emoTag');
  if(!cap){
    if(typeof fn === 'function') fn();
    return;
  }
  const hadNoTransition = cap.classList.contains('dst-no-transition');
  cap.classList.add('dst-no-transition');
  if(typeof fn === 'function') fn();
  syncPotentialDestinyTrigger();
  void cap.offsetWidth;
  if(!hadNoTransition){
    requestAnimationFrame(() => cap.classList.remove('dst-no-transition'));
  }
}

function hidePotentialDestinyTrigger(){
  const btn = $('potentialDestinyTrigger');
  if(!btn) return;
  cancelPotentialDestinyHold();
  btn.classList.add('is-hidden');
  btn.classList.remove('is-busy','complete','destiny-awake','dst-type-potential','dst-type-destined');
  btn.disabled = true;
  $('chatScreen')?.classList.remove('has-potential-destiny-layout');
  restoreEmotionCapsuleDefaultPosition();
}

function awakenPotentialDestinyTrigger(destiny){
  const btn = $('potentialDestinyTrigger');
  if(!btn) return;
  if(!btn.innerHTML.trim()) btn.innerHTML = getPotentialDestinyTriggerHTML();
  resetPotentialDestinySourceButterfly(btn);
  btn.classList.remove('dst-type-potential','dst-type-destined');
  btn.classList.add('destiny-awake',destinyTypeClass(destiny));
}

function hidePotentialDestinySourceButterfly(btn = $('potentialDestinyTrigger')){
  const svg = btn?.querySelector?.('.dst-bfly-svg');
  if(!svg) return;
  svg.style.opacity = '0';
  svg.style.transform = 'scale(.58)';
}

function resetPotentialDestinySourceButterfly(btn = $('potentialDestinyTrigger')){
  const svg = btn?.querySelector?.('.dst-bfly-svg');
  if(!svg) return;
  svg.style.opacity = '';
  svg.style.transform = '';
}

function setPotentialDestinyTriggerBusy(on){
  const btn = $('potentialDestinyTrigger');
  if(!btn) return;
  if(!btn.innerHTML.trim()) btn.innerHTML = getPotentialDestinyTriggerHTML();
  bindPotentialDestinyTrigger(btn);
  btn.classList.toggle('is-busy', !!on);
  btn.classList.remove('is-hidden','complete');
  btn.disabled = !!on;
  if(on) positionPotentialDestinyTriggerBesideCapsule(btn);
}

function positionPotentialDestinyTriggerBesideCapsule(btn = $('potentialDestinyTrigger'), cap = $('emoTag')){
  const parent = $('chatScreen') || btn?.offsetParent;
  if(!btn || !cap || !parent) return;
  const parentRect = parent.getBoundingClientRect();
  const parentW = parent.offsetWidth || parentRect.width || 375;
  const scale = parentRect.width && parentW ? parentRect.width / parentW : 1;
  const capRect = cap.getBoundingClientRect();
  const left = Math.round((capRect.right - parentRect.left) / scale + 8);
  btn.style.left = Math.min(parentW - 42, Math.max(12, left)) + 'px';
  btn.style.bottom = '151px';
}

function restoreEmotionCapsuleDefaultPosition(cap = $('emoTag')){
  if(!cap) return;
  const hadNoTransition = cap.classList.contains('dst-no-transition');
  cap.classList.add('dst-no-transition');
  cap.style.left = '';
  cap.style.right = '';
  cap.style.transform = '';
  void cap.offsetWidth;
  if(!hadNoTransition){
    requestAnimationFrame(() => cap.classList.remove('dst-no-transition'));
  }
}

function bindPotentialDestinyTrigger(btn){
  if(!btn || btn.dataset.boundPotentialDestiny) return;
  btn.dataset.boundPotentialDestiny = '1';
  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if(Date.now() < potentialDestinySuppressClickUntil && !destinyTaskOpenTimer) return;
    openDestinyTaskScreenFromTrigger();
  });
  btn.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startPotentialDestinyPress(btn, e, { openTaskOnTap:true });
    startPotentialDestinyHold(btn, e);
  });
  btn.addEventListener('pointerup', e => {
    e.preventDefault();
    e.stopPropagation();
    finishPotentialDestinyPress(btn);
  });
  ['pointercancel','pointerleave'].forEach(type => {
    btn.addEventListener(type, e => {
      e.preventDefault();
      e.stopPropagation();
      cancelPotentialDestinyHold();
    });
  });
}

function bindEmotionCapsulePotentialHold(cap){
  if(!cap || cap.dataset.boundPotentialCapsuleHold) return;
  cap.dataset.boundPotentialCapsuleHold = '1';
  cap.addEventListener('click', e => {
    if(Date.now() >= potentialDestinySuppressClickUntil) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  cap.addEventListener('pointerdown', e => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    if(!canShowPotentialDestinyTrigger()) return;
    startPotentialDestinyPress(cap, e, { openTaskOnTap:false });
    startPotentialDestinyHold(cap, e);
  });
  cap.addEventListener('pointerup', e => {
    const press = potentialPressState;
    if(!press || press.btn !== cap) return;
    if(press.pointerId != null && e.pointerId !== press.pointerId) return;
    finishPotentialDestinyPress(cap);
  });
  ['pointercancel','pointerleave'].forEach(type => {
    cap.addEventListener(type, e => {
      const press = potentialPressState;
      if(press?.btn === cap && (press.pointerId == null || e.pointerId === press.pointerId)){
        potentialPressState = null;
      }
      cancelPotentialDestinyHold();
    });
  });
}

function startPotentialDestinyPress(btn, e, options = {}){
  potentialPressState = {
    btn,
    pointerId:e?.pointerId,
    startedAt:Date.now(),
    holdCompleted:false,
    handled:false,
    openTaskOnTap:options.openTaskOnTap !== false
  };
}

function finishPotentialDestinyPress(btn){
  const press = potentialPressState;
  if(!press || press.btn !== btn || press.handled) return;
  press.handled = true;
  potentialPressState = null;
  const elapsed = Date.now() - press.startedAt;
  const shouldOpen = press.openTaskOnTap && elapsed < 560 && !press.holdCompleted && !isDestinyVisible() && !enteringDestiny;
  if(press.holdCompleted) potentialDestinySuppressClickUntil = Date.now() + 450;
  cancelPotentialDestinyHold();
  if(shouldOpen && Date.now() >= potentialDestinySuppressClickUntil){
    potentialDestinySuppressClickUntil = Date.now() + 350;
    openDestinyTaskScreenFromTrigger();
  }
}

function openDestinyTaskScreenFromTrigger(){
  if(destinyTaskOpenTimer) clearTimeout(destinyTaskOpenTimer);
  destinyTaskOpenTimer = setTimeout(() => {
    destinyTaskOpenTimer = null;
    if(typeof openTaskScreen === 'function') openTaskScreen();
  }, 80);
}

document.addEventListener('pointerup', e => {
  const press = potentialPressState;
  if(!press) return;
  if(press.pointerId != null && e.pointerId !== press.pointerId) return;
  finishPotentialDestinyPress(press.btn);
}, true);

document.addEventListener('pointercancel', e => {
  const press = potentialPressState;
  if(!press) return;
  if(press.pointerId != null && e.pointerId !== press.pointerId) return;
  potentialPressState = null;
  cancelPotentialDestinyHold();
}, true);

function startPotentialDestinyHold(btn, e){
  if(!btn) return;
  if(typeof isAnimating !== 'undefined' && isAnimating) return;
  if(!canShowPotentialDestinyTrigger()) return;
  if(isDestinyVisible() || enteringDestiny) return;
  cancelPotentialDestinyHold();
  const visualBtn = btn.id === 'emoTag' && $('potentialDestinyTrigger') && !$('potentialDestinyTrigger').classList.contains('is-hidden')
    ? $('potentialDestinyTrigger')
    : btn;
  const ring = visualBtn.querySelector('.potential-destiny-ring circle');
  const duration = 980;
  const started = performance.now();
  visualBtn.classList.remove('complete');
  visualBtn.classList.add('holding');
  if(visualBtn !== btn) btn.classList.add('holding');
  try{ btn.setPointerCapture(e.pointerId); }catch(_){}
  const tick = now => {
    const p = Math.min(1, (now - started) / duration);
    if(ring) ring.style.strokeDasharray = `${p} 1`;
    if(p < 1 && potentialHoldState?.btn === btn){
      potentialHoldState.frame = requestAnimationFrame(tick);
    }
  };
  potentialHoldState = {
    btn,
    visualBtn,
    ring,
    frame: requestAnimationFrame(tick),
    timer: setTimeout(() => completePotentialDestinyHold(btn), duration),
    done: false
  };
}

function cancelPotentialDestinyHold(){
  const st = potentialHoldState;
  if(!st || st.done) return;
  if(st.timer) clearTimeout(st.timer);
  if(st.frame) cancelAnimationFrame(st.frame);
  st.btn?.classList.remove('holding');
  st.visualBtn?.classList.remove('holding');
  if(st.ring) st.ring.style.strokeDasharray = '0 1';
  potentialHoldState = null;
}

function completePotentialDestinyHold(btn){
  const st = potentialHoldState;
  if(!st || st.btn !== btn || st.done) return;
  st.done = true;
  if(potentialPressState?.btn === btn) potentialPressState.holdCompleted = true;
  potentialDestinySuppressClickUntil = Date.now() + 900;
  if(st.timer) clearTimeout(st.timer);
  if(st.frame) cancelAnimationFrame(st.frame);
  if(st.ring) st.ring.style.strokeDasharray = '1 1';
  btn.classList.remove('holding');
  st.visualBtn?.classList.remove('holding');
  if(isMainlineDestinyInProgress()){
    if(st.ring) st.ring.style.strokeDasharray = '0 1';
    potentialHoldState = null;
    if(typeof showToast === 'function') showToast('请先完成当前驻店命令');
    return;
  }
  const visualBtn = st.visualBtn || btn;
  visualBtn.classList.add('complete','destiny-awake','dst-type-potential');
  potentialHoldState = null;
  triggerPotentialDestinyFromButton(btn, visualBtn);
}

function makeManualPotentialPendingDestiny(charName = currentStoryChar){
  return {
    id: MANUAL_POTENTIAL_PENDING_ID,
    char: charName,
    type: '潜在的命运',
    typeKey: 'potential',
    redBlack: '黑',
    audience: 'single',
    title: '潜在命运',
    opening: '',
    core: ''
  };
}

function resetManualPotentialPendingCapsule(visualBtn){
  clearPendingDestinyCapsuleFlight();
  setCapsuleThinking(false);
  const cap = $('emoTag');
  if(cap?.classList.contains('capsule-destiny') || cap?.classList.contains('capsule-destiny-os')){
    cap.classList.remove('has-potential-destiny','capsule-destiny','capsule-destiny-os','dst-thinking','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly','dst-from-bfly-trigger','dst-morphing-in');
    cap.style.cssText = '';
    if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  }
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');
  resetPotentialDestinySourceButterfly(visualBtn || $('potentialDestinyTrigger'));
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
}

async function triggerPotentialDestinyFromButton(btn, visualBtn = btn){
  let destiny = null;
  let pendingCapsuleShown = false;
  let pendingCapsulePromise = null;
  if(typeof isAnimating !== 'undefined' && isAnimating){
    visualBtn?.classList.remove('complete');
    return;
  }
  if(typeof window.shouldSuppressDestinyAutoTrigger === 'function'
    && window.shouldSuppressDestinyAutoTrigger({char:currentStoryChar,typeKey:'potential',redBlack:'黑'}, currentStoryChar, 'manual')){
    visualBtn?.classList.remove('complete','destiny-awake','dst-type-potential');
    isAnimating = false;
    if(typeof showToast === 'function') showToast('当前可以自由聊天');
    return;
  }
  try{
    isAnimating = true;
    visualBtn?.classList.add('is-busy');
    const pendingDestiny = makeManualPotentialPendingDestiny(currentStoryChar);
    pendingCapsulePromise = showManualPotentialCapsule(pendingDestiny, btn, { departSource:true })
      .then(() => {
        pendingCapsuleShown = true;
        setCapsuleThinking(true);
      })
      .catch(e => {
        console.error('manual potential pending capsule failed:', e);
        pendingCapsuleShown = false;
      });
    if(typeof showToast === 'function') showToast('蝴蝶正在生成黑情境...');
    if(typeof generateBlackDestinies === 'function'){
      const generated = await generateBlackDestinies(currentStoryChar, {
        count: 1,
        userDisturbance: buildManualBlackDestinyDisturbance(currentStoryChar)
      });
      destiny = generated.find(d => d?.typeKey === 'potential' && d.redBlack === '黑' && !isDestinyTriggerSuppressed(d,currentStoryChar,'manual')) || null;
    }
    if(!destiny) destiny = nextBlackPotentialDestiny(currentStoryChar);
  }catch(e){
    console.error('manual black destiny generation failed:', e);
    destiny = nextBlackPotentialDestiny(currentStoryChar);
  }finally{
    visualBtn?.classList.remove('is-busy');
  }
  if(pendingCapsulePromise) await pendingCapsulePromise;
  if(!destiny){
    if(typeof showToast === 'function') showToast('暂时没有可触及的黑情境');
    resetManualPotentialPendingCapsule(visualBtn);
    visualBtn?.classList.remove('complete');
    isAnimating = false;
    return;
  }
  try{
    await runDestiny(destiny, '（主动触及潜在命运）', {
      manualPotentialSource: btn,
      manualPotentialCapsuleShown: pendingCapsuleShown,
      preservePendingCapsuleFlight: pendingCapsuleShown,
      suppressNormalReply: true,
      revealUserText: '（用户长按蝴蝶胶囊，主动触及了一条由近期扰动生成的潜在命运·黑情境）'
    });
  }catch(e){
    console.error('triggerPotentialDestinyFromButton error:', e);
    visualBtn?.classList.remove('complete');
    isAnimating = false;
  }
}

async function showManualPotentialCapsule(destiny, sourceButton, options = {}){
  const sourceRect = sourceButton?.getBoundingClientRect ? sourceButton.getBoundingClientRect() : null;
  if(!sourceRect){
    await showDestinyCapsule(destiny);
    return;
  }
  await showExternalButterflyDestinyCapsule(destiny, sourceRect, {
    sourceButton,
    departSource: !!options.departSource
  });
}

async function showTriggeredDestinyCapsule(destiny){
  const btn = $('potentialDestinyTrigger');
  const usableButton = btn && !btn.classList.contains('is-hidden') && btn.getBoundingClientRect().width > 0;
  if(usableButton){
    awakenPotentialDestinyTrigger(destiny);
    await delay(140);
    await showManualPotentialCapsule(destiny, btn, { departSource:true });
    return;
  }
  await showDestinyCapsule(destiny);
}

async function showKeywordPotentialButterflyTakeoffReady(destiny){
  const btn = $('potentialDestinyTrigger');
  const usableButton = btn && !btn.classList.contains('is-hidden') && btn.getBoundingClientRect().width > 0;
  if(!usableButton) return null;
  awakenPotentialDestinyTrigger(destiny);
  btn.classList.add('is-busy','keyword-direct-active');
  await delay(180);
  return btn;
}

function resetKeywordPotentialButterflySource(btn){
  if(!btn) return;
  btn.classList.remove('is-busy','complete','destiny-awake','dst-type-potential','dst-type-destined','bfly-departed','keyword-direct-active');
  resetPotentialDestinySourceButterfly(btn);
}

async function showExternalButterflyDestinyCapsule(destiny, sourceRect, options = {}){
  const host = $('chatScreen') || document.querySelector('.ph-inner') || document.body;
  const sourcePoint = rectCenterToHostPoint(sourceRect, host);
  const sx = sourcePoint.x;
  const sy = sourcePoint.y;
  const layer = document.createElement('div');
  layer.className = 'dst-enter-transition ' + destinyTypeClass(destiny);
  layer.innerHTML = getReusableDestinyFlightHTML();
  host.appendChild(layer);
  if(options.departSource){
    options.sourceButton?.classList.add('bfly-departed');
    hidePotentialDestinySourceButterfly(options.sourceButton);
  }
  const fly = layer.querySelector('.dst-fly-one');
  const trails = [...layer.querySelectorAll('.dst-flight-trail')];
  const revealCapsule = showDestinyCapsule(destiny, { startRect:sourceRect, hideButterfly:true });
  await nextFrame();
  await Promise.all([
    revealCapsule,
    animateDestinyFlight({
      fly,
      trails,
      sx,
      sy,
      getTarget:getDestinyCapsuleOrbitAnchor,
      duration:620,
      loopPower:22,
      smoothTarget:true
    })
  ]);
  const orbit = startDestinyButterflyOrbit({
    fly,
    trails,
    getCenter:getDestinyCapsuleOrbitAnchor,
    radiusX:15,
    radiusY:6
  });
  pendingDestinyCapsuleFlight = { layer, fly, trails, orbit };
}

function getDestinyCapsuleButterflyAnchor(){
  const host = $('chatScreen') || document.body;
  const metrics = getHostCoordinateMetrics(host);
  const cap = $('emoTag');
  const target = cap?.querySelector('.dst-cap-bfly');
  const capRect = cap?.getBoundingClientRect();
  if(target && capRect?.width){
    const capPoint = rectToHostPoint(capRect, host, metrics);
    return {
      x: capPoint.x + target.offsetLeft + target.offsetWidth / 2,
      y: capPoint.y + target.offsetTop + target.offsetHeight / 2
    };
  }
  const rect = cap?.getBoundingClientRect();
  if(rect?.width){
    return rectCenterToHostPoint(rect, host, metrics);
  }
  return { x: (host.offsetWidth || metrics.rect.width / metrics.scale) / 2 - 38, y: (host.offsetHeight || metrics.rect.height / metrics.scale) - 166 };
}

function getDestinyBoxButterflyAnchor(){
  const host = $('chatScreen') || document.body;
  const metrics = getHostCoordinateMetrics(host);
  const cap = $('emoTag');
  const target = $('dstButterfly');
  const capRect = cap?.getBoundingClientRect();
  if(target && capRect?.width){
    const capPoint = rectToHostPoint(capRect, host, metrics);
    return {
      x: capPoint.x + target.offsetLeft + target.offsetWidth / 2,
      y: capPoint.y + target.offsetTop + target.offsetHeight / 2
    };
  }
  return getDestinyCapsuleButterflyAnchor();
}

function getHostCoordinateMetrics(host){
  const rect = host.getBoundingClientRect();
  const scale = rect.width && host.offsetWidth ? rect.width / host.offsetWidth : 1;
  return { rect, scale: scale || 1 };
}

function rectToHostPoint(rect, host, metrics = getHostCoordinateMetrics(host)){
  return {
    x: (rect.left - metrics.rect.left) / metrics.scale,
    y: (rect.top - metrics.rect.top) / metrics.scale
  };
}

function rectCenterToHostPoint(rect, host, metrics = getHostCoordinateMetrics(host)){
  return {
    x: (rect.left + rect.width / 2 - metrics.rect.left) / metrics.scale,
    y: (rect.top + rect.height / 2 - metrics.rect.top) / metrics.scale
  };
}

function getDestinyCapsuleOrbitAnchor(){
  return getDestinyCapsuleButterflyAnchor();
}

function clearPendingDestinyCapsuleFlight(){
  if(!pendingDestinyCapsuleFlight) return;
  const state = pendingDestinyCapsuleFlight;
  pendingDestinyCapsuleFlight = null;
  try{ state.orbit?.stop?.(); }catch(e){}
  state.layer?.remove?.();
  $('emoTag')?.classList.remove('dst-await-return-bfly');
}

async function finishPendingDestinyCapsuleFlight(){
  const state = pendingDestinyCapsuleFlight;
  if(!state) return;
  pendingDestinyCapsuleFlight = null;
  const from = state.orbit?.stop?.() || getDestinyCapsuleOrbitAnchor();
  await nextFrame();
  await animateDestinyDirectFlight({
    fly: state.fly,
    trails: state.trails,
    sx: from.x,
    sy: from.y,
    getTarget:getDestinyCapsuleButterflyAnchor,
    duration:760,
    wave:4,
    fadeIn:false
  });
  if(state.fly) state.fly.style.opacity = '0';
  state.layer?.remove?.();
  $('emoTag')?.classList.remove('dst-await-return-bfly');
}

function getDestinyMultiAvatarsHTML(destiny){
  if(destiny?.audience !== 'multi') return '';
  const names = (destiny.participants && destiny.participants.length ? destiny.participants : ['周往','夏季','叶恒']).filter(Boolean).slice(0,4);
  const avMap = {
    '钟辰时':'assets/avatar_zhongchenshi.jpg',
    '周往':'assets/avatar_zhouwang.png',
    '夏季':'assets/avatar_xiaji.png',
    '叶恒':'assets/avatar_yeheng.png'
  };
  return `<div class="dst-multi-avatars" aria-hidden="true">${names.map(name=>{
    const av = (typeof CH !== 'undefined' && CH[name]?.av) || avMap[name] || '';
    return `<span class="dst-multi-av" title="${escapeHTML(name)}"><img src="${escapeHTML(av)}" alt=""></span>`;
  }).join('')}</div>`;
}

function getDestinyFateArtSrc(destiny){
  if(destiny?.fateArt) return destiny.fateArt;
  const charName = destiny?.char || (typeof currentStoryChar !== 'undefined' ? currentStoryChar : '');
  const artMap = {
    '钟辰时':'assets/zcs0601.jpg',
    '周往':'assets/avatar_zhouwang.png',
    '夏季':'assets/avatar_xiaji.png',
    '叶恒':'assets/avatar_yeheng.png'
  };
  if(artMap[charName]) return artMap[charName];
  if(typeof STORY_CONFIG !== 'undefined' && STORY_CONFIG[charName]?.av) return STORY_CONFIG[charName].av;
  if(typeof CH !== 'undefined' && CH[charName]?.av) return CH[charName].av;
  return 'assets/zcs0601.jpg';
}

function setCapsuleThinking(on){
  const cap = $('emoTag');
  if(!cap) return;
  cap.classList.toggle('dst-thinking', !!on);
}

async function expandDestinyBox(){
  const cap = $('emoTag');
  if(!cap) return;
  const chatScreen = $('chatScreen');
  const parent = chatScreen || cap.offsetParent;
  setDestinyFrameGlow(true);

  const host = chatScreen || document.querySelector('.ph-inner') || document.body;
  const bflyStart = getDestinyCapsuleButterflyAnchor();
  const flightLayer = document.createElement('div');
  flightLayer.className = 'dst-enter-transition ' + destinyTypeClass(revealState?.destiny);
  flightLayer.innerHTML = getReusableDestinyFlightHTML();
  host.appendChild(flightLayer);
  const fly = flightLayer.querySelector('.dst-fly-one');
  const trails = [...flightLayer.querySelectorAll('.dst-flight-trail')];

  const startW = cap.offsetWidth;
  const startH = cap.offsetHeight;
  const capRect = cap.getBoundingClientRect();
  const parentRect = parent?.getBoundingClientRect ? parent.getBoundingClientRect() : { left:0, top:0, bottom:window.innerHeight, width:window.innerWidth, height:window.innerHeight };
  const parentW = parent?.offsetWidth || parentRect.width || window.innerWidth;
  const parentH = parent?.offsetHeight || parentRect.height || window.innerHeight;
  const scaleX = parentRect.width && parentW ? parentRect.width / parentW : 1;
  const scaleY = parentRect.height && parentH ? parentRect.height / parentH : scaleX;
  const startLeft = (capRect.left - parentRect.left) / scaleX;
  const parentBottom = Number.isFinite(parentRect.bottom) ? parentRect.bottom : ((parentRect.top || 0) + (parentRect.height || parentH));
  const startBottom = (parentBottom - capRect.bottom) / scaleY;
  const targetLeft = 18;
  const targetW = Math.max(260, parentW - targetLeft * 2);
  const startStyle = getComputedStyle(cap);
  const startMorphStyle = {
    padding: startStyle.padding,
    borderRadius: startStyle.borderRadius,
    background: startStyle.backgroundColor,
    borderColor: startStyle.borderColor,
    boxShadow: startStyle.boxShadow,
    gap: startStyle.gap
  };

  // 先把当前视觉矩形固化成绝对数值，避免从提示胶囊跳到卡片默认位置。
  cap.classList.add('dst-no-transition');
  cap.style.left = startLeft + 'px';
  cap.style.right = 'auto';
  cap.style.bottom = startBottom + 'px';
  cap.style.transform = 'none';
  cap.style.width = startW + 'px';
  cap.style.height = startH + 'px';

  cap.classList.remove('capsule-destiny');
  cap.classList.remove('dst-thinking');
  cap.classList.add('capsule-destiny-os','dst-box-preveal');
  cap.style.bottom = '';
  const targetStyle = getComputedStyle(cap);
  const targetBottom = parseFloat(targetStyle.bottom);
  cap.style.bottom = startBottom + 'px';
  const targetMorphStyle = {
    padding: targetStyle.padding,
    borderRadius: targetStyle.borderRadius,
    background: targetStyle.backgroundColor,
    borderColor: targetStyle.borderColor,
    boxShadow: targetStyle.boxShadow,
    gap: targetStyle.gap
  };
  cap.style.padding = startMorphStyle.padding;
  cap.style.borderRadius = startMorphStyle.borderRadius;
  cap.style.background = startMorphStyle.background;
  cap.style.borderColor = startMorphStyle.borderColor;
  cap.style.boxShadow = startMorphStyle.boxShadow;
  cap.style.gap = startMorphStyle.gap;
  cap.innerHTML = `
    <div class="dst-fate-art" aria-hidden="true"><img src="${escapeHTML(getDestinyFateArtSrc(revealState?.destiny))}" alt=""></div>
    <div class="dst-os-head">
      <span class="dst-os-bfly" id="dstButterfly">${BUTTERFLY_SVG}</span>
      <span class="dst-os-label" id="dstLabel">${escapeHTML(revealState?.title || '命运')}</span>
    </div>
    <svg class="dst-countdown-ring" id="dstCountdownRing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1.2" y="1.2" width="97.6" height="97.6" rx="5.8" pathLength="1"></rect>
    </svg>
    <button type="button" class="dst-close ${isDestinedType(revealState?.destiny)?'dst-later':''}" onclick="${isDestinedType(revealState?.destiny)?'postponeDestiny(event)':'ignoreDestiny(event)'}" aria-label="${isDestinedType(revealState?.destiny)?'稍后':'忽略命运'}">${isDestinedType(revealState?.destiny)?'稍后':''}</button>
    <div class="dst-os-body" id="dstBody"></div>
    <button type="button" class="dst-next-arrow" id="dstNextArrow" aria-label="查看下一步"></button>
    <div class="dst-os-actions" id="dstActions">
      <div class="dst-action-line">
        ${getDestinyMultiAvatarsHTML(revealState?.destiny)}
        <span class="dst-action dst-action-enter" id="dstEnterAction" role="button" tabindex="0" onclick="enterDestiny(event)">${escapeHTML(enterActionLabel(revealState?.destiny))}</span>
      </div>
      <span class="dst-auto-enter-tip" id="dstAutoEnterTip"></span>
    </div>`;
  cap.onclick = null;

  // 测目标高度后做高度过渡（复用情绪→内心OS的展开手法）
  cap.style.overflow = 'hidden';
  cap.style.padding = targetMorphStyle.padding;
  cap.style.borderRadius = targetMorphStyle.borderRadius;
  cap.style.background = targetMorphStyle.background;
  cap.style.borderColor = targetMorphStyle.borderColor;
  cap.style.boxShadow = targetMorphStyle.boxShadow;
  cap.style.gap = targetMorphStyle.gap;
  cap.style.width = targetW + 'px';
  cap.style.height = 'auto';
  const targetH = cap.offsetHeight;
  cap.style.left = startLeft + 'px';
  cap.style.width = startW + 'px';
  cap.style.height = startH + 'px';
  cap.style.padding = startMorphStyle.padding;
  cap.style.borderRadius = startMorphStyle.borderRadius;
  cap.style.background = startMorphStyle.background;
  cap.style.borderColor = startMorphStyle.borderColor;
  cap.style.boxShadow = startMorphStyle.boxShadow;
  cap.style.gap = startMorphStyle.gap;
  void cap.offsetWidth;

  chatScreen?.classList.add('has-os-capsule');
  chatScreen?.style.setProperty('--os-capsule-height', targetH + 'px');
  cap.classList.remove('dst-no-transition');
  cap.classList.add('dst-box-morphing');
  await nextFrame();
  cap.style.left = targetLeft + 'px';
  cap.style.right = 'auto';
  cap.style.bottom = Number.isFinite(targetBottom) ? (targetBottom + 'px') : '';
  cap.style.width = targetW + 'px';
  cap.style.height = targetH + 'px';
  cap.style.padding = targetMorphStyle.padding;
  cap.style.borderRadius = targetMorphStyle.borderRadius;
  cap.style.background = targetMorphStyle.background;
  cap.style.borderColor = targetMorphStyle.borderColor;
  cap.style.boxShadow = targetMorphStyle.boxShadow;
  cap.style.gap = targetMorphStyle.gap;

  const bflyFlight = animateDestinyFlight({
    fly,
    trails,
    sx: bflyStart.x,
    sy: bflyStart.y,
    getTarget:getDestinyBoxButterflyAnchor,
    duration:760,
    loopPower:18,
    smoothTarget:true
  });

  await delay(560);
  cap.classList.remove('dst-box-morphing');
  cap.classList.remove('dst-box-preveal');
  await bflyFlight;
  if(fly) fly.style.opacity = '0';
  flightLayer.remove();
  showButterfly();
  cap.style.overflow = '';
  cap.style.height = 'auto';
  cap.style.left = '';
  cap.style.right = '';
  cap.style.bottom = '';
  cap.style.width = '';
  cap.style.transform = '';
  cap.style.padding = '';
  cap.style.borderRadius = '';
  cap.style.background = '';
  cap.style.borderColor = '';
  cap.style.boxShadow = '';
  cap.style.gap = '';
  syncDestinyCapsuleHeight();
}

function nextFrame(){
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function setDstLabel(text){
  const el = $('dstLabel');
  if(el) el.textContent = text;
}

function showButterfly(){
  const el = $('dstButterfly');
  if(el) el.classList.add('on');
}

function showDestinyEnterAction(){
  const el = $('dstEnterAction');
  const actions = $('dstActions');
  if(actions) actions.classList.add('on');
  if(el) el.classList.add('on');
  syncDestinyCapsuleHeight();
}

function startDestinyCountdown(){
  clearDestinyCountdown();
  const ring = $('dstCountdownRing');
  if(!ring) return;
  const tip = $('dstAutoEnterTip');
  measureCountdownRing();
  const line = ring.querySelector('rect');
  if(line){
    line.style.strokeDasharray = '0 1';
    line.style.strokeDashoffset = '0';
  }
  ring.classList.remove('on');
  void ring.offsetWidth;
  ring.classList.add('on');
  const started = performance.now();
  const duration = 10000;
  const updateTip = remaining => {
    if(tip) tip.textContent = `倒计时${remaining}秒自动进入`;
  };
  updateTip(Math.ceil(duration / 1000));
  const tick = now => {
    const p = Math.min(1, (now - started) / duration);
    if(line) line.style.strokeDasharray = `${p} 1`;
    updateTip(Math.max(1, Math.ceil((duration - (now - started)) / 1000)));
    if(p < 1 && !aborted && revealState){
      countdownFrame = requestAnimationFrame(tick);
    }
  };
  countdownFrame = requestAnimationFrame(tick);
  countdownTimer = setTimeout(() => {
    countdownTimer = null;
    if(aborted || !revealState || runId <= 0) return;
    enterDestiny();
  }, 10000);
}

function clearDestinyCountdown(){
  if(countdownTimer){
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  if(countdownFrame){
    cancelAnimationFrame(countdownFrame);
    countdownFrame = null;
  }
  $('dstCountdownRing')?.classList.remove('on');
  const tip = $('dstAutoEnterTip');
  if(tip) tip.textContent = '';
}

function measureCountdownRing(){
  const cap = $('emoTag');
  const ring = $('dstCountdownRing');
  const line = ring?.querySelector('rect');
  if(!cap || !ring || !line) return;
  const w = Math.max(1, Math.round(cap.offsetWidth));
  const h = Math.max(1, Math.round(cap.offsetHeight));
  const inset = 1.2;
  const radius = Math.max(12, Math.min(18, Math.round(Math.min(w, h) * .08)));
  ring.setAttribute('viewBox', `0 0 ${w} ${h}`);
  line.setAttribute('x', inset);
  line.setAttribute('y', inset);
  line.setAttribute('width', Math.max(1, w - inset * 2));
  line.setAttribute('height', Math.max(1, h - inset * 2));
  line.setAttribute('rx', radius);
  line.setAttribute('pathLength', '1');
}

function waitForStableDestinyBox(){
  const cap = $('emoTag');
  if(!cap) return nextFrame();
  return new Promise(resolve => {
    let lastW = -1;
    let lastH = -1;
    let stableFrames = 0;
    let frames = 0;
    const check = () => {
      const w = Math.round(cap.offsetWidth);
      const h = Math.round(cap.offsetHeight);
      if(w === lastW && h === lastH) stableFrames++;
      else stableFrames = 0;
      lastW = w;
      lastH = h;
      frames++;
      if(stableFrames >= 4 || frames >= 24){
        syncDestinyCapsuleHeight();
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

function waitForDestinyNext(myRun){
  return new Promise(resolve => {
    const arrow = $('dstNextArrow');
    if(!arrow){ resolve(); return; }
    let done = false;
    const finish = () => {
      if(done) return;
      done = true;
      arrow.classList.remove('on');
      arrow.onclick = null;
      resolve();
    };
    arrow.onclick = e => {
      if(e && e.stopPropagation) e.stopPropagation();
      finish();
    };
    arrow.classList.add('on');
    syncDestinyCapsuleHeight();

    const tick = setInterval(() => {
      if(done){
        clearInterval(tick);
        return;
      }
      if(aborted || myRun !== runId){
        clearInterval(tick);
        finish();
      }
    }, 120);
  });
}

/* 打字机：逐字写入，可被中断 */
async function typeInto(el, text, speed, myRun){
  if(!el) return;
  el.textContent = '';
  const body = $('dstBody');
  const chars = Array.from(String(text || ''));
  for(let i=0; i<chars.length; i++){
    if(aborted || myRun !== runId) return;
    el.textContent += chars[i];
    syncDestinyCapsuleHeight();
    if(body) body.scrollTop = body.scrollHeight;
    await delay(speed);
  }
  syncDestinyCapsuleHeight();
}

async function clearDestinyBody(myRun){
  const body = $('dstBody');
  if(!body) return;
  body.classList.add('dst-body-out');
  await delay(220);
  if(aborted || myRun !== runId) return;
  body.innerHTML = '';
  body.scrollTop = 0;
  body.classList.remove('dst-body-out');
  syncDestinyCapsuleHeight();
}

function syncDestinyCapsuleHeight(){
  const cap = $('emoTag');
  if(!cap?.classList.contains('capsule-destiny-os')) return;
  const h = cap.offsetHeight;
  if(h) $('chatScreen')?.style.setProperty('--os-capsule-height', h + 'px');
}

function setDestinyFrameGlow(on){
  document.querySelector('.phone')?.classList.toggle('destiny-frame-glow', !!on);
  document.querySelector('.ph-inner')?.classList.toggle('destiny-frame-glow', !!on);
}

/* ---------- 按钮：忽略 / 进入 ---------- */
function ignoreDestiny(e){
  if(e && e.stopPropagation) e.stopPropagation();
  const replyText = revealState?.userText || pendingNormalReplyText;
  aborted = true;
  runId++;
  revealState = null;
  pendingNormalReplyText = '';
  clearPendingDestinyCapsuleFlight();
  clearDestinyCountdown();
  setDestinyFrameGlow(false);
  const cap = $('emoTag');
  if(cap){
    cap.classList.remove('has-potential-destiny','capsule-destiny','capsule-destiny-os','dst-thinking','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly');
    cap.style.cssText = '';
  }
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');
  if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  if(replyText && typeof sendToAI === 'function'){
    isAnimating = true;
    sendToAI(replyText);
  }else{
    isAnimating = false;
  }
}

function postponeDestiny(e){
  if(e && e.stopPropagation) e.stopPropagation();
  const rs = revealState;
  aborted = true;
  runId++;
  pendingNormalReplyText = '';
  clearPendingDestinyCapsuleFlight();
  clearDestinyCountdown();
  setDestinyFrameGlow(false);
  if(rs?.destiny?.char && rs.destiny.id){
    const st = storyState[rs.destiny.char];
    if(st){
      if(!Array.isArray(st.postponedDestinies)) st.postponedDestinies = [];
      if(!st.postponedDestinies.includes(rs.destiny.id)) st.postponedDestinies.push(rs.destiny.id);
      rememberDestinyReveal(rs.destiny, {
        reason: rs.reason,
        title: rs.title,
        preview: rs.preview,
        opening: rs.opening
      });
    }
  }
  revealState = null;
  const cap = $('emoTag');
  if(cap){
    cap.classList.remove('has-potential-destiny','capsule-destiny','capsule-destiny-os','dst-thinking','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly');
    cap.style.cssText = '';
  }
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');
  if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  if(typeof showToast === 'function') showToast('已收起，可在蝴蝶列表继续');
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();
  isAnimating = false;
}

async function enterDestiny(e){
  if(e && e.stopPropagation) e.stopPropagation();
  if(enteringDestiny) return;
  const rs = revealState;
  if(!rs){ ignoreDestiny(); return; }
  enteringDestiny = true;
  aborted = true;
  runId++;
  pendingNormalReplyText = '';
  clearDestinyCountdown();

  // 标记已触发，记录正在经历的命运（注入后续对话的 system prompt）
  const char = rs.destiny.char;
  const done = triggeredSet(char);
  if(!shouldDelayDestinyCompletionRecord(rs.destiny) && !done.includes(rs.destiny.id)) done.push(rs.destiny.id);
  storyState[char].activeDestiny = {
    id: rs.destiny.id,
    title: rs.title,
    type: typeLabel(rs.destiny),
    audience: rs.destiny.audience || 'single',
    participants: rs.destiny.participants || [],
    reason: rs.reason,
    opening: rs.opening,
    core: rs.destiny.core
  };
  if(typeof window.recordDestinyImpactEntered === 'function') window.recordDestinyImpactEntered(rs.destiny, rs);

  if(rs.destiny.audience === 'multi'){
    await enterMultiDestinyWorld(rs);
    if(typeof addFeedEntry === 'function'){
      try{ addFeedEntry(char, '触碰多人命运 · ' + rs.title, (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
    }
    if(typeof saveCurrentStory === 'function') saveCurrentStory();
    if(typeof saveAppState === 'function') saveAppState();
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
    return;
  }

  if(rs.destiny?.id === DOLO_DESTINY_ID && typeof startNpcWorldExplorePath === 'function'){
    await collapseDestinyBoxToEmotion();
    setDestinyFrameGlow(false);
    if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
    startNpcWorldExplorePath(rs);
    if(typeof addFeedEntry === 'function'){
      try{ addFeedEntry(char, 'NPC世界探索 · DOLO', (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
    }
    if(typeof saveCurrentStory === 'function') saveCurrentStory();
    if(typeof saveAppState === 'function') saveAppState();
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    return;
  }

  const preludeVideoSrc = getDestinyPreludeVideoSrc(rs);
  if(preludeVideoSrc){
    setDestinyFrameGlow(false);
    await playDestinyPreludeVideo(preludeVideoSrc);
  }

  // 先收回命运框，恢复普通聊天布局，再发出命运开场白气泡。
  const bubbleRefs = await playDestinyEnterTransition(options => appendDestinyOpeningBubble(rs, options), rs);
  setDestinyFrameGlow(false);
  finalizeDestinyOpeningBubble(bubbleRefs);
  if(typeof startDestinyChoiceGuide === 'function'){
    startDestinyChoiceGuide(rs.destiny,rs);
  }

  if(typeof addFeedEntry === 'function'){
    try{ addFeedEntry(char, '触及命运 · ' + rs.title, (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
  }
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();

  revealState = null;
  enteringDestiny = false;
  isAnimating = false;
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
}

async function appendDirectDestinyOpeningBubble(rs, options = {}){
  const area = $('chatArea');
  if(!area) return null;
  const text = String(rs?.opening || '').trim() || '……';
  const row = document.createElement('div');
  row.className = 'chat-row chat-row-left destiny-flow-fragment';
  if(rs?.destiny?.id){
    row.dataset.destinyId = rs.destiny.id;
    row.dataset.destinyRole = 'opening';
  }
  const bub = document.createElement('div');
  bub.className = 'chat-bubble dst-direct-opening-bubble';
  bub.style.flex = 'none';
  bub.style.maxWidth = '82%';
  const body = document.createElement('div');
  body.className = 'dst-bubble-body';
  const textHost = document.createElement('div');
  textHost.className = 'dst-bubble-text';
  const dial = document.createElement('div');
  dial.className = 'msg-dial';
  textHost.appendChild(dial);
  body.appendChild(textHost);
  bub.appendChild(body);
  const refs = { row, bub, body, textHost, dial, rs };
  applyApp2DestinedInlineButterfly(refs);
  row.appendChild(bub);
  area.appendChild(row);
  scrollChat();
  const directRun = runId;
  let liveText = '';
  for(const ch of Array.from(text)){
    if(directRun !== runId || !row.isConnected) return { row, bub, body, textHost, dial, rs, cancelled:true };
    liveText += ch;
    renderDestinyOpeningStreamingText(refs, liveText);
    applyApp2DestinedInlineButterfly(refs);
    scrollChat();
    await delay(options.directOpeningSpeed || 18);
  }
  formatBubble(textHost, text);
  applyApp2DestinedInlineButterfly(refs);
  if(Array.isArray(chatHistory)) chatHistory.push({role:'assistant', content:text});
  await waitForStableElement(bub);
  scrollChat();
  return refs;
}

async function enterDestinyWithDirectOpening(options = {}){
  if(enteringDestiny) return;
  const rs = revealState;
  if(!rs){ ignoreDestiny(); return; }
  enteringDestiny = true;
  aborted = true;
  runId++;
  pendingNormalReplyText = '';
  clearDestinyCountdown();
  clearPendingDestinyCapsuleFlight();

  const cap = $('emoTag');
  if(cap?.classList.contains('capsule-destiny') || cap?.classList.contains('capsule-destiny-os')){
    cap.classList.remove('has-potential-destiny','capsule-destiny','capsule-destiny-os','dst-thinking','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly');
    cap.style.cssText = '';
    if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  }
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');

  const char = rs.destiny.char;
  const st = storyState[char];
  if(!st){
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    return;
  }
  st.activeDestiny = {
    id: rs.destiny.id,
    title: rs.title,
    type: typeLabel(rs.destiny),
    audience: rs.destiny.audience || 'single',
    participants: rs.destiny.participants || [],
    reason: rs.reason,
    opening: rs.opening,
    core: rs.destiny.core
  };
  if(typeof window.recordDestinyImpactEntered === 'function') window.recordDestinyImpactEntered(rs.destiny, rs);

  if(rs.destiny.audience === 'multi'){
    await enterMultiDestinyWorld(rs);
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
    return;
  }

  const preludeVideoSrc = options.skipPreludeVideo ? '' : getDestinyPreludeVideoSrc(rs);
  if(preludeVideoSrc){
    setDestinyFrameGlow(false);
    await playDestinyPreludeVideo(preludeVideoSrc);
  }

  const bubbleRefs = await appendDirectDestinyOpeningBubble(rs, options);
  if(bubbleRefs?.cancelled){
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
    return;
  }
  if(typeof startDestinyChoiceGuide === 'function'){
    startDestinyChoiceGuide(rs.destiny,rs);
  }

  if(typeof addFeedEntry === 'function'){
    try{ addFeedEntry(char, '命运开场 · ' + rs.title, (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
  }
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();

  revealState = null;
  enteringDestiny = false;
  isAnimating = false;
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
}

async function enterDestinyWithoutRevealUI(){
  if(enteringDestiny) return;
  const rs = revealState;
  if(!rs){ ignoreDestiny(); return; }
  enteringDestiny = true;
  aborted = true;
  runId++;
  pendingNormalReplyText = '';
  clearDestinyCountdown();
  clearPendingDestinyCapsuleFlight();

  const cap = $('emoTag');
  if(cap?.classList.contains('capsule-destiny') || cap?.classList.contains('capsule-destiny-os')){
    cap.classList.remove('has-potential-destiny','capsule-destiny','capsule-destiny-os','dst-thinking','holding','complete','is-busy','destiny-awake','dst-type-destined','dst-type-potential','dst-audience-single','dst-audience-multi','dst-await-return-bfly');
    cap.style.cssText = '';
    if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  }
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');

  const char = rs.destiny.char;
  const done = triggeredSet(char);
  if(!shouldDelayDestinyCompletionRecord(rs.destiny) && !done.includes(rs.destiny.id)) done.push(rs.destiny.id);
  storyState[char].activeDestiny = {
    id: rs.destiny.id,
    title: rs.title,
    type: typeLabel(rs.destiny),
    audience: rs.destiny.audience || 'single',
    participants: rs.destiny.participants || [],
    reason: rs.reason,
    opening: rs.opening,
    core: rs.destiny.core
  };
  if(typeof window.recordDestinyImpactEntered === 'function') window.recordDestinyImpactEntered(rs.destiny, rs);

  if(rs.destiny.audience === 'multi'){
    await enterMultiDestinyWorld(rs);
    revealState = null;
    enteringDestiny = false;
    isAnimating = false;
    if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
    return;
  }

  const preludeVideoSrc = getDestinyPreludeVideoSrc(rs);
  if(preludeVideoSrc){
    setDestinyFrameGlow(false);
    await playDestinyPreludeVideo(preludeVideoSrc);
  }

  const sourceButton = $('potentialDestinyTrigger');
  const bubbleRefs = await playKeywordPotentialDirectTransition(
    sourceButton,
    options => appendDestinyOpeningBubble(rs, options),
    rs
  );
  setDestinyFrameGlow(false);
  finalizeDestinyOpeningBubble(bubbleRefs);
  if(typeof startDestinyChoiceGuide === 'function'){
    startDestinyChoiceGuide(rs.destiny,rs);
  }
  if(typeof addFeedEntry === 'function'){
    try{ addFeedEntry(char, '触及命运 · ' + rs.title, (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
  }
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();

  revealState = null;
  enteringDestiny = false;
  isAnimating = false;
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
}

async function enterKeywordPotentialDestinyDirectly(rs, sourceButton){
  if(enteringDestiny) return;
  if(!rs){ ignoreDestiny(); return; }
  enteringDestiny = true;
  aborted = true;
  runId++;
  pendingNormalReplyText = '';
  clearDestinyCountdown();

  const char = rs.destiny.char;
  const done = triggeredSet(char);
  if(!shouldDelayDestinyCompletionRecord(rs.destiny) && !done.includes(rs.destiny.id)) done.push(rs.destiny.id);
  storyState[char].activeDestiny = {
    id: rs.destiny.id,
    title: rs.title,
    type: typeLabel(rs.destiny),
    audience: rs.destiny.audience || 'single',
    participants: rs.destiny.participants || [],
    reason: rs.reason,
    opening: rs.opening,
    core: rs.destiny.core
  };
  if(typeof window.recordDestinyImpactEntered === 'function') window.recordDestinyImpactEntered(rs.destiny, rs);

  const bubbleRefs = await playKeywordPotentialDirectTransition(
    sourceButton,
    options => appendDestinyOpeningBubble(rs, options),
    rs
  );
  setDestinyFrameGlow(false);
  finalizeDestinyOpeningBubble(bubbleRefs);
  if(typeof startDestinyChoiceGuide === 'function'){
    startDestinyChoiceGuide(rs.destiny,rs);
  }

  if(typeof addFeedEntry === 'function'){
    try{ addFeedEntry(char, '触及命运 · ' + rs.title, (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[char] : '') || '', 'emotion'); }catch(e){}
  }
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();

  revealState = null;
  enteringDestiny = false;
  isAnimating = false;
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
}

function getDestinyPreludeVideoSrc(rs){
  const destiny = rs?.destiny || rs;
  if(!destiny) return '';
  if(DESTINY_PRELUDE_VIDEOS[destiny.id]) return DESTINY_PRELUDE_VIDEOS[destiny.id];
  const keys = Array.isArray(destiny.keywords) ? destiny.keywords : [];
  if(keys.some(k => String(k || '').trim() === '兜风')) return 'video/兜风.mp4';
  if(keys.some(k => String(k || '').trim() === '摩托车')) return 'video/摩托车.mp4';
  return '';
}

function playDestinyPreludeVideo(src){
  const screen = $('chatScreen');
  if(!screen || !src) return Promise.resolve(false);
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'destiny-video-overlay';
    overlay.innerHTML = `
      <video class="destiny-video-player" src="${escapeHTML(src)}" playsinline webkit-playsinline preload="auto"></video>
      <button type="button" class="destiny-video-skip">跳过</button>
      <div class="destiny-video-confirm" aria-hidden="true">
        <div class="destiny-video-confirm-card" role="dialog" aria-modal="true" aria-label="跳过确认">
          <div class="destiny-video-confirm-title">确定跳过吗？</div>
          <div class="destiny-video-confirm-text">该视频涉及到重要剧情，确定跳过吗？</div>
          <div class="destiny-video-confirm-actions">
            <button type="button" class="destiny-video-confirm-cancel">继续观看</button>
            <button type="button" class="destiny-video-confirm-ok">确定</button>
          </div>
        </div>
      </div>`;
    const video = overlay.querySelector('.destiny-video-player');
    const skip = overlay.querySelector('.destiny-video-skip');
    const confirm = overlay.querySelector('.destiny-video-confirm');
    const cancelBtn = overlay.querySelector('.destiny-video-confirm-cancel');
    const okBtn = overlay.querySelector('.destiny-video-confirm-ok');
    let done = false;

    const cleanup = () => {
      screen.classList.remove('destiny-video-playing');
      try{
        video.pause();
        video.removeAttribute('src');
        video.load();
      }catch(_){}
      overlay.remove();
    };
    const finish = () => {
      if(done) return;
      done = true;
      cleanup();
      resolve(true);
    };
    const showConfirm = () => {
      if(done) return;
      video.pause();
      confirm.classList.add('on');
      confirm.setAttribute('aria-hidden','false');
    };
    const hideConfirm = () => {
      confirm.classList.remove('on');
      confirm.setAttribute('aria-hidden','true');
      video.play().catch(() => {});
    };

    video.addEventListener('ended', finish, { once:true });
    video.addEventListener('error', finish, { once:true });
    skip.addEventListener('click', showConfirm);
    cancelBtn.addEventListener('click', hideConfirm);
    okBtn.addEventListener('click', finish);

    screen.classList.remove('tools-open');
    screen.classList.add('destiny-video-playing');
    screen.appendChild(overlay);
    video.play().catch(() => {});
  });
}

async function enterMultiDestinyWorld(rs){
  await collapseDestinyBoxToEmotion();
  setDestinyFrameGlow(false);
  if(typeof syncPotentialDestinyTrigger === 'function') syncPotentialDestinyTrigger();
  if(typeof startMultiDestinyPath === 'function'){
    startMultiDestinyPath(rs);
    return;
  }
  if(typeof openWorldFocus === 'function'){
    await openWorldFocus(rs.destiny.char || currentStoryChar);
  }else if(typeof openWorldFromChat === 'function'){
    openWorldFromChat();
  }else if(typeof openWorld === 'function'){
    openWorld();
  }
}

function appendDestinyOpeningBubble(rs, options = {}){
  const area = $('chatArea');
  if(!area) return null;
  const isPotential = !isDestinedType(rs?.destiny);
  const row = document.createElement('div');
  row.className = 'chat-row chat-row-left dst-destiny-bubble';
  if(rs?.destiny?.id){
    row.classList.add('destiny-flow-fragment');
    row.dataset.destinyId = rs.destiny.id;
    row.dataset.destinyRole = 'opening';
  }
  if(options.hidden) row.classList.add('dst-pending-reveal');
  const bub = document.createElement('div');
  bub.className = 'chat-bubble dst-destiny-start';
  if(isPotential) bub.classList.add('dst-potential-bubble-start');
  bub.style.flex = 'none';
  bub.style.maxWidth = '82%';
  const mark = createDestinyBubbleMark(rs);
  const body = document.createElement('div');
  body.className = 'dst-bubble-body';
  const textHost = document.createElement('div');
  textHost.className = 'dst-bubble-text';
  if(!isPotential){
    bub.appendChild(mark);
    requestAnimationFrame(() => fitDestinyOpeningBubbleToMark(bub, mark));
  }
  const dial = document.createElement('div');
  dial.className = 'msg-dial';
  if(isPotential){
    mark.classList.add('dst-bubble-mark-inline');
    dial.appendChild(mark);
  }
  textHost.appendChild(dial);
  body.appendChild(textHost);
  bub.appendChild(body);
  row.appendChild(bub);
  area.appendChild(row);
  scrollChat();
  return { row, bub, body, textHost, dial, mark, rs };
}

function fitDestinyOpeningBubbleToMark(bub, mark){
  if(!bub || !mark) return;
  const markW = Math.ceil(mark.scrollWidth || mark.offsetWidth || 0);
  if(!markW) return;
  const style = getComputedStyle(bub);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const markLeft = mark.offsetLeft || 12;
  const minW = Math.min(288, Math.max(80, markLeft + markW + paddingRight + 8));
  bub.style.minWidth = minW + 'px';
}

function finalizeDestinyOpeningBubble(refs){
  if(!refs?.row) return;
  refs.mark?.classList.add('on');
  if(typeof attachLatestNpcActions === 'function') attachLatestNpcActions(refs.row);
  if(typeof scrollChat === 'function') scrollChat();
}

function createDestinyBubbleMark(rs){
  const mark = document.createElement('span');
  mark.className = 'dst-bubble-mark ' + destinyTypeClass(rs.destiny);
  const title = isDestinedType(rs?.destiny)
    ? `<span class="dst-bubble-title">${escapeHTML(rs.title || typeLabel(rs.destiny))}</span>`
    : '';
  if(!title) mark.classList.add('dst-bubble-mark-bfly-only');
  mark.innerHTML = `<span class="dst-bubble-bfly"><span class="dst-bubble-sparkles" aria-hidden="true"></span>${BUTTERFLY_SVG}</span>${title}`;
  return mark;
}

async function streamDestinyOpeningBubble(refs){
  if(!refs?.bub) return;
  const text = limitDestinyOpening(refs.rs?.opening || '', 150);
  const textHost = refs.textHost || refs.body || refs.bub;
  if(!textHost) return;
  const isPotential = refs.rs && !isDestinedType(refs.rs.destiny);
  let liveText = '';
  for(const ch of Array.from(text)){
    liveText += ch;
    renderDestinyOpeningStreamingText(refs, liveText);
    if(isPotential) applyPotentialDestinyInlineButterfly(refs);
    applyApp2DestinedInlineButterfly(refs);
    scrollChat();
    await delay(18);
  }
  formatBubble(textHost, text);
  applyPotentialDestinyInlineButterfly(refs);
  applyApp2DestinedInlineButterfly(refs);
  if(Array.isArray(chatHistory)) chatHistory.push({role:'assistant', content:text});
  await waitForStableElement(refs.bub);
  scrollChat();
}

function renderDestinyOpeningStreamingText(refs, text){
  const host = refs?.textHost || refs?.body || refs?.bub;
  if(!host) return false;
  if(typeof renderStreamingBubbleText === 'function'){
    renderStreamingBubbleText(host, text);
    return true;
  }
  const dial = refs?.dial || host.querySelector?.('.msg-dial');
  if(dial){
    dial.textContent = String(text || '');
    return true;
  }
  host.textContent = String(text || '');
  return true;
}

function applyPotentialDestinyInlineButterfly(refs){
  if(!refs?.rs || isDestinedType(refs.rs.destiny)) return;
  const body = refs.body || refs.bub;
  if(!body) return;
  body.querySelectorAll('.dst-bubble-mark').forEach(el => el.remove());
  const firstText = body.querySelector('.msg-dial,.msg-narr');
  if(!firstText) return;
  const mark = createDestinyBubbleMark(refs.rs);
  mark.classList.add('dst-bubble-mark-inline','on');
  firstText.insertBefore(mark, firstText.firstChild);
  refs.mark = mark;
}

function applyApp2DestinedInlineButterfly(refs){
  if(!refs?.rs || !isDestinedType(refs.rs.destiny)) return;
  const screen = $('chatScreen');
  if(!screen?.classList?.contains('app2-day-chat')) return;
  const body = refs.body || refs.bub;
  const firstText = body?.querySelector?.('.msg-dial,.msg-narr');
  if(!body || !firstText) return;
  let mark = refs.mark || refs.bub?.querySelector?.(':scope > .dst-bubble-mark') || body.querySelector?.('.dst-bubble-mark');
  if(!mark) mark = createDestinyBubbleMark(refs.rs);
  if(!mark.querySelector('.dst-bubble-title')){
    const title = document.createElement('span');
    title.className = 'dst-bubble-title';
    title.textContent = refs.rs.title || typeLabel(refs.rs.destiny);
    mark.appendChild(title);
  }
  mark.classList.remove('dst-bubble-mark-bfly-only');
  mark.classList.add('dst-bubble-mark-inline','on');
  let heading = body.querySelector(':scope > .dst-bubble-heading');
  if(!heading){
    heading = document.createElement('div');
    heading.className = 'dst-bubble-heading';
    body.insertBefore(heading, body.firstChild);
  }
  heading.appendChild(mark);
  refs.mark = mark;
}

async function playDestinyEnterTransition(createBubble, rs){
  const host = $('chatScreen') || document.querySelector('.ph-inner') || document.body;
  const srcEl = $('dstButterfly');
  const src = srcEl?.getBoundingClientRect();
  const hostMetrics = getHostCoordinateMetrics(host);
  const sourcePoint = src ? rectCenterToHostPoint(src, host, hostMetrics) : { x:(host.offsetWidth || 375) / 2, y:(host.offsetHeight || 812) - 210 };
  const sx = sourcePoint.x;
  const sy = sourcePoint.y;
  const layer = document.createElement('div');
  layer.className = 'dst-enter-transition ' + destinyTypeClass(rs?.destiny);
  layer.innerHTML = getReusableDestinyFlightHTML();
  host.appendChild(layer);
  const fly = layer.querySelector('.dst-fly-one');
  const trails = [...layer.querySelectorAll('.dst-flight-trail')];
  if(fly){
    fly.style.opacity = '1';
    fly.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(.9) rotate(-8deg)`;
  }
  if(srcEl) srcEl.style.opacity = '0';

  const takeoff = {
    x: Math.min((host.offsetWidth || 375) - 44, sx + 34),
    y: Math.min((host.offsetHeight || 812) - 92, sy + 46)
  };
  await Promise.all([
    collapseDestinyBoxToEmotion(),
    animateDestinyDirectFlight({
      fly,
      trails,
      sx,
      sy,
      getTarget:()=>takeoff,
      duration:520,
      wave:6,
      fadeIn:false
    })
  ]);
  const refs = typeof createBubble === 'function' ? createBubble({ hidden:true }) : null;
  await nextFrame();
  await animateDestinyFlight({
    fly,
    trails,
    sx: takeoff.x,
    sy: takeoff.y,
    getTarget:()=>getDestinyBubbleMarkAnchor(refs),
    duration:1120,
    loopPower:28,
    fadeIn:false,
    smoothTarget:true
  });
  const landingOrbit = startDestinyButterflyOrbit({
    fly,
    trails,
    getCenter:()=>getDestinyBubbleMarkAnchor(refs),
    radiusX:10,
    radiusY:5
  });
  await delay(620);
  const from = landingOrbit.stop() || getDestinyBubbleMarkAnchor(refs);
  await animateDestinyDirectFlight({
    fly,
    trails,
    sx: from.x,
    sy: from.y,
    getTarget:()=>getDestinyBubbleMarkAnchor(refs),
    duration:360,
    wave:2,
    fadeIn:false
  });
  if(fly) fly.style.opacity = '0';
  layer.remove();
  refs?.row?.classList.remove('dst-pending-reveal');
  refs?.row?.classList.add('dst-reveal-now');
  refs?.mark?.classList.add('on');
  await delay(220);
  refs?.row?.classList.remove('dst-reveal-now');
  await streamDestinyOpeningBubble(refs);
  return refs;
}

async function playKeywordPotentialDirectTransition(sourceButton, createBubble, rs){
  const host = $('chatScreen') || document.querySelector('.ph-inner') || document.body;
  const hostMetrics = getHostCoordinateMetrics(host);
  const sourceEl = sourceButton?.querySelector?.('.dst-bfly-svg') || sourceButton || $('emoTag');
  const src = sourceEl?.getBoundingClientRect?.();
  const sourcePoint = src ? rectCenterToHostPoint(src, host, hostMetrics) : { x:(host.offsetWidth || 375) / 2, y:(host.offsetHeight || 812) - 166 };
  const sx = sourcePoint.x;
  const sy = sourcePoint.y;

  const layer = document.createElement('div');
  layer.className = 'dst-enter-transition dst-keyword-direct ' + destinyTypeClass(rs?.destiny);
  layer.innerHTML = getReusableDestinyFlightHTML();
  host.appendChild(layer);
  const fly = layer.querySelector('.dst-fly-one');
  const trails = [...layer.querySelectorAll('.dst-flight-trail')];
  if(fly){
    fly.style.opacity = '1';
    fly.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-50%) scale(.86) rotate(-8deg)`;
  }

  const refs = typeof createBubble === 'function' ? createBubble({ hidden:true }) : null;
  await nextFrame();
  const flight = animateDestinyFlight({
    fly,
    trails,
    sx,
    sy,
    getTarget:()=>getDestinyBubbleMarkAnchor(refs),
    duration:1080,
    loopPower:26,
    fadeIn:false,
    smoothTarget:true
  });
  await delay(260);
  resetKeywordPotentialButterflySource(sourceButton);
  await flight;

  const landingOrbit = startDestinyButterflyOrbit({
    fly,
    trails,
    getCenter:()=>getDestinyBubbleMarkAnchor(refs),
    radiusX:9,
    radiusY:4
  });
  await delay(360);
  const from = landingOrbit.stop() || getDestinyBubbleMarkAnchor(refs);
  await animateDestinyDirectFlight({
    fly,
    trails,
    sx: from.x,
    sy: from.y,
    getTarget:()=>getDestinyBubbleMarkAnchor(refs),
    duration:260,
    wave:2,
    fadeIn:false
  });
  if(fly) fly.style.opacity = '0';
  layer.remove();
  refs?.row?.classList.remove('dst-pending-reveal');
  refs?.row?.classList.add('dst-reveal-now');
  refs?.mark?.classList.add('on');
  await delay(180);
  refs?.row?.classList.remove('dst-reveal-now');
  await streamDestinyOpeningBubble(refs);
  return refs;
}

function startDestinyButterflyOrbit({fly,trails,getCenter,radiusX=24,radiusY=13}){
  let raf = 0;
  let running = true;
  let current = getCenter ? getCenter() : {x:0,y:0};
  const started = performance.now();
  const trailLags = [0.12, 0.22];
  function place(el,p,angle,scale,opacity){
    if(!el) return;
    el.style.opacity = opacity;
    el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%) scale(${scale}) rotate(${angle}deg)`;
  }
  function point(t,lag=0){
    const center = getCenter ? getCenter() : current;
    const a = (t - lag) * Math.PI * 2;
    return {
      x: center.x + Math.cos(a) * radiusX + Math.sin(a * .5) * 6,
      y: center.y + Math.sin(a) * radiusY + Math.cos(a * .7) * 4
    };
  }
  function tick(now){
    const t = (now - started) / 1100;
    const p = point(t);
    const ahead = point(t + .018);
    const angle = Math.max(-16, Math.min(16, Math.atan2(ahead.y - p.y, ahead.x - p.x) * 180 / Math.PI * .28));
    current = p;
    place(fly, p, angle, .82 + Math.sin(t * Math.PI * 2) * .05, 1);
    trails.forEach((trail,i)=>{
      const tp = point(t, trailLags[i]);
      place(trail, tp, angle * .7, i ? .56 : .74, i ? .34 : .48);
    });
    if(running) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return {
    stop(){
      running = false;
      if(raf) cancelAnimationFrame(raf);
      return current;
    }
  };
}

function getDestinyBubbleOrbitAnchor(refs){
  const p = getDestinyBubbleMarkAnchor(refs);
  return { x:p.x - 12, y:p.y - 18 };
}

function animateDestinyFlight({fly,trails,sx,sy,getTarget,duration=1120,loopPower=32,fadeIn=true,smoothTarget=false}){
  const start = { x:sx, y:sy };
  const trailLags = [0.08, 0.18];
  return new Promise(resolve => {
    const started = performance.now();
    const initialTarget = getTarget();
    let smoothedTarget = { ...initialTarget };
    function ease(t){
      return t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
    }
    function mix(a,b,t){ return a + (b - a) * t; }
    function route(t){
      const latest = smoothTarget ? smoothedTarget : getTarget();
      const blend = Math.max(0, (t - .55) / .45);
      const end = {
        x: mix(initialTarget.x, latest.x, blend),
        y: mix(initialTarget.y, latest.y, blend)
      };
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const loop = Math.sin(t * Math.PI * 2.25) * (1 - t) * loopPower;
      const lift = Math.sin(t * Math.PI) * Math.max(18, loopPower * 1.35);
      const drift = Math.sin(t * Math.PI * 1.1) * 18;
      return {
        x: start.x + dx * ease(t) + drift + loop,
        y: start.y + dy * ease(t) - lift + Math.sin(t * Math.PI * 4.1) * (1 - t) * 10
      };
    }
    function place(el,p,angle,scale,opacity){
      if(!el) return;
      el.style.opacity = opacity;
      el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%) scale(${scale}) rotate(${angle}deg)`;
    }
    function tick(now){
      const raw = Math.min(1, (now - started) / duration);
      if(smoothTarget){
        const latest = getTarget();
        const targetEase = raw >= 1 ? 1 : (raw > .82 ? .46 : .18);
        smoothedTarget = {
          x: mix(smoothedTarget.x, latest.x, targetEase),
          y: mix(smoothedTarget.y, latest.y, targetEase)
        };
      }
      const t = raw;
      const p = route(t);
      const ahead = route(Math.min(1, t + .018));
      const d = { x:ahead.x - p.x, y:ahead.y - p.y };
      const angle = Math.max(-18, Math.min(18, Math.atan2(d.y, d.x) * 180 / Math.PI * .32));
      const flyOpacity = fadeIn ? (raw < .08 ? raw / .08 : 1) : 1;
      const scale = .82 + Math.sin(raw * Math.PI) * .18 - raw * .12;
      place(fly, p, angle, scale, flyOpacity);
      trails.forEach((trail,i)=>{
        const tt = Math.max(0, raw - trailLags[i]);
        const tp = route(tt);
        const tpa = route(Math.min(1, tt + .018));
        const td = { x:tpa.x - tp.x, y:tpa.y - tp.y };
        const ta = Math.atan2(td.y, td.x) * 180 / Math.PI * .25;
        const op = raw < trailLags[i] ? 0 : Math.max(0, Math.min(.75, (1 - raw) * 1.15));
        place(trail, tp, ta, i ? .58 : .78, op);
      });
      if(raw < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

function animateDestinyDirectFlight({fly,trails,sx,sy,getTarget,duration=360,wave=8,fadeIn=true}){
  const start = { x:sx, y:sy };
  const trailLags = [0.07, 0.14];
  return new Promise(resolve => {
    const started = performance.now();
    const initialTarget = getTarget();
    function ease(t){ return 1 - Math.pow(1 - t, 3); }
    function mix(a,b,t){ return a + (b - a) * t; }
    function route(t){
      const latest = getTarget();
      const blend = Math.max(0, (t - .35) / .65);
      const end = {
        x: mix(initialTarget.x, latest.x, blend),
        y: mix(initialTarget.y, latest.y, blend)
      };
      const p = ease(t);
      return {
        x: mix(start.x, end.x, p),
        y: mix(start.y, end.y, p) + Math.sin(t * Math.PI * 2) * wave * (1 - Math.abs(t - .5) * .7)
      };
    }
    function place(el,p,angle,scale,opacity){
      if(!el) return;
      el.style.opacity = opacity;
      el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%) scale(${scale}) rotate(${angle}deg)`;
    }
    function tick(now){
      const raw = Math.min(1, (now - started) / duration);
      const p = route(raw);
      const ahead = route(Math.min(1, raw + .025));
      const angle = Math.max(-14, Math.min(14, Math.atan2(ahead.y - p.y, ahead.x - p.x) * 180 / Math.PI * .28));
      const opacity = fadeIn && raw < .06 ? raw / .06 : 1;
      place(fly, p, angle, .9 - raw * .06, opacity);
      trails.forEach((trail,i)=>{
        const tt = Math.max(0, raw - trailLags[i]);
        const tp = route(tt);
        const op = raw < trailLags[i] ? 0 : Math.max(0, Math.min(.5, (1 - raw) * .9));
        place(trail, tp, angle * .6, i ? .52 : .7, op);
      });
      if(raw < 1) requestAnimationFrame(tick);
      else resolve();
    }
    requestAnimationFrame(tick);
  });
}

function getDestinyBubbleMarkAnchor(refs){
  const host = $('chatScreen') || document.body;
  const metrics = getHostCoordinateMetrics(host);
  const area = $('chatArea');
  const mark = refs?.mark;
  const bfly = mark?.querySelector('.dst-bubble-bfly');
  const bubRect = refs?.bub?.getBoundingClientRect();
  if(bubRect?.width && mark && bfly){
    const bubPoint = rectToHostPoint(bubRect, host, metrics);
    return {
      x: bubPoint.x + mark.offsetLeft + bfly.offsetLeft + bfly.offsetWidth / 2,
      y: bubPoint.y + mark.offsetTop + bfly.offsetTop + bfly.offsetHeight / 2
    };
  }
  const areaLeft = area?.offsetLeft ?? 12;
  const areaW = area?.offsetWidth || 351;
  const screenH = host.offsetHeight || 812;
  const bubbleW = Math.min(areaW * .82, 288);
  const inputClearance = 140;
  const chatPaddingBottom = 50;
  if(metrics.rect.width){
    return {
      x: areaLeft + 18,
      y: screenH - inputClearance - chatPaddingBottom - 42
    };
  }
  return { x: 34, y: screenH - 190 };
}

function waitForStableElement(el){
  if(!el) return nextFrame();
  return new Promise(resolve => {
    let lastW = -1;
    let lastH = -1;
    let stableFrames = 0;
    let frames = 0;
    const check = () => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if(w === lastW && h === lastH) stableFrames++;
      else stableFrames = 0;
      lastW = w;
      lastH = h;
      frames++;
      if(stableFrames >= 3 || frames >= 18){
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

async function collapseDestinyBoxToEmotion(){
  const cap = $('emoTag');
  const parent = $('chatScreen') || cap?.offsetParent;
  if(!cap || !parent) return;
  const parentRect = parent.getBoundingClientRect();
  const parentW = parent.offsetWidth || parentRect.width;
  const scale = parentRect.width && parentW ? parentRect.width / parentW : 1;
  const rect = cap.getBoundingClientRect();
  const startLeft = (rect.left - parentRect.left) / scale;
  const startW = rect.width / scale;
  const startH = rect.height / scale;
  const target = measureEmotionCapsule();
  const targetW = target.width || 72;
  const targetH = target.height || 36;
  const targetLeft = (parentW - targetW) / 2;

  cap.classList.add('dst-no-transition');
  cap.style.left = startLeft + 'px';
  cap.style.right = 'auto';
  cap.style.transform = 'none';
  cap.style.width = startW + 'px';
  cap.style.height = startH + 'px';
  cap.style.overflow = 'hidden';
  cap.innerHTML = getCurrentEmotionCapsuleHTML();
  cap.className = 'emo-tag dst-collapse-to-emotion dst-no-transition';
  void cap.offsetWidth;
  cap.classList.remove('dst-no-transition');
  cap.style.left = targetLeft + 'px';
  cap.style.width = targetW + 'px';
  cap.style.height = targetH + 'px';
  await delay(620);
  $('chatScreen')?.classList.remove('has-os-capsule');
  $('chatScreen')?.style.removeProperty('--os-capsule-height');
  cap.classList.remove('dst-collapse-to-emotion','dst-no-transition');
  cap.style.cssText = '';
  if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
}

function getCurrentEmotionCapsuleHTML(){
  const st = storyState[currentStoryChar] || {};
  const tag = st.emotion?.tag || 'peaceful';
  return `<span class="emo-tag-emoji" id="emoTagEmoji">${EMOTION_SVG[tag] || EMOTION_SVG.peaceful}</span><span class="emo-tag-text" id="emoTagText">${escapeHTML(EMOTION_NAMES[tag] || '平静')}</span>`;
}

function measureEmotionCapsule(){
  const parent = $('chatScreen') || document.body;
  const probe = document.createElement('div');
  probe.className = 'emo-tag dst-measure-emotion';
  probe.innerHTML = getCurrentEmotionCapsuleHTML().replace(/id="[^"]+"/g, '');
  parent.appendChild(probe);
  const size = { width: probe.offsetWidth, height: probe.offsetHeight };
  probe.remove();
  return size;
}

/* ---------- 注入后续对话的 system prompt ---------- */
function getDestinySystemContext(charName){
  const st = storyState[charName];
  const d = st && st.activeDestiny;
  if(!d) return '';
  return `\n\n【正在经历的命运：${d.title}（${d.type}）】\n你和用户正处在这样一个情境中：\n${d.opening}\n演绎指引（仅供你把握分寸与走向，不要照搬复述，更不要把这些幕后说明暴露给用户）：\n${d.core}\n请自然地延续这个情境继续对话，保持时间、地点、人物状态、剧情的连贯，不要推翻刚刚发生的事。`;
}

/* ---------- DOLO 世界探索 ---------- */
function maybeTriggerWorldExploration(userText){
  const text = String(userText || '').trim().toUpperCase();
  if(text !== 'DOLO') return false;
  if(typeof isAbsentMode !== 'undefined' && isAbsentMode) return false;
  if(isDestinyVisible() || enteringDestiny) return false;
  const destiny = ensureDoloDestiny(currentStoryChar);
  isAnimating = true;
  runDestiny(destiny, 'DOLO', {
    suppressNormalReply:true,
    revealUserText:'（用户输入了关键词 DOLO，一个具有时间回溯能力的奇幻生物突然出现，强行开启回到17岁的注定命运。）'
  }).catch(e => {
    console.error('trigger DOLO destiny error:', e);
    isAnimating = false;
  });
  return true;
}

function getDoloWorldExploreInfo(){
  return {
    title: '世界探索',
    desc: '去找DOLO聊聊，探寻礼堂坍塌的秘密',
    image: 'assets/dolo.png',
    triggeredAt: Date.now()
  };
}

function renderWorldExploreCapsule(info){
  appendWorldExploreBubble(info);
}

function appendWorldExploreBubble(info = getDoloWorldExploreInfo()){
  const area = $('chatArea');
  if(!area) return;
  const st = storyState[currentStoryChar];
  if(st) st.worldExploreActive = info;
  const row = document.createElement('div');
  row.className = 'chat-row chat-row-left world-explore-row';
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'chat-bubble world-explore-bubble';
  card.onclick = () => {
    openWorldExploreFromBubble();
  };
  card.innerHTML = `
    <span class="world-explore-avatar"><img src="${escapeHTML(info?.image || 'assets/dolo.png')}" alt=""></span>
    <span class="world-explore-copy">
      <span class="world-explore-title">${escapeHTML(info?.title || '世界探索')}</span>
      <span class="world-explore-desc">${escapeHTML(info?.desc || '去找DOLO聊聊，探寻礼堂坍塌的秘密')}</span>
    </span>
    <span class="material-symbols-rounded world-explore-arrow" aria-hidden="true">chevron_right</span>`;
  row.appendChild(card);
  area.appendChild(row);
  if(typeof scrollChat === 'function') scrollChat();
  if(typeof addFeedEntry === 'function'){
    try{ addFeedEntry(currentStoryChar, '世界探索 · 去找DOLO聊聊', (typeof CHAR_POSITIONS!=='undefined' ? CHAR_POSITIONS[currentStoryChar] : '') || '', 'emotion'); }catch(e){}
  }
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();
}

function openWorldExploreFromBubble(){
  if(typeof syncChatBgm === 'function') syncChatBgm();
  if(typeof renderWorld === 'function') renderWorld();
  if(typeof setWorldLevel === 'function') setWorldLevel(true);
  const ws = $('worldScreen');
  if(ws){
    ws.classList.remove('slide-up');
    ws.style.clipPath = '';
    ws.classList.add('on');
  }
  if(typeof syncChatBgm === 'function') syncChatBgm();
  if(typeof syncWorldBgm === 'function') syncWorldBgm();
  setTimeout(() => {
    if(typeof scrollWorldToLocation === 'function') scrollWorldToLocation('DOLO屋');
    else if(typeof scheduleCenterWorldMap === 'function') scheduleCenterWorldMap();
  }, 420);
  if(typeof startWorldEventTimer === 'function') startWorldEventTimer();
  if(typeof startWorldCardRotation === 'function') startWorldCardRotation();
  if(typeof scheduleWorldEntryScheduleBubbles === 'function') scheduleWorldEntryScheduleBubbles();
}

function closeWorldExploreCapsule(e){
  if(e && e.stopPropagation) e.stopPropagation();
  const st = storyState[currentStoryChar];
  if(st) st.worldExploreActive = null;
  const capsule = $('emoTag');
  if(capsule){
    capsule.classList.remove('has-potential-destiny','capsule-world-explore');
    capsule.style.cssText = '';
  }
  if(typeof renderCapsuleEmotion === 'function') renderCapsuleEmotion();
  if(typeof saveCurrentStory === 'function') saveCurrentStory();
  if(typeof saveAppState === 'function') saveAppState();
}

/* ---------- 调试入口 ---------- */
const APP2_BEIDOU_DEBUG_DESTINY_IDS = ['app2_beidou_day1_destiny','app2_beidou_day1_destiny2'];

function ensureApp2DebugBeidouDestinies(){
  const ensured = [];
  ['ensureApp2BeidouDestiny','ensureApp2BeidouDestiny2'].forEach(fnName => {
    try{
      const fn = window[fnName];
      if(typeof fn === 'function'){
        const destiny = fn();
        if(destiny) ensured.push(destiny);
      }
    }catch(e){}
  });
  APP2_BEIDOU_DEBUG_DESTINY_IDS.forEach(id => {
    const destiny = pool().find(x => x.id === id);
    if(destiny) ensured.push(destiny);
  });
  const seen = new Set();
  return ensured.filter(d => d?.id && !seen.has(d.id) && seen.add(d.id));
}

function isApp2DebugBeidouDestiny(id){
  return APP2_BEIDOU_DEBUG_DESTINY_IDS.includes(String(id || ''));
}

async function debugTriggerApp2BeidouDestiny(id){
  const destiny = ensureApp2DebugBeidouDestinies().find(d => d.id === id) || pool().find(d => d.id === id);
  if(!destiny){ if(typeof showToast === 'function') showToast('没有找到北斗真注定命运'); return; }
  if(typeof openApp2SingleChat === 'function') openApp2SingleChat('北斗真');
  if(typeof app2ResetBeidouDestiny === 'function') app2ResetBeidouDestiny();
  if(typeof app2ShowBeidouDestiny === 'function'){
    await app2ShowBeidouDestiny(destiny);
    return;
  }
  isAnimating = true;
  await runDestiny(destiny, '（调试触发：北斗真注定命运）', {
    suppressNormalReply:true,
    revealUserText:'（调试触发北斗真的注定命运）',
    directOpeningOnly:id === 'app2_beidou_day1_destiny',
    skipPreludeVideo:true
  });
}

async function debugTriggerDestiny(id){
  if(isDestinyVisible()) return;
  if(isApp2DebugBeidouDestiny(id)){
    try{
      await debugTriggerApp2BeidouDestiny(id);
    }catch(e){
      console.error('debugTriggerApp2BeidouDestiny error:', e);
      isAnimating = false;
      if(typeof showToast === 'function') showToast('触发北斗真命运失败');
    }
    return;
  }
  const char = currentStoryChar;
  let d = id ? pool().find(x => x.id === id) : (untriggered(char)[0] || pool().find(x => x.char === char));
  if(!d){ if(typeof showToast === 'function') showToast('没有可触发的命运'); return; }
  isAnimating = true;
  runDestiny(d, '（调试触发）');
}

function debugTriggerDestinyPreset(typeKey, audience){
  if(isDestinyVisible()) return;
  const char = currentStoryChar;
  const desiredAudience = audience === 'multi' ? 'multi' : 'single';
  const desiredType = desiredAudience === 'multi' || typeKey === 'destined' ? 'destined' : 'potential';
  const list = pool().filter(x => x.char === char);
  let d = list.find(x => x.typeKey === desiredType && (x.audience || 'single') === desiredAudience);

  // 目前表里可能没有某个组合（例如「注定多人」），调试按钮仍需要可演示对应视觉/分支。
  if(!d && desiredAudience === 'multi'){
    const base = list.find(x => (x.audience || 'single') === 'multi') || list.find(x => x.typeKey === desiredType) || list[0];
    if(base) d = {
      ...base,
      id: `debug-${desiredType}-${desiredAudience}-${char}`,
      typeKey: desiredType,
      type: desiredType === 'destined' ? '注定的命运' : '潜在的命运',
      audience: 'multi',
      participants: base.participants?.length ? base.participants : ['周往','夏季','叶恒'].filter(n => n !== char)
    };
  }
  if(!d){
    const base = list.find(x => x.typeKey === desiredType) || list[0];
    if(base) d = {
      ...base,
      id: `debug-${desiredType}-${desiredAudience}-${char}`,
      typeKey: desiredType,
      type: desiredType === 'destined' ? '注定的命运' : '潜在的命运',
      audience: desiredAudience
    };
  }

  if(!d){
    if(typeof showToast === 'function') showToast('没有可触发的命运');
    return;
  }
  isAnimating = true;
  runDestiny(d, `（调试触发：${d.type} · ${desiredAudience === 'multi' ? '多人' : '单人'}）`);
}

function refreshDestinyDebugSelect(){
  const sel = $('dstDebugSelect');
  if(!sel) return;
  const char = currentStoryChar;
  const previous = sel.value;
  const pinned = ensureApp2DebugBeidouDestinies();
  const pinnedIds = new Set(pinned.map(d => d.id));
  const list = [...pinned, ...pool().filter(x => x.char === char && !pinnedIds.has(x.id))];
  const done = triggeredSet(char);
  sel.innerHTML = list.map(d => {
    const mark = (APP2_BEIDOU_DEBUG_DESTINY_IDS.includes(d.id) ? triggeredSet(d.char || char) : done).includes(d.id) ? '✓ ' : '';
    const pinnedMark = APP2_BEIDOU_DEBUG_DESTINY_IDS.includes(d.id) ? '北斗真 · ' : '';
    const label = d.title || ((d.keywords && d.keywords.length) ? d.keywords.join('/') : (d.semantic ? '语义' : '—'));
    return `<option value="${escapeHTML(d.id)}">${mark}${typeLabel(d)}·${pinnedMark}${escapeHTML(label).slice(0,18)}</option>`;
  }).join('');
  if(previous && [...sel.options].some(opt => opt.value === previous)) sel.value = previous;
}

function debugTriggerSelectedDestiny(){
  const sel = $('dstDebugSelect');
  debugTriggerDestiny(sel ? sel.value : '');
}

/* 暴露到全局，供 inline onclick 与主脚本调用 */
window.maybeTriggerDestiny = maybeTriggerDestiny;
window.runDestiny = runDestiny;
window.generateBlackDestinies = generateBlackDestinies;
window.maybeTriggerWorldExploration = maybeTriggerWorldExploration;
window.closeWorldExploreCapsule = closeWorldExploreCapsule;
window.getDestinySystemContext = getDestinySystemContext;
window.typeLabel = typeLabel;
window.isDestinedType = isDestinedType;
window.destinyTypeClass = destinyTypeClass;
window.destinyAudienceClass = destinyAudienceClass;
window.getPotentialDestinyTriggerHTML = getPotentialDestinyTriggerHTML;
window.getReusableDestinyButterflyHTML = getReusableDestinyButterflyHTML;
window.getReusableDestinyFlightHTML = getReusableDestinyFlightHTML;
window.renderReusableDestinyButterflies = renderReusableDestinyButterflies;
window.playDestinyPreludeVideo = playDestinyPreludeVideo;
window.syncPotentialDestinyTrigger = syncPotentialDestinyTrigger;
window.withStablePotentialDestinyLayout = withStablePotentialDestinyLayout;
window.ignoreDestiny = ignoreDestiny;
window.postponeDestiny = postponeDestiny;
window.enterDestiny = enterDestiny;
window.debugTriggerDestiny = debugTriggerDestiny;
window.debugTriggerDestinyPreset = debugTriggerDestinyPreset;
window.debugTriggerSelectedDestiny = debugTriggerSelectedDestiny;
window.refreshDestinyDebugSelect = refreshDestinyDebugSelect;
window.showTriggeredDestinyCapsule = showTriggeredDestinyCapsule;
window.finishPendingDestinyCapsuleFlight = finishPendingDestinyCapsuleFlight;
window.clearPendingDestinyCapsuleFlight = clearPendingDestinyCapsuleFlight;
window.awakenPotentialDestinyTrigger = awakenPotentialDestinyTrigger;

document.addEventListener('DOMContentLoaded', () => {
  try{
    refreshDestinyDebugSelect();
    renderReusableDestinyButterflies(document);
    syncPotentialDestinyTrigger();
  }catch(e){}
});
window.addEventListener('resize', () => { try{ syncPotentialDestinyTrigger(); }catch(e){} });

})();
