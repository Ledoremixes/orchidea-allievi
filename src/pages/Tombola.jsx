import {useEffect,useRef,useState} from "react";
import "./Tombola.css";
const all=Array.from({length:90},(_,i)=>i+1);
const labels={2:"Ambo",3:"Terno",4:"Quaterna",5:"Cinquina",15:"Tombola"};
function shuffle(a){return [...a].map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);}
export function makeCard(){let cells,cols;do{cells=Array(27).fill(0);for(let r=0;r<3;r++)for(const c of shuffle(Array.from({length:9},(_,i)=>i)).slice(0,5))cells[r*9+c]=-1;cols=Array.from({length:9},(_,c)=>[c,c+9,c+18].filter(i=>cells[i]===-1));}while(cols.some(c=>!c.length));cols.forEach((slots,c)=>{const nums=shuffle(all.filter(n=>Math.min(8,Math.floor(n/10))===c)).slice(0,slots.length).sort((a,b)=>a-b);slots.forEach((i,j)=>cells[i]=nums[j]);});return cells;}
function reached(card,drawn,tier){return tier===15?card.filter(n=>drawn.includes(n)).length===15:[0,1,2].some(r=>card.slice(r*9,r*9+9).filter(n=>drawn.includes(n)).length>=tier);}
function demoGame(){return {id:"demo",status:"waiting",drawn:[],card:makeCard(),winners:[],card_count:1};}
export default function Tombola({session,admin=false,demo=false,busy=false,onAction}){
 const [test,setTest]=useState(demoGame),[rolling,setRolling]=useState(false),[shown,setShown]=useState(null);
 const data=demo?test:session;
 const drawn=data?.drawn||[], last=drawn.at(-1), card=data?.card||[], winners=data?.winners||[], open=data?.status!=="closed";
 const lastSeen=useRef(null), timer=useRef(null), rollingRef=useRef(false);
 useEffect(()=>{if(last==null){setShown(null);lastSeen.current=null;setRolling(false);rollingRef.current=false;return;}
 if(lastSeen.current===last)return;lastSeen.current=last;setRolling(true);rollingRef.current=true;
 const t=window.setTimeout(()=>{setShown(last);setRolling(false);rollingRef.current=false;},1000);timer.current=t;
 return()=>window.clearTimeout(t);
 },[last,data?.id]);
 useEffect(()=>()=>window.clearTimeout(timer.current),[]);
 function draw(){if(rollingRef.current||busy||!open||drawn.length>=90)return;
 if(!demo){onAction("draw",data.id);return;}
 const available=all.filter(n=>!drawn.includes(n)),n=available[Math.floor(Math.random()*available.length)],next=[...drawn,n];
 const win=[...winners];for(const tier of [2,3,4,5,15])if(!win.some(w=>w.prize===tier)&&reached(card,next,tier))win.push({prize:tier,name:"Tu (test)",number:n,mine:true});
 setTest({...test,drawn:next,winners:win,status:win.some(w=>w.prize===15)?"closed":"live"});
 }
 function reset(){window.clearTimeout(timer.current);lastSeen.current=null;rollingRef.current=false;setRolling(false);setShown(null);setTest(demoGame());}
 if(!data)return null;
 const visible=rolling?drawn.slice(0,-1):drawn;
 const displayWins=rolling?winners.filter(w=>w.number!==last):winners;
 const matched=card.filter(n=>visible.includes(n)).length;
 return <section className="gn-stage tb-root">
 <div className="tb-head"><div><small>ORCHIDEA · TOMBOLA</small><h3>La tombola</h3></div><span>{demo?"TEST":data.status==="waiting"?"LOBBY":open?"LIVE":"FINITA"}</span></div>
 <div className="tb-machine"><div className="tb-halo"/><div className={"tb-ball"+(rolling?" tb-rolling":"")} key={rolling?"rolling-"+last:"ball-"+shown}><div className="tb-ball-side tb-ball-back"/><div className="tb-ball-side tb-ball-front"><strong>{shown??"?"}</strong></div></div><div className="tb-shadow"/><div className="tb-live-number" aria-live="polite">{rolling?"Estrazione in corso…":shown!=null?"Numero estratto: "+shown:"Pronti per l’estrazione?"}</div></div>
 <div className="tb-count"><span>{visible.length} / 90 estratti</span><span>{data.card_count||0} cartelle</span></div>
 {(admin||demo)&&<div className="tb-actions"><button type="button" disabled={rolling||busy||!open||!data.card_count} onClick={draw}>{rolling?"Estrazione…":open?"Estrai numero":"Partita conclusa"}</button>{demo?<button type="button" className="gn-secondary" onClick={reset}>Nuova partita test</button>:open&&<button type="button" className="gn-secondary" disabled={busy||rolling} onClick={()=>{if(window.confirm("Chiudere la tombola?"))onAction("close",data.id);}}>Chiudi tombola</button>}</div>}
 {data.status==="waiting"&&!demo&&<p>Distribuisci le cartelle prima della prima estrazione. Dopo, non si possono più aggiungere giocatori.</p>}
 {!card.length&&!demo&&data.status==="waiting"&&<button type="button" disabled={busy} onClick={()=>onAction("join",data.id)}>Ricevi la tua cartella</button>}
 {!card.length&&!demo&&data.status!=="waiting"&&<p>Stai seguendo la partita senza cartella.</p>}
 {card.length>0&&<div className="tb-card"><div className="tb-card-head"><strong>La tua cartella</strong><span>{matched}/15</span></div><div className="tb-ticket">{card.map((n,i)=><div key={i} className={n?(visible.includes(n)?"tb-cell tb-mark":"tb-cell"):"tb-cell tb-empty"}>{n||""}</div>)}</div><small>I numeri estratti vengono segnati automaticamente.</small></div>}
 <div className="tb-prizes">{[2,3,4,5,15].map(tier=>{const ws=displayWins.filter(w=>w.prize===tier);return <div key={tier} className={ws.length?"tb-won":""}><strong>{labels[tier]}</strong><small>{ws.length?ws.map(w=>w.name).join(", "):"In palio"}</small></div>})}</div>
 {displayWins.some(w=>w.mine)&&<p className="tb-win" role="status">✦ {displayWins.filter(w=>w.mine).map(w=>labels[w.prize]).join(" · ")}! Complimenti!</p>}
 <div className="tb-history"><strong>Ultimi estratti</strong><div>{visible.slice(-8).reverse().map(n=><span key={n}>{n}</span>)}{!visible.length&&<small>Ancora nessun numero</small>}</div></div>
 <div><strong>Tabellone 1–90</strong><div className="tb-board">{all.map(n=><span key={n} className={visible.includes(n)?(n===shown?"tb-hit tb-latest":"tb-hit"):""}>{n}</span>)}</div></div>
 </section>;
}
