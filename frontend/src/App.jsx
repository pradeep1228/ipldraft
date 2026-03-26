import { useState, useEffect, useCallback, useRef } from "react";

const API_BASE = "/api";
const POLL_INTERVAL = 2500;

const IPL_TEAMS = [
  { id: "MI",   name: "Mumbai Indians",        color: "#004BA0" },
  { id: "CSK",  name: "Chennai Super Kings",   color: "#F9CD05" },
  { id: "RCB",  name: "Royal Challengers",     color: "#EC1C24" },
  { id: "KKR",  name: "Kolkata Knight Riders", color: "#3A225D" },
  { id: "DC",   name: "Delhi Capitals",        color: "#0078BC" },
  { id: "PBKS", name: "Punjab Kings",          color: "#ED1B24" },
  { id: "RR",   name: "Rajasthan Royals",      color: "#EA1A85" },
  { id: "SRH",  name: "Sunrisers Hyderabad",   color: "#FF6B00" },
  { id: "LSG",  name: "Lucknow Super Giants",  color: "#A72056" },
  { id: "GT",   name: "Gujarat Titans",        color: "#1C1C5E" },
];

const ROLES = ["Batter", "Bowler", "All-rounder", "Wicket-keeper"];
// SQUAD_RULES is now stored in appState.squadRules (dynamic, configured by host)

function validateSquad(picks, allPlayers, squadRules) {
  const rules = squadRules || { total: 11, roles: {}, maxPerTeam: 0 };
  const players = picks.map(id => allPlayers.find(p => p.id === id)).filter(Boolean);
  const errors = [];
  if (players.length < rules.total) { errors.push(`Need ${rules.total - players.length} more player(s)`); return errors; }
  const roleCounts = {};
  players.forEach(p => { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; });
  Object.entries(rules.roles).forEach(([role, count]) => {
    if (count > 0 && (roleCounts[role] || 0) < count) errors.push(`Need ${count} ${role}(s), have ${roleCounts[role] || 0}`);
  });
  if (rules.maxPerTeam > 0) {
    const teamCounts = {};
    players.forEach(p => { teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });
    const violating = Object.entries(teamCounts).filter(([, c]) => c > rules.maxPerTeam);
    violating.forEach(([team, c]) => errors.push(`${team}: ${c} players (max ${rules.maxPerTeam} per team)`));
  }
  return errors;
}

function getSquadProgress(picks, allPlayers, squadRules) {
  const rules = squadRules || { total: 11, roles: {} };
  const players = picks.map(id => allPlayers.find(p => p.id === id)).filter(Boolean);
  const roleCounts = {};
  players.forEach(p => { roleCounts[p.role] = (roleCounts[p.role] || 0) + 1; });
  return { total: players.length, roles: roleCounts, done: players.length === rules.total && validateSquad(picks, allPlayers, rules).length === 0 };
}

function makeInitialState() {
  return {
    players: [], participants: [],
    draftStarted: false, draftEnded: false,
    currentTurn: 0, snakeOrder: [],
    hostCode: "HOST" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    squadRules: { total: 11, roles: { "Batter": 4, "All-rounder": 2, "Wicket-keeper": 1, "Bowler": 4 }, maxPerTeam: 1 },
    recentPick: null,
  };
}

function generateSnakeOrder(n, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) { const row = r % 2 === 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse(); order.push(...row); }
  return order;
}

function uid() { return Math.random().toString(36).slice(2, 10); }
async function fetchState() { const res = await fetch(`${API_BASE}/GetState`); const data = await res.json(); return data.state; }
async function pushState(state) { await fetch(`${API_BASE}/SetState`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) }); }

export default function App() {
  const [appState, setAppState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("idle");
  const [view, setView] = useState("login");
  const [loginCode, setLoginCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [squadViewUser, setSquadViewUser] = useState(null);

  useEffect(() => {
    fetchState().then(state => { setAppState(state || makeInitialState()); setLoading(false); }).catch(() => { setAppState(makeInitialState()); setLoading(false); });
  }, []);

  useEffect(() => {
    if ((view === "draft" || view === "host") && appState) {
      const interval = setInterval(async () => { try { const latest = await fetchState(); if (latest) setAppState(latest); } catch (_) {} }, POLL_INTERVAL);
      return () => clearInterval(interval);
    }
  }, [view]);

  const mutate = useCallback(async (fn) => {
    setSyncStatus("saving");
    setAppState(prev => {
      const next = fn(JSON.parse(JSON.stringify(prev)));
      pushState(next).then(() => setSyncStatus("saved")).catch(() => setSyncStatus("error"));
      return next;
    });
  }, []);

  function handleLogin() {
    setLoginError("");
    const code = loginCode.trim().toUpperCase();
    if (!appState) return;
    if (code === appState.hostCode) { setCurrentUser({ name: "Host", code, isHost: true }); setView("host"); return; }
    const participant = appState.participants.find(p => p.code === code);
    if (participant) { setCurrentUser({ name: participant.name, code, isHost: false }); setView("draft"); return; }
    setLoginError("Invalid code. Ask your host for a valid code.");
  }

  const openSquad = (u) => { setSquadViewUser(u); setView("squad"); };

  if (loading) return (<div style={S.loadingWrap}><div style={S.loadingSpinner} /><div style={S.loadingText}>Connecting to draft room…</div></div>);
  if (!appState) return null;

  return (
    <>
      {syncStatus === "saving" && <div style={S.syncBadge}>⏳ Syncing…</div>}
      {syncStatus === "saved"  && <div style={{...S.syncBadge, background:"#d4edda", color:"#1a6b35"}}>✓ Saved</div>}
      {syncStatus === "error"  && <div style={{...S.syncBadge, background:"#f8d7da", color:"#cc0000"}}>⚠ Sync error</div>}
      {view === "login" && <LoginScreen loginCode={loginCode} setLoginCode={setLoginCode} loginError={loginError} onLogin={handleLogin} hostCode={appState.hostCode} />}
      {view === "host"  && <HostScreen appState={appState} mutate={mutate} onGoToDraft={() => setView("draft")} onViewSquad={openSquad} />}
      {view === "draft" && <DraftScreen appState={appState} mutate={mutate} currentUser={currentUser} onBack={() => setView(currentUser?.isHost ? "host" : "login")} onViewSquad={openSquad} />}
      {view === "squad" && <SquadScreen appState={appState} user={squadViewUser || currentUser} onBack={() => setView(currentUser?.isHost ? "host" : "draft")} />}
    </>
  );
}

function LoginScreen({ loginCode, setLoginCode, loginError, onLogin, hostCode }) {
  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.logoMark}>🏏</div>
        <h1 style={S.loginTitle}>IPL Snake Draft</h1>
        <p style={S.loginSub}>Enter your draft code to join</p>
        <input style={S.input} placeholder="Enter your code" value={loginCode} onChange={e => setLoginCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && onLogin()} maxLength={12} />
        {loginError && <p style={S.error}>{loginError}</p>}
        <button style={S.btnPrimary} onClick={onLogin}>Join Draft →</button>
        <div style={S.hostHint}><span style={{opacity:0.5}}>Host code: </span><code style={S.hostCode}></code></div>
      </div>
    </div>
  );
}

