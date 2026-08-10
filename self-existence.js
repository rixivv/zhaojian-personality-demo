/* 依赖 alive-demo.html 中的全局：$、escapeHTML、showToast、saveAppState、
 * USER_PROFILE、userSelfState、storyState、currentStoryChar、API_BASE、MODEL。
 */
(function(){
'use strict';

const MAX_INSIGHTS=24;
const MAX_RIPPLES=80;
const MAX_MEMORY_TAGS=80;
let lastMemoryAiAt=0;

function nowTime(ts=Date.now()){
  return new Date(ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
}

function safeText(value,max=160){
  return String(value||'').trim().replace(/\s+/g,' ').slice(0,max);
}

function getSelfState(){
  userSelfState=normalizeUserSelfState(userSelfState);
  return userSelfState;
}

function saveSelfState({quiet=false}={}){
  userSelfState=normalizeUserSelfState(userSelfState);
  if(typeof saveAppState==='function') saveAppState();
  if(!quiet&&typeof renderSelfExistenceScreen==='function') renderSelfExistenceScreen();
}

function profileFacts(){
  const state=getSelfState();
  const p=state.profile||{};
  const facts=[];
  if(USER_PROFILE?.nickname) facts.push(`昵称：${USER_PROFILE.nickname}`);
  if(USER_PROFILE?.mbti) facts.push(`MBTI：${USER_PROFILE.mbti}`);
  if(p.selfImage) facts.push(`自我感受：${p.selfImage}`);
  if(p.currentEmotion) facts.push(`反复出现的情绪：${p.currentEmotion}`);
  if(p.coreNeed) facts.push(`核心渴望：${p.coreNeed}`);
  if(p.fear) facts.push(`隐秘恐惧：${p.fear}`);
  if(p.relationshipPattern) facts.push(`靠近方式：${p.relationshipPattern}`);
  return facts;
}

function upsertMemoryTag(tag){
  if(!tag) return null;
  const type=safeText(tag.type||'note',24)||'note';
  const value=safeText(tag.value||tag.label||'',80);
  if(!value) return null;
  const state=getSelfState();
  const label=safeText(tag.label||getMemoryTypeLabel(type),24)||getMemoryTypeLabel(type);
  const key=(type+'|'+value).toLowerCase();
  const existing=state.memoryTags.find(item=>(String(item.type||'')+'|'+String(item.value||'')).toLowerCase()===key);
  const payload={
    type,
    label,
    value,
    importance:Number(tag.importance)||0.55,
    reason:safeText(tag.reason||'',80),
    source:safeText(tag.source||'chat',24),
    charName:safeText(tag.charName||currentStoryChar||'',24),
    time:Number(tag.time)||Date.now()
  };
  if(existing){
    Object.assign(existing,payload,{importance:Math.max(Number(existing.importance)||0,payload.importance)});
    return existing;
  }
  state.memoryTags.unshift(payload);
  if(state.memoryTags.length>MAX_MEMORY_TAGS) state.memoryTags.length=MAX_MEMORY_TAGS;
  return payload;
}

function getMemoryTypeLabel(type){
  return ({
    self_image:'自我',
    core_need:'需求',
    fear:'恐惧',
    desire:'渴望',
    emotion:'情绪',
    belief:'信念',
    defense:'防御',
    relationship_pattern:'关系',
    boundary:'边界',
    value:'价值',
    wound:'旧伤'
  })[type]||'内在';
}

function localExtractMemoryTags(text,meta={}){
  const src=String(text||'').trim();
  if(src.length<3) return [];
  const tags=[];
  const emotionWords=['焦虑','委屈','害怕','生气','孤独','空','麻木','疲惫','烦','难过','不甘心','羡慕','嫉妒','愧疚','羞耻'];
  const emotion=emotionWords.find(word=>src.includes(word));
  if(emotion) tags.push({type:'emotion',label:'情绪',value:emotion,importance:.68,reason:'用户透露了内在情绪'});

  const fearMatch=src.match(/(?:我)?(?:害怕|怕|恐惧|担心)([^。！？!?，,]{1,28})/);
  if(fearMatch) tags.push({type:'fear',label:'恐惧',value:safeText(fearMatch[1],40),importance:.78,reason:'用户说出了害怕的东西'});

  const needMatch=src.match(/(?:我)?(?:想要|希望|渴望|需要)([^。！？!?，,]{1,30})/);
  if(needMatch) tags.push({type:'core_need',label:'需求',value:safeText(needMatch[1],44),importance:.74,reason:'用户说出了想要的东西'});

  const selfMatch=src.match(/我(?:其实|总是|好像|经常|不太|很)?([^。！？!?，,]{1,24})(?:的人|这样|那样|吧)?/);
  if(selfMatch&&/(逞强|敏感|别扭|拧巴|慢热|胆小|要强|冷|热情|讨好|逃避|控制|在意|自卑|自恋)/.test(selfMatch[1])){
    tags.push({type:'self_image',label:'自我',value:safeText(selfMatch[1],36),importance:.62,reason:'用户描述了自我感受'});
  }

  if(/不敢靠近|想靠近|推开|躲开|逃|冷处理|装没事|嘴硬|讨好|试探/.test(src)){
    const value=(src.match(/(不敢靠近|想靠近|推开|躲开|逃|冷处理|装没事|嘴硬|讨好|试探)/)||[])[1];
    tags.push({type:'relationship_pattern',label:'关系',value,importance:.64,reason:'用户透露了靠近或防御方式'});
  }

  return tags.map(tag=>({...tag,source:meta.source||'chat',charName:meta.charName||currentStoryChar,time:Date.now()}));
}

function parseJsonObject(text){
  const raw=String(text||'').replace(/```json|```/g,'').trim();
  try{return JSON.parse(raw)}catch(e){}
  const match=raw.match(/\{[\s\S]*\}/);
  if(!match) return null;
  try{return JSON.parse(match[0])}catch(e){return null}
}

async function extractSelfMemoryWithAI(text,meta={}){
  if(!API_BASE) return;
  const recent=String(text||'').trim();
  if(recent.length<8) return;
  const now=Date.now();
  if(now-lastMemoryAiAt<8000) return;
  lastMemoryAiAt=now;
  const prompt=`你是命运屋背后的“内在画像”记录器。只提取能让角色和命运屋未来自然照见用户内心的内容，不要记录外在身份资料。

【用户输入】
${recent}

【输出 JSON】
{"tags":[{"type":"self_image|core_need|fear|desire|emotion|belief|defense|relationship_pattern|boundary|value|wound","label":"2-4字标签","value":"具体内容，40字内","importance":0.1到1,"reason":"为什么值得记住，20字内"}]}

规则：
- 只记录用户明确表达出的内在信息：自我感受、核心渴望、害怕什么、在关系里如何靠近/防御、信念、边界、旧伤、价值感来源。
- 禁止记录城市、职业、年龄、学校、公司、收入、现实身份等外在资料。
- 如果用户说了外在事件，只提取其背后的情绪/恐惧/渴望，不记录事件本身。
- 不要记录隐私敏感推断；不要诊断心理疾病。
- 没有值得记住的内容时输出 {"tags":[]}。`;
  try{
    const res=await fetch(API_BASE,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
      body:JSON.stringify({model:MODEL,stream:false,temperature:.2,max_tokens:220,messages:[{role:'user',content:prompt}]})
    });
    if(!res.ok) return;
    const json=await res.json();
    const data=parseJsonObject(json.choices?.[0]?.message?.content||'');
    const tags=Array.isArray(data?.tags)?data.tags:[];
    let changed=false;
    tags.slice(0,4).forEach(tag=>{
      const saved=upsertMemoryTag({...tag,source:'ai',charName:meta.charName||currentStoryChar,time:Date.now()});
      if(saved) changed=true;
    });
    if(changed){
      saveSelfState({quiet:true});
      if($('selfExistenceScreen')?.classList.contains('on')) renderSelfExistenceScreen();
    }
  }catch(e){
    console.warn('Self memory AI failed:',e);
  }
}

function createLocalInsight(){
  const facts=profileFacts();
  const tags=getSelfState().memoryTags||[];
  const charName=currentStoryChar||'有人';
  const emotion=getSelfState().profile.currentEmotion||tags.find(t=>t.type==='emotion')?.value||'还没说出口的那部分';
  const need=getSelfState().profile.coreNeed||tags.find(t=>t.type==='core_need'||t.type==='desire')?.value||'想被确认的地方';
  const text=facts.length
    ? `${charName}未必会说破，但他会记得：你表面接住很多事，心里真正晃动的是${emotion}，以及${need}。`
    : '命运屋还没有听见太多，但它已经知道：你不是旁观者，你的沉默本身也会改变牌面。';
  return {
    id:'insight-'+Date.now().toString(36),
    lens:charName,
    text,
    question:'你更怕被看见，还是没人看见？',
    source:'local',
    time:Date.now()
  };
}

async function callInsightAI(){
  const state=getSelfState();
  const recentChat=(storyState?.[currentStoryChar]?.chatHistory||[])
    .filter(m=>m.role!=='system')
    .slice(-8)
    .map(m=>`${m.role==='user'?'用户':currentStoryChar}：${m.content}`)
    .join('\n');
  const prompt=`你是 Livo 命运屋里的命运大师。请生成一段“照见”反馈，让用户觉得自己的内在动机、恐惧、渴望和关系模式被轻轻接住。

【用户内在画像】
${profileFacts().join('\n')||'暂无'}

【已被命运屋记住的内在切片】
${state.memoryTags.slice(0,10).map(t=>`- ${t.label}：${t.value}（${t.reason||'用户提到'}）`).join('\n')||'暂无'}

【最近涟漪】
${state.ripples.slice(0,6).map(r=>`- ${r.title}：${r.text}`).join('\n')||'暂无'}

【最近对话】
${recentChat||'暂无'}

请严格输出 JSON：
{"lens":"世界旁白/角色名","text":"一句 45-80 字的照见反馈","question":"一个 18 字内的追问"}

要求：
- 具体但留白，像命运大师翻牌时不经意说中用户。
- 只能引用内在信息，不要引用城市、职业、年龄、学校、公司等外在资料。
- 追问只能问一个内在问题。
- 不要像心理咨询报告、问卷或人生建议。
- 不要说“根据你的资料/我分析你”。`;
  const res=await fetch(API_BASE,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+API_KEY},
    body:JSON.stringify({model:MODEL,stream:false,temperature:.72,max_tokens:260,messages:[{role:'user',content:prompt}]})
  });
  if(!res.ok) throw new Error('Insight API '+res.status);
  const json=await res.json();
  const data=parseJsonObject(json.choices?.[0]?.message?.content||'');
  if(!data?.text) throw new Error('Invalid insight');
  return {
    id:'insight-'+Date.now().toString(36),
    lens:safeText(data.lens||currentStoryChar||'世界旁白',20),
    text:safeText(data.text,120),
    question:safeText(data.question||'你还想被怎样看见？',30),
    source:'ai',
    time:Date.now()
  };
}

