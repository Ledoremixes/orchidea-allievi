import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "../lib/supabaseClient.js";
import "./GameNight.css";
import Tombola from "./Tombola.jsx";
import Wheel from "./Wheel.jsx";

const games = {
 quiz: ["Quiz Orchidea","?","Rispondi prima che scada il tempo."],
 impostor: ["L’impostore","◈","Scopri chi ha ricevuto una parola diversa."],
 wheel: ["Ruota della fortuna","✺","Scopri il tuo premio."],
 tombola: ["Tombola Orchidea","●","Estrai i numeri e completa la tua cartella."],
};
const templates = {
 quiz: {prompt:"Da quale paese proviene la bachata?",options:["Cuba","Repubblica Dominicana","Colombia","Portorico"],answer:1,seconds:20,points:100},
 impostor:{prompt:"L’impostore: a turno date un indizio senza dire la parola.",options:["Bachata"],seconds:300,points:100},
 wheel:{prompt:"Gira la ruota!",options:["Drink omaggio","Ingresso omaggio","Lezione omaggio","Riprova la prossima volta"],seconds:300,points:0},
};
const impostorDefaults=()=>({kind:"impostor",commonWord:"Salsa",impostorWord:"Bachata",seconds:300,points:100});
function ImpostorEditor({draft,setDraft,disabled,onStart,demo,asImpostor,setAsImpostor}){
 return <div className="gn-stage gn-admin"><h3>Configura L’impostore</h3><label>Parola dei partecipanti<input maxLength={250} value={draft.commonWord} onChange={e=>setDraft({...draft,commonWord:e.target.value})} placeholder="Es. Salsa"/></label><label>Parola dell’impostore<input maxLength={250} value={draft.impostorWord} onChange={e=>setDraft({...draft,impostorWord:e.target.value})} placeholder="Es. Bachata"/></label><p>Scegli due parole diverse ma simili. Ogni giocatore riceve solo la propria parola.</p><div className="gn-editor-row"><label>Secondi<input type="number" min="10" max="1800" value={draft.seconds} onChange={e=>setDraft({...draft,seconds:e.target.value})}/></label><label>Punti<input type="number" min="0" max="1000" value={draft.points} onChange={e=>setDraft({...draft,points:e.target.value})}/></label></div>{demo&&<label>Ruolo da provare<select value={asImpostor?"impostor":"player"} onChange={e=>setAsImpostor(e.target.value==="impostor")}><option value="player">Partecipante</option><option value="impostor">Impostore</option></select></label>}<button type="button" disabled={disabled||!draft.commonWord.trim()||!draft.impostorWord.trim()||draft.commonWord.trim().toLowerCase()===draft.impostorWord.trim().toLowerCase()} onClick={onStart}>{demo?"Avvia impostore test":"Avvia impostore live"}</button></div>;
}

const makeDraft = kind => ({kind,...templates[kind],options:templates[kind].options.join("\n")});

