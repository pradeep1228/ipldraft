import { useState, useEffect, useCallback, useRef } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
// After deploying to Azure Static Web Apps, the /api/* routes are automatically
// proxied to your Azure Functions. No URL change needed.
const API_BASE = "/api";
const POLL_INTERVAL = 2500; // ms — how often participants refresh state

// ─── Constants ────────────────────────────────────────────────────────────────
const IPL_TEAMS = [
  { id: "MI",   name: "Mumbai Indians",        color: "#004BA0", accent: "#D1AB3E" },
  { id: "CSK",  name: "Chennai Super Kings",   color: "#F9CD05", accent: "#0081E9" },
  { id: "RCB",  name: "Royal Challengers",     color: "#EC1C24", accent: "#000000" },
  { id: "KKR",  name: "Kolkata Knight Riders", color: "#3A225D", accent: "#F0B400" },
  { id: "DC",   name: "Delhi Capitals",        color: "#0078BC", accent: "#EF1C25" },
  { id: "PBKS", name: "Punjab Kings",          color: "#ED1B24", accent: "#A7A9AC" },
  { id: "RR",   name: "Rajasthan Royals",      color: "#EA1A85", accent: "#254AA5" },
  { id: "SRH",  name: "Sunrisers Hyderabad",   color: "#FF6B00", accent: "#000000" },
  { id: "LSG",  name: "Lucknow Super Giants",  color: "#A72056", accent: "#FFCC00" },
  { id: "GT",   name: "Gujarat Titans",        color: "#1C1C5E", accent: "#00BFFF" },
];

const ROLES = ["Batter", "Bowler", "All-rounder", "Wicket-keeper"];

function makeInitialState() {
  return {
    players: [],
    participants: [],
    draftStarted: false,
    draftEnded: false,
    currentTurn: 0,
    snakeOrder: [],
    hostCode: "HOST" + Math.random().toString(36).slice(2, 6).toUpperCase(),
  };
}