window.openSelfExistenceScreen=function(){
  if(typeof openDestinyVoiceRoom==='function') openDestinyVoiceRoom();
};

window.closeSelfExistenceScreen=function(){
  const screen=$('selfExistenceScreen');
  if(!screen) return;
  screen.classList.remove('on');
  screen.setAttribute('aria-hidden','true');
};

window.renderSelfExistenceScreen=function(){
  const screen=$('selfExistenceScreen');
  if(!screen) return;
  const state=getSelfState();
  if($('selfHeroText')){
    $('selfHeroText').textContent='命运屋会从你的回答里听见那些没有被直接说出的渴望、恐惧和靠近方式。';
  }
  renderInsight(state.insights[0]);
  renderMemoryTags(state.memoryTags);
  renderRipples(state.ripples);
};

function renderInsight(insight){
  const meta=$('selfInsightMeta');
  const text=$('selfInsightText');
  const question=$('selfInsightQuestion');
  if(!insight){
    if(meta) meta.textContent='尚未照见';
    if(text) text.textContent='先说一句话，或补充一点现实中的你。世界会从细节里开始回应。';
    if(question) question.textContent='你现在最想让谁懂你一点？';
    return;
  }
  if(meta) meta.textContent=`${insight.lens||'世界旁白'} · ${nowTime(insight.time)}`;
  if(text) text.textContent=insight.text||'';
  if(question) question.textContent=insight.question||'你还想被怎样看见？';
}

