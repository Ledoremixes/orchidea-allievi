import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

export default function RewardsPanel({ student }) {
  const [summary, setSummary] = useState({ lessons_count: 0, event_rsvps: 0, earned_points: 0, spent_points: 0, balance_points: 0 });
  const [rewards, setRewards] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [claimingId, setClaimingId] = useState("");

  const load = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    const [summaryResult, rewardsResult, redemptionsResult] = await Promise.all([
      supabase.rpc("get_my_reward_summary"),
      supabase.from("reward_catalog").select("id, title, description, points_cost, stock, icon, active").eq("active", true).order("points_cost", { ascending: true }),
      supabase.from("reward_redemptions").select("id, reward_id, points_spent, status, source, requested_at, reward_catalog(title, icon)").eq("tesseramento_id", student.id).order("requested_at", { ascending: false }).limit(8),
    ]);
    const row = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    if (row) setSummary(row);
    setRewards(rewardsResult.data || []);
    setRedemptions(redemptionsResult.data || []);
    setLoading(false);
  }, [student?.id]);

  useEffect(() => { load(); }, [load]);

  const progress = useMemo(() => {
    const next = rewards.find((reward) => Number(reward.points_cost) > Number(summary.balance_points || 0));
    if (!next) return { next: null, percent: 100 };
    return { next, percent: Math.min(100, Math.round((Number(summary.balance_points || 0) / Number(next.points_cost || 1)) * 100)) };
  }, [rewards, summary.balance_points]);

  async function claim(reward) {
    setClaimingId(reward.id);
    setMessage("");
    const { data, error } = await supabase.rpc("claim_reward", { p_reward_id: reward.id });
    if (error) setMessage(error.message);
    else setMessage(data?.message || "Richiesta registrata.");
    setClaimingId("");
    await load();
  }

  return (
    <section className="rewards-section">
      <div className="rewards-head">
        <div><span className="orchidea-kicker">Orchidea Rewards</span><h3>I tuoi punti</h3><p>Accumuli punti partecipando davvero ai corsi. Anche le conferme alle serate danno un piccolo bonus community.</p></div>
        <div className="rewards-balance"><span>Saldo</span><strong>{loading ? "…" : summary.balance_points}</strong><small>Orchidea Points</small></div>
      </div>

      <div className="rewards-stats">
        <div><span>Lezioni registrate</span><strong>{summary.lessons_count || 0}</strong><small>+10 pt ciascuna</small></div>
        <div><span>Serate confermate</span><strong>{summary.event_rsvps || 0}</strong><small>+2 pt ciascuna</small></div>
        <div><span>Punti utilizzati</span><strong>{summary.spent_points || 0}</strong><small>premi richiesti</small></div>
      </div>

      {progress.next && <div className="rewards-progress"><div><span>Prossimo premio</span><strong>{progress.next.icon} {progress.next.title}</strong></div><div className="rewards-progress-track"><i style={{ width: `${progress.percent}%` }} /></div><small>{summary.balance_points || 0} / {progress.next.points_cost} pt</small></div>}
      {message && <div className="rewards-message">{message}</div>}

      <div className="reward-catalog-grid">
        {rewards.map((reward) => {
          const canClaim = Number(summary.balance_points || 0) >= Number(reward.points_cost || 0);
          return <article className={`reward-card ${canClaim ? "is-ready" : ""}`} key={reward.id}><span className="reward-icon">{reward.icon || "✦"}</span><div><strong>{reward.title}</strong><p>{reward.description || "Premio Orchidea"}</p><small>{reward.points_cost} punti</small></div><button type="button" onClick={() => claim(reward)} disabled={!canClaim || claimingId === reward.id}>{claimingId === reward.id ? "Richiedo…" : canClaim ? "Richiedi premio" : "Continua così"}</button></article>;
        })}
      </div>

      {redemptions.length > 0 && <div className="reward-history"><h4>I tuoi premi</h4>{redemptions.map((row) => <div key={row.id}><span>{row.reward_catalog?.icon || "✦"}</span><strong>{row.reward_catalog?.title || "Premio"}</strong><small>{row.source === "admin_gift" ? (row.status === "fulfilled" ? "Regalo Orchidea · consegnato" : "Regalo Orchidea · pronto") : row.status === "requested" ? "In attesa segreteria" : row.status === "approved" ? "Approvato" : row.status === "fulfilled" ? "Consegnato" : row.status}</small></div>)}</div>}
    </section>
  );
}