function generateSnakeOrder(n, rounds) {
  const order = [];
  for (let r = 0; r < rounds; r++) {
    const row = r % 2 === 0 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
    order.push(...row);
  }
  return order;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

// ─── Azure API helpers ────────────────────────────────────────────────────────
async function fetchState() {
  const res = await fetch(`${API_BASE}/GetState`);
  const data = await res.json();
  return data.state; // null if first run
}

async function pushState(state) {
  await fetch(`${API_BASE}/SetState`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [appState, setAppState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | saving | saved | error
  const [view, setView] = useState("login");
  const [loginCode, setLoginCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const pollRef = useRef(null);

  // ── Bootstrap: load state from Azure on mount ──
  useEffect(() => {
    fetchState().then(state => {
      setAppState(state || makeInitialState());
      setLoading(false);
    }).catch(() => {
      // Fallback to local if Azure unreachable (dev mode)
      setAppState(makeInitialState());
      setLoading(false);
    });
  }, []);

  // ── Poll Azure every POLL_INTERVAL when in draft view ──
  useEffect(() => {
    if (view === "draft" && appState) {
      pollRef.current = setInterval(async () => {
        try {
          const latest = await fetchState();
          if (latest) setAppState(latest);
        } catch (_) {}
      }, POLL_INTERVAL);
      return () => clearInterval(pollRef.current);
    }
  }, [view, appState?.currentTurn]);

  // ── Mutate: update local state AND push to Azure ──
  const mutate = useCallback(async (fn) => {
    setSyncStatus("saving");
    setAppState(prev => {
      const next = fn(JSON.parse(JSON.stringify(prev)));
      // Push async — don't block UI
      pushState(next)
        .then(() => setSyncStatus("saved"))
        .catch(() => setSyncStatus("error"));
      return next;
    });
  }, []);

  // ── Login ──
  function handleLogin() {
    setLoginError("");
    const code = loginCode.trim().toUpperCase();
    if (!appState) return;
    if (code === appState.hostCode) {
      setCurrentUser({ name: "Host", code, isHost: true });
      setView("host");
      return;
    }
    const participant = appState.participants.find(p => p.code === code);
    if (participant) {
      setCurrentUser({ name: participant.name, code, isHost: false });
      setView("draft");
      return;
    }
    setLoginError("Invalid code. Ask your host for a valid code.");
  }

  if (loading) return (
    <div style={styles.loadingWrap}>
      <div style={styles.loadingSpinner} />
      <div style={styles.loadingText}>Connecting to draft room…</div>
    </div>
  );

  if (!appState) return null;

  return (
    <>
      {/* Sync indicator */}
      {syncStatus === "saving" && <div style={styles.syncBadge}>⏳ Syncing…</div>}
      {syncStatus === "saved"  && <div style={{...styles.syncBadge, background:"#1a472a", color:"#5dde9a"}}>✓ Saved</div>}
      {syncStatus === "error"  && <div style={{...styles.syncBadge, background:"#4a1010", color:"#ff6b6b"}}>⚠ Sync error</div>}

      {view === "login" && (
        <LoginScreen
          loginCode={loginCode} setLoginCode={setLoginCode}
          loginError={loginError} onLogin={handleLogin}
          hostCode={appState.hostCode}
        />
      )}
      {view === "host" && (
        <HostScreen
          appState={appState} mutate={mutate}
          onGoToDraft={() => setView("draft")}
          currentUser={currentUser}
        />
      )}
      {view === "draft" && (
        <DraftScreen
          appState={appState} mutate={mutate}
          currentUser={currentUser}
          onBack={() => setView(currentUser?.isHost ? "host" : "login")}
        />
      )}
    </>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ loginCode, setLoginCode, loginError, onLogin, hostCode }) {
  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.logoMark}>🏏</div>
        <h1 style={styles.loginTitle}>IPL Snake Draft</h1>
        <p style={styles.loginSub}>Enter your draft code to join</p>
        <input
          style={styles.input}
          placeholder="Enter your code (e.g. ABC123)"
          value={loginCode}
          onChange={e => setLoginCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && onLogin()}
          maxLength={12}
        />
        {loginError && <p style={styles.error}>{loginError}</p>}
        <button style={styles.btnPrimary} onClick={onLogin}>Join Draft →</button>
        <div style={styles.hostHint}>
          <span style={{ opacity: 0.5 }}>Host code: </span>
          <code style={styles.hostCode}>{hostCode}</code>
        </div>
      </div>
    </div>
  );
}

// ─── Host Screen ──────────────────────────────────────────────────────────────
function HostScreen({ appState, mutate, onGoToDraft }) {
  const [tab, setTab] = useState("players");
  const [playerName, setPlayerName] = useState("");
  const [playerTeam, setPlayerTeam] = useState("MI");
  const [playerRole, setPlayerRole] = useState("Batter");
  const [participantName, setParticipantName] = useState("");
  const [rounds, setRounds] = useState(5);
  const [search, setSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState("ALL");
  const [shuffling, setShuffling] = useState(false);
  const [shuffleResult, setShuffleResult] = useState(null);
  const [importStatus, setImportStatus] = useState(null);
  const [importing, setImporting] = useState(false);

  const VALID_TEAMS = new Set(["MI","CSK","RCB","KKR","DC","PBKS","RR","SRH","LSG","GT"]);
  const VALID_ROLES = new Set(["Batter","Bowler","All-rounder","Wicket-keeper"]);

  async function handleExcelImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setImporting(true);
    setImportStatus(null);
    try {
      const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const newPlayers = [];
      let dupes = 0, errors = 0;
      const existingNames = new Set(appState.players.map(p => p.name.toLowerCase()));
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        for (const row of rows) {
          const name    = (row["Player"] || row["player"] || "").toString().trim();
          const rawTeam = (row["Team"]   || row["team"]   || sheetName).toString().trim().toUpperCase();
          const rawRole = (row["Role"]   || row["role"]   || "").toString().trim();
          if (!name) continue;
          const team = VALID_TEAMS.has(rawTeam) ? rawTeam : null;
          const role = VALID_ROLES.has(rawRole) ? rawRole
            : rawRole.toLowerCase().includes("bat")  ? "Batter"
            : rawRole.toLowerCase().includes("bowl") ? "Bowler"
            : rawRole.toLowerCase().includes("keep") ? "Wicket-keeper"
            : rawRole.toLowerCase().includes("all")  ? "All-rounder"
            : null;
          if (!team || !role) { errors++; continue; }
          if (existingNames.has(name.toLowerCase())) { dupes++; continue; }
          existingNames.add(name.toLowerCase());
          newPlayers.push({ id: uid(), name, team, role, picked: false, pickedBy: null });
        }
      }
      if (newPlayers.length > 0) mutate(s => { s.players.push(...newPlayers); return s; });
      setImportStatus({ count: newPlayers.length, dupes, errors });
    } catch (err) {
      setImportStatus({ count: 0, dupes: 0, errors: -1, message: err.message });
    }
    setImporting(false);
  }

  function addPlayer() {
    if (!playerName.trim()) return;
    mutate(s => { s.players.push({ id: uid(), name: playerName.trim(), team: playerTeam, role: playerRole, picked: false, pickedBy: null }); return s; });
    setPlayerName("");
  }

  function removePlayer(id) {
    mutate(s => { s.players = s.players.filter(p => p.id !== id); return s; });
  }

  function addParticipant() {
    if (!participantName.trim()) return;
    const code = participantName.trim().slice(0, 3).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
    mutate(s => { s.participants.push({ name: participantName.trim(), code, picks: [] }); return s; });
    setParticipantName("");
  }

  function removeParticipant(code) {
    mutate(s => { s.participants = s.participants.filter(p => p.code !== code); return s; });
  }

  function randomizeDraftOrder() {
    if (appState.participants.length < 2) return;
    setShuffling(true);
    setShuffleResult(null);
    setTimeout(() => {
      mutate(s => {
        const arr = [...s.participants];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        s.participants = arr;
        return s;
      });
      setShuffling(false);
      setShuffleResult("done");
      setTimeout(() => setShuffleResult(null), 3000);
    }, 1500);
  }

  function startDraft() {
    if (appState.participants.length < 2) return alert("Add at least 2 participants.");
    if (appState.players.length < appState.participants.length) return alert("Add more players than participants.");
    mutate(s => {
      s.snakeOrder = generateSnakeOrder(s.participants.length, rounds);
      s.currentTurn = 0;
      s.draftStarted = true;
      s.draftEnded = false;
      s.participants.forEach(p => p.picks = []);
      s.players.forEach(p => { p.picked = false; p.pickedBy = null; });
      return s;
    });
    onGoToDraft();
  }

  function resetDraft() {
    mutate(s => {
      s.draftStarted = false; s.draftEnded = false; s.currentTurn = 0; s.snakeOrder = [];
      s.participants.forEach(p => p.picks = []);
      s.players.forEach(p => { p.picked = false; p.pickedBy = null; });
      return s;
    });
  }

  const filtered = appState.players.filter(p =>
    (filterTeam === "ALL" || p.team === filterTeam) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  );
  const teamCount = {};
  appState.players.forEach(p => { teamCount[p.team] = (teamCount[p.team] || 0) + 1; });

  return (
    <div style={styles.hostWrap}>
      <div style={styles.sidebar}>
        <div style={styles.sidebarLogo}>🏏 Draft Host</div>
        {["players", "participants", "settings"].map(t => (
          <button key={t} style={{ ...styles.sidebarBtn, ...(tab === t ? styles.sidebarBtnActive : {}) }} onClick={() => setTab(t)}>
            {t === "players" ? "🧑 Players" : t === "participants" ? "👥 Participants" : "⚙️ Settings"}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={styles.btnStart} onClick={startDraft}>▶ Start Draft</button>
        {appState.draftStarted && <button style={{ ...styles.btnStart, background: "#555", marginTop: 8 }} onClick={onGoToDraft}>View Draft →</button>}
        <button style={{ ...styles.btnStart, background: "#c0392b", marginTop: 8 }} onClick={resetDraft}>↺ Reset</button>
        <div style={styles.hostCodeBox}>Host Code: <b>{appState.hostCode}</b></div>
      </div>

      <div style={styles.hostMain}>
        {tab === "players" && (
          <div>
            <h2 style={styles.sectionTitle}>Player Pool <span style={styles.badge}>{appState.players.length}</span></h2>

            {/* ── Excel Import ── */}
            <div style={styles.importBox}>
              <div style={{flex:1}}>
                <div style={{fontWeight:600, fontSize:14, color:"#fff"}}>📥 Import from Excel</div>
                <div style={{color:"#888", fontSize:12, marginTop:2}}>
                  Upload your <code style={{color:"#FFD700"}}>IPL_2026_Squads.xlsx</code> — supports "All Teams" sheet or per-team sheets
                </div>
              </div>
              <label style={{...styles.btnImport, opacity: importing ? 0.6 : 1, cursor: importing ? "not-allowed" : "pointer"}}>
                {importing ? "⏳ Importing…" : "📂 Choose File"}
                <input type="file" accept=".xlsx,.xls" style={{display:"none"}}
                  onChange={handleExcelImport} disabled={importing} />
              </label>
            </div>

            {importStatus && (
              <div style={{
                ...styles.importResult,
                borderColor: importStatus.errors === -1 ? "#ff6b6b" : "#5dde9a",
                background:  importStatus.errors === -1 ? "rgba(255,100,100,0.08)" : "rgba(0,200,100,0.08)",
              }}>
                {importStatus.errors === -1
                  ? `❌ Import failed: ${importStatus.message}`
                  : `✅ Imported ${importStatus.count} players${importStatus.dupes > 0 ? ` · ${importStatus.dupes} duplicates skipped` : ""}${importStatus.errors > 0 ? ` · ${importStatus.errors} rows skipped (missing team/role)` : ""}`
                }
              </div>
            )}

            <div style={styles.addRow}>
              <input style={{ ...styles.input, flex: 2 }} placeholder="Player name" value={playerName}
                onChange={e => setPlayerName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} />
              <select style={styles.select} value={playerTeam} onChange={e => setPlayerTeam(e.target.value)}>
                {IPL_TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select style={styles.select} value={playerRole} onChange={e => setPlayerRole(e.target.value)}>
                {ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
              <button style={styles.btnPrimary} onClick={addPlayer}>+ Add</button>
            </div>
            <div style={styles.filterRow}>
              <input style={{ ...styles.input, flex: 1 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
              <select style={styles.select} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
                <option value="ALL">All Teams</option>
                {IPL_TEAMS.map(t => <option key={t.id} value={t.id}>{t.id} ({teamCount[t.id] || 0})</option>)}
              </select>
            </div>
            <div style={styles.playerGrid}>
              {filtered.map(p => {
                const team = IPL_TEAMS.find(t => t.id === p.team);
                return (
                  <div key={p.id} style={{ ...styles.playerCard, borderLeft: `4px solid ${team?.color || "#888"}` }}>
                    <div>
                      <div style={styles.playerName}>{p.name}</div>
                      <div style={styles.playerMeta}>
                        <span style={{ ...styles.teamPill, background: team?.color || "#444" }}>{p.team}</span>
                        <span style={styles.rolePill}>{p.role}</span>
                      </div>
                    </div>
                    <button style={styles.delBtn} onClick={() => removePlayer(p.id)}>✕</button>
                  </div>
                );
              })}
              {filtered.length === 0 && <p style={{ color: "#888", gridColumn: "1/-1", padding: "2rem", textAlign: "center" }}>No players yet. Add some above!</p>}
            </div>
          </div>
        )}

        {tab === "participants" && (
          <div>
            <h2 style={styles.sectionTitle}>Participants <span style={styles.badge}>{appState.participants.length}</span></h2>
            <div style={styles.addRow}>
              <input style={{ ...styles.input, flex: 1 }} placeholder="Participant name" value={participantName}
                onChange={e => setParticipantName(e.target.value)} onKeyDown={e => e.key === "Enter" && addParticipant()} />
              <button style={styles.btnPrimary} onClick={addParticipant}>+ Add</button>
            </div>
            {appState.participants.length >= 2 && (
              <div style={styles.randomizeBox}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#fff" }}>🎲 Randomize Draft Order</div>
                  <div style={{ color: "#888", fontSize: 12, marginTop: 2 }}>Shuffles pick positions randomly</div>
                </div>
                <button style={{ ...styles.btnRandomize, opacity: shuffling ? 0.7 : 1 }}
                  onClick={randomizeDraftOrder} disabled={shuffling}>
                  {shuffling ? "🔀 Shuffling…" : "🔀 Randomize"}
                </button>
              </div>
            )}
            {shuffleResult === "done" && (
              <div style={styles.shuffleBanner}>✅ Order randomized! Pick #1 goes to <b>{appState.participants[0]?.name}</b></div>
            )}
            <div style={styles.participantList}>
              {appState.participants.map((p, i) => (
                <div key={p.code} style={{ ...styles.participantCard, opacity: shuffling ? 0.6 : 1, transition: "all 0.3s" }}>
                  <div style={{ ...styles.participantNum, background: i === 0 ? "#FFD700" : i === 1 ? "#C0C0C0" : i === 2 ? "#cd7f32" : "#333", color: i < 3 ? "#000" : "#aaa", fontSize: 11, width: 36, height: 36 }}>
                    {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}`}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.playerName}>{p.name}</div>
                    <div style={{ color: "#aaa", fontSize: 13 }}>Code: <b style={{ color: "#FFD700" }}>{p.code}</b> · {p.picks?.length || 0} picks</div>
                  </div>
                  <button style={styles.delBtn} onClick={() => removeParticipant(p.code)}>✕</button>
                </div>
              ))}
              {appState.participants.length === 0 && <p style={{ color: "#888", textAlign: "center", padding: "2rem" }}>No participants yet.</p>}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div>
            <h2 style={styles.sectionTitle}>Draft Settings</h2>
            <div style={styles.settingRow}>
              <label style={styles.label}>Rounds per participant</label>
              <input type="number" min={1} max={20} style={{ ...styles.input, width: 80 }} value={rounds}
                onChange={e => setRounds(parseInt(e.target.value) || 1)} />
            </div>
            <div style={styles.settingRow}>
              <label style={styles.label}>Host Code</label>
              <code style={styles.hostCode}>{appState.hostCode}</code>
            </div>
            <div style={styles.settingRow}>
              <label style={styles.label}>Total picks</label>
              <span style={{ color: "#FFD700" }}>{appState.participants.length * rounds}</span>
            </div>
            <div style={styles.settingRow}>
              <label style={styles.label}>Poll interval</label>
              <span style={{ color: "#aaa", fontSize: 13 }}>{POLL_INTERVAL / 1000}s (live sync)</span>
            </div>
            <div style={{ marginTop: 24, color: "#888", fontSize: 13 }}>
              Snake draft: picks go 1→N then N→1 each round. State is synced live via Azure Table Storage.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draft Screen ─────────────────────────────────────────────────────────────
function DraftScreen({ appState, mutate, currentUser, onBack }) {
  const [filterRole, setFilterRole] = useState("ALL");
  const [filterTeam, setFilterTeam] = useState("ALL");
  const [search, setSearch] = useState("");
  const [viewTab, setViewTab] = useState("pick");

  const { participants, players, snakeOrder, currentTurn, draftStarted, draftEnded } = appState;
  const currentPickerIdx = snakeOrder[currentTurn];
  const currentPicker = participants[currentPickerIdx];
  const isMyTurn = !currentUser?.isHost && currentPicker?.code === currentUser?.code;

  function pickPlayer(playerId) {
    if (!isMyTurn && !currentUser?.isHost) return;
    mutate(s => {
      const player = s.players.find(p => p.id === playerId);
      if (!player || player.picked) return s;
      player.picked = true;
      player.pickedBy = s.participants[s.snakeOrder[s.currentTurn]]?.name;
      const picker = s.participants[s.snakeOrder[s.currentTurn]];
      if (picker) picker.picks.push(playerId);
      s.currentTurn += 1;
      if (s.currentTurn >= s.snakeOrder.length) s.draftEnded = true;
      return s;
    });
  }

  const availablePlayers = players.filter(p =>
    !p.picked &&
    (filterRole === "ALL" || p.role === filterRole) &&
    (filterTeam === "ALL" || p.team === filterTeam) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const round = participants.length > 0 ? Math.floor(currentTurn / participants.length) + 1 : 1;
  const pickInRound = participants.length > 0 ? (currentTurn % participants.length) + 1 : 1;

  return (
    <div style={styles.draftWrap}>
      <div style={styles.draftTopBar}>
        <button style={styles.backBtn} onClick={onBack}>← Back</button>
        <div style={styles.draftTitle}>🏏 IPL Snake Draft</div>
        <div style={styles.userBadge}>{currentUser?.isHost ? "👑 Host" : `👤 ${currentUser?.name}`}</div>
      </div>

      {!draftEnded ? (
        <div style={{ ...styles.statusBanner, background: isMyTurn ? "#1a472a" : "#1a1a2e" }}>
          {draftStarted ? (
            <>
              <div style={styles.statusRound}>Round {round} · Pick {pickInRound} of {participants.length}</div>
              <div style={styles.statusPicker}>{isMyTurn ? "🟢 Your turn to pick!" : `⏳ Waiting for ${currentPicker?.name || "…"}`}</div>
              <div style={styles.snakeTrack}>
                {participants.map((p, i) => (
                  <div key={p.code} style={{ ...styles.snakeNode, background: i === currentPickerIdx ? "#FFD700" : "#333", color: i === currentPickerIdx ? "#000" : "#aaa", transform: i === currentPickerIdx ? "scale(1.1)" : "scale(1)" }}>
                    {p.name.split(" ")[0]}
                  </div>
                ))}
              </div>
            </>
          ) : <div style={{ color: "#888" }}>Draft not started yet. Waiting for host…</div>}
        </div>
      ) : (
        <div style={{ ...styles.statusBanner, background: "#1a472a", textAlign: "center" }}>
          <div style={{ fontSize: 28 }}>🎉 Draft Complete!</div>
          <div style={{ color: "#aaa", marginTop: 4 }}>All picks have been made.</div>
        </div>
      )}

      <div style={styles.tabBar}>
        {["pick", "teams"].map(t => (
          <button key={t} style={{ ...styles.tabBtn, ...(viewTab === t ? styles.tabBtnActive : {}) }} onClick={() => setViewTab(t)}>
            {t === "pick" ? "🎯 Pick Players" : "📋 Draft Boards"}
          </button>
        ))}
      </div>

      {viewTab === "pick" && (
        <div style={styles.draftBody}>
          <div style={styles.filterRow}>
            <input style={{ ...styles.input, flex: 1 }} placeholder="Search player…" value={search} onChange={e => setSearch(e.target.value)} />
            <select style={styles.select} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
              <option value="ALL">All IPL Teams</option>
              {IPL_TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select style={styles.select} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="ALL">All Roles</option>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={styles.playerGrid}>
            {availablePlayers.map(p => {
              const team = IPL_TEAMS.find(t => t.id === p.team);
              const canPick = draftStarted && !draftEnded && (isMyTurn || currentUser?.isHost);
              return (
                <div key={p.id} style={{ ...styles.playerCard, borderLeft: `4px solid ${team?.color || "#888"}`, cursor: canPick ? "pointer" : "default", opacity: canPick ? 1 : 0.6 }}
                  onClick={() => canPick && pickPlayer(p.id)}
                  onMouseEnter={e => { if (canPick) e.currentTarget.style.background = "#2a2a3a"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#1e1e2e"; }}>
                  <div>
                    <div style={styles.playerName}>{p.name}</div>
                    <div style={styles.playerMeta}>
                      <span style={{ ...styles.teamPill, background: team?.color || "#444" }}>{p.team}</span>
                      <span style={styles.rolePill}>{p.role}</span>
                    </div>
                  </div>
                  {canPick && <div style={{ color: "#FFD700", fontSize: 20 }}>+</div>}
                </div>
              );
            })}
            {availablePlayers.length === 0 && (
              <p style={{ color: "#888", gridColumn: "1/-1", padding: "2rem", textAlign: "center" }}>
                {players.filter(p => !p.picked).length === 0 ? "All players have been picked!" : "No players match filters."}
              </p>
            )}
          </div>
        </div>
      )}

      {viewTab === "teams" && (
        <div style={styles.draftBody}>
          <div style={styles.boardGrid}>
            {participants.map((p, i) => {
              const myPicks = p.picks.map(id => players.find(pl => pl.id === id)).filter(Boolean);
              const isActive = i === currentPickerIdx && !draftEnded;
              return (
                <div key={p.code} style={{ ...styles.boardCard, ...(isActive ? { borderColor: "#FFD700" } : {}) }}>
                  <div style={styles.boardHeader}>
                    <span>{p.name}</span>
                    {isActive && <span style={{ fontSize: 12, color: "#FFD700" }}>● picking</span>}
                    <span style={{ color: "#aaa", fontSize: 12 }}>{myPicks.length} picks</span>
                  </div>
                  {myPicks.length === 0
                    ? <div style={{ color: "#555", fontSize: 13, padding: "1rem 0", textAlign: "center" }}>No picks yet</div>
                    : myPicks.map(pl => {
                        const team = IPL_TEAMS.find(t => t.id === pl.team);
                        return (
                          <div key={pl.id} style={styles.miniPick}>
                            <span style={{ ...styles.teamPill, background: team?.color || "#444", fontSize: 10 }}>{pl.team}</span>
                            <span style={{ fontSize: 13 }}>{pl.name}</span>
                            <span style={{ color: "#888", fontSize: 11 }}>{pl.role}</span>
                          </div>
                        );
                      })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  loadingWrap: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0a0a12", gap: 16 },
  loadingSpinner: { width: 40, height: 40, border: "3px solid #333", borderTop: "3px solid #FFD700", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  loadingText: { color: "#aaa", fontSize: 14 },
  syncBadge: { position: "fixed", top: 12, right: 12, zIndex: 9999, background: "#1a1a2e", color: "#aaa", fontSize: 12, padding: "6px 12px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)" },
  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a12", backgroundImage: "radial-gradient(ellipse at 30% 20%, #1a1040 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, #0d2040 0%, transparent 60%)", fontFamily: "'Segoe UI', system-ui, sans-serif" },
  loginCard: { background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "3rem 2.5rem", textAlign: "center", width: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" },
  logoMark: { fontSize: 56, marginBottom: 12 },
  loginTitle: { color: "#FFD700", fontSize: 28, fontWeight: 800, margin: "0 0 8px", letterSpacing: -1 },
  loginSub: { color: "#aaa", fontSize: 14, margin: "0 0 2rem" },
  input: { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit" },
  btnPrimary: { background: "linear-gradient(135deg,#FFD700,#FFA500)", color: "#000", border: "none", borderRadius: 10, padding: "11px 22px", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%", marginTop: 12, fontFamily: "inherit" },
  error: { color: "#ff6b6b", fontSize: 13, margin: "8px 0" },
  hostHint: { marginTop: 20, fontSize: 12, color: "#666" },
  hostCode: { color: "#FFD700", fontFamily: "monospace", fontSize: 13 },
  hostWrap: { display: "flex", minHeight: "100vh", background: "#0d0d1a", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#fff" },
  sidebar: { width: 220, background: "#111120", borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", padding: "1.5rem 1rem", gap: 6, flexShrink: 0 },
  sidebarLogo: { color: "#FFD700", fontWeight: 800, fontSize: 18, marginBottom: 16, paddingLeft: 8 },
  sidebarBtn: { background: "transparent", border: "none", color: "#888", textAlign: "left", padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontFamily: "inherit", transition: "all 0.15s" },
  sidebarBtnActive: { background: "rgba(255,215,0,0.1)", color: "#FFD700", fontWeight: 600 },
  btnStart: { background: "linear-gradient(135deg,#FFD700,#FFA500)", color: "#000", border: "none", borderRadius: 10, padding: "10px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 13 },
  hostCodeBox: { marginTop: 12, color: "#555", fontSize: 11, textAlign: "center" },
  hostMain: { flex: 1, padding: "2rem", overflowY: "auto" },
  sectionTitle: { color: "#fff", fontWeight: 700, fontSize: 20, marginBottom: 20, display: "flex", alignItems: "center", gap: 10 },
  badge: { background: "#FFD700", color: "#000", borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 700 },
  addRow: { display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" },
  filterRow: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  select: { background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, outline: "none", fontFamily: "inherit" },
  importBox: {
    display:"flex", alignItems:"center", gap:14,
    background:"rgba(255,255,255,0.03)", border:"1px dashed rgba(255,255,255,0.15)",
    borderRadius:12, padding:"14px 18px", marginBottom:12,
  },
  btnImport: {
    display:"inline-block", background:"linear-gradient(135deg,#1a472a,#2ecc71)",
    color:"#fff", borderRadius:10, padding:"10px 18px", fontWeight:700,
    fontSize:13, fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0,
    border:"none",
  },
  importResult: {
    border:"1px solid", borderRadius:10, padding:"10px 16px",
    marginBottom:12, fontSize:13, color:"#fff",
  },
  playerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 },
  playerCard: { background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "background 0.2s" },
  playerName: { color: "#fff", fontWeight: 600, fontSize: 14, marginBottom: 6 },
  playerMeta: { display: "flex", gap: 6, alignItems: "center" },
  teamPill: { color: "#fff", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600 },
  rolePill: { color: "#aaa", fontSize: 11, background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: 20 },
  delBtn: { background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: 4 },
  randomizeBox: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.2)", borderRadius: 12, padding: "14px 18px", marginBottom: 16, gap: 12 },
  btnRandomize: { background: "linear-gradient(135deg,#7B2FBE,#4A90D9)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 700, fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" },
  shuffleBanner: { background: "rgba(0,200,100,0.12)", border: "1px solid rgba(0,200,100,0.3)", borderRadius: 10, padding: "12px 16px", marginBottom: 14, color: "#5dde9a", fontSize: 13 },
  participantList: { display: "flex", flexDirection: "column", gap: 10 },
  participantCard: { background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 },
  participantNum: { width: 32, height: 32, borderRadius: "50%", background: "#FFD700", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 },
  settingRow: { display: "flex", alignItems: "center", gap: 16, marginBottom: 20 },
  label: { color: "#aaa", fontSize: 14, width: 200 },
  draftWrap: { minHeight: "100vh", background: "#0d0d1a", color: "#fff", fontFamily: "'Segoe UI',system-ui,sans-serif", display: "flex", flexDirection: "column" },
  draftTopBar: { background: "#111120", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" },
  backBtn: { background: "none", border: "1px solid rgba(255,255,255,0.15)", color: "#aaa", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" },
  draftTitle: { color: "#FFD700", fontWeight: 800, fontSize: 18 },
  userBadge: { color: "#aaa", fontSize: 13 },
  statusBanner: { padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", transition: "background 0.5s" },
  statusRound: { color: "#aaa", fontSize: 12, marginBottom: 4 },
  statusPicker: { color: "#fff", fontWeight: 700, fontSize: 18, marginBottom: 12 },
  snakeTrack: { display: "flex", gap: 8, flexWrap: "wrap" },
  snakeNode: { padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, transition: "all 0.3s" },
  tabBar: { display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingLeft: 16 },
  tabBtn: { background: "none", border: "none", color: "#888", padding: "14px 20px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", borderBottom: "2px solid transparent" },
  tabBtnActive: { color: "#FFD700", borderBottomColor: "#FFD700" },
  draftBody: { flex: 1, padding: "16px 20px", overflowY: "auto" },
  boardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 },
  boardCard: { background: "#1e1e2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "14px" },
  boardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, fontWeight: 700, fontSize: 14 },
  miniPick: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" },
};