const noPrize="Riprova la prossima volta";
const quizDefaults=()=>[
 {prompt:"Da quale paese proviene la bachata?",options:"Cuba\nRepubblica Dominicana\nColombia\nPortorico",answer:1,seconds:20,points:100},
 {prompt:"Quale ballo nasce a Cuba?",options:"Salsa cubana\nKizomba\nCountry",answer:0,seconds:20,points:100},
 {prompt:"Quale strumento è tipico della bachata?",options:"Chitarra\nArpa\nViolino",answer:0,seconds:20,points:100}
];
const lines=v=>v.split("\n").map(x=>x.trim()).filter(Boolean);
function quizPayload(q){return q.map(x=>({...x,prompt:x.prompt.trim(),options:lines(x.options),answer:Number(x.answer),seconds:Number(x.seconds),points:Number(x.points)}));}
function validateQuiz(q){if(!q.length||q.length>50||q.some(x=>!x.prompt||x.prompt.length>500||x.options.length<2||x.options.length>6||x.options.some(o=>o.length>250)||!Number.isInteger(x.answer)||x.answer<0||x.answer>=x.options.length||!Number.isInteger(x.seconds)||x.seconds<10||x.seconds>1800||!Number.isInteger(x.points)||x.points<0||x.points>1000))throw Error("Controlla tutte le domande, risposte corrette, timer e punti.");}
function QuizEditor({questions,setQuestions,disabled,onStart,label}){
 const edit=(i,key,value)=>setQuestions(old=>old.map((q,j)=>j===i?{...q,[key]:value}:q));
 return <div className="gn-stage gn-admin"><h3>Quizzone · {questions.length} domande</h3>{questions.map((q,i)=><div className="gn-editor-item" key={i}><div className="gn-editor-head"><strong>Domanda {i+1}</strong><button type="button" className="gn-secondary" disabled={disabled||questions.length===1} onClick={()=>setQuestions(old=>old.filter((_,j)=>j!==i))}>Rimuovi</button></div><label>Domanda<input value={q.prompt} onChange={e=>edit(i,"prompt",e.target.value)} maxLength={500}/></label><label>Risposte (una per riga)<textarea rows={4} value={q.options} onChange={e=>edit(i,"options",e.target.value)}/></label><label>Risposta corretta<select value={q.answer} onChange={e=>edit(i,"answer",Number(e.target.value))}>{lines(q.options).map((v,j)=><option key={j} value={j}>{String.fromCharCode(65+j)} · {v}</option>)}</select></label><div className="gn-editor-row"><label>Secondi<input type="number" min="10" max="1800" value={q.seconds} onChange={e=>edit(i,"seconds",e.target.value)}/></label><label>Punti<input type="number" min="0" max="1000" value={q.points} onChange={e=>edit(i,"points",e.target.value)}/></label></div></div>)}<button type="button" className="gn-secondary" disabled={disabled||questions.length>=50} onClick={()=>setQuestions(old=>[...old,{prompt:"",options:"",answer:0,seconds:20,points:100}])}>+ Aggiungi domanda</button><button type="button" disabled={disabled} onClick={onStart}>{label}</button></div>;
}
function wheelPayload(draft,rules){
 const options=lines(draft.options),out={};
 if(options.length<2||options.length>12||new Set(options).size!==options.length)throw Error("Inserisci da 2 a 12 spicchi diversi.");
 for(const rule of rules){const n=Number(rule.turn),idx=options.indexOf(rule.prize);if(!Number.isInteger(n)||n<1||n>999999||idx<0||Object.hasOwn(out,n)||rule.prize===noPrize)throw Error("Controlla giri e premi: ogni numero deve essere unico.");out[n]=idx;}
 const fallback=options.indexOf(noPrize);
 if(rules.length&&fallback<0)throw Error("Aggiungi lo spicchio “"+noPrize+"”.");
 return {...draft,kind:"wheel",options,wheel_rules:out,wheel_default:Math.max(0,fallback),answer:0,seconds:Number(draft.seconds),points:0};
}
function WheelEditor({draft,setDraft,rules,setRules,demo,prior,setPrior,disabled,onStart}){
 const options=lines(draft.options).filter(x=>x!==noPrize);
 return <div className="gn-stage gn-admin"><h3>Regole della ruota</h3><label>Spicchi (uno per riga, da 2 a 12)<textarea rows={5} value={draft.options} onChange={e=>setDraft({...draft,options:e.target.value})}/></label><label>Durata in secondi<input type="number" min="10" max="1800" value={draft.seconds} onChange={e=>setDraft({...draft,seconds:e.target.value})}/></label><p>Imposta i giri vincenti globali. Se inserisci regole, tutti gli altri giri danno “{noPrize}”. Senza regole, tutti gli spicchi hanno la stessa probabilità.</p>{rules.map((r,i)=><div className="gn-editor-item" key={i}><div className="gn-editor-head"><strong>Premio {i+1}</strong><button type="button" className="gn-secondary" onClick={()=>setRules(old=>old.filter((_,j)=>i!==j))}>Rimuovi</button></div><label>Numero del giro<input type="number" min="1" max="999999" value={r.turn} onChange={e=>setRules(old=>old.map((v,j)=>j===i?{...v,turn:e.target.value}:v))}/></label><label>Premio<select value={r.prize} onChange={e=>setRules(old=>old.map((v,j)=>j===i?{...v,prize:e.target.value}:v))}><option value="">Seleziona premio</option>{options.map((v,j)=><option key={j} value={v}>{v}</option>)}</select></label></div>)}<button type="button" className="gn-secondary" disabled={rules.length>=100||!options.length} onClick={()=>setRules(old=>[...old,{turn:"",prize:options[0]||""}])}>+ Premio a giro prestabilito</button>{demo&&<label>Giri precedenti simulati<input type="number" min="0" max="999998" value={prior} onChange={e=>setPrior(e.target.value)}/></label>}<button type="button" disabled={disabled} onClick={onStart}>{demo?"Avvia ruota test":"Avvia ruota live"}</button></div>;
}