function HostScreen({ appState, mutate, onGoToDraft, onViewSquad }) {
  const [tab, setTab] = useState("players");
  const [playerName, setPlayerName] = useState(""); const [playerTeam, setPlayerTeam] = useState("MI"); const [playerRole, setPlayerRole] = useState("Batter");
  const [participantName, setParticipantName] = useState(""); const [rounds, setRounds] = useState(appState.squadRules?.total || 11);
  const [search, setSearch] = useState(""); const [filterTeam, setFilterTeam] = useState("ALL");
  const [shuffling, setShuffling] = useState(false); const [shuffleResult, setShuffleResult] = useState(null);
  const [importStatus, setImportStatus] = useState(null); const [importing, setImporting] = useState(false);
  const VALID_TEAMS = new Set(["MI","CSK","RCB","KKR","DC","PBKS","RR","SRH","LSG","GT"]);
  const VALID_ROLES = new Set(["Batter","Bowler","All-rounder","Wicket-keeper"]);

  async function handleExcelImport(e) {
    const file = e.target.files[0]; if (!file) return; e.target.value = ""; setImporting(true); setImportStatus(null);
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: "array" });
      const newPlayers = []; let dupes = 0, errors = 0;
      const existingNames = new Set(appState.players.map(p => p.name.toLowerCase()));
      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
        for (const row of rows) {
          const name = (row["Player"] || row["player"] || "").toString().trim();
          const rawTeam = (row["Team"] || row["team"] || sheetName).toString().trim().toUpperCase();
          const rawRole = (row["Role"] || row["role"] || "").toString().trim();
          if (!name) continue;
          const team = VALID_TEAMS.has(rawTeam) ? rawTeam : null;
          const role = VALID_ROLES.has(rawRole) ? rawRole : rawRole.toLowerCase().includes("bat") ? "Batter" : rawRole.toLowerCase().includes("bowl") ? "Bowler" : rawRole.toLowerCase().includes("keep") ? "Wicket-keeper" : rawRole.toLowerCase().includes("all") ? "All-rounder" : null;
          if (!team || !role) { errors++; continue; }
          if (existingNames.has(name.toLowerCase())) { dupes++; continue; }
          existingNames.add(name.toLowerCase());
          newPlayers.push({ id: uid(), name, team, role, picked: false, pickedBy: null, points: 0 });
        }
      }
      if (newPlayers.length > 0) mutate(s => { s.players.push(...newPlayers); return s; });
      setImportStatus({ count: newPlayers.length, dupes, errors });
    } catch (err) { setImportStatus({ count: 0, dupes: 0, errors: -1, message: err.message }); }
    setImporting(false);
  }

  function addPlayer() { if (!playerName.trim()) return; mutate(s => { s.players.push({ id: uid(), name: playerName.trim(), team: playerTeam, role: playerRole, picked: false, pickedBy: null, points: 0 }); return s; }); setPlayerName(""); }
  function removePlayer(id) { mutate(s => { s.players = s.players.filter(p => p.id !== id); return s; }); }
  function addParticipant() { if (!participantName.trim()) return; const code = participantName.trim().slice(0,3).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); mutate(s => { s.participants.push({ name: participantName.trim(), code, picks: [] }); return s; }); setParticipantName(""); }
  function removeParticipant(code) { mutate(s => { s.participants = s.participants.filter(p => p.code !== code); return s; }); }

  function randomizeDraftOrder() {
    if (appState.participants.length < 2) return; setShuffling(true); setShuffleResult(null);
    setTimeout(() => {
      mutate(s => { const arr = [...s.participants]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } s.participants = arr; return s; });
      setShuffling(false); setShuffleResult("done"); setTimeout(() => setShuffleResult(null), 3000);
    }, 1500);
  }

  function startDraft() {
    if (appState.participants.length < 2) return alert("Add at least 2 participants.");
    if (appState.players.length < appState.participants.length * (appState.squadRules?.total || 11)) return alert(`Need at least ${appState.participants.length * (appState.squadRules?.total || 11)} players.`);
    mutate(s => { s.snakeOrder = generateSnakeOrder(s.participants.length, rounds); s.currentTurn = 0; s.draftStarted = true; s.draftEnded = false; s.participants.forEach(p => p.picks = []); s.players.forEach(p => { p.picked = false; p.pickedBy = null; }); return s; });
    onGoToDraft();
  }

  function resetDraft() { mutate(s => { s.draftStarted = false; s.draftEnded = false; s.currentTurn = 0; s.snakeOrder = []; s.participants.forEach(p => p.picks = []); s.players.forEach(p => { p.picked = false; p.pickedBy = null; }); return s; }); }

  function clearEverything() {
    mutate(s => {
      s.players = [];
      s.participants = [];
      s.draftStarted = false;
      s.draftEnded = false;
      s.currentTurn = 0;
      s.snakeOrder = [];
      s.hostCode = "HOST" + Math.random().toString(36).slice(2, 6).toUpperCase();
      return s;
    });
  }

  function clearPoints() {
    mutate(s => { s.players.forEach(p => { p.points = 0; }); return s; });
  }

  function clearPicksOnly() {
    mutate(s => {
      s.draftStarted = false;
      s.draftEnded = false;
      s.currentTurn = 0;
      s.snakeOrder = [];
      s.participants.forEach(p => p.picks = []);
      s.players.forEach(p => { p.picked = false; p.pickedBy = null; p.points = 0; });
      return s;
    });
  }

  const filtered = appState.players.filter(p => (filterTeam === "ALL" || p.team === filterTeam) && p.name.toLowerCase().includes(search.toLowerCase()));
  const teamCount = {}; appState.players.forEach(p => { teamCount[p.team] = (teamCount[p.team]||0)+1; });

  return (
    <div style={S.hostWrap}>
      <div style={S.sidebar}>
        <div style={S.sidebarLogo}>🏏 Host Panel</div>
        {["players","participants","live","points","settings"].map(t => (
          <button key={t} style={{...S.sidebarBtn,...(tab===t?S.sidebarBtnActive:{})}} onClick={()=>setTab(t)}>
            {t==="players"?"🧑 Players":t==="participants"?"👥 Participants":t==="live"?"📺 Live Draft":t==="points"?"🏅 Points":"⚙️ Settings"}
          </button>
        ))}
        <div style={{flex:1}} />
        <button style={S.btnStart} onClick={startDraft}>▶ Start Draft</button>
        {appState.draftStarted && <button style={{...S.btnStart,background:"#444",marginTop:8}} onClick={onGoToDraft}>View Draft →</button>}
        <button style={{...S.btnStart,background:"#b03020",marginTop:8}} onClick={() => { if(window.confirm("Reset draft picks? Players and participants stay, all picks and points cleared.")) clearPicksOnly(); }}>↺ Reset Draft</button>
        <button style={{...S.btnStart,background:"#7b1fa2",marginTop:8}} onClick={() => { if(window.confirm("Clear all points? Player list and participants stay.")) clearPoints(); }}>🗑 Clear Points</button>
        <button style={{...S.btnStart,background:"#c62828",marginTop:8}} onClick={() => { if(window.confirm("⚠️ Start fresh? This clears EVERYTHING — all players, participants, picks and points. Cannot be undone.")) clearEverything(); }}>⚡ Start Fresh</button>
        <div style={S.hostCodeBox}>Host Code: <b>{appState.hostCode}</b></div>
      </div>

      <div style={S.hostMain}>
        {tab === "players" && (
          <div>
            <h2 style={S.sectionTitle}>Player Pool <span style={S.badge}>{appState.players.length}</span></h2>
            <div style={S.importBox}>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:14,color:"#111111"}}>📥 Import from Excel</div><div style={{color:"#777777",fontSize:12,marginTop:2}}>Upload IPL_2026_Squads.xlsx</div></div>
              <label style={{...S.btnImport,opacity:importing?0.6:1,cursor:importing?"not-allowed":"pointer"}}>{importing?"⏳ Importing…":"📂 Choose File"}<input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleExcelImport} disabled={importing} /></label>
            </div>
            {importStatus && <div style={{...S.importResult,borderColor:importStatus.errors===-1?"#cc0000":"#1a6b35",background:importStatus.errors===-1?"#fff0f0":"#e8f5e9"}}>{importStatus.errors===-1?`❌ ${importStatus.message}`:`✅ Imported ${importStatus.count} players${importStatus.dupes>0?` · ${importStatus.dupes} dupes skipped`:""}`}</div>}
            <div style={S.addRow}>
              <input style={{...S.input,flex:2}} placeholder="Player name" value={playerName} onChange={e=>setPlayerName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} />
              <select style={S.select} value={playerTeam} onChange={e=>setPlayerTeam(e.target.value)}>{IPL_TEAMS.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <select style={S.select} value={playerRole} onChange={e=>setPlayerRole(e.target.value)}>{ROLES.map(r=><option key={r}>{r}</option>)}</select>
              <button style={S.btnPrimary} onClick={addPlayer}>+ Add</button>
            </div>
            <div style={S.filterRow}>
              <input style={{...S.input,flex:1}} placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} />
              <select style={S.select} value={filterTeam} onChange={e=>setFilterTeam(e.target.value)}><option value="ALL">All Teams</option>{IPL_TEAMS.map(t=><option key={t.id} value={t.id}>{t.id} ({teamCount[t.id]||0})</option>)}</select>
            </div>
            <div style={S.playerGrid}>
              {filtered.map(p => { const team=IPL_TEAMS.find(t=>t.id===p.team); return (<div key={p.id} style={{...S.playerCard,borderLeft:`4px solid ${team?.color||"#777777"}`}}><div><div style={S.playerName}>{p.name}</div><div style={S.playerMeta}><span style={{...S.teamPill,background:team?.color||"#888888"}}>{p.team}</span><span style={S.rolePill}>{p.role}</span></div></div><button style={S.delBtn} onClick={()=>removePlayer(p.id)}>✕</button></div>); })}
              {filtered.length===0&&<p style={{color:"#777777",gridColumn:"1/-1",padding:"2rem",textAlign:"center"}}>No players yet.</p>}
            </div>
          </div>
        )}

        {tab === "participants" && (
          <div>
            <h2 style={S.sectionTitle}>Participants <span style={S.badge}>{appState.participants.length}</span></h2>
            <div style={S.addRow}><input style={{...S.input,flex:1}} placeholder="Participant name" value={participantName} onChange={e=>setParticipantName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addParticipant()} /><button style={S.btnPrimary} onClick={addParticipant}>+ Add</button></div>
            {appState.participants.length>=2&&<div style={S.randomizeBox}><div><div style={{fontWeight:600,fontSize:14,color:"#111111"}}>🎲 Randomize Draft Order</div><div style={{color:"#777777",fontSize:12,marginTop:2}}>Shuffles positions randomly</div></div><button style={{...S.btnRandomize,opacity:shuffling?0.7:1}} onClick={randomizeDraftOrder} disabled={shuffling}>{shuffling?"🔀 Shuffling…":"🔀 Randomize"}</button></div>}
            {shuffleResult==="done"&&<div style={S.shuffleBanner}>✅ Order randomized! Pick #1 goes to <b>{appState.participants[0]?.name}</b></div>}
            <div style={S.participantList}>
              {appState.participants.map((p,i)=>{
                const prog=getSquadProgress(p.picks||[],appState.players,appState.squadRules);
                return (
                  <div key={p.code} style={{...S.participantCard,opacity:shuffling?0.6:1}}>
                    <div style={{...S.participantNum,background:i===0?"#b8860b":i===1?"#C0C0C0":i===2?"#cd7f32":"#dddddd",color:i<3?"#000":"#555555",fontSize:11,width:36,height:36}}>{i===0?"1st":i===1?"2nd":i===2?"3rd":`${i+1}`}</div>
                    <div style={{flex:1}}><div style={S.playerName}>{p.name}</div><div style={{color:"#555555",fontSize:13}}>Code: <b style={{color:"#b8860b"}}>{p.code}</b> · {prog.total}/{appState.squadRules?.total||11} picks</div></div>
                    {prog.done&&<span style={{color:"#1a6b35",fontSize:12,fontWeight:600}}>✓ Done</span>}
                    <button style={{background:"none",border:"1px solid #cccccc",color:"#555555",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12,marginLeft:8}} onClick={()=>onViewSquad(p)}>👁 Squad</button>
                    <button style={S.delBtn} onClick={()=>removeParticipant(p.code)}>✕</button>
                  </div>
                );
              })}
              {appState.participants.length===0&&<p style={{color:"#777777",textAlign:"center",padding:"2rem"}}>No participants yet.</p>}
            </div>
          </div>
        )}

        {tab === "live" && (
          <div>
            <h2 style={S.sectionTitle}>📺 Live Draft Board</h2>
            <PickNotification recentPick={appState.recentPick} currentUser={{isHost:true}} />
            {!appState.draftStarted&&<p style={{color:"#777777"}}>Draft hasn't started yet.</p>}
            {appState.draftStarted&&(
              <>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
                  {appState.participants.map((p,i)=>{
                    const prog=getSquadProgress(p.picks||[],appState.players,appState.squadRules);
                    const isActive=i===appState.snakeOrder[appState.currentTurn]&&!appState.draftEnded;
                    return (
                      <div key={p.code} onClick={()=>onViewSquad(p)} style={{background:isActive?"#fffbe6":"#ffffff",border:`1px solid ${isActive?"#b8860b":"#e0e0e0"}`,borderRadius:10,padding:"10px 14px",cursor:"pointer",minWidth:150}}>
                        <div style={{fontWeight:600,fontSize:13,color:isActive?"#b8860b":"#222222",marginBottom:4}}>{isActive?"● ":""}{p.name}</div>
                        <div style={{fontSize:12,color:"#555555",marginBottom:6}}>{prog.total}/{appState.squadRules?.total||11} picks</div>
                        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                          {Object.entries(appState.squadRules?.roles||{}).filter(([,need])=>need>0).map(([role,need])=>{ const have=prog.roles[role]||0; return <span key={role} style={{fontSize:10,padding:"1px 6px",borderRadius:10,background:have>=need?"#c8e6c9":"#f0f0f0",color:have>=need?"#1a6b35":"#666666"}}>{role.slice(0,3)} {have}/{need}</span>; })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{marginBottom:20}}><LeaderboardView appState={appState} onViewSquad={onViewSquad} /></div>
                <div style={{fontSize:12,fontWeight:600,color:"#777",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10,marginTop:24}}>Pick-by-pick boards</div>
                <div style={S.boardGrid}>
                  {appState.participants.map((p,i)=>{
                    const myPicks=(p.picks||[]).map(id=>appState.players.find(pl=>pl.id===id)).filter(Boolean);
                    const isActive=i===appState.snakeOrder[appState.currentTurn]&&!appState.draftEnded;
                    return (
                      <div key={p.code} style={{...S.boardCard,...(isActive?{borderColor:"#b8860b"}:{}),cursor:"pointer"}} onClick={()=>onViewSquad(p)}>
                        <div style={S.boardHeader}><span style={{color:isActive?"#b8860b":"#222222"}}>{p.name}</span><span style={{color:"#555555",fontSize:12}}>{myPicks.length}/{appState.squadRules?.total||11}</span></div>
                        {myPicks.length===0?<div style={{color:"#555555",fontSize:12,padding:"0.5rem 0",textAlign:"center"}}>No picks yet</div>:myPicks.map(pl=>{ const team=IPL_TEAMS.find(t=>t.id===pl.team); return <div key={pl.id} style={S.miniPick}><span style={{...S.teamPill,background:team?.color||"#888888",fontSize:10}}>{pl.team}</span><span style={{fontSize:12,flex:1}}>{pl.name}</span><span style={{color:"#777777",fontSize:10}}>{pl.role.slice(0,3)}</span></div>; })}
                        {myPicks.length>0&&<div style={{color:"#555555",fontSize:11,marginTop:6,textAlign:"center"}}>Tap to view squad →</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "points" && <PointsTab appState={appState} mutate={mutate} />}

        {tab === "settings" && (
          <div>
            <h2 style={S.sectionTitle}>Draft Settings</h2>
            <div style={{background:"#fffbe6",border:"1px solid rgba(255,215,0,0.2)",borderRadius:12,padding:"16px 20px",marginBottom:20}}>
              <div style={{color:"#b8860b",fontWeight:600,marginBottom:10}}>Squad Rules (fixed)</div>
              <div style={{fontSize:13,color:"#ccc",lineHeight:2}}>✓ Each participant picks <b>11 players</b><br/>✓ Exactly <b>4 Batters · 2 All-rounders · 1 Wicket-keeper · 4 Bowlers</b></div>
            </div>
            <div style={S.settingRow}><label style={S.label}>Rounds (set to 11)</label><input type="number" min={1} max={20} style={{...S.input,width:80}} value={rounds} onChange={e=>setRounds(parseInt(e.target.value)||11)} /></div>
            {/* Max players per team */}
            <div style={{background:"#f0f4ff",border:"1px solid #c5cae9",borderRadius:12,padding:"20px",marginBottom:20}}>
              <div style={{color:"#3949ab",fontWeight:700,fontSize:15,marginBottom:14}}>🏏 Team Restriction</div>
              <div style={S.settingRow}>
                <label style={{...S.label,flex:1}}>
                  Max players from same team
                  <div style={{fontSize:12,color:"#888",fontWeight:400,marginTop:2}}>Set 0 = no team restriction</div>
                </label>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <button style={{width:32,height:32,borderRadius:6,border:"1px solid #ddd",background:"#f5f5f5",fontSize:18,cursor:"pointer",color:"#555"}}
                    onClick={()=>mutate(s=>{if(!s.squadRules)s.squadRules={total:11,roles:{},maxPerTeam:0};s.squadRules.maxPerTeam=Math.max(0,(s.squadRules.maxPerTeam||0)-1);return s;})}>−</button>
                  <div style={{width:48,textAlign:"center",fontSize:20,fontWeight:700,color:(appState.squadRules?.maxPerTeam||0)===0?"#bbb":"#3949ab"}}>
                    {(appState.squadRules?.maxPerTeam||0)===0?"∞":appState.squadRules?.maxPerTeam}
                  </div>
                  <button style={{width:32,height:32,borderRadius:6,border:"1px solid #ddd",background:"#f5f5f5",fontSize:18,cursor:"pointer",color:"#555"}}
                    onClick={()=>mutate(s=>{if(!s.squadRules)s.squadRules={total:11,roles:{},maxPerTeam:0};s.squadRules.maxPerTeam=(s.squadRules.maxPerTeam||0)+1;return s;})}>+</button>
                  <span style={{fontSize:13,color:(appState.squadRules?.maxPerTeam||0)===0?"#999":"#3949ab",fontWeight:600}}>
                    {(appState.squadRules?.maxPerTeam||0)===0?"no limit":`max ${appState.squadRules?.maxPerTeam} per team`}
                  </span>
                </div>
              </div>
              <div style={{fontSize:12,color:"#666",marginTop:8,padding:"8px 12px",background:"#e8eaf6",borderRadius:8}}>
                {(appState.squadRules?.maxPerTeam||0)===1
                  ? "✓ Players can only pick 1 player from each IPL team"
                  : (appState.squadRules?.maxPerTeam||0)===0
                  ? "No team restriction — players can pick unlimited players from any team"
                  : `Players can pick up to ${appState.squadRules?.maxPerTeam} players from any single IPL team`}
              </div>
            </div>

            <div style={S.settingRow}><label style={S.label}>Host Code</label><code style={S.hostCode}>{appState.hostCode}</code></div>
          </div>
        )}
      </div>
    </div>
  );
}

function DraftScreen({ appState, mutate, currentUser, onBack, onViewSquad }) {
  const [filterRole, setFilterRole] = useState("ALL"); const [filterTeam, setFilterTeam] = useState("ALL"); const [search, setSearch] = useState(""); const [viewTab, setViewTab] = useState("pick");
  const { participants, players, snakeOrder, currentTurn, draftStarted, draftEnded } = appState;
  const currentPickerIdx = snakeOrder[currentTurn];
  const currentPicker = participants[currentPickerIdx];
  const myParticipant = participants.find(p => p.code === currentUser?.code);
  const isMyTurn = !currentUser?.isHost && currentPicker?.code === currentUser?.code;
  const myPicks = myParticipant?.picks || [];
  const myProgress = getSquadProgress(myPicks, players, appState.squadRules);
  const squadDone = myPicks.length === (appState.squadRules?.total || 11);

  function getRuleViolation(player) {
    if (currentUser?.isHost) return null;
    const currentPicks = myPicks.map(id => players.find(p => p.id === id)).filter(Boolean);
    const roleCounts = {}; currentPicks.forEach(p => { roleCounts[p.role] = (roleCounts[p.role]||0)+1; });
    const roleLimit = appState.squadRules?.roles?.[player.role] || 0;
    if (roleLimit > 0 && (roleCounts[player.role]||0) >= roleLimit) return `Already have ${roleLimit} ${player.role}(s)`;
    const maxPerTeam = appState.squadRules?.maxPerTeam || 0;
    if (maxPerTeam > 0) {
      const teamCount = currentPicks.filter(p => p.team === player.team).length;
      if (teamCount >= maxPerTeam) return `Already have ${maxPerTeam} player(s) from ${player.team}`;
    }
    return null;
  }

  function pickPlayer(playerId) {
    if (!draftStarted || draftEnded) return;
    if (!isMyTurn && !currentUser?.isHost) return;
    if (myPicks.length >= (appState.squadRules?.total || 11) && !currentUser?.isHost) return;
    const player = players.find(p => p.id === playerId); if (!player) return;
    const violation = getRuleViolation(player);
    if (violation && !currentUser?.isHost) { alert(`Cannot pick: ${violation}`); return; }
    mutate(s => {
      const pl = s.players.find(p => p.id === playerId); if (!pl || pl.picked) return s;
      const picker = s.participants[s.snakeOrder[s.currentTurn]];
      pl.picked = true; pl.pickedBy = picker?.name;
      if (picker) picker.picks.push(playerId);
      s.recentPick = { playerName: pl.name, playerTeam: pl.team, playerRole: pl.role, pickedBy: picker?.name, at: Date.now() };
      s.currentTurn += 1; if (s.currentTurn >= s.snakeOrder.length) s.draftEnded = true;
      return s;
    });
  }

  const availablePlayers = players.filter(p => !p.picked && (filterRole==="ALL"||p.role===filterRole) && (filterTeam==="ALL"||p.team===filterTeam) && p.name.toLowerCase().includes(search.toLowerCase()));
  const round = participants.length>0?Math.floor(currentTurn/participants.length)+1:1;
  const pickInRound = participants.length>0?(currentTurn%participants.length)+1:1;

  return (
    <div style={S.draftWrap}>
      <PickNotification recentPick={appState.recentPick} currentUser={currentUser} />
      <div style={S.draftTopBar}>
        <button style={S.backBtn} onClick={onBack}>← Back</button>
        <div style={S.draftTitle}>🏏 IPL Snake Draft</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {(squadDone||draftEnded)&&!currentUser?.isHost&&<button style={{...S.backBtn,borderColor:"#b8860b",color:"#b8860b"}} onClick={()=>onViewSquad(myParticipant)}>My Squad →</button>}
          <div style={S.userBadge}>{currentUser?.isHost?"👑 Host":`👤 ${currentUser?.name}`}</div>
        </div>
      </div>

      {!currentUser?.isHost&&draftStarted&&(
        <div style={{background:"#f8f8f8",padding:"10px 20px",borderBottom:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{color:"#666666",fontSize:12}}>My squad:</span>
          {Object.entries(appState.squadRules?.roles||{}).filter(([,need])=>need>0).map(([role,need])=>{ const have=myProgress.roles[role]||0; return <span key={role} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:have>=need?"#d4edda":"#f0f0f0",color:have>=need?"#1a6b35":"#777777",border:`1px solid ${have>=need?"#81c784":"#e0e0e0"}`}}>{role.slice(0,3)} {have}/{need}</span>; })}
          <span style={{fontSize:12,color:"#666666",marginLeft:"auto"}}>{myPicks.length}/{appState.squadRules?.total||11}</span>
          {squadDone&&<span style={{color:"#b8860b",fontSize:12,fontWeight:600}}>✓ Complete!</span>}
        </div>
      )}

      {!draftEnded?(
        <div style={{...S.statusBanner,background:isMyTurn?"#d4edda":"#f8f9fa"}}>
          {draftStarted?(<><div style={S.statusRound}>Round {round} · Pick {pickInRound} of {participants.length}</div><div style={S.statusPicker}>{isMyTurn?"🟢 Your turn to pick!":`⏳ Waiting for ${currentPicker?.name||"…"}`}</div><div style={S.snakeTrack}>{participants.map((p,i)=><div key={p.code} style={{...S.snakeNode,background:i===currentPickerIdx?"#b8860b":"#e8e8e8",color:i===currentPickerIdx?"#000":"#555555",transform:i===currentPickerIdx?"scale(1.1)":"scale(1)"}}>{p.name.split(" ")[0]}</div>)}</div></>):<div style={{color:"#777777"}}>Draft not started yet…</div>}
        </div>
      ):(
        <div style={{...S.statusBanner,background:"#d4edda",textAlign:"center"}}>
          <div style={{fontSize:28}}>🎉 Draft Complete!</div>
          <div style={{color:"#555555",marginTop:4}}>View your final squad below!</div>
        </div>
      )}

      <div style={S.tabBar}>
        {["pick","boards","leaderboard"].map(t=><button key={t} style={{...S.tabBtn,...(viewTab===t?S.tabBtnActive:{})}} onClick={()=>setViewTab(t)}>{t==="pick"?"🎯 Pick Players":t==="boards"?"📋 All Boards":"🏆 Leaderboard"}</button>)}
        {!currentUser?.isHost&&(squadDone||draftEnded)&&<button style={{...S.tabBtn,color:"#b8860b",borderBottom:viewTab==="mysquad"?"2px solid #FFD700":"2px solid transparent"}} onClick={()=>{setViewTab("mysquad");onViewSquad(myParticipant);}}>🏆 My Squad</button>}
      </div>

      {viewTab==="pick"&&(
        <div style={S.draftBody}>
          <div style={S.filterRow}>
            <input style={{...S.input,flex:1}} placeholder="Search player…" value={search} onChange={e=>setSearch(e.target.value)} />
            <select style={S.select} value={filterTeam} onChange={e=>setFilterTeam(e.target.value)}><option value="ALL">All Teams</option>{IPL_TEAMS.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <select style={S.select} value={filterRole} onChange={e=>setFilterRole(e.target.value)}><option value="ALL">All Roles</option>{ROLES.map(r=><option key={r}>{r}</option>)}</select>
          </div>
          <div style={S.playerGrid}>
            {availablePlayers.map(p=>{
              const team=IPL_TEAMS.find(t=>t.id===p.team);
              const canPick=draftStarted&&!draftEnded&&(isMyTurn||currentUser?.isHost)&&myPicks.length<appState.squadRules?.total||11;
              const violation=isMyTurn?getRuleViolation(p):null;
              const blocked=violation!==null&&isMyTurn;
              return (
                <div key={p.id} style={{...S.playerCard,borderLeft:`4px solid ${team?.color||"#777777"}`,cursor:canPick&&!blocked?"pointer":"default",opacity:canPick&&!blocked?1:0.45}}
                  onClick={()=>canPick&&!blocked&&pickPlayer(p.id)}
                  onMouseEnter={e=>{if(canPick&&!blocked)e.currentTarget.style.background="#f0f4ff";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#ffffff";}}>
                  <div style={{flex:1}}><div style={S.playerName}>{p.name}</div><div style={S.playerMeta}><span style={{...S.teamPill,background:team?.color||"#888888"}}>{p.team}</span><span style={S.rolePill}>{p.role}</span></div>{blocked&&<div style={{color:"#cc0000",fontSize:11,marginTop:4}}>⛔ {violation}</div>}</div>
                  {canPick&&!blocked&&<div style={{color:"#b8860b",fontSize:20}}>+</div>}
                </div>
              );
            })}
            {availablePlayers.length===0&&<p style={{color:"#777777",gridColumn:"1/-1",padding:"2rem",textAlign:"center"}}>{players.filter(p=>!p.picked).length===0?"All players picked!":"No players match filters."}</p>}
          </div>
        </div>
      )}

      {viewTab==="leaderboard"&&(
        <div style={S.draftBody}>
          <LeaderboardView appState={appState} onViewSquad={onViewSquad} />
        </div>
      )}

      {viewTab==="boards"&&(
        <div style={S.draftBody}>
          <div style={S.boardGrid}>
            {participants.map((p,i)=>{
              const mp=(p.picks||[]).map(id=>players.find(pl=>pl.id===id)).filter(Boolean);
              const isActive=i===currentPickerIdx&&!draftEnded;
              return (
                <div key={p.code} style={{...S.boardCard,...(isActive?{borderColor:"#b8860b"}:{}),cursor:"pointer"}} onClick={()=>onViewSquad(p)}>
                  <div style={S.boardHeader}><span style={{color:isActive?"#b8860b":"#222222"}}>{p.name}</span><span style={{color:"#555555",fontSize:12}}>{mp.length}/{appState.squadRules?.total||11}</span></div>
                  {mp.length===0?<div style={{color:"#555555",fontSize:12,padding:"0.5rem 0",textAlign:"center"}}>No picks yet</div>:mp.map(pl=>{ const team=IPL_TEAMS.find(t=>t.id===pl.team); return <div key={pl.id} style={S.miniPick}><span style={{...S.teamPill,background:team?.color||"#888888",fontSize:10}}>{pl.team}</span><span style={{fontSize:12,flex:1}}>{pl.name}</span><span style={{color:"#777777",fontSize:10}}>{pl.role.slice(0,3)}</span></div>; })}
                  {mp.length>0&&<div style={{color:"#555555",fontSize:11,marginTop:6,textAlign:"center"}}>Tap to view squad →</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SquadScreen({ appState, user, onBack }) {
  const { players } = appState;
  const participant = appState.participants.find(p => p.code === user?.code);
  const picks = (participant?.picks || []).map(id => players.find(p => p.id === id)).filter(Boolean);
  const progress = getSquadProgress(participant?.picks || [], players, appState.squadRules);
  const errors = validateSquad(participant?.picks || [], players, appState.squadRules);
  const isComplete = errors.length === 0 && picks.length === appState.squadRules?.total||11;
  const byRole = {}; ROLES.forEach(r => { byRole[r] = picks.filter(p => p.role === r); });

  return (
    <div style={S.draftWrap}>
      <div style={S.draftTopBar}>
        <button style={S.backBtn} onClick={onBack}>← Back</button>
        <div style={S.draftTitle}>🏏 {participant?.name || user?.name}'s Squad</div>
        <div style={{fontSize:13,color:isComplete?"#1a6b35":"#555555"}}>{isComplete?"✓ Valid squad":picks.length+"/"+appState.squadRules?.total||11+" picked"}</div>
      </div>

      <div style={{padding:"20px",maxWidth:860,margin:"0 auto",width:"100%",overflowY:"auto",background:"#f5f5f5"}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
          {Object.entries(appState.squadRules?.roles||{}).filter(([,need])=>need>0).map(([role,need])=>{ const have=progress.roles[role]||0; const ok=have>=need; return <div key={role} style={{padding:"6px 14px",borderRadius:20,fontSize:13,fontWeight:600,background:ok?"#d4edda":"#f0f0f0",color:ok?"#1a6b35":"#777777",border:`1px solid ${ok?"#81c784":"#e0e0e0"}`}}>{role} {have}/{need}</div>; })}
          <div style={{padding:"6px 14px",borderRadius:20,fontSize:13,fontWeight:600,background:picks.length===appState.squadRules?.total||11?"#d4edda":"#f0f0f0",color:picks.length===appState.squadRules?.total||11?"#1a6b35":"#555555",border:"1px solid #e0e0e0"}}>Total {picks.length}/{appState.squadRules?.total||11}</div>
        </div>

        {picks.length===0?<div style={{color:"#555555",textAlign:"center",padding:"3rem"}}>No players picked yet.</div>:(
          Object.entries(byRole).map(([role,rolePlayers])=>rolePlayers.length===0?null:(
            <div key={role} style={{marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:600,color:"#555555",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,paddingBottom:6,borderBottom:"1px solid rgba(255,255,255,0.06)"}}>{role}s ({rolePlayers.length}/{appState.squadRules?.roles||{}[role]})</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
                {rolePlayers.map(p=>{ const team=IPL_TEAMS.find(t=>t.id===p.team); return (<div key={p.id} style={{...S.playerCard,borderLeft:`4px solid ${team?.color||"#777777"}`}}><div><div style={S.playerName}>{p.name}</div><div style={S.playerMeta}><span style={{...S.teamPill,background:team?.color||"#888888"}}>{p.team}</span><span style={S.rolePill}>{team?.name||p.team}</span></div></div></div>); })}
              </div>
            </div>
          ))
        )}

        {errors.length>0&&picks.length>0&&(
          <div style={{background:"#fff0f0",border:"1px solid rgba(255,100,100,0.3)",borderRadius:12,padding:"14px 18px",marginTop:16}}>
            <div style={{color:"#cc0000",fontWeight:600,marginBottom:8}}>Squad issues to fix:</div>
            {errors.map((e,i)=><div key={i} style={{color:"#cc0000",fontSize:13,marginBottom:4}}>⚠ {e}</div>)}
          </div>
        )}

        {isComplete&&(
          <div style={{background:"#e8f5e9",border:"1px solid rgba(0,200,100,0.3)",borderRadius:12,padding:"20px",marginTop:16,textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>🏆</div>
            <div style={{color:"#1a6b35",fontWeight:700,fontSize:18}}>{participant?.name}'s squad is complete!</div>
            <div style={{color:"#555555",fontSize:13,marginTop:6}}>4 Batters · 2 All-rounders · 1 Wicket-keeper · 4 Bowlers · 1 from each IPL team</div>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Helper: compute leaderboard ─────────────────────────────────────────────
function computeLeaderboard(participants, players) {
  return participants.map(p => {
    const myPlayers = (p.picks || []).map(id => players.find(pl => pl.id === id)).filter(Boolean);
    const totalPoints = myPlayers.reduce((sum, pl) => sum + (pl.points || 0), 0);
    const topPlayer = myPlayers.reduce((best, pl) => (pl.points || 0) > (best?.points || 0) ? pl : best, null);
    return { ...p, totalPoints, myPlayers, topPlayer };
  }).sort((a, b) => b.totalPoints - a.totalPoints);
}

// ─── Points Tab (host) ────────────────────────────────────────────────────────
function PointsTab({ appState, mutate }) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [filterTeam, setFilterTeam] = useState("ALL");

  const filtered = appState.players.filter(p =>
    (filterTeam === "ALL" || p.team === filterTeam) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => (b.points || 0) - (a.points || 0));

  function savePoints(id) {
    const val = parseInt(editValue);
    if (isNaN(val)) return;
    mutate(s => { const pl = s.players.find(p => p.id === id); if (pl) pl.points = val; return s; });
    setEditingId(null); setEditValue("");
  }

  function addPoints(id, delta) {
    mutate(s => { const pl = s.players.find(p => p.id === id); if (pl) pl.points = (pl.points || 0) + delta; return s; });
  }

  const leaderboard = computeLeaderboard(appState.participants, appState.players);

  return (
    <div>
      <h2 style={S.sectionTitle}>🏅 Points Manager</h2>

      {/* Mini leaderboard at top */}
      {appState.participants.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#777", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Squad Leaderboard</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {leaderboard.map((p, i) => (
              <div key={p.code} style={{ display: "flex", alignItems: "center", gap: 12, background: i === 0 ? "#fffbe6" : "#fafafa", border: `1px solid ${i === 0 ? "#ffe066" : "#e0e0e0"}`, borderRadius: 10, padding: "10px 16px" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: i === 0 ? "#b8860b" : i === 1 ? "#9e9e9e" : i === 2 ? "#a0522d" : "#e0e0e0", color: i < 3 ? "#fff" : "#555", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{p.name}</div>
                  {p.topPlayer && <div style={{ fontSize: 11, color: "#888" }}>Best: {p.topPlayer.name} ({p.topPlayer.points || 0} pts)</div>}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: i === 0 ? "#b8860b" : "#333" }}>{p.totalPoints}</div>
                <div style={{ fontSize: 11, color: "#999" }}>pts</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player points editor */}
      <div style={{ fontSize: 12, fontWeight: 600, color: "#777", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Add / Edit Player Points</div>
      <div style={S.filterRow}>
        <input style={{ ...S.input, flex: 1 }} placeholder="Search player…" value={search} onChange={e => setSearch(e.target.value)} />
        <select style={S.select} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="ALL">All Teams</option>
          {IPL_TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map(p => {
          const team = IPL_TEAMS.find(t => t.id === p.team);
          const isEditing = editingId === p.id;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, padding: "10px 14px", borderLeft: `4px solid ${team?.color || "#ccc"}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#111" }}>{p.name}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  <span style={{ ...S.teamPill, background: team?.color || "#888" }}>{p.team}</span>
                  <span style={S.rolePill}>{p.role}</span>
                  {p.picked && <span style={{ ...S.rolePill, background: "#e8f5e9", color: "#1a6b35" }}>Drafted</span>}
                </div>
              </div>
              {isEditing ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" style={{ ...S.input, width: 80, padding: "6px 10px" }} value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") savePoints(p.id); if (e.key === "Escape") setEditingId(null); }}
                    autoFocus />
                  <button style={{ background: "#1a6b35", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12 }} onClick={() => savePoints(p.id)}>Save</button>
                  <button style={{ background: "#eee", color: "#555", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 12 }} onClick={() => setEditingId(null)}>✕</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 16, color: "#555" }} onClick={() => addPoints(p.id, -1)}>−</button>
                  <div style={{ minWidth: 52, textAlign: "center", fontWeight: 700, fontSize: 16, color: (p.points || 0) > 0 ? "#1a6b35" : "#999", cursor: "pointer" }}
                    onClick={() => { setEditingId(p.id); setEditValue(String(p.points || 0)); }}>
                    {p.points || 0}
                  </div>
                  <button style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 6, width: 28, height: 28, cursor: "pointer", fontSize: 16, color: "#555" }} onClick={() => addPoints(p.id, 1)}>+</button>
                  <button style={{ background: "#fffbe6", border: "1px solid #ffe066", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, color: "#b8860b", fontWeight: 600 }}
                    onClick={() => { setEditingId(p.id); setEditValue(String(p.points || 0)); }}>Edit</button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <p style={{ color: "#999", textAlign: "center", padding: "2rem" }}>No players found.</p>}
      </div>
    </div>
  );
}

// ─── Leaderboard Component (shared) ──────────────────────────────────────────
function LeaderboardView({ appState, onViewSquad }) {
  const leaderboard = computeLeaderboard(appState.participants, appState.players);
  if (leaderboard.length === 0) return <p style={{ color: "#999", textAlign: "center", padding: "3rem" }}>No participants yet.</p>;

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      {leaderboard.map((p, i) => {
        const prev = i > 0 ? leaderboard[i - 1].totalPoints : null;
        const gap = prev !== null ? prev - p.totalPoints : null;
        return (
          <div key={p.code} onClick={() => onViewSquad && onViewSquad(p)} style={{
            display: "flex", alignItems: "center", gap: 14,
            background: i === 0 ? "#fffbe6" : "#fff",
            border: `1px solid ${i === 0 ? "#ffe066" : "#e0e0e0"}`,
            borderRadius: 12, padding: "14px 18px", marginBottom: 10,
            cursor: onViewSquad ? "pointer" : "default",
            transition: "box-shadow 0.15s",
          }}
            onMouseEnter={e => { if (onViewSquad) e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; }}>
            {/* Rank */}
            <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, background: i === 0 ? "#b8860b" : i === 1 ? "#9e9e9e" : i === 2 ? "#a0522d" : "#eeeeee", color: i < 3 ? "#fff" : "#555" }}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
            </div>
            {/* Name + best player */}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>{p.name}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {p.myPlayers.slice(0, 5).map(pl => {
                  const team = IPL_TEAMS.find(t => t.id === pl.team);
                  return <span key={pl.id} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: team?.color || "#888", color: "#fff", fontWeight: 600 }}>{pl.name.split(" ").pop()} {pl.points || 0}</span>;
                })}
                {p.myPlayers.length > 5 && <span style={{ fontSize: 11, color: "#999" }}>+{p.myPlayers.length - 5} more</span>}
              </div>
            </div>
            {/* Score */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: i === 0 ? "#b8860b" : "#222" }}>{p.totalPoints}</div>
              <div style={{ fontSize: 11, color: "#999" }}>
                {gap !== null && gap > 0 ? `-${gap} pts` : gap === 0 ? "tied" : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


// ─── Pick Notification ────────────────────────────────────────────────────────
function PickNotification({ recentPick, currentUser }) {
  const [visible, setVisible] = useState(false);
  const [pick, setPick] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!recentPick || !recentPick.at) return;
    // Only show if pick is within last 8 seconds
    if (Date.now() - recentPick.at > 8000) return;
    setPick(recentPick);
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timerRef.current);
  }, [recentPick?.at]);

  if (!visible || !pick) return null;
  const team = IPL_TEAMS.find(t => t.id === pick.playerTeam);
  const isMyPick = currentUser?.name === pick.pickedBy || currentUser?.isHost;

  return (
    <div style={{
      position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
      zIndex: 9998, minWidth: 320, maxWidth: 480,
      background: "#ffffff", borderRadius: 14,
      boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
      border: `2px solid ${team?.color || "#e0e0e0"}`,
      padding: "14px 18px",
      display: "flex", alignItems: "center", gap: 14,
      animation: "slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)",
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(80px); opacity: 0; }
          to   { transform: translateX(-50%) translateY(0);   opacity: 1; }
        }
      `}</style>
      {/* Team color dot */}
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: team?.color || "#888", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>
        {pick.playerTeam}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#111", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {pick.playerName}
        </div>
        <div style={{ fontSize: 12, color: "#888" }}>
          <span style={{ background: "#f0f0f0", padding: "1px 8px", borderRadius: 10, marginRight: 6 }}>{pick.playerRole}</span>
          picked by <b style={{ color: "#333" }}>{pick.pickedBy}</b>
        </div>
      </div>
      <div style={{ fontSize: 22 }}>
        {isMyPick ? "✅" : "🏏"}
      </div>
    </div>
  );
}

const S = {
  loadingWrap:{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#f0f4ff",gap:16},
  loadingSpinner:{width:40,height:40,border:"3px solid #ddd",borderTop:"3px solid #b8860b",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
  loadingText:{color:"#555555",fontSize:14},
  syncBadge:{position:"fixed",top:12,right:12,zIndex:9999,background:"#f0f0f0",color:"#555555",fontSize:12,padding:"6px 12px",borderRadius:20,border:"1px solid #e0e0e0"},
  loginWrap:{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f0f4ff",backgroundImage:"radial-gradient(ellipse at 30% 20%, #1a1040 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0d2040 0%, transparent 60%)",fontFamily:"'Segoe UI', system-ui, sans-serif"},
  loginCard:{background:"#ffffff",border:"1px solid #e0e0e0",borderRadius:20,padding:"3rem 2.5rem",textAlign:"center",width:360,boxShadow:"0 4px 24px rgba(0,0,0,0.10)"},
  logoMark:{fontSize:56,marginBottom:12},loginTitle:{color:"#b8860b",fontSize:28,fontWeight:800,margin:"0 0 8px",letterSpacing:-1},
  loginSub:{color:"#555555",fontSize:14,margin:"0 0 2rem"},
  input:{background:"#ffffff",border:"1px solid #cccccc",borderRadius:10,padding:"10px 14px",color:"#111111",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box",fontFamily:"inherit"},
  btnPrimary:{background:"linear-gradient(135deg,#b8860b,#e07b00)",color:"#000",border:"none",borderRadius:10,padding:"11px 22px",fontWeight:700,fontSize:15,cursor:"pointer",width:"100%",marginTop:12,fontFamily:"inherit"},
  error:{color:"#cc0000",fontSize:13,margin:"8px 0"},hostHint:{marginTop:20,fontSize:12,color:"#666666"},hostCode:{color:"#b8860b",fontFamily:"monospace",fontSize:13},
  hostWrap:{display:"flex",minHeight:"100vh",background:"#f5f5f5",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#111111"},
  sidebar:{width:220,background:"#111111",borderRight:"1px solid #e0e0e0",display:"flex",flexDirection:"column",padding:"1.5rem 1rem",gap:6,flexShrink:0},
  sidebarLogo:{color:"#FFD700",fontWeight:800,fontSize:18,marginBottom:16,paddingLeft:8},
  sidebarBtn:{background:"transparent",border:"none",color:"#aaaaaa",textAlign:"left",padding:"10px 12px",borderRadius:8,cursor:"pointer",fontSize:14,fontFamily:"inherit",transition:"all 0.15s"},
  sidebarBtnActive:{background:"#fff8cc",color:"#b8860b",fontWeight:600},
  btnStart:{background:"linear-gradient(135deg,#b8860b,#e07b00)",color:"#000",border:"none",borderRadius:10,padding:"10px 14px",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:13},
  hostCodeBox:{marginTop:12,color:"#555555",fontSize:11,textAlign:"center"},hostMain:{flex:1,padding:"2rem",overflowY:"auto",background:"#f5f5f5"},
  sectionTitle:{color:"#111111",fontWeight:700,fontSize:20,marginBottom:20,display:"flex",alignItems:"center",gap:10},
  badge:{background:"#b8860b",color:"#000",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:700},
  addRow:{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"},
  filterRow:{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"},
  select:{background:"#ffffff",border:"1px solid #cccccc",borderRadius:10,padding:"10px 12px",color:"#111111",fontSize:13,outline:"none",fontFamily:"inherit"},
  importBox:{display:"flex",alignItems:"center",gap:14,background:"#f8f8f8",border:"1px dashed rgba(255,255,255,0.15)",borderRadius:12,padding:"14px 18px",marginBottom:12},
  btnImport:{display:"inline-block",background:"linear-gradient(135deg,#1a472a,#2ecc71)",color:"#ffffff",borderRadius:10,padding:"10px 18px",fontWeight:700,fontSize:13,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,border:"none"},
  importResult:{border:"1px solid",borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:13,color:"#222222"},
  playerGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10},
  playerCard:{background:"#ffffff",border:"1px solid #e0e0e0",borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"background 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"},
  playerName:{color:"#111111",fontWeight:600,fontSize:14,marginBottom:6},playerMeta:{display:"flex",gap:6,alignItems:"center"},
  teamPill:{color:"#ffffff",fontSize:11,padding:"2px 8px",borderRadius:20,fontWeight:600},
  rolePill:{color:"#555555",fontSize:11,background:"#e0e0e0",padding:"2px 8px",borderRadius:20},
  delBtn:{background:"none",border:"none",color:"#555555",cursor:"pointer",fontSize:14,padding:4},
  randomizeBox:{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fffbe6",border:"1px solid rgba(255,215,0,0.2)",borderRadius:12,padding:"14px 18px",marginBottom:16,gap:12},
  btnRandomize:{background:"linear-gradient(135deg,#7B2FBE,#4A90D9)",color:"#ffffff",border:"none",borderRadius:10,padding:"10px 18px",fontWeight:700,fontSize:13,fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0,cursor:"pointer"},
  shuffleBanner:{background:"#d4edda",border:"1px solid rgba(0,200,100,0.3)",borderRadius:10,padding:"12px 16px",marginBottom:14,color:"#1a6b35",fontSize:13},
  participantList:{display:"flex",flexDirection:"column",gap:10},
  participantCard:{background:"#ffffff",border:"1px solid #e0e0e0",borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",gap:14},
  participantNum:{width:32,height:32,borderRadius:"50%",background:"#b8860b",color:"#000",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,flexShrink:0},
  settingRow:{display:"flex",alignItems:"center",gap:16,marginBottom:20},label:{color:"#555555",fontSize:14,width:200},
  draftWrap:{minHeight:"100vh",background:"#f5f5f5",color:"#111111",fontFamily:"'Segoe UI',system-ui,sans-serif",display:"flex",flexDirection:"column"},
  draftTopBar:{background:"#ffffff",borderBottom:"1px solid #e0e0e0",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px"},
  backBtn:{background:"none",border:"1px solid #cccccc",color:"#555555",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit"},
  draftTitle:{color:"#b8860b",fontWeight:800,fontSize:18},userBadge:{color:"#555555",fontSize:13},
  statusBanner:{padding:"16px 24px",borderBottom:"1px solid rgba(255,255,255,0.06)",transition:"background 0.5s"},
  statusRound:{color:"#555555",fontSize:12,marginBottom:4},statusPicker:{color:"#111111",fontWeight:700,fontSize:18,marginBottom:12},
  snakeTrack:{display:"flex",gap:8,flexWrap:"wrap"},snakeNode:{padding:"5px 14px",borderRadius:20,fontSize:12,fontWeight:600,transition:"all 0.3s"},
  tabBar:{display:"flex",borderBottom:"1px solid #e0e0e0",paddingLeft:16},
  tabBtn:{background:"none",border:"none",color:"#777777",padding:"14px 20px",cursor:"pointer",fontSize:13,fontFamily:"inherit",borderBottom:"2px solid transparent"},
  tabBtnActive:{color:"#b8860b",borderBottomColor:"#b8860b"},
  draftBody:{flex:1,padding:"16px 20px",overflowY:"auto",background:"#f5f5f5"},
  boardGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14},
  boardCard:{background:"#ffffff",border:"1px solid #e0e0e0",borderRadius:12,padding:"14px"},
  boardHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,fontWeight:700,fontSize:14},
  miniPick:{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,0.05)"},
};
