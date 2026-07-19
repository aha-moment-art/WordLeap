"use client";

import { useMemo, useState } from "react";

type Mode = "meaning" | "cloze";
type Stage = "setup" | "quiz" | "result";

const questions = {
  meaning: [
    { word: "abandon", phonetic: "/əˈbændən/", options: ["获得", "放弃", "建立", "避免"], answer: 1, example: "They had to abandon the car in the snow." },
    { word: "vital", phonetic: "/ˈvaɪtl/", options: ["微小的", "古老的", "至关重要的", "自愿的"], answer: 2, example: "Regular exercise is vital for good health." },
    { word: "reluctant", phonetic: "/rɪˈlʌktənt/", options: ["不情愿的", "可靠的", "相关的", "放松的"], answer: 0, example: "She was reluctant to admit her mistake." },
    { word: "derive", phonetic: "/dɪˈraɪv/", options: ["描述", "减少", "推迟", "获得；源自"], answer: 3, example: "Many English words derive from Latin." },
    { word: "inevitable", phonetic: "/ɪnˈevɪtəbl/", options: ["看不见的", "不可避免的", "不合适的", "不准确的"], answer: 1, example: "Some changes are simply inevitable." },
  ],
  cloze: [
    { word: "abandon", phonetic: "/əˈbændən/", sentence: "He had to _____ the plan because it was too expensive.", options: ["abandon", "achieve", "protect", "improve"], answer: 0, example: "They had to abandon the car in the snow." },
    { word: "vital", phonetic: "/ˈvaɪtl/", sentence: "Clear communication is _____ to the success of any team.", options: ["vital", "rural", "formal", "equal"], answer: 0, example: "Regular exercise is vital for good health." },
    { word: "reluctant", phonetic: "/rɪˈlʌktənt/", sentence: "Tom was _____ to speak in front of the large audience.", options: ["eager", "reluctant", "likely", "ready"], answer: 1, example: "She was reluctant to admit her mistake." },
    { word: "derive", phonetic: "/dɪˈraɪv/", sentence: "The word 'planet' _____ from an ancient Greek term.", options: ["protects", "prevents", "derives", "delivers"], answer: 2, example: "Many English words derive from Latin." },
    { word: "inevitable", phonetic: "/ɪnˈevɪtəbl/", sentence: "With such rapid growth, change seems _____.", options: ["inevitable", "invisible", "individual", "informal"], answer: 0, example: "Some changes are simply inevitable." },
  ],
};

const letters = ["A", "B", "C", "D"];