function renderMemoryTags(tags=[]){
  const box=$('selfMemoryTags');
  if(!box) return;
  const list=tags.slice(0,16);
  if(!list.length){
    box.innerHTML='<div class="self-empty">还没有可召回的内在切片。去命运屋聊一聊，它会顺着你的回答慢慢照见你。</div>';
    return;
  }
  box.innerHTML=list.map(tag=>`<div class="self-memory-tag">
    <span>${escapeHTML(tag.label||getMemoryTypeLabel(tag.type))}</span>
    <b>${escapeHTML(tag.value||'')}</b>
  </div>`).join('');
}

function renderRipples(ripples=[]){
  const box=$('selfRippleList');
  if(!box) return;
  const list=ripples.slice(0,14);
  if(!list.length){
    box.innerHTML='<div class="self-empty">还没有涟漪。等你触发命运、改变角色或让世界动态带上你的痕迹，这里会记录下来。</div>';
    return;
  }
  box.innerHTML=list.map(item=>`<div class="self-ripple-item">
    <div class="self-ripple-dot"><span class="material-symbols-rounded">${escapeHTML(getRippleIcon(item.type))}</span></div>
    <div class="self-ripple-card">
      <div class="self-ripple-meta"><span>${escapeHTML(getRippleTypeLabel(item.type))}</span><em>${escapeHTML(nowTime(item.time))}</em></div>
      <div class="self-ripple-title">${escapeHTML(item.title||'世界有了变化')}</div>
      <div class="self-ripple-text">${escapeHTML(item.text||'')}</div>
    </div>
  </div>`).join('');
}

