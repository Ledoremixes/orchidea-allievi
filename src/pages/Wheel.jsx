import {memo,useEffect,useRef,useState} from "react";
import "./Wheel.css";
const colors=["#ffcd05","#ef7809","#83b641","#00a5d1","#42549a","#8f358e","#00a5d1","#ff7900","#ffca00","#80b73c","#df211b","#435668"];
const pt=(r,a)=>[160+r*Math.sin(a*Math.PI/180),160-r*Math.cos(a*Math.PI/180)];
export default memo(function Wheel({options=[],result=null,resultIndex=null,disabled=false,onSpin,programmed=false,count=null,demo=false,onReplay}){
 const [angle,setAngle]=useState(0),[moving,setMoving]=useState(false),[revealed,setRevealed]=useState(false);
 const requested=useRef(false),finished=useRef(null),timer=useRef(null);
 const n=options.length,step=360/Math.max(1,n);
 useEffect(()=>{if(resultIndex==null||!Number.isInteger(resultIndex)||resultIndex<0||resultIndex>=n)return;
 if(finished.current===resultIndex&&!requested.current)return;
 finished.current=resultIndex;
 if(!requested.current){setAngle(-(resultIndex+.5)*step);setRevealed(true);return;}
 requested.current=false;setMoving(true);setRevealed(false);
 setAngle(prev=>{const target=(360-((resultIndex+.5)*step)%360)%360;return prev+1800+((target-((prev%360)+360)%360+360)%360);});
 timer.current=window.setTimeout(()=>{setMoving(false);setRevealed(true);},3400);
 return()=>window.clearTimeout(timer.current);
 },[resultIndex,n,step]);
 useEffect(()=>{if(!disabled&&resultIndex==null&&requested.current){requested.current=false;setMoving(false);}},[disabled,resultIndex]);
 useEffect(()=>()=>window.clearTimeout(timer.current),[]);
 function spin(){if(disabled||moving||resultIndex!=null||requested.current)return;requested.current=true;setRevealed(false);onSpin();}
 return <div className="ow-wrap">
 <div className="ow-stage"><div className="ow-disc" style={{transform:"rotate("+angle+"deg)",transition:moving?"transform 3.35s cubic-bezier(.12,.7,.13,1)":"none"}}>
 <svg viewBox="0 0 320 320" role="img" aria-label="Ruota con spicchi numerati">
 <defs><radialGradient id="ow-gold"><stop stopColor="#fff3a8"/><stop offset="1" stopColor="#e4a514"/></radialGradient></defs>
 <circle cx="160" cy="160" r="157" fill="#ffca13"/><circle cx="160" cy="160" r="139" fill="#a6761b"/>
 {options.map((o,i)=>{const s=pt(137,i*step),e=pt(137,(i+1)*step),label=pt(99,(i+.5)*step);return <g key={i}><path d={"M160 160 L"+s.join(" ")+" A137 137 0 "+(step>180?1:0)+" 1 "+e.join(" ")+" Z"} fill={colors[i%colors.length]} stroke="#fff2" strokeWidth="1"/><text x={label[0]} y={label[1]} fill="#fff" stroke="#0008" strokeWidth=".8" paintOrder="stroke" fontWeight="900" fontSize={n>8?17:21} textAnchor="middle" dominantBaseline="central" transform={"rotate("+((i+.5)*step)+" "+label.join(" ")+")"}>{i+1}</text></g>;})}
 {Array.from({length:24},(_,i)=>{const p=pt(148,i*15);return <circle key={i} cx={p[0]} cy={p[1]} r="5" fill="#fffef0" stroke="#ffeaa5" strokeWidth="2"/>;})}
 <circle cx="160" cy="160" r="34" fill="#805317"/><circle cx="160" cy="160" r="30" fill="url(#ow-gold)" stroke="#fff3b3" strokeWidth="3"/>
 <image href="/assets/logo.png" x="137" y="139" width="46" height="42" preserveAspectRatio="xMidYMid meet"/>
 </svg></div><div className="ow-pointer" aria-hidden="true"/></div>
 <div className="ow-legend">{options.map((o,i)=><div key={i}><span style={{background:colors[i%colors.length]}}>{i+1}</span><small>{o}</small></div>)}</div>
 {programmed&&<p className="ow-note">Premi assegnati a giri prestabiliti; gli altri giri non sono vincenti.</p>}
 {count!=null&&<p className="ow-note">Giri registrati: {count}</p>}
 {resultIndex==null?<button type="button" disabled={disabled||moving||n<2} onClick={spin}>{disabled?"Attendi…":"Gira la ruota"}</button>:<div className="ow-result" role="status">{revealed?(result||options[resultIndex]):"La ruota sta girando…"}</div>}
 {demo&&revealed&&onReplay&&<button type="button" className="gn-secondary" onClick={onReplay}>Simula un altro partecipante</button>}{demo&&<small>Simulazione: nessun premio reale.</small>}
 </div>;
});