export default function Home() {
  const [stage, setStage] = useState<Stage>("setup");
  const [mode, setMode] = useState<Mode>("meaning");
  const [library, setLibrary] = useState("CET-4");
  const [scope, setScope] = useState("新词学习");
  const [count, setCount] = useState(10);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);

  const set = questions[mode];
  const current = set[index % set.length];
  const total = Math.min(count, 20);
  const accuracy = index === 0 ? 0 : Math.round((correct / index) * 100);
  const dueToday = useMemo(() => 12 + saved.length, [saved.length]);

  function startQuiz() {
    setIndex(0); setSelected(null); setCorrect(0); setStreak(0); setMistakes([]); setStage("quiz");
  }

  function choose(option: number) {
    if (selected !== null) return;
    setSelected(option);
    if (option === current.answer) { setCorrect(v => v + 1); setStreak(v => v + 1); }
    else { setMistakes(v => [...v, current.word]); setStreak(0); }
  }

  function next() {
    if (index + 1 >= total) setStage("result");
    else { setIndex(v => v + 1); setSelected(null); }
  }

  function speak() {
    if (typeof window === "undefined") return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(current.word); u.lang = "en-GB"; u.rate = 0.82;
    window.speechSynthesis.speak(u);
  }

  function toggleSave() {
    setSaved(v => v.includes(current.word) ? v.filter(w => w !== current.word) : [...v, current.word]);
  }

  return (
    <main>
      <nav className="nav">
        <button className="brand" onClick={() => setStage("setup")}><span className="logo">W</span><span>WordLeap</span></button>
        <div className="navLinks"><button className="active">练习</button><button>词库</button><button>错题本 <span className="badge">{mistakes.length || 3}</span></button></div>
        <div className="navRight"><span className="day">🔥 <b>7</b> 天连续学习</span><button className="avatar">YL</button></div>
      </nav>

      {stage === "setup" && <section className="setup shell">
        <div className="hero">
          <div><p className="eyebrow">今日学习计划</p><h1>每一个单词，<br/><em>都是向前的一步。</em></h1><p className="sub">选择适合你的词库和练习方式，开始今天的高效记忆。</p></div>
          <div className="todayCard"><div className="ring"><strong>18</strong><small>/ 30</small></div><div><b>今日已学</b><span>继续保持，快完成啦！</span></div><div className="miniStats"><span><b>{dueToday}</b> 待复习</span><span><b>86%</b> 正确率</span></div></div>
        </div>

        <div className="step"><div className="stepTitle"><span>01</span><div><h2>选择词库</h2><p>你想挑战哪个考试？</p></div></div>
          <div className="libraryGrid">
            {[["CET-4","英语四级","4,500","大学英语基础"],["CET-6","英语六级","6,000","进阶核心词汇"],["IELTS","雅思","7,500","留学高频词汇"],["TOEFL","托福","8,000","学术场景词汇"]].map(([id,name,num,desc]) => <button key={id} className={`libCard ${library===id?"chosen":""}`} onClick={()=>setLibrary(id)}><span className={`examIcon ${id.toLowerCase()}`}>{id === "IELTS" ? "I" : id === "TOEFL" ? "T" : id.slice(-1)}</span><div><b>{name}</b><small>{desc}</small></div><span className="wordCount">{num}<small>词</small></span>{library===id&&<i>✓</i>}</button>)}
          </div>
        </div>

        <div className="step"><div className="stepTitle"><span>02</span><div><h2>选择练习方式</h2><p>用你喜欢的方式巩固记忆</p></div></div>
          <div className="modeGrid">
            <button className={`modeCard ${mode==="meaning"?"chosen":""}`} onClick={()=>setMode("meaning")}><span className="modeIcon">译</span><div><b>单词选择释义</b><p>看英文单词，从四个中文释义中选出正确答案。</p><small>适合快速记忆词义</small></div><i>→</i></button>
            <button className={`modeCard ${mode==="cloze"?"chosen":""}`} onClick={()=>setMode("cloze")}><span className="modeIcon purple">填</span><div><b>句子填空选词</b><p>结合句子语境，从四个单词中选出最佳答案。</p><small>适合掌握实际用法</small></div><i>→</i></button>
          </div>
        </div>

        <div className="preferences"><div><label>学习范围</label><div className="segments">{["新词学习","复习词","错题本","收藏词"].map(s=><button key={s} onClick={()=>setScope(s)} className={scope===s?"on":""}>{s}</button>)}</div></div><div><label>本组题量</label><div className="segments count">{[5,10,15,20].map(n=><button key={n} onClick={()=>setCount(n)} className={count===n?"on":""}>{n} 题</button>)}</div></div><button className="start" onClick={startQuiz}>开始练习 <span>→</span></button></div>
      </section>}

      {stage === "quiz" && <section className="quizPage shell">
        <div className="quizTop"><button className="exit" onClick={()=>setStage("setup")}>× <span>退出练习</span></button><div className="progressWrap"><div className="progressMeta"><b>{library} · {scope}</b><span>{index + 1} / {total}</span></div><div className="progress"><i style={{width:`${((index+1)/total)*100}%`}}/></div></div><div className="liveStats"><span>🔥 <b>{streak}</b> 连对</span><span>◎ <b>{index ? accuracy : 100}%</b> 正确率</span></div></div>
        <div className="quizCard">
          <div className="questionLabel">{mode === "meaning" ? "选择正确的中文释义" : "选择最适合填入空格的单词"}</div>
          {mode === "meaning" ? <div className="wordDisplay"><h1>{current.word}</h1><button aria-label="播放发音" onClick={speak}>🔊</button></div> : <h2 className="sentence">{current.sentence}</h2>}
          <div className="options">{current.options.map((option,i)=>{const state=selected===null?"":i===current.answer?"right":i===selected?"wrong":"dim";return <button key={option} className={state} onClick={()=>choose(i)}><span>{letters[i]}</span><b>{option}</b>{selected!==null&&i===current.answer&&<i>✓</i>}{selected===i&&i!==current.answer&&<i>×</i>}</button>})}</div>
          {selected !== null && <div className={`feedback ${selected===current.answer?"success":"error"}`}><div className="feedbackHead"><span>{selected===current.answer?"✓":"×"}</span><div><b>{selected===current.answer?"回答正确！":"再想一想"}</b><small>{selected===current.answer?"做得很好，继续保持。":`正确答案是 ${letters[current.answer]}. ${current.options[current.answer]}`}</small></div></div><div className="wordInfo"><div><b>{current.word}</b> <span>{current.phonetic}</span><button onClick={speak}>🔊</button></div><p>{current.example}</p></div><div className="feedbackActions"><button className={saved.includes(current.word)?"saved":""} onClick={toggleSave}>{saved.includes(current.word)?"★ 已收藏":"☆ 加入收藏"}</button><button className="next" onClick={next}>{index+1>=total?"查看结果":"下一题"} →</button></div></div>}
        </div>
      </section>}

      {stage === "result" && <section className="result shell"><div className="resultCard"><span className="trophy">★</span><p className="eyebrow">练习完成</p><h1>今天又进步了一点！</h1><p>你完成了 {library} 的一组 {mode === "meaning" ? "词义选择" : "句子填空"} 练习。</p><div className="score"><strong>{Math.round(correct/total*100)}</strong><span>分</span></div><div className="resultStats"><div><b>{correct}</b><span>回答正确</span></div><div><b>{total-correct}</b><span>需要复习</span></div><div><b>{Math.max(streak,correct)}</b><span>最佳连对</span></div></div>{mistakes.length>0&&<div className="weak"><b>薄弱词汇</b><div>{[...new Set(mistakes)].map(w=><span key={w}>{w}</span>)}</div></div>}<div className="resultActions"><button onClick={()=>setStage("setup")}>返回首页</button><button className="start" onClick={startQuiz}>再练一组 →</button></div></div></section>}
      <footer><span>WordLeap · 让每一次练习都算数</span><span>今日目标 30 词 · 已坚持 7 天</span></footer>
    </main>
  );
}