function getRippleIcon(type){
  return ({soul:'auto_awesome',destiny:'flutter_dash',world:'public',profile:'person',memory:'bookmark',chat:'forum'})[type]||'ripple';
}

function getRippleTypeLabel(type){
  return ({soul:'灵魂变化',destiny:'命运扰动',world:'世界动态',profile:'自我补充',memory:'被记住',chat:'对话回响'})[type]||'涟漪';
}

window.saveSelfExistenceProfile=function(){
  if(typeof openDestinyVoiceRoom==='function') openDestinyVoiceRoom();
  if(typeof showToast==='function') showToast('去命运屋聊聊，它会慢慢照见你');
};

window.generateSelfInsight=async function(){
  const btn=$('selfInsightBtn');
  if(btn){btn.disabled=true;btn.textContent='照见中';}
  try{
    const insight=await callInsightAI();
    const state=getSelfState();
    state.insights.unshift(insight);
    if(state.insights.length>MAX_INSIGHTS) state.insights.length=MAX_INSIGHTS;
    state.lastInsightAt=insight.time;
    recordSelfRipple({
      type:'chat',
      title:'世界重新照见了你',
      text:insight.text,
      save:false
    });
    saveSelfState({quiet:true});
  }catch(e){
    console.warn('Generate self insight failed:',e);
    const state=getSelfState();
    const insight=createLocalInsight();
    state.insights.unshift(insight);
    if(state.insights.length>MAX_INSIGHTS) state.insights.length=MAX_INSIGHTS;
    state.lastInsightAt=insight.time;
    saveSelfState({quiet:true});
  }finally{
    if(btn){btn.disabled=false;btn.textContent='重新照见';}
    renderSelfExistenceScreen();
  }
};

