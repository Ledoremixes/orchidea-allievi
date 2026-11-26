import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import "./GameNight.css";

const games = {
 quiz: ["Quiz Orchidea","?","Rispondi prima che scada il tempo."],
 mission: ["Missioni segrete","✦","Completa la missione nel mondo reale."],
 bingo: ["Social Bingo","▦","Conosci i compagni e completa la cartella."],
 impostor: ["L’impostore","◈","Scopri chi non conosce la parola."],
 awards: ["Orchidea Awards","★","Vota il tuo preferito."],
 battle: ["Battle dei tavoli","⚑","Sfida creativa da svolgere insieme."],
 wheel: ["Ruota della fortuna","✺","Scopri il tuo premio."],
};
const templates = {
 quiz: {prompt:"Da quale paese proviene la bachata?",options:["Cuba","Repubblica Dominicana","Colombia","Portorico"],answer:1,seconds:20,points:100},
 mission:{prompt:"Missione segreta",options:["Fai un selfie con tre persone di corsi diversi (con il loro consenso).","Impara un passo da un nuovo compagno.","Fai sorridere una persona che non conosci."],seconds:600,points:50},
 bingo:{prompt:"Completa le nove caselle conoscendo altre persone",options:["Balla salsa","Balla bachata","Balla country","Balla da più di 5 anni","Frequenta due corsi","È al primo anno","Ama ballare in coppia","Compie gli anni nel tuo mese","Non conoscevi prima di oggi"],seconds:900,points:90},
 impostor:{prompt:"L’impostore: a turno date un indizio senza dire la parola.",options:["Bachata"],seconds:300,points:0},
 awards:{prompt:"Chi ha il sorriso più contagioso?",options:[""],seconds:120,points:0},
 battle:{prompt:"Inventate un nome e un breve saluto del vostro tavolo, poi mostratelo al presentatore.",options:["Sfida completata"],seconds:300,points:50},
 wheel:{prompt:"Gira la ruota!",options:["Ingresso omaggio","Lezione omaggio","Riprova la prossima volta"],seconds:300,points:0},
};
const makeDraft = kind => ({kind,...templates[kind],options:templates[kind].options.join("\n")});