function normalizeName(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("it").trim();}
function SuspectList({options,disabled,onVote,impostorIndex=null}){
 const [query,setQuery]=useState("");
 const filtered=useMemo(()=>options.map((name,index)=>({name,index})).filter(x=>normalizeName(x.name).includes(normalizeName(query))),[options,query]);
 return <div className="gn-suspects"><label htmlFor="gn-suspect-search">Cerca un sospettato</label><input id="gn-suspect-search" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nome o cognome…" autoComplete="off"/><div className="gn-list-count">{filtered.length} di {options.length} partecipanti</div><div className="gn-suspect-scroll" role="region" aria-label="Elenco sospettati" tabIndex={0}>{filtered.map(({name,index})=><button type="button" key={index} disabled={disabled} className={index===impostorIndex?"gn-impostor-mark":undefined} onClick={()=>onVote(String(index))}><span>{name}</span>{index===impostorIndex&&<small>IMPOSTORE</small>}</button>)}{!filtered.length&&<p>Nessun nominativo trovato.</p>}</div></div>;
}

const demoNames=[...Array.from({length:59},(_,i)=>"Demo "+(i+1)),"Tu"];
function demoInitial(){return {event:{title:"Game Night · simulazione",status:"live"},joined:true,admin:true,team:"Tavolo Demo",player_count:60,xp:0,leaderboard:[],teams:[]};}
function demoBoard(xp){return [{id:"me",name:"Tu (test)",xp},{id:"d1",name:"Demo 1",xp:120},{id:"d2",name:"Demo 2",xp:80},{id:"d3",name:"Demo 3",xp:40}].sort((a,b)=>b.xp-a.xp);}
export default function GameNight({isAdmin=false}){
 const [demo,setDemo]=useState(false);
 return <>{isAdmin&&<div className="gn-root" style={{paddingBottom:0,marginBottom:12}}><section className="gn-demo-banner"><strong>{demo?"MODALITÀ TEST ATTIVA":"AREA ADMIN · MODALITÀ TEST"}</strong><p>{demo?"Stai giocando da solo con dati simulati. Nessun risultato viene salvato.":"Prova tutti i giochi da solo, senza coinvolgere gli allievi o modificare la serata."}</p><button type="button" className={demo?"gn-secondary":""} onClick={()=>setDemo(v=>!v)}>{demo?"Esci dal test · torna all’evento reale":"Prova i giochi"}</button></section></div>}<GameNightArena key={isAdmin&&demo?"demo":"real"} isAdmin={isAdmin} demo={isAdmin&&demo}/></>;
}
function GameNightArena({isAdmin=false,demo=false}) {
 const [state,setState]=useState(()=>demo?{...demoInitial(),leaderboard:demoBoard(0)}:null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
 const [draft,setDraft]=useState(()=>makeDraft("quiz")), [title,setTitle]=useState("Cena Orchidea · 29 novembre 2026");
 const [clock,setClock]=useState(Date.now());
 const [impostorDraft,setImpostorDraft]=useState(impostorDefaults),[asImpostor,setAsImpostor]=useState(false);
 const [questions,setQuestions]=useState(quizDefaults),[wheelDraft,setWheelDraft]=useState(()=>makeDraft("wheel")),[rules,setRules]=useState([]),[prior,setPrior]=useState(0),[demoEditor,setDemoEditor]=useState(""),[demoQuiz,setDemoQuiz]=useState(null),[demoWheel,setDemoWheel]=useState(null);
 const offset=useRef(0), request=useRef(0), submitting=useRef(false), pollState=useRef(null);
 const load=useCallback(async()=>{if(demo)return;const seq=++request.current;const {data,error}=await supabase.rpc("orchidea_game_state");if(seq!==request.current)return;if(error){setError(error.message);return;}setError(prev=>prev==="Connessione temporaneamente non disponibile. Riprovo automaticamente."?"":prev);if(data?.server_time)offset.current=Date.parse(data.server_time)-Date.now();pollState.current=data;setState(data);},[demo]);
 useEffect(()=>{
 if(demo)return;
 let active=true,running=false,timer;
 function schedule(delay){window.clearTimeout(timer);if(active&&document.visibilityState!=="hidden")timer=window.setTimeout(refresh,delay);}
 function interval(){const s=pollState.current;const round=s?.round;const liveRound=round?.status==="live"&&Date.parse(round.ends_at)>Date.now()+offset.current;const liveTombola=s?.tombola?.status==="live"||s?.tombola?.status==="waiting";return (s?.event?.status==="live"&&(liveRound||liveTombola)?2200: s?.event?.status==="live"?3500:6500)+Math.random()*1000;}
 async function refresh(){if(!active||document.visibilityState==="hidden")return;if(running||submitting.current){schedule(750+Math.random()*400);return;}running=true;try{await load();}catch(e){if(active)setError("Connessione temporaneamente non disponibile. Riprovo automaticamente.");}finally{running=false;schedule(interval());}}
 function onVisibility(){window.clearTimeout(timer);if(document.visibilityState==="visible")refresh();}
 schedule(Math.random()*350);document.addEventListener("visibilitychange",onVisibility);
 return()=>{active=false;window.clearTimeout(timer);request.current++;document.removeEventListener("visibilitychange",onVisibility);};
 },[load,demo]);
 
 const r=state?.round && games[state.round.kind] ? state.round : null, id=r?.id;
 useEffect(()=>{setClock(Date.now());if(!id||r.status!=="live")return;const tick=()=>{if(document.visibilityState!=="hidden")setClock(Date.now());};const t=setInterval(tick,1000);document.addEventListener("visibilitychange",tick);return()=>{clearInterval(t);document.removeEventListener("visibilitychange",tick);};},[id,r?.status]);
 const [demoTombola,setDemoTombola]=useState(false);
 const tombola=state?.tombola;
 const tombolaOpen=Boolean(tombola&&tombola.status!=="closed");
 const showTombola=demo?demoTombola:Boolean(tombola);
 const impostorInfo=isAdmin&&state?.admin&&r?.kind==="impostor"?(demo?{index:r.impostorIndex,name:demoNames[r.impostorIndex],common_word:r.commonWord,impostor_word:r.impostorWord}:state.impostor_admin?.round_id===id?state.impostor_admin:null):null;

 async function run(name,args={}){if(demo||submitting.current)return;submitting.current=true;setBusy(true);setError("");try{const {error}=await supabase.rpc(name,args);if(error)throw error;await load();}catch(e){setError(e.message||"Operazione non riuscita");}finally{submitting.current=false;setBusy(false);}}
 const left=r?Math.max(0,Math.ceil((Date.parse(r.ends_at)-clock-offset.current)/1000)):0;
 const live=state?.event?.status==="live" && r?.status==="live" && left>0;
 const answered=Boolean(state?.response);
 useEffect(()=>{if(demo&&r?.status==="live"&&left===0)demoFinish();},[demo,r?.status,left]);
 function demoStart(kind){
   setDemoEditor("");setDemoQuiz(null);setDemoWheel(null);
   if(kind==="quiz"||kind==="wheel"||kind==="impostor"){setDemoTombola(false);setState(s=>({...s,round:null,response:null}));setDemoEditor(kind);return;}
   if(kind==="tombola"){setDemoTombola(true);setState(s=>({...s,round:null,response:null}));return;}
   setDemoTombola(false);
   const t=templates[kind], now=Date.now();
   const options=kind==="impostor"?demoNames:t.options;
   const secret=kind==="impostor"?"Parola segreta: Bachata":null;
   setClock(now);setError("");
   setState(s=>({...s,response:null,round:{id:"demo-"+now+"-"+kind,kind,prompt:t.prompt,options,secret,status:"live",ends_at:new Date(now+t.seconds*1000).toISOString(),seconds:t.seconds}}));
 }
 function demoFinish(){
   setState(s=>{
     const round=s.round;if(!round||round.status==="closed")return s;
     const reveal=round.kind==="quiz"?"Risposta corretta: "+round.options[round.answer??templates.quiz.answer]:round.kind==="impostor"?"L’impostore era: "+demoNames[round.impostorIndex]:null;
     const votes=round.kind==="impostor"?demoNames.map((name,i)=>({name,votes:(i===round.impostorIndex?2:0)+(Number(s.response?.value)===i&&s.response?1:0)})).sort((a,b)=>b.votes-a.votes):null;
     return {...s,round:{...round,status:"closed",reveal,counts:votes}};
   });
 }
 function demoSubmit(value){
   if(!live||answered)return;
   const kind=r.kind,t=kind==="quiz"?r:templates[kind];
   let points=0,result="Risposta registrata!",pending=false;
   if(kind==="quiz"||kind==="impostor"){
     const right=kind==="quiz"?Number(value)===t.answer:r.impostorIndex!==demoNames.length-1&&Number(value)===r.impostorIndex;
     points=right?(kind==="quiz"?Math.round(t.points*(.5+.5*Math.min(1,left/t.seconds))):t.points):0;
     result=right?"Risposta corretta!":"Risposta errata";
   }else if(kind==="wheel"){const cfg=demoWheel;if(!cfg)return;const count=cfg.count+1;const idx=Object.keys(cfg.wheel_rules).length?(cfg.wheel_rules[count]??cfg.wheel_default):Math.floor(Math.random()*cfg.options.length);setDemoWheel({...cfg,count});value=String(idx);result=cfg.options[idx];}
   setState(s=>{if(s.response||s.round?.id!==id)return s;const xp=s.xp+points;return {...s,xp,leaderboard:demoBoard(xp),round:kind==="quiz"?{...s.round,status:"closed",reveal:"Risposta corretta: "+t.options[t.answer]}:s.round,response:{value,points,result,pending}};});
 }
 const submit=value=>demo?demoSubmit(value):run("orchidea_game_submit",{p_round:id,p_value:value});
 const tombolaMark=(session,number)=>run("orchidea_tombola_mark",{p_session:session,p_number:number});
 const tombolaAction=(action,session=null)=>run("orchidea_tombola_action",{p_action:action,p_session:session});
 function startDemoRound(q,kind="quiz"){
   const now=Date.now();setClock(now);setDemoEditor("");setDemoTombola(false);setState(s=>({...s,response:null,round:{...q,id:"demo-"+now+"-"+Math.random(),kind,status:"live",ends_at:new Date(now+q.seconds*1000).toISOString()}}));
 }
 function startImpostor(){
 try{setError("");const common=impostorDraft.commonWord.trim(),other=impostorDraft.impostorWord.trim(),seconds=Number(impostorDraft.seconds),points=Number(impostorDraft.points);
 if(!common||!other||common.length>250||other.length>250||common.toLowerCase()===other.toLowerCase())throw Error("Inserisci due parole diverse.");
 if(!Number.isInteger(seconds)||seconds<10||seconds>1800||!Number.isInteger(points)||points<0||points>1000)throw Error("Controlla durata e punti.");
 const cfg={kind:"impostor",prompt:templates.impostor.prompt,options:[common,other],seconds,points,answer:0};
 if(demo){const impostorIndex=asImpostor?demoNames.length-1:1;startDemoRound({...cfg,options:demoNames,impostorIndex,commonWord:common,impostorWord:other,secret:asImpostor?"Sei l’impostore! La tua parola: "+other:"Parola segreta: "+common},"impostor");}
 else run("orchidea_game_admin",{p_action:"round",p_payload:cfg});
 }catch(e){setError(e.message);}
 }
 function startQuiz(){try{setError("");const q=quizPayload(questions);validateQuiz(q);if(demo){setDemoQuiz({questions:q,position:0});startDemoRound(q[0]);}else run("orchidea_quiz_action",{p_action:"start",p_questions:q});}catch(e){setError(e.message);}}
 function nextQuiz(){if(demo){if(!demoQuiz||demoQuiz.position+1>=demoQuiz.questions.length)return;const p=demoQuiz.position+1;setDemoQuiz({...demoQuiz,position:p});startDemoRound(demoQuiz.questions[p]);}else{const force=live;if(force&&!window.confirm("Non tutti hanno ancora risposto. Passare comunque alla prossima domanda?"))return;run("orchidea_quiz_action",{p_action:force?"next_force":"next",p_questions:{round_id:id}});}}
 function startWheel(){try{setError("");const cfg=wheelPayload(wheelDraft,rules);if(!Number.isInteger(cfg.seconds)||cfg.seconds<10||cfg.seconds>1800)throw Error("Durata non valida");if(demo){const count=Number(prior);if(!Number.isInteger(count)||count<0||count>999998)throw Error("Contatore test non valido");setDemoWheel({...cfg,count});startDemoRound(cfg,"wheel");}else run("orchidea_game_admin",{p_action:"round",p_payload:cfg});}catch(e){setError(e.message);}}
 const quizInfo=demo?(demoQuiz?{position:demoQuiz.position+1,total:demoQuiz.questions.length,answered:answered?1:0,eligible:1}:null):state?.quiz;
 const wheelInfo=demo?{index:state?.response?Number(state.response.value):null,programmed:Boolean(demoWheel&&Object.keys(demoWheel.wheel_rules).length),count:demoWheel?.count,used:false}:state?.wheel;
 const openRound=()=>run("orchidea_game_admin",{p_action:"round",p_payload:{...draft,options:draft.options.split("\n").map(x=>x.trim()).filter(Boolean),answer:Number(draft.answer||0),seconds:Number(draft.seconds),points:Number(draft.points)}});
 return <div className="gn-root">
   <header className="gn-hero"><div><small>ORCHIDEA COMMUNITY · SPECIAL EVENT</small><h2>GAME<br/>NIGHT<span> ✦</span></h2><p>Gioca. Conosci. Divertiti.</p></div><div className="gn-orb" aria-hidden="true">★</div></header>
   {demo&&<section className="gn-demo-banner"><strong>Scegli il gioco da provare</strong><small>Puoi ripetere ogni prova senza coinvolgere gli allievi.</small><div className="gn-demo-picker">{Object.entries(games).map(([k,g])=><button type="button" key={k} aria-pressed={k==="tombola"?demoTombola:demoEditor===k||r?.kind===k} onClick={()=>demoStart(k)}>{g[0]}</button>)}</div>{r&&<div className="gn-demo-actions"><button type="button" className="gn-secondary" onClick={()=>demoStart(r.kind)}>Riprova</button><button type="button" className="gn-secondary" disabled={r.status==="closed"} onClick={demoFinish}>Termina e mostra esito</button></div>}<button type="button" className="gn-secondary" onClick={()=>{setState({...demoInitial(),leaderboard:demoBoard(0)});setDemoTombola(false);setDemoEditor("");setDemoQuiz(null);setDemoWheel(null);}}>Azzera test</button></section>}
   {demo&&demoEditor==="impostor"&&<ImpostorEditor draft={impostorDraft} setDraft={setImpostorDraft} demo asImpostor={asImpostor} setAsImpostor={setAsImpostor} onStart={startImpostor}/>}
   {demo&&demoEditor==="quiz"&&<QuizEditor questions={questions} setQuestions={setQuestions} onStart={startQuiz} label="Avvia quizzone test"/>}
   {demo&&demoEditor==="wheel"&&<WheelEditor draft={wheelDraft} setDraft={setWheelDraft} rules={rules} setRules={setRules} demo prior={prior} setPrior={setPrior} onStart={startWheel}/>}
   {error&&<p className="gn-alert" role="alert">{error.includes("orchidea_game_state")?"Game Night non è ancora configurata.":error}</p>}
   {!state&&!error&&<p>Caricamento arena…</p>}
   {state&&<><div className="gn-metrics"><div><small>EVENTO</small><strong>{state.event?.title||"In attesa"}</strong></div><div><small>IL TUO PUNTEGGIO</small><strong>{(demo&&live&&["quiz","impostor"].includes(r.kind)?state.xp-(state.response?.points||0):state.xp)||0} XP</strong></div></div>
   {state.event?.status==="live"&&!state.joined&&<section className="gn-stage gn-admin"><h3>Entra in Game Night</h3><p>Il tuo nome e il punteggio saranno visibili agli altri partecipanti.</p><button disabled={busy} onClick={()=>run("orchidea_game_join",{p_team:""})}>Partecipa</button></section>}
   {showTombola&&<Tombola key={demo?"demo":tombola.id} session={tombola} demo={demo} admin={isAdmin&&state.admin} busy={busy} onAction={tombolaAction} onMark={tombolaMark}/>}
   {!showTombola&&r&&<section className="gn-stage" key={id}><div className="gn-stage-top"><span>{games[r.kind]?.[0]}</span><strong>{live?left+" s":"Round concluso"}</strong></div><div className="gn-progress"><i style={{width:Math.min(100,100*left/r.seconds)+"%"}}/></div>{r.kind!=="wheel"&&<div className={"gn-token gn-"+r.kind} aria-hidden="true">{games[r.kind]?.[1]}</div>}{r.kind==="quiz"&&quizInfo&&<span className="gn-quiz-progress">Domanda {quizInfo.position} di {quizInfo.total}</span>}<h3>{r.prompt}</h3>{impostorInfo&&<div className="gn-impostor-admin" role="status"><small>SOLO ADMIN · IDENTITÀ SEGRETA</small><strong>Impostore: {impostorInfo.name}</strong><span>Partecipanti: {impostorInfo.common_word||"—"} · Impostore: {impostorInfo.impostor_word||"—"}</span><span>Non mostrare questa informazione agli allievi.</span></div>}
   {!state.joined?<p>Partecipa per giocare.</p>:r.kind==="wheel"?<><Wheel options={r.options||[]} result={state.response?.result} resultIndex={wheelInfo?.index??null} disabled={busy||!live||(!demo&&wheelInfo?.used&&wheelInfo?.index==null)} programmed={wheelInfo?.programmed} count={isAdmin?wheelInfo?.count:null} demo={demo} onSpin={()=>submit("spin")} onReplay={demo?()=>startDemoRound(demoWheel,"wheel"):undefined}/>{!demo&&wheelInfo?.used&&wheelInfo?.index==null&&<p>Hai già girato la ruota in questo evento.</p>}</>:answered?<div className="gn-result" role="status"><strong>{demo&&live&&["quiz","impostor"].includes(r.kind)?"Risposta registrata!":state.response.result||"Risposta registrata!"}</strong><p>{live&&["quiz","impostor"].includes(r.kind)?"Esito a fine round.":"+"+state.response.points+" XP"}</p></div>:!live?<p>Attendi il prossimo gioco.</p>:r.kind==="impostor"?<><p className="gn-secret">{r.secret||"Ruolo non assegnato: attendi il prossimo round."}</p><p>Non mostrare lo schermo! Discutete a voce, poi vota il sospettato.</p>{r.secret&&<SuspectList key={id} options={r.options||[]} disabled={busy} onVote={submit} impostorIndex={impostorInfo?.index??null}/>}</>:<div className="gn-options">{(r.options||[]).map((option,i)=><button key={i} disabled={busy} onClick={()=>submit(String(i))}><b>{String.fromCharCode(65+i)}</b>{option}</button>)}</div>}
   {r.reveal&&<p className="gn-secret">{r.reveal}</p>}{r.kind==="quiz"&&quizInfo&&<div className="gn-quiz-controls"><span className="gn-list-count">{quizInfo.answered??0} / {quizInfo.eligible??0} risposte ricevute</span>{live&&answered&&!demo&&<p>Risposta salvata. Attendi gli altri partecipanti o il presentatore.</p>}{quizInfo.position<quizInfo.total&&isAdmin&&(!demo||!live)&&<button disabled={busy} onClick={nextQuiz}>{live?"Avanza prima del termine":"Prossima domanda"} · {quizInfo.position+1}/{quizInfo.total}</button>}{quizInfo.position===quizInfo.total&&!live&&<strong>Quizzone concluso!</strong>}</div>}{r.counts?.length>0&&<div className="gn-result-scroll">{r.counts.map((x,i)=><div className="gn-rank" key={i}><span>{x.name}</span><strong>{x.votes} voti</strong></div>)}</div>}
   </section>}
   <div className="gn-games">{Object.entries(games).map(([key,g])=><div key={key} className={"gn-card gn-"+key+((key==="tombola"?(demoTombola||tombolaOpen):live&&r?.kind===key)?" gn-active":"")}><div className="gn-token" aria-hidden="true">{g[1]}</div><strong>{g[0]}</strong><small>{g[2]}</small><span>{(key==="tombola"?(demoTombola||tombolaOpen):live&&r?.kind===key)?"IN CORSO":"IN ATTESA"}</span></div>)}</div>
   {state.event&&(state.joined||state.admin)&&<section className="gn-stage"><h3>🏆 Classifica serata</h3><div className="gn-result-scroll">{(state.leaderboard||[]).length?(demo&&live&&["quiz","impostor"].includes(r.kind)?demoBoard(state.xp-(state.response?.points||0)):state.leaderboard).map((x,i)=><div className="gn-rank" key={x.id}><b>{i+1}°</b><span>{x.name}</span><strong>{x.xp} XP</strong></div>):<p>I punteggi appariranno dopo il primo gioco.</p>}</div></section>}
      {!demo&&isAdmin&&state.admin&&<section className="gn-stage gn-admin"><h3>Regia Game Night</h3>{!showTombola&&impostorInfo&&<div className="gn-impostor-admin"><small>SOLO ADMIN</small><strong>Impostore: {impostorInfo.name}</strong></div>}<p>{state.player_count||0} partecipanti</p>{state.wheel?.count!=null&&<p>Giri registrati nella ruota: {state.wheel.count}</p>}<label>Nome evento<input value={title} onChange={e=>setTitle(e.target.value)}/></label><button disabled={busy||state.event?.status==="live"} onClick={()=>run("orchidea_game_admin",{p_action:"event",p_payload:{title}})}>Apri nuovo evento</button>
   {state.event?.status==="live"&&<><label>Gioco<select value={draft.kind} onChange={e=>setDraft(makeDraft(e.target.value))}>{Object.entries(games).filter(([k])=>k!=="tombola").map(([k,g])=><option key={k} value={k}>{g[0]}</option>)}</select></label>{draft.kind==="quiz"?<QuizEditor questions={questions} setQuestions={setQuestions} disabled={busy||live||tombolaOpen} onStart={startQuiz} label="Avvia quizzone live"/>:draft.kind==="wheel"?<WheelEditor draft={wheelDraft} setDraft={setWheelDraft} rules={rules} setRules={setRules} disabled={busy||live||tombolaOpen} onStart={startWheel}/>:<ImpostorEditor draft={impostorDraft} setDraft={setImpostorDraft} disabled={busy||live||tombolaOpen} onStart={startImpostor}/> }<button type="button" disabled={busy||live||tombolaOpen} onClick={()=>tombolaAction("start")}>Apri tombola · distribuisci cartelle</button><button disabled={busy||!r||r.status!=="live"} onClick={()=>run("orchidea_game_admin",{p_action:"close_round",p_payload:{}})}>Chiudi round e rivela risultato</button><button className="gn-secondary" disabled={busy} onClick={()=>{if(window.confirm("Terminare la Game Night?"))run("orchidea_game_admin",{p_action:"close_event",p_payload:{}});}}>Chiudi evento</button></>}
   </section>}</>}
 </div>;
}