window.trackSelfMemoryFromUserText=function(text,meta={}){
  const local=localExtractMemoryTags(text,meta);
  let changed=false;
  local.forEach(tag=>{
    const saved=upsertMemoryTag(tag);
    if(saved) changed=true;
  });
  if(changed){
    recordSelfRipple({
      type:'memory',
      title:'命运屋记住了你的一个内在切片',
      text:`这些不必被说破，但未来可能被角色或命运屋轻轻照见。`,
      save:false
    });
    saveSelfState({quiet:true});
  }
  extractSelfMemoryWithAI(text,meta);
};

window.updateSelfAfterChatTurn=function({charName,userText,assistantText}={}){
  const state=getSelfState();
  if(state.insights.length===0&&(state.memoryTags.length>0||profileFacts().length>2)){
    const insight=createLocalInsight();
    state.insights.unshift(insight);
    state.lastInsightAt=insight.time;
    saveSelfState({quiet:true});
  }
  if($('selfExistenceScreen')?.classList.contains('on')) renderSelfExistenceScreen();
};

window.recordSelfRipple=function(event={}){
  const state=getSelfState();
  const time=Number(event.time)||Date.now();
  const title=safeText(event.title||'世界有了变化',80);
  const text=safeText(event.text||'',160);
  if(!title&&!text) return null;
  const key=safeText(event.key||[event.type||'ripple',event.charName||'',title,text].join('|'),220);
  const existing=state.ripples.find(item=>item.key===key);
  if(existing) return existing;
  const item={
    id:'ripple-'+time.toString(36)+'-'+Math.random().toString(36).slice(2,6),
    key,
    type:safeText(event.type||'world',20),
    title,
    text,
    charName:safeText(event.charName||currentStoryChar||'',24),
    ref:safeText(event.ref||'',120),
    time
  };
  state.ripples.unshift(item);
  if(state.ripples.length>MAX_RIPPLES) state.ripples.length=MAX_RIPPLES;
  if(event.save!==false) saveSelfState({quiet:true});
  if($('selfExistenceScreen')?.classList.contains('on')) renderSelfExistenceScreen();
  return item;
};

window.recordSelfRippleFromFeed=function(entry){
  if(!entry||entry.init) return;
  const text=String(entry.text||'');
  const type=String(entry.type||'world');
  if(type==='emotion'&&!/^触及命运|^触碰多人命运|^NPC世界探索|^世界探索/.test(text)) return;
  const memoryValues=(getSelfState().memoryTags||[]).slice(0,16).map(t=>String(t.value||'')).filter(v=>v&&v.length>=2);
  const userRelated=/你|你的|用户/.test(text)
    ||(USER_PROFILE?.nickname&&text.includes(USER_PROFILE.nickname))
    ||memoryValues.some(v=>text.includes(v));
  const destinyRelated=/命运/.test(text);
  if(type==='schedule'&&!userRelated) return;
  const rippleType=destinyRelated?'destiny':'world';
  recordSelfRipple({
    type:rippleType,
    title:destinyRelated?`${entry.char||'角色'}的命运被你触动`:`${entry.char||'角色'}的世界动态带上了你`,
    text:entry.location?`${entry.location}：${text}`:text,
    charName:entry.char,
    key:`feed|${entry.id||entry.time}`,
    time:entry.time||Date.now(),
    save:false
  });
};

window.syncSelfProfileFromUserProfile=function(){
  if(USER_PROFILE?.mbti) upsertMemoryTag({type:'profile',label:'MBTI',value:USER_PROFILE.mbti,importance:.45,reason:'新用户资料'});
};

