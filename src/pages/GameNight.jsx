import { useCallback, useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient.js";
import "./GameNight.css";
import Tombola from "./Tombola.jsx";

const games = {
 quiz: ["Quiz Orchidea","?","Rispondi prima che scada il tempo."],
 impostor: ["L’impostore","◈","Scopri chi non conosce la parola."],
 wheel: ["Ruota della fortuna","✺","Scopri il tuo premio."],
 tombola: ["Tombola Orchidea","●","Estrai i numeri e completa la tua cartella."],
};
const templates = {
 quiz: {prompt:"Da quale paese proviene la bachata?",options:["Cuba","Repubblica Dominicana","Colombia","Portorico"],answer:1,seconds:20,points:100},
 impostor:{prompt:"L’impostore: a turno date un indizio senza dire la parola.",options:["Bachata"],seconds:300,points:100},
 wheel:{prompt:"Gira la ruota!",options:["Premio simbolico: stella Orchidea","Riprova la prossima volta"],seconds:300,points:0},
};
const makeDraft = kind => ({kind,...templates[kind],options:templates[kind].options.join("\n")});

const demoNames=["Demo 1","Demo 2","Demo 3","Tu"];
function demoInitial(){return {event:{title:"Game Night · simulazione",status:"live"},joined:true,admin:true,team:"Tavolo Demo",player_count:4,xp:0,leaderboard:[],teams:[]};}
function demoBoard(xp){return [{id:"me",name:"Tu (test)",xp},{id:"d1",name:"Demo 1",xp:120},{id:"d2",name:"Demo 2",xp:80},{id:"d3",name:"Demo 3",xp:40}].sort((a,b)=>b.xp-a.xp);}
export default function GameNight({isAdmin=false}){
 const [demo,setDemo]=useState(false);
 return <>{isAdmin&&<div className="gn-root" style={{paddingBottom:0,marginBottom:12}}><section className="gn-demo-banner"><strong>{demo?"MODALITÀ TEST ATTIVA":"AREA ADMIN · MODALITÀ TEST"}</strong><p>{demo?"Stai giocando da solo con dati simulati. Nessun risultato viene salvato.":"Prova tutti i giochi da solo, senza coinvolgere gli allievi o modificare la serata."}</p><button type="button" className={demo?"gn-secondary":""} onClick={()=>setDemo(v=>!v)}>{demo?"Esci dal test · torna all’evento reale":"Prova i giochi"}</button></section></div>}<GameNightArena key={isAdmin&&demo?"demo":"real"} isAdmin={isAdmin} demo={isAdmin&&demo}/></>;
}
function GameNightArena({isAdmin=false,demo=false}) {
 const [state,setState]=useState(()=>demo?{...demoInitial(),leaderboard:demoBoard(0)}:null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
 const [draft,setDraft]=useState(()=>makeDraft("quiz")), [title,setTitle]=useState("Cena Orchidea · 29 novembre 2026");
 const [clock,setClock]=useState(Date.now()), [spin,setSpin]=useState(false);
 const offset=useRef(0), request=useRef(0), submitting=useRef(false);
 const load=useCallback(async()=>{if(demo)return;const seq=++request.current;const {data,error}=await supabase.rpc("orchidea_game_state");if(seq!==request.current)return;if(error){setError(error.message);return;}if(data?.server_time)offset.current=Date.parse(data.server_time)-Date.now();setState(data);},[demo]);
 useEffect(()=>{if(demo)return;let active=true;let running=false;const refresh=async()=>{if(!active||running)return;running=true;try{await load();}finally{running=false;}};refresh();const id=setInterval(refresh,2500);return()=>{active=false;clearInterval(id);};},[load,demo]);
 useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(t);},[]);
 const r=state?.round && games[state.round.kind] ? state.round : null, id=r?.id;
 const [demoTombola,setDemoTombola]=useState(false);
 const tombola=state?.tombola;
 const tombolaOpen=Boolean(tombola&&tombola.status!=="closed");
 const showTombola=demo?demoTombola:Boolean(tombola);
 useEffect(()=>{setSpin(false);},[id]);
 async function run(name,args={}){if(demo||submitting.current)return;submitting.current=true;setBusy(true);setError("");try{const {error}=await supabase.rpc(name,args);if(error)throw error;await load();}catch(e){setError(e.message||"Operazione non riuscita");}finally{submitting.current=false;setBusy(false);}}
 const left=r?Math.max(0,Math.ceil((Date.parse(r.ends_at)-clock-offset.current)/1000)):0;
 const live=state?.event?.status==="live" && r?.status==="live" && left>0;
 const answered=Boolean(state?.response);
 useEffect(()=>{if(demo&&r?.status==="live"&&left===0)demoFinish();},[demo,r?.status,left]);
 function demoStart(kind){
   if(kind==="tombola"){setDemoTombola(true);setState(s=>({...s,round:null,response:null}));return;}
   setDemoTombola(false);
   const t=templates[kind], now=Date.now();
   const options=kind==="impostor"?demoNames:t.options;
   const secret=kind==="impostor"?"Parola segreta: Bachata":null;
   setClock(now);setSpin(false);setError("");
   setState(s=>({...s,response:null,round:{id:"demo-"+now+"-"+kind,kind,prompt:t.prompt,options,secret,status:"live",ends_at:new Date(now+t.seconds*1000).toISOString(),seconds:t.seconds}}));
 }
 function demoFinish(){
   setState(s=>{
     const round=s.round;if(!round||round.status==="closed")return s;
     const reveal=round.kind==="quiz"?"Risposta corretta: "+round.options[templates.quiz.answer]:round.kind==="impostor"?"L’impostore era: Demo 2":null;
     const votes=round.kind==="impostor"?demoNames.map((name,i)=>({name,votes:(i===1?2:0)+(Number(s.response?.value)===i&&s.response?1:0)})).sort((a,b)=>b.votes-a.votes):null;
     return {...s,round:{...round,status:"closed",reveal,counts:votes}};
   });
 }
 function demoSubmit(value){
   if(!live||answered)return;
   const kind=r.kind,t=templates[kind];
   let points=0,result="Risposta registrata!",pending=false;
   if(kind==="quiz"||kind==="impostor"){
     const right=Number(value)===(kind==="quiz"?t.answer:1);
     points=right?(kind==="quiz"?Math.round(t.points*(.5+.5*Math.min(1,left/t.seconds))):t.points):0;
     result=right?"Risposta corretta!":"Risposta errata";
   }else if(kind==="wheel"){result=t.options[Math.floor(Math.random()*t.options.length)];}
   setState(s=>{if(s.response||s.round?.id!==id)return s;const xp=s.xp+points;return {...s,xp,leaderboard:demoBoard(xp),response:{value,points,result,pending}};});
 }
 const submit=value=>demo?demoSubmit(value):run("orchidea_game_submit",{p_round:id,p_value:value});
 const tombolaAction=(action,session=null)=>run("orchidea_tombola_action",{p_action:action,p_session:session});
 const openRound=()=>run("orchidea_game_admin",{p_action:"round",p_payload:{...draft,options:draft.options.split("\n").map(x=>x.trim()).filter(Boolean),answer:Number(draft.answer||0),seconds:Number(draft.seconds),points:Number(draft.points)}});
 return <div className="gn-root">
   <header className="gn-hero"><div><small>ORCHIDEA COMMUNITY · SPECIAL EVENT</small><h2>GAME<br/>NIGHT<span> ✦</span></h2><p>Gioca. Conosci. Divertiti.</p></div><div className="gn-orb" aria-hidden="true">★</div></header>
   {demo&&<section className="gn-demo-banner"><strong>Scegli il gioco da provare</strong><small>Puoi ripetere ogni prova senza coinvolgere gli allievi.</small><div className="gn-demo-picker">{Object.entries(games).map(([k,g])=><button type="button" key={k} aria-pressed={k==="tombola"?demoTombola:r?.kind===k} onClick={()=>demoStart(k)}>{g[0]}</button>)}</div>{r&&<div className="gn-demo-actions"><button type="button" className="gn-secondary" onClick={()=>demoStart(r.kind)}>Riprova</button><button type="button" className="gn-secondary" disabled={r.status==="closed"} onClick={demoFinish}>Termina e mostra esito</button></div>}<button type="button" className="gn-secondary" onClick={()=>{setState({...demoInitial(),leaderboard:demoBoard(0)});setDemoTombola(false);setSpin(false);}}>Azzera test</button></section>}
   {error&&<p className="gn-alert" role="alert">{error.includes("orchidea_game_state")?"Game Night non è ancora configurata.":error}</p>}
   {!state&&!error&&<p>Caricamento arena…</p>}
   {state&&<><div className="gn-metrics"><div><small>EVENTO</small><strong>{state.event?.title||"In attesa"}</strong></div><div><small>IL TUO PUNTEGGIO</small><strong>{(demo&&live&&["quiz","impostor"].includes(r.kind)?state.xp-(state.response?.points||0):state.xp)||0} XP</strong></div></div>
   {state.event?.status==="live"&&!state.joined&&<section className="gn-stage gn-admin"><h3>Entra in Game Night</h3><p>Il tuo nome e il punteggio saranno visibili agli altri partecipanti.</p><button disabled={busy} onClick={()=>run("orchidea_game_join",{p_team:""})}>Partecipa</button></section>}
   {showTombola&&<Tombola key={demo?"demo":tombola.id} session={tombola} demo={demo} admin={isAdmin&&state.admin} busy={busy} onAction={tombolaAction}/>}
   {!showTombola&&r&&<section className="gn-stage" key={id}><div className="gn-stage-top"><span>{games[r.kind]?.[0]}</span><strong>{live?left+" s":"Round concluso"}</strong></div><div className="gn-progress"><i style={{width:Math.min(100,100*left/r.seconds)+"%"}}/></div><div className={"gn-token gn-"+r.kind+(spin?" gn-spin":"")} aria-hidden="true">{games[r.kind]?.[1]}</div><h3>{r.prompt}</h3>
   {!state.joined?<p>Partecipa per giocare.</p>:answered?<div className="gn-result" role="status"><strong>{demo&&live&&["quiz","impostor"].includes(r.kind)?"Risposta registrata!":state.response.result||"Risposta registrata!"}</strong><p>{live&&["quiz","impostor"].includes(r.kind)?"Esito a fine round.":"+"+state.response.points+" XP"}</p></div>:!live?<p>Attendi il prossimo gioco.</p>:r.kind==="impostor"?<><p className="gn-secret">{r.secret||"Ruolo non assegnato: attendi il prossimo round."}</p><p>Non mostrare lo schermo! Discutete a voce, poi vota il sospettato.</p><div className="gn-options">{r.secret&&(r.options||[]).map((o,i)=><button key={i} disabled={busy} onClick={()=>submit(String(i))}>{o}</button>)}</div></>:r.kind==="wheel"?<button disabled={busy} onClick={()=>{setSpin(true);submit("spin");}}>Gira la ruota</button>:<div className="gn-options">{(r.options||[]).map((option,i)=><button key={i} disabled={busy} onClick={()=>submit(String(i))}><b>{String.fromCharCode(65+i)}</b>{option}</button>)}</div>}
   {r.reveal&&<p className="gn-secret">{r.reveal}</p>}{r.counts?.map((x,i)=><div className="gn-rank" key={i}><span>{x.name}</span><strong>{x.votes} voti</strong></div>)}
   </section>}
   <div className="gn-games">{Object.entries(games).map(([key,g])=><div key={key} className={"gn-card gn-"+key+((key==="tombola"?(demoTombola||tombolaOpen):live&&r?.kind===key)?" gn-active":"")}><div className="gn-token" aria-hidden="true">{g[1]}</div><strong>{g[0]}</strong><small>{g[2]}</small><span>{(key==="tombola"?(demoTombola||tombolaOpen):live&&r?.kind===key)?"IN CORSO":"IN ATTESA"}</span></div>)}</div>
   {state.event&&(state.joined||state.admin)&&<section className="gn-stage"><h3>🏆 Classifica serata</h3>{(state.leaderboard||[]).length?(demo&&live&&["quiz","impostor"].includes(r.kind)?demoBoard(state.xp-(state.response?.points||0)):state.leaderboard).map((x,i)=><div className="gn-rank" key={x.id}><b>{i+1}°</b><span>{x.name}</span><strong>{x.xp} XP</strong></div>):<p>I punteggi appariranno dopo il primo gioco.</p>}</section>}
      {!demo&&isAdmin&&state.admin&&<section className="gn-stage gn-admin"><h3>Regia Game Night</h3><p>{state.player_count||0} partecipanti</p><label>Nome evento<input value={title} onChange={e=>setTitle(e.target.value)}/></label><button disabled={busy||state.event?.status==="live"} onClick={()=>run("orchidea_game_admin",{p_action:"event",p_payload:{title}})}>Apri nuovo evento</button>
   {state.event?.status==="live"&&<><label>Gioco<select value={draft.kind} onChange={e=>setDraft(makeDraft(e.target.value))}>{Object.entries(games).filter(([k])=>k!=="tombola").map(([k,g])=><option key={k} value={k}>{g[0]}</option>)}</select></label><label>Titolo / domanda<input value={draft.prompt} onChange={e=>setDraft({...draft,prompt:e.target.value})}/></label><label>Opzioni (una per riga)<textarea rows={5} value={draft.options} onChange={e=>setDraft({...draft,options:e.target.value})}/></label>{draft.kind==="quiz"&&<label>Risposta corretta (A=0, B=1, C=2, D=3)<input type="number" min="0" value={draft.answer||0} onChange={e=>setDraft({...draft,answer:e.target.value})}/></label>}<label>Secondi<input type="number" min="10" max="1800" value={draft.seconds} onChange={e=>setDraft({...draft,seconds:e.target.value})}/></label><label>Punti<input type="number" min="0" max="1000" value={draft.points} onChange={e=>setDraft({...draft,points:e.target.value})}/></label><button disabled={busy||live||tombolaOpen} onClick={openRound}>Avvia round</button><button type="button" disabled={busy||live||tombolaOpen} onClick={()=>tombolaAction("start")}>Apri tombola · distribuisci cartelle</button><button disabled={busy||!r||r.status!=="live"} onClick={()=>run("orchidea_game_admin",{p_action:"close_round",p_payload:{}})}>Chiudi round e rivela risultato</button><button className="gn-secondary" disabled={busy} onClick={()=>{if(window.confirm("Terminare la Game Night?"))run("orchidea_game_admin",{p_action:"close_event",p_payload:{}});}}>Chiudi evento</button></>}
   </section>}</>}
 </div>;
}
