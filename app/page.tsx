"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wordBanks, type WordEntry } from "./word-bank";
import customExamples from "../public/dicts/custom-examples.json";

type Stage = "setup" | "quiz" | "result";
type Provider = "deepseek" | "kimi" | "gemini";
type Question = { word: string; phonetic: string; options: string[]; answer: number; example?: string; exampleAudioId?: string; exampleSourceId?: number; exampleSourceUser?: string };
type WordStats = Record<string, { right: number; wrong: number; lastSeen: number }>;
type GeneratedQuestionResponse = { questions?: Question[]; error?: string };

const letters = ["A", "B", "C", "D"];
const bankCounts:Record<string,number>={"CET-4":2525,"CET-6":4112,"IELTS":3649,"PTE":3451,"TEM-4":4158,"TEM-8":9983,"TOEFL":5905};
const bankCache=new Map<string,WordEntry[]>();
const customExampleMap=new Map(customExamples.map(item=>[item.word.toLocaleLowerCase(),item]));

async function loadFullBank(library:string) {
  if(bankCache.has(library)) return bankCache.get(library)!;
  const base=window.location.hostname.endsWith("github.io")?"/WordLeap":"";
  const response=await fetch(`${base}/dicts/${library}.json`);
  if(!response.ok) throw new Error("完整词库载入失败");
  const entries=await response.json() as WordEntry[];
  bankCache.set(library,entries);
  return entries;
}

function shuffle<T>(items:T[]) {
  const copy=[...items];
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
  return copy;
}

function toQuestions(entries:WordEntry[], bank:WordEntry[]):Question[] {
  return entries.map(entry=>{
    const category=(entry.pos||"").split(/[\/:]/)[0];
    const correct=entry.meaning;
    const eligible=bank.filter(item=>item.word!==entry.word&&item.meaning.trim()&&item.meaning!==correct);
    const sameType=eligible.filter(item=>!category||(item.pos||"").startsWith(category));
    const seenMeanings=new Set([correct]);
    const distractors:WordEntry[]=[];
    for(const item of [...shuffle(sameType),...shuffle(eligible)]) {
      if(seenMeanings.has(item.meaning)) continue;
      seenMeanings.add(item.meaning);
      distractors.push(item);
      if(distractors.length===3) break;
    }
    const options=shuffle([correct,...distractors.map(item=>item.meaning)]);
    const custom=customExampleMap.get(entry.word.toLocaleLowerCase());
    return {word:entry.word,phonetic:entry.phonetic,options,answer:options.indexOf(correct),example:entry.example||custom?.example,exampleAudioId:entry.exampleSourceId?String(entry.exampleSourceId):custom?.audioId,exampleSourceId:entry.exampleSourceId,exampleSourceUser:entry.exampleSourceUser};
  });
}