window.buildSelfExistenceSystemContext=function(charName=currentStoryChar){
  const facts=profileFacts();
  const tags=getSelfState().memoryTags
    .slice()
    .sort((a,b)=>(Number(b.importance)||0)-(Number(a.importance)||0))
    .slice(0,8);
  if(!facts.length&&!tags.length) return '';
  const tagLines=tags.map(tag=>`- ${tag.label||getMemoryTypeLabel(tag.type)}：${tag.value}${tag.reason?'（'+tag.reason+'）':''}`).join('\n');
  return `\n\n【用户内在记忆】\n这些不是资料表，而是用户被命运屋和角色慢慢照见的内在切片。你可以偶尔自然地回应其中一处，让用户感到“我的内心被接住了”。\n${facts.length?'内在画像：'+facts.join('；')+'\n':''}${tagLines?'可召回内在切片：\n'+tagLines+'\n':''}使用规则：不要每轮都引用；不要说“根据你的资料”；不要提城市、职业、年龄、公司等外在身份；只在情绪、场景或关系自然适合时轻轻带出一个内在观察。`;
};

window.buildSelfExistenceScheduleContext=function(){
  const facts=profileFacts();
  const tags=getSelfState().memoryTags.slice(0,8);
  if(!facts.length&&!tags.length) return '';
  return `\n【照见内心取材】\n${facts.join('；')}\n${tags.map(t=>`- ${t.label}：${t.value}`).join('\n')}\n如果本条日程是用户关系线，可以自然取一个内在切片转化为角色动作：比如他察觉用户的逞强、怕被看见、想被确认、习惯逃开。不要引用城市、职业、年龄等外在资料。`;
};

window.buildSelfExistenceOracleContext=function(){
  const facts=profileFacts();
  const tags=getSelfState().memoryTags
    .slice()
    .sort((a,b)=>(Number(b.importance)||0)-(Number(a.importance)||0))
    .slice(0,10);
  const lines=[
    facts.length?`【命运屋已照见的内在画像】\n${facts.join('；')}`:'',
    tags.length?`【可继续追问的内在切片】\n${tags.map(t=>`- ${t.label||getMemoryTypeLabel(t.type)}：${t.value}${t.reason?'（'+t.reason+'）':''}`).join('\n')}`:''
  ].filter(Boolean).join('\n');
  return lines?`\n${lines}\n命运大师使用规则：顺着已有切片继续探，不要重复盘问；如果信息不足，就用隐喻式问题引导用户说出“害怕什么/渴望什么/如何确认自己存在”。`:'';
};

window.buildSelfExistenceFollowupContext=function(){
  const tags=getSelfState().memoryTags
    .slice()
    .sort((a,b)=>(Number(b.time)||0)-(Number(a.time)||0))
    .slice(0,5);
  if(!tags.length) return `\n【用户内在信息】暂时很少。角色可以偶尔用一个轻问题试探用户内在特征，但不要像问卷。`;
  return `\n【用户内在信息】\n${tags.map(t=>`- ${t.label||getMemoryTypeLabel(t.type)}：${t.value}`).join('\n')}\n追问规则：优先顺着这些内在信息追问一个更深的问题；不要问城市、职业、年龄等外在资料。`;
};

window.updateSelfAfterDestinyHouseTurn=function({userText,assistantText}={}){
  const state=getSelfState();
  const reply=safeText(assistantText,160);
  if(reply){
    state.insights.unshift({
      id:'oracle-'+Date.now().toString(36),
      lens:'命运屋',
      text:reply,
      question:'',
      source:'destiny_house',
      time:Date.now()
    });
    if(state.insights.length>MAX_INSIGHTS) state.insights.length=MAX_INSIGHTS;
    state.lastInsightAt=Date.now();
  }
  recordSelfRipple({
    type:'chat',
    title:'命运屋照见了你的一层内心',
    text:reply||'命运屋把你的回答收进了回声里。',
    save:false
  });
  saveSelfState({quiet:true});
};

document.addEventListener('DOMContentLoaded',()=>{
  renderSelfExistenceScreen();
});

})();