export default function GameNight({isAdmin=false}) {
 const [state,setState]=useState(null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
 const [draft,setDraft]=useState(()=>makeDraft("quiz")), [title,setTitle]=useState("Cena Orchidea · 29 novembre 2026");
 const [clock,setClock]=useState(Date.now()), [checked,setChecked]=useState([]), [spin,setSpin]=useState(false);
 const load=useCallback(async()=>{const {data,error}=await supabase.rpc("orchidea_game_state");if(error){setError(error.message);return;}setState(data);},[]);
 useEffect(()=>{let active=true;let running=false;const refresh=async()=>{if(!active||running)return;running=true;try{await load();}finally{running=false;}};refresh();const id=setInterval(refresh,2500);return()=>{active=false;clearInterval(id);};},[load]);
 useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(t);},[]);
 const r=state?.round, id=r?.id;
 useEffect(()=>{setChecked([]);setSpin(false);},[id]);
 async function run(name,args={}){if(busy)return;setBusy(true);setError("");try{const {error}=await supabase.rpc(name,args);if(error)throw error;await load();}catch(e){setError(e.message||"Operazione non riuscita");}finally{setBusy(false);}}
 const left=r?Math.max(0,Math.ceil((Date.parse(r.ends_at)-clock)/1000)):0;
 const live=state?.event?.status==="live" && r?.status==="live" && left>0;
 const answered=Boolean(state?.response);
 const submit=value=>run("orchidea_game_submit",{p_round:id,p_value:value});
 const openRound=()=>run("orchidea_game_admin",{p_action:"round",p_payload:{...draft,options:draft.options.split("\n").map(x=>x.trim()).filter(Boolean),answer:Number(draft.answer||0),seconds:Number(draft.seconds),points:Number(draft.points)}});
 return <div className="gn-root">
   <header className="gn-hero"><div><small>ORCHIDEA COMMUNITY · SPECIAL EVENT</small><h2>GAME<br/>NIGHT<span> ✦</span></h2><p>Gioca. Conosci. Divertiti.</p></div><div className="gn-orb" aria-hidden="true">★</div></header>
   {error&&<p className="gn-alert" role="alert">{error.includes("orchidea_game_state")?"Game Night non è ancora configurata.":error}</p>}
   {!state&&!error&&<p>Caricamento arena…</p>}
   {state&&<><div className="gn-metrics"><div><small>EVENTO</small><strong>{state.event?.title||"In attesa"}</strong></div><div><small>IL TUO PUNTEGGIO</small><strong>{state.xp||0} XP</strong></div></div>
   {r&&<section className="gn-stage" key={id}><div className="gn-stage-top"><span>{games[r.kind]?.[0]}</span><strong>{live?left+" s":"Round concluso"}</strong></div><div className="gn-progress"><i style={{width:Math.min(100,100*left/r.seconds)+"%"}}/></div><div className={"gn-token gn-"+r.kind+(spin?" gn-spin":"")} aria-hidden="true">{games[r.kind]?.[1]}</div><h3>{r.prompt}</h3>
   {answered?<div className="gn-result" role="status"><strong>{state.response.result||"Risposta registrata!"}</strong><p>+{state.response.points} XP</p></div>:!live?<p>Attendi il prossimo gioco.</p>:r.kind==="impostor"?<><p className="gn-secret">{r.secret||"Ruolo non assegnato: attendi il prossimo round."}</p><p>Non mostrare lo schermo! Discutete a voce e il presentatore rivelerà il ruolo alla fine.</p></>:r.kind==="mission"?<><p className="gn-secret">{r.secret}</p><button disabled={busy} onClick={()=>submit("done")}>Missione completata</button></>:r.kind==="bingo"?<><div className="gn-bingo">{(r.options||[]).map((option,i)=><button key={i} aria-pressed={checked.includes(i)} disabled={busy} onClick={()=>setChecked(old=>old.includes(i)?old.filter(x=>x!==i):[...old,i])}>{checked.includes(i)?"✓ ":""}{option}</button>)}</div><button disabled={busy||checked.length!==9} onClick={()=>submit("done")}>Bingo! {checked.length}/9</button></>:r.kind==="wheel"?<button disabled={busy} onClick={()=>{setSpin(true);submit("spin");}}>Gira la ruota</button>:<div className="gn-options">{(r.options||[]).map((option,i)=><button key={i} disabled={busy} onClick={()=>submit(String(i))}><b>{String.fromCharCode(65+i)}</b>{option}</button>)}</div>}
   {r.reveal&&<p className="gn-secret">{r.reveal}</p>}
   </section>}
   <div className="gn-games">{Object.entries(games).map(([key,g])=><div key={key} className={"gn-card gn-"+key+(live&&r?.kind===key?" gn-active":"")}><div className="gn-token" aria-hidden="true">{g[1]}</div><strong>{g[0]}</strong><small>{g[2]}</small><span>{live&&r?.kind===key?"IN CORSO":"IN ATTESA"}</span></div>)}</div>
   {state.event&&<section className="gn-stage"><h3>🏆 Classifica serata</h3>{(state.leaderboard||[]).length?state.leaderboard.map((x,i)=><div className="gn-rank" key={x.id}><b>{i+1}°</b><span>{x.name}</span><strong>{x.xp} XP</strong></div>):<p>I punteggi appariranno dopo il primo gioco.</p>}</section>}
   {isAdmin&&state.admin&&<section className="gn-stage gn-admin"><h3>Regia Game Night</h3><label>Nome evento<input value={title} onChange={e=>setTitle(e.target.value)}/></label><button disabled={busy||state.event?.status==="live"} onClick={()=>run("orchidea_game_admin",{p_action:"event",p_payload:{title}})}>Apri nuovo evento</button>
   {state.event?.status==="live"&&<><label>Gioco<select value={draft.kind} onChange={e=>setDraft(makeDraft(e.target.value))}>{Object.entries(games).map(([k,g])=><option key={k} value={k}>{g[0]}</option>)}</select></label><label>Titolo / domanda<input value={draft.prompt} onChange={e=>setDraft({...draft,prompt:e.target.value})}/></label><label>Opzioni (una per riga)<textarea rows={5} value={draft.options} onChange={e=>setDraft({...draft,options:e.target.value})}/></label>{draft.kind==="quiz"&&<label>Risposta corretta (A=0, B=1, C=2, D=3)<input type="number" min="0" value={draft.answer||0} onChange={e=>setDraft({...draft,answer:e.target.value})}/></label>}<label>Secondi<input type="number" min="10" max="1800" value={draft.seconds} onChange={e=>setDraft({...draft,seconds:e.target.value})}/></label><label>Punti<input type="number" min="0" max="1000" value={draft.points} onChange={e=>setDraft({...draft,points:e.target.value})}/></label><button disabled={busy||live} onClick={openRound}>Avvia round</button><button disabled={busy||!r||r.status!=="live"} onClick={()=>run("orchidea_game_admin",{p_action:"close_round",p_payload:{}})}>Chiudi round e rivela risultato</button><button className="gn-secondary" disabled={busy} onClick={()=>{if(window.confirm("Terminare la Game Night?"))run("orchidea_game_admin",{p_action:"close_event",p_payload:{}});}}>Chiudi evento</button></>}
   </section>}</>}
 </div>;
}