async function generateOnGitHubPages(provider: Provider, key: string, payload: {library:string;count:number;weakWords:string[]}) {
  const prompt = `Create ${payload.count} ${payload.library} English vocabulary multiple-choice questions: show one English word with four Chinese meaning options. ${payload.weakWords.length ? `Prioritize these weak words: ${payload.weakWords.join(", ")}.` : "Use representative exam vocabulary."} Return valid JSON only as {"questions":[{"word":"","phonetic":"IPA","options":["","","",""],"answer":0,"example":"short natural English example"}]}. answer is zero-based. Exactly four distinct options.`;
  let response: Response; let content = "";
  if (provider === "gemini") {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify({system_instruction:{parts:[{text:"You are an expert vocabulary-test writer. Return accurate JSON only."}]},contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}})});
    const data = await response.json() as { error?: { message?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] }; if (!response.ok) throw new Error(data.error?.message||"Gemini 请求失败"); content=data.candidates?.[0]?.content?.parts?.[0]?.text||"";
  } else {
    const config=provider==="kimi"?{url:"https://api.moonshot.cn/v1/chat/completions",model:"kimi-k3"}:{url:"https://api.deepseek.com/chat/completions",model:"deepseek-v4-flash"};
    response=await fetch(config.url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},body:JSON.stringify({model:config.model,temperature:.7,response_format:{type:"json_object"},messages:[{role:"system",content:"You are an expert vocabulary-test writer. Produce accurate, unambiguous questions and valid JSON only."},{role:"user",content:prompt}]})});
    const data=await response.json() as { error?: { message?: string }; choices?: { message?: { content?: string } }[] }; if(!response.ok) throw new Error(data.error?.message||"AI 请求失败"); content=data.choices?.[0]?.message?.content||"";
  }
  return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/, "")) as GeneratedQuestionResponse;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("setup");
  const [library, setLibrary] = useState("CET-4");
  const [scope, setScope] = useState("新词学习");
  const [count, setCount] = useState(10);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [adaptive, setAdaptive] = useState(true);
  const [showApi, setShowApi] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<Provider>("deepseek");
  const [rememberKey, setRememberKey] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [apiStatus, setApiStatus] = useState("");
  const [wordStats, setWordStats] = useState<WordStats>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const apiModalRef = useRef<HTMLDivElement | null>(null);
  const apiTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [activeSet, setActiveSet] = useState<Question[]>(()=>toQuestions(wordBanks["CET-4"].slice(0,10),wordBanks["CET-4"]));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stats = localStorage.getItem("wordleap-stats");
        const savedProvider = (localStorage.getItem("wordleap-provider") || "deepseek") as Provider;
        const key = localStorage.getItem(`wordleap-api-key-${savedProvider}`);
        if (stats) setWordStats(JSON.parse(stats));
        setProvider(savedProvider);
        if (key) { setApiKey(key); setRememberKey(true); }
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const set = activeSet;
  const current = set[index % set.length];
  const total = Math.min(count, 20);
  const answeredCount = index + (selected === null ? 0 : 1);
  const accuracy = answeredCount === 0 ? 0 : Math.round((correct / answeredCount) * 100);
  const dueToday = useMemo(() => 12 + saved.length, [saved.length]);

  const speak = useCallback(() => {
    if (typeof window === "undefined") return;
    audioRef.current?.pause();
    window.speechSynthesis.cancel();
    const spokenWord=current.word;
    const base=window.location.hostname.endsWith("github.io")?"/WordLeap":"";
    const audio=new Audio(`${base}/audio/words/${encodeURIComponent(spokenWord)}.mp3`);
    audioRef.current=audio;
    let didFallback=false;
    const fallback=()=>{
      if(audioRef.current!==audio || didFallback) return;
      didFallback=true;
      const utterance=new SpeechSynthesisUtterance(spokenWord);
      utterance.lang="en-GB";
      utterance.rate=0.82;
      window.speechSynthesis.speak(utterance);
    };
    audio.onerror=fallback;
    audio.play().catch(fallback);
  }, [current.word]);

  useEffect(() => {
    if (stage === "quiz") speak();
    return () => { audioRef.current?.pause(); };
  }, [stage, speak]);

  useEffect(() => {
    function handleNextShortcut(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || stage !== "quiz" || selected === null || showApi) return;
      const target = event.target as HTMLElement | null;
      const interactive = target?.closest("input, textarea, select, button, a, [role='button']");
      const isAnsweredOption = interactive instanceof HTMLButtonElement && interactive.classList.contains("answerOption");
      if (target?.isContentEditable || (interactive && !isAnsweredOption)) return;
      event.preventDefault();
      if (index + 1 >= total) setStage("result");
      else { setIndex(value => value + 1); setSelected(null); }
    }

    window.addEventListener("keydown", handleNextShortcut);
    return () => window.removeEventListener("keydown", handleNextShortcut);
  }, [stage, selected, showApi, index, total]);

  useEffect(() => {
    if (!showApi) return;
    const modal=apiModalRef.current;
    const trigger=apiTriggerRef.current;
    const focusable=()=>Array.from(modal?.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])')||[]).filter(element=>!element.hasAttribute("disabled"));
    focusable()[0]?.focus();
    function handleDialogKeydown(event:KeyboardEvent) {
      if(event.key==="Escape") { event.preventDefault(); setShowApi(false); return; }
      if(event.key!=="Tab") return;
      const items=focusable();
      if(!items.length) return;
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first) { event.preventDefault(); last.focus(); }
      else if(!event.shiftKey&&document.activeElement===last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown",handleDialogKeydown);
    return ()=>{document.removeEventListener("keydown",handleDialogKeydown);trigger?.focus();};
  },[showApi]);

  async function startQuiz() {
    setGenerating(true); setApiStatus("正在载入完整词库…");
    let bank:WordEntry[];
    try { bank=await loadFullBank(library); setApiStatus(`✓ 已载入 ${bank.length.toLocaleString()} 个词`); }
    catch { bank=wordBanks[library]||wordBanks[library==="TEM-4"?"CET-6":library==="TEM-8"?"TOEFL":"IELTS"]; setApiStatus("完整词库暂时无法载入，已使用精选词库"); }
    let candidates=shuffle(bank);
    if(scope==="错题本") candidates=candidates.filter(item=>(wordStats[item.word]?.wrong||0)>0);
    if(scope==="复习词") candidates=candidates.filter(item=>(wordStats[item.word]?.lastSeen||0)>0);
    if(scope==="收藏词") candidates=candidates.filter(item=>saved.includes(item.word));
    if(scope==="新词学习") candidates.sort((a,b)=>(wordStats[a.word]?.lastSeen||0)-(wordStats[b.word]?.lastSeen||0));
    if(!candidates.length) candidates=shuffle(bank);
    if(!candidates.length) { setGenerating(false); setApiStatus("该词库暂时没有可用单词"); return; }
    if (adaptive) candidates.sort((a,b) => {
      const sa = wordStats[a.word] || {right:0,wrong:0,lastSeen:0};
      const sb = wordStats[b.word] || {right:0,wrong:0,lastSeen:0};
      return (sb.wrong * 3 - sb.right) - (sa.wrong * 3 - sa.right) || sa.lastSeen - sb.lastSeen;
    });
    else candidates=shuffle(candidates);
    let nextSet: Question[] = toQuestions(candidates.slice(0,count),bank);
    if (apiKey.trim()) {
      setApiStatus("AI 正在根据你的学习情况出题…");
      try {
        const allowedWords=new Set(bank.map(item=>item.word.trim().toLocaleLowerCase()));
        const payload={library,count:Math.min(count,10),weakWords:Object.entries(wordStats).filter(([word])=>allowedWords.has(word.trim().toLocaleLowerCase())).sort((a,b)=>b[1].wrong-a[1].wrong).slice(0,8).map(([w])=>w)};
        let data: GeneratedQuestionResponse;
        if (window.location.hostname.endsWith("github.io")) data=await generateOnGitHubPages(provider,apiKey.trim(),payload);
        else { const response = await fetch("/api/generate", { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${apiKey.trim()}`}, body:JSON.stringify({provider,...payload}) }); data=await response.json() as GeneratedQuestionResponse; if (!response.ok) throw new Error(data.error || "生成失败"); }
        if (Array.isArray(data.questions) && data.questions.length) {
          const approvedQuestions=(data.questions as Question[]).filter(question=>allowedWords.has(question.word.trim().toLocaleLowerCase())&&Array.isArray(question.options)&&question.options.length===4&&new Set(question.options.map(option=>option.trim())).size===4&&Number.isInteger(question.answer)&&question.answer>=0&&question.answer<4);
          nextSet = [...approvedQuestions,...nextSet.filter(q=>!approvedQuestions.some(ai=>ai.word===q.word))].slice(0,count);
        }
        setApiStatus("✓ 已生成专属智能题组");
      } catch (error) { setApiStatus(`未能生成新题，已使用内置题组：${error instanceof Error ? error.message : "请检查 Key"}`); }
    }
    setGenerating(false);
    setActiveSet(nextSet);
    setIndex(0); setSelected(null); setCorrect(0); setStreak(0); setMistakes([]); setStage("quiz");
  }

  function choose(option: number) {
    if (selected !== null) return;
    setSelected(option);
    const isRight = option === current.answer;
    if (isRight) { setCorrect(v => v + 1); setStreak(v => v + 1); }
    else { setMistakes(v => [...v, current.word]); setStreak(0); }
    setWordStats(previous => {
      const old = previous[current.word] || {right:0,wrong:0,lastSeen:0};
      const updated = {...previous,[current.word]:{right:old.right+(isRight?1:0),wrong:old.wrong+(isRight?0:1),lastSeen:Date.now()}};
      try { localStorage.setItem("wordleap-stats",JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function next() {
    if (index + 1 >= total) setStage("result");
    else { setIndex(v => v + 1); setSelected(null); }
  }

  function speakExample() {
    if (typeof window === "undefined") return;
    audioRef.current?.pause();
    window.speechSynthesis.cancel();
    const spokenExample=current.example;
    if(!spokenExample) return;
    const base=window.location.hostname.endsWith("github.io")?"/WordLeap":"";
    const audio=current.exampleAudioId ? new Audio(`${base}/audio/sentences/${current.exampleAudioId}.mp3`) : null;
    audioRef.current=audio;
    let didFallback=false;
    const fallback=()=>{
      if(audioRef.current!==audio || didFallback) return;
      didFallback=true;
      const utterance=new SpeechSynthesisUtterance(spokenExample);
      utterance.lang="en-GB";
      utterance.rate=0.82;
      window.speechSynthesis.speak(utterance);
    };
    if(!audio) { fallback(); return; }
    audio.onerror=fallback;
    audio.play().catch(fallback);
  }

  function toggleSave() {
    setSaved(v => v.includes(current.word) ? v.filter(w => w !== current.word) : [...v, current.word]);
  }

  function saveApiSettings() {
    try { localStorage.setItem("wordleap-provider",provider); if (rememberKey) localStorage.setItem(`wordleap-api-key-${provider}`,apiKey.trim()); else localStorage.removeItem(`wordleap-api-key-${provider}`); localStorage.removeItem("wordleap-api-key"); } catch {}
    setApiStatus(apiKey.trim() ? "✓ API Key 已就绪" : ""); setShowApi(false);
  }

  function changeProvider(next: Provider) {
    setProvider(next);
    try { const key=localStorage.getItem(`wordleap-api-key-${next}`)||""; setApiKey(key); setRememberKey(Boolean(key)); } catch { setApiKey(""); }
  }

  return (
    <main>
      <nav className="nav">
        <button className="brand" onClick={() => setStage("setup")}><span className="logo">W</span><span>WordLeap</span></button>
        <div className="navLinks"><button className="active">练习</button><button>词库</button><button>错题本 <span className="badge">{mistakes.length || 3}</span></button></div>
        <div className="navRight"><span className="day">🔥 <b>7</b> 天连续学习</span><button ref={apiTriggerRef} className={`apiNav ${apiKey?"connected":""}`} onClick={()=>setShowApi(true)}>✦ {apiKey?({deepseek:"DeepSeek",kimi:"Kimi",gemini:"Gemini"}[provider]):"AI 设置"}</button><button className="avatar">YL</button></div>
      </nav>

      {stage === "setup" && <section className="setup shell">
        <div className="hero">
          <div><p className="eyebrow">今日学习计划</p><h1>每一个单词，<br/><em>都是向前的一步。</em></h1><p className="sub">选择适合你的词库，开始今天的高效记忆。</p></div>
          <div className="todayCard"><div className="ring"><strong>18</strong><small>/ 30</small></div><div><b>今日已学</b><span>继续保持，快完成啦！</span></div><div className="miniStats"><span><b>{dueToday}</b> 待复习</span><span><b>86%</b> 正确率</span></div></div>
        </div>

        <div className="step"><div className="stepTitle"><span>01</span><div><h2>选择词库</h2><p>你想挑战哪个考试？</p></div></div>
          <div className="libraryGrid">
            {[["CET-4","英语四级","大学英语基础"],["CET-6","英语六级","进阶核心词汇"],["TEM-4","英语专四","专业阶段核心"],["TEM-8","英语专八","专业阶段进阶"],["IELTS","雅思","留学高频词汇"],["TOEFL","托福","学术场景词汇"],["PTE","PTE","培生学术英语"]].map(([id,name,desc]) => <button key={id} className={`libCard ${library===id?"chosen":""}`} onClick={()=>setLibrary(id)}><span className={`examIcon ${id.toLowerCase()}`}>{id === "IELTS" ? "I" : id === "TOEFL" ? "T" : id === "PTE" ? "P" : id.slice(-1)}</span><div><b>{name}</b><small>{desc}</small></div><span className="wordCount">{bankCounts[id].toLocaleString()}<small>核心词库</small></span>{library===id&&<i>✓</i>}</button>)}
          </div>
        </div>

        <div className="adaptiveBar"><div><span className="brain">✦</span><div><b>自适应学习</b><p>优先复习易错词，并根据掌握情况动态调整难度。</p></div></div><button className={`switch ${adaptive?"on":""}`} aria-label="切换自适应学习" onClick={()=>setAdaptive(v=>!v)}><i/></button></div>
        <div className="preferences"><div><label>学习范围</label><div className="segments">{["新词学习","复习词","错题本","收藏词"].map(s=><button key={s} onClick={()=>setScope(s)} className={scope===s?"on":""}>{s}</button>)}</div></div><div><label>本组题量</label><div className="segments count">{[5,10,15,20].map(n=><button key={n} onClick={()=>setCount(n)} className={count===n?"on":""}>{n} 题</button>)}</div></div><button className="start" disabled={generating} onClick={startQuiz}>{generating?"正在生成…":apiKey?"生成智能练习":"开始练习"} <span>→</span></button></div>
        {apiStatus&&<p className="apiStatus">{apiStatus}</p>}
      </section>}

      {stage === "quiz" && <section className="quizPage shell">
        <div className="quizTop"><button className="exit" onClick={()=>setStage("setup")}>× <span>退出练习</span></button><div className="progressWrap"><div className="progressMeta"><b>{library} · {scope}</b><span>{index + 1} / {total}</span></div><div className="progress"><i style={{width:`${((index+1)/total)*100}%`}}/></div></div><div className="liveStats"><span>🔥 <b>{streak}</b> 连对</span><span>◎ <b>{accuracy}%</b> 正确率</span></div></div>
        <div className="quizCard">
          <div className="questionLabel">选择正确的中文释义</div>
          <div className="wordDisplay"><h1>{current.word}</h1><button aria-label="播放发音" onClick={speak}>🔊</button></div>
          <div className="options">{current.options.map((option,i)=>{const state=selected===null?"":i===current.answer?"right":i===selected?"wrong":"dim";return <button key={option} className={`answerOption ${state}`.trim()} onClick={()=>choose(i)}><span>{letters[i]}</span><b>{option}</b>{selected!==null&&i===current.answer&&<i>✓</i>}{selected===i&&i!==current.answer&&<i>×</i>}</button>})}</div>
          {selected !== null && <div className={`feedback ${selected===current.answer?"success":"error"}`}><div className="feedbackHead"><span>{selected===current.answer?"✓":"×"}</span><div><b>{selected===current.answer?"回答正确！":"再想一想"}</b><small>{selected===current.answer?"做得很好，继续保持。":`正确答案是 ${letters[current.answer]}. ${current.options[current.answer]}`}</small></div></div><div className="wordInfo"><div><b>{current.word}</b> <span>{current.phonetic||"暂无音标"}</span><button onClick={speak}>🔊</button></div>{current.example?<><div className="exampleLine"><p>{current.example}</p><button aria-label="播放例句" title="播放例句" onClick={speakExample}>🔊</button></div>{current.exampleSourceId&&<a className="exampleSource" href={`https://tatoeba.org/en/sentences/show/${current.exampleSourceId}`} target="_blank" rel="noreferrer">例句来源：Tatoeba #{current.exampleSourceId}{current.exampleSourceUser?` · ${current.exampleSourceUser}`:""} · CC BY 2.0 FR</a>}</>:<p className="noExample">暂无可用例句</p>}</div><div className="feedbackActions"><button className={saved.includes(current.word)?"saved":""} onClick={toggleSave}>{saved.includes(current.word)?"★ 已收藏":"☆ 加入收藏"}</button><button className="next" onClick={next}>{index+1>=total?"查看结果":"下一题"} →</button></div></div>}
        </div>
      </section>}

      {stage === "result" && <section className="result shell"><div className="resultCard"><span className="trophy">★</span><p className="eyebrow">练习完成</p><h1>今天又进步了一点！</h1><p>你完成了 {library} 的一组词义选择练习。</p><div className="score"><strong>{Math.round(correct/total*100)}</strong><span>分</span></div><div className="resultStats"><div><b>{correct}</b><span>回答正确</span></div><div><b>{total-correct}</b><span>需要复习</span></div><div><b>{Math.max(streak,correct)}</b><span>最佳连对</span></div></div>{mistakes.length>0&&<div className="weak"><b>薄弱词汇</b><div>{[...new Set(mistakes)].map(w=><span key={w}>{w}</span>)}</div></div>}<div className="resultActions"><button onClick={()=>setStage("setup")}>返回首页</button><button className="start" onClick={startQuiz}>再练一组 →</button></div></div></section>}
      {showApi&&<div className="modalShade" onClick={()=>setShowApi(false)}><div ref={apiModalRef} className="apiModal" role="dialog" aria-modal="true" aria-labelledby="api-dialog-title" onClick={e=>e.stopPropagation()}><button className="modalClose" aria-label="关闭 AI 设置" onClick={()=>setShowApi(false)}>×</button><span className="apiSpark">✦</span><h2 id="api-dialog-title">连接 AI 智能出题</h2><p>选择你方便使用的服务商，系统会结合词库、题型和薄弱词汇生成专属练习。</p><label>AI 服务商</label><div className="providerGrid"><button className={provider==="deepseek"?"selected":""} onClick={()=>changeProvider("deepseek")}><b>DeepSeek</b><small>国内推荐</small></button><button className={provider==="kimi"?"selected":""} onClick={()=>changeProvider("kimi")}><b>Kimi</b><small>月之暗面</small></button><button className={provider==="gemini"?"selected":""} onClick={()=>changeProvider("gemini")}><b>Gemini</b><small>Google</small></button></div><label>{({deepseek:"DeepSeek",kimi:"Kimi",gemini:"Gemini"}[provider])} API Key</label><input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="请输入对应服务商的 API Key" autoComplete="off"/><small>Key 只发送给你选择的服务商，WordLeap 不会把它写入网站数据库。</small><label className="remember"><input type="checkbox" checked={rememberKey} onChange={e=>setRememberKey(e.target.checked)}/><span>保存在此设备，下次自动使用（共享设备请勿勾选）</span></label><button className="start modalSave" onClick={saveApiSettings}>保存设置</button><button className="clearKey" onClick={()=>{setApiKey("");setRememberKey(false);try{localStorage.removeItem(`wordleap-api-key-${provider}`)}catch{};setApiStatus("")}}>清除当前服务商的 Key</button></div></div>}
      <footer><span>WordLeap · 让每一次练习都算数</span><span>今日目标 30 词 · 已坚持 7 天</span></footer>
    </main>
  );
}
