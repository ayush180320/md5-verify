import { useState, useRef, useCallback, useEffect } from "react";

type Theme = "dark" | "light";
type HashCase = "lower" | "upper";

interface FileResult {
  id: string;
  file: File;
  hash: string | null;
  status: "idle" | "hashing" | "done" | "error";
  progress: number;
  speed: number;
  speedHistory: number[];       // for sparkline
  estimatedRemaining: number | null;
  elapsed: number | null;
  error?: string;
  expectedHash: string;
}

interface BenchResult { speedBps: number; estimatedSeconds: number; }

const MAX_PARALLEL = 3;        // hash up to 3 files simultaneously
const HISTORY_LEN  = 40;       // sparkline data points

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmtBytes(b: number, d = 2) {
  if (!b) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${s[i]}`;
}
function fmtExact(b: number) { return b.toLocaleString("en-US") + " bytes"; }
function fmtSpd(b: number)   { return fmtBytes(b, 1) + "/s"; }
function fmtTime(s: number) {
  if (s < 60)   return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.ceil((s % 3600) / 60)}m`;
}
function applyCase(h: string, c: HashCase) { return c === "upper" ? h.toUpperCase() : h; }
function uid() { return Math.random().toString(36).slice(2, 10); }
function escXml(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function dl(content: string, mime: string, name: string) {
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([content], { type: mime })), download: name,
  });
  a.click(); URL.revokeObjectURL(a.href);
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  if (data.length < 3) return null;
  const max = Math.max(...data);
  if (max === 0) return null;
  const W = 88, H = 22, n = data.length;
  const pts = data.map((v, i) =>
    `${((i / (n - 1)) * W).toFixed(1)},${(H - (v / max) * H * 0.85).toFixed(1)}`
  );
  const line = pts.join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  return (
    <svg width={W} height={H} className="shrink-0" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`g${stroke.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#g${stroke.replace("#","")})`} />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function palette(t: Theme) {
  return t === "dark" ? {
    bg:          "bg-[#0f0f11]",
    headerBg:    "bg-[#141416] border-[#2a2a2d]",
    card:        "bg-[#1a1a1d] border-[#2a2a2d]",
    cardHover:   "hover:border-[#3d3d40]",
    dropzone:    "border-[#2a2a2d] bg-[#141416]",
    dropActive:  "border-[#38bdf8] bg-[#38bdf8]/5",
    input:       "bg-[#0f0f11] border-[#2a2a2d] text-white placeholder-[#555]",
    text:        "text-white",
    textSub:     "text-[#c0c0c8]",
    textMuted:   "text-[#666]",
    statusBar:   "bg-[#0a0a0c] border-[#1e1e21]",
    sizeColor:   "text-[#fbbf24]",
    hashColor:   "text-[#34d399]",
    accent:      "text-[#38bdf8]",
    accentHex:   "#38bdf8",
    speedHex:    "#a78bfa",
    btnBase:     "bg-[#252528] border-[#333] text-[#c0c0c8] hover:border-[#555] hover:text-white",
    btnSuccess:  "border-[#34d399] text-[#34d399] bg-[#34d399]/10",
    matchBox:    "border-[#34d399]/40 bg-[#34d399]/8 text-[#34d399]",
    mismatchBox: "border-[#f87171]/40 bg-[#f87171]/8 text-[#f87171]",
    progress:    "bg-[#252528]",
    progressFg:  "bg-[#38bdf8]",
    insetBg:     "bg-[#111113] border-[#252528]",
    sep:         "bg-[#2a2a2d]",
    statLabel:   "text-[#555]",
    batchBar:    "bg-[#141416] border-[#2a2a2d]",
    kbd:         "bg-[#252528] border-[#333] text-[#999]",
  } : {
    bg:          "bg-[#f0f0f3]",
    headerBg:    "bg-white border-[#d8d8dc]",
    card:        "bg-white border-[#d8d8dc]",
    cardHover:   "hover:border-[#aaaaaf]",
    dropzone:    "border-[#c8c8ce] bg-white",
    dropActive:  "border-[#0284c7] bg-[#0284c7]/5",
    input:       "bg-[#f4f4f6] border-[#c8c8ce] text-[#000] placeholder-[#999]",
    text:        "text-[#000]",
    textSub:     "text-[#1a1a1a]",
    textMuted:   "text-[#555]",
    statusBar:   "bg-white border-[#d8d8dc]",
    sizeColor:   "text-[#92400e]",
    hashColor:   "text-[#065f46]",
    accent:      "text-[#0284c7]",
    accentHex:   "#0284c7",
    speedHex:    "#7c3aed",
    btnBase:     "bg-white border-[#c8c8ce] text-[#1a1a1a] hover:border-[#888] hover:text-[#000]",
    btnSuccess:  "border-[#059669] text-[#065f46] bg-[#059669]/10",
    matchBox:    "border-[#059669]/40 bg-[#059669]/8 text-[#065f46]",
    mismatchBox: "border-[#dc2626]/40 bg-[#dc2626]/8 text-[#991b1b]",
    progress:    "bg-[#dddde2]",
    progressFg:  "bg-[#0284c7]",
    insetBg:     "bg-[#f4f4f6] border-[#d8d8dc]",
    sep:         "bg-[#d8d8dc]",
    statLabel:   "text-[#888]",
    batchBar:    "bg-white border-[#d8d8dc]",
    kbd:         "bg-[#f4f4f6] border-[#d8d8dc] text-[#555]",
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function Md5Tool() {
  const [theme, setTheme]       = useState<Theme>("dark");
  const [results, setResults]   = useState<FileResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [hashCase, setHashCase] = useState<HashCase>("lower");
  const [bench, setBench]       = useState<BenchResult | null>(null);
  const [benching, setBenching] = useState(false);
  const [copied, setCopied]     = useState<string | null>(null);
  const [dragIdx, setDragIdx]   = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("default");
  const [sessionStart]          = useState(Date.now);
  const [, setTick]             = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const workersRef = useRef<Map<string, Worker>>(new Map());
  const fileRef    = useRef<HTMLInputElement>(null);
  const p = palette(theme);

  // ── Tick for session timer ────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Notification permission ───────────────────────────────────────────────
  useEffect(() => {
    if ("Notification" in window) setNotifPerm(Notification.permission);
  }, []);

  const requestNotif = useCallback(async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, icon: "/favicon.svg" });
  }, []);

  // ── Process one file ──────────────────────────────────────────────────────
  const processFile = useCallback((id: string, file: File, idx: number) => {
    const worker = new Worker(
      new URL("../workers/md5.worker.ts", import.meta.url), { type: "module" }
    );
    workersRef.current.set(id, worker);

    setResults(prev => {
      const u = [...prev];
      const i = u.findIndex(r => r.id === id);
      if (i !== -1) u[i] = { ...u[i], status: "hashing" };
      return u;
    });

    worker.onmessage = ev => {
      const msg = ev.data;
      if (msg.type === "progress") {
        setResults(prev => {
          const u = [...prev];
          const i = u.findIndex(r => r.id === id);
          if (i === -1) return prev;
          const hist = [...u[i].speedHistory, msg.speed].slice(-HISTORY_LEN);
          u[i] = { ...u[i], progress: msg.progress, speed: msg.speed, speedHistory: hist, estimatedRemaining: msg.estimatedRemaining };
          return u;
        });
      } else if (msg.type === "done") {
        worker.terminate();
        workersRef.current.delete(id);
        setResults(prev => {
          const u = [...prev];
          const i = u.findIndex(r => r.id === id);
          if (i !== -1) u[i] = { ...u[i], hash: msg.hash, status: "done", progress: 1, elapsed: msg.elapsed };
          // Notify per-file
          notify("MD5 Verify", `✓ ${file.name} — ${msg.hash.slice(0, 8)}…`);
          // Start next idle file(s) to keep MAX_PARALLEL saturated
          const running = u.filter(r => r.status === "hashing").length;
          let started = running;
          for (let j = 0; j < u.length && started < MAX_PARALLEL; j++) {
            if (u[j].status === "idle") {
              setTimeout(() => processFile(u[j].id, u[j].file, j), 20);
              u[j] = { ...u[j], status: "hashing" }; // optimistic
              started++;
            }
          }
          // Batch complete notification
          const allDone = u.every(r => r.status === "done" || r.status === "error");
          if (allDone && u.length > 1) notify("MD5 Verify", `✓ All ${u.length} files hashed`);
          return u;
        });
      }
    };
    worker.onerror = err => {
      worker.terminate();
      workersRef.current.delete(id);
      setResults(prev => {
        const u = [...prev];
        const i = u.findIndex(r => r.id === id);
        if (i !== -1) u[i] = { ...u[i], status: "error", error: err.message };
        return u;
      });
    };
    worker.postMessage({ mode: "hash", file });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify]);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const items: FileResult[] = files.map(f => ({
      id: uid(), file: f, hash: null, expectedHash: "",
      status: "idle", progress: 0, speed: 0, speedHistory: [],
      estimatedRemaining: null, elapsed: null,
    }));
    setResults(prev => {
      const updated = [...prev, ...items];
      const running = updated.filter(r => r.status === "hashing").length;
      let started = running;
      for (let i = 0; i < updated.length && started < MAX_PARALLEL; i++) {
        if (updated[i].status === "idle") {
          setTimeout(() => processFile(updated[i].id, updated[i].file, i), 0);
          updated[i] = { ...updated[i], status: "hashing" };
          started++;
        }
      }
      return updated;
    });
  }, [processFile]);

  const cancelFile = useCallback((id: string) => {
    const w = workersRef.current.get(id);
    if (w) { w.terminate(); workersRef.current.delete(id); }
    setResults(prev => prev.map(r => r.id === id ? { ...r, status: "error", error: "Cancelled" } : r));
  }, []);

  const reset = useCallback(() => {
    workersRef.current.forEach(w => w.terminate());
    workersRef.current.clear();
    setResults([]); setBench(null);
  }, []);

  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }, []);

  const setExpected = useCallback((id: string, val: string) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, expectedHash: val } : r));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd + O → open files
      if (mod && e.key === "o") { e.preventDefault(); fileRef.current?.click(); }
      // Escape → cancel all running
      if (e.key === "Escape") {
        workersRef.current.forEach((w, id) => {
          w.terminate();
          setResults(prev => prev.map(r => r.id === id ? { ...r, status: "error", error: "Cancelled" } : r));
        });
        workersRef.current.clear();
      }
      // Ctrl/Cmd + Shift + R → reset
      if (mod && e.shiftKey && e.key === "R") { e.preventDefault(); reset(); }
      // ? → show shortcuts
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) setShowShortcuts(s => !s);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reset]);

  // ── Benchmark ─────────────────────────────────────────────────────────────
  const runBenchmark = useCallback(() => {
    setBenching(true); setBench(null);
    const w = new Worker(new URL("../workers/md5.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ev => {
      if (ev.data.type === "benchmarkDone") { setBench(ev.data); setBenching(false); w.terminate(); }
    };
    w.postMessage({ mode: "benchmark" });
  }, []);

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const onCardDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOver(idx); };
  const onCardDrop     = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOver(null); return; }
    setResults(prev => {
      const u = [...prev];
      const [m] = u.splice(dragIdx, 1);
      u.splice(idx, 0, m);
      return u;
    });
    setDragIdx(null); setDragOver(null);
  };

  // ── Exports ───────────────────────────────────────────────────────────────
  const done = results.filter(r => r.status === "done");
  const exportXML = () => {
    const rows = done.map((r, i) => [
      `  <File index="${i + 1}">`,
      `    <Name>${escXml(r.file.name)}</Name>`,
      `    <Size unit="bytes">${r.file.size}</Size>`,
      `    <SizeHuman>${fmtBytes(r.file.size)}</SizeHuman>`,
      `    <MD5>${applyCase(r.hash!, hashCase)}</MD5>`,
      r.elapsed ? `    <ComputedInSeconds>${r.elapsed.toFixed(3)}</ComputedInSeconds>` : "",
      r.elapsed ? `    <AverageSpeed>${fmtSpd(r.file.size / r.elapsed)}</AverageSpeed>` : "",
      `  </File>`,
    ].filter(Boolean).join("\n")).join("\n");
    dl(`<?xml version="1.0" encoding="UTF-8"?>\n<MD5Report generated="${new Date().toISOString()}">\n${rows}\n</MD5Report>`,
      "application/xml", `md5-${Date.now()}.xml`);
  };
  const exportCSV = () => {
    const header = "Filename,Size (bytes),Size (human),MD5,Elapsed (s),Avg Speed";
    const rows = done.map(r =>
      `"${r.file.name}",${r.file.size},"${fmtBytes(r.file.size)}","${applyCase(r.hash!, hashCase)}",${(r.elapsed ?? 0).toFixed(3)},"${r.elapsed ? fmtSpd(r.file.size / r.elapsed) : "—"}"`
    );
    dl([header, ...rows].join("\n"), "text/csv", `md5-${Date.now()}.csv`);
  };
  const exportMd5 = () => {
    dl(done.map(r => `${applyCase(r.hash!, hashCase)}  ${r.file.name}`).join("\n"), "text/plain", `md5-${Date.now()}.md5`);
  };

  // ── Batch stats ───────────────────────────────────────────────────────────
  const totalBytes    = done.reduce((s, r) => s + r.file.size, 0);
  const totalElapsed  = done.reduce((s, r) => s + (r.elapsed ?? 0), 0);
  const avgSpeed      = totalElapsed > 0 ? totalBytes / totalElapsed : 0;
  const activeFiles   = results.filter(r => r.status === "hashing");
  const currentSpeed  = activeFiles.reduce((s, r) => s + r.speed, 0);
  const remainingBytes = results
    .filter(r => r.status === "idle" || r.status === "hashing")
    .reduce((s, r) => s + (r.status === "idle" ? r.file.size : r.file.size * (1 - r.progress)), 0);
  const batchETA      = currentSpeed > 0 ? remainingBytes / currentSpeed : null;
  const totalFiles    = results.length;
  const doneCount     = done.length;
  const queuedCount   = results.filter(r => r.status === "idle").length;
  const batchProgress = totalFiles > 0 ? (doneCount / totalFiles) : 0;
  const sessionSec    = Math.floor((Date.now() - sessionStart) / 1000);
  const hasFiles      = results.length > 0;
  const hasDone       = done.length > 0;
  const isActive      = activeFiles.length > 0;

  return (
    <div className={`min-h-screen flex flex-col ${p.bg} ${p.text}`}
      style={{ fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" }}>

      {/* ── KEYBOARD SHORTCUTS OVERLAY ──────────────────────────────────── */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}>
          <div className={`rounded-2xl border p-6 w-80 ${theme === "dark" ? "bg-[#1a1a1d] border-[#2a2a2d]" : "bg-white border-[#d8d8dc]"}`}
            onClick={e => e.stopPropagation()}>
            <p className={`text-sm font-bold mb-4 ${p.text}`}>Keyboard Shortcuts</p>
            {[
              ["⌘ / Ctrl + O", "Open file picker"],
              ["Escape",        "Cancel all hashing"],
              ["⌘ / Ctrl + ⇧ + R", "Reset everything"],
              ["?",             "Toggle this panel"],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between mb-2.5">
                <span className={`text-xs ${p.textMuted}`}>{label}</span>
                <kbd className={`text-[10px] font-mono px-2 py-0.5 rounded border ${p.kbd}`}>{key}</kbd>
              </div>
            ))}
            <button onClick={() => setShowShortcuts(false)}
              className={`mt-4 w-full py-2 text-xs font-semibold border rounded-lg ${p.btnBase}`}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className={`border-b ${p.headerBg} px-5 py-3 flex items-center gap-3 shrink-0`}>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <p className={`text-sm font-bold ${p.text}`}>MD5 Verify</p>
            <p className={`text-xs ${p.textMuted}`} style={{ marginTop: -2 }}>Media Integrity Tool</p>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Notification bell */}
          <button
            onClick={notifPerm === "default" ? requestNotif : undefined}
            title={notifPerm === "granted" ? "Notifications enabled" : notifPerm === "denied" ? "Notifications blocked in browser" : "Enable notifications"}
            className={`w-8 h-8 flex items-center justify-center border rounded-lg transition-all ${p.btnBase} ${notifPerm === "granted" ? "border-emerald-500 text-emerald-500" : ""}`}>
            {notifPerm === "granted" ? "🔔" : "🔕"}
          </button>

          {/* Shortcuts */}
          <button onClick={() => setShowShortcuts(true)}
            className={`w-8 h-8 flex items-center justify-center border rounded-lg transition-all text-xs font-bold ${p.btnBase}`}
            title="Keyboard shortcuts (?)">
            ?
          </button>

          <button onClick={() => setHashCase(c => c === "lower" ? "upper" : "lower")}
            className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase}`}>
            <span className="font-mono">{hashCase === "lower" ? "a–z" : "A–Z"}</span>
          </button>

          <button onClick={runBenchmark} disabled={benching}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase} disabled:opacity-40`}>
            {benching ? <><span className="animate-spin inline-block">⟳</span> …</> : <>⚡ Benchmark</>}
          </button>

          {hasDone && <>
            <button onClick={exportXML} className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase}`}>↓ XML</button>
            <button onClick={exportCSV} className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase}`}>↓ CSV</button>
            <button onClick={exportMd5} className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase}`}>↓ .md5</button>
            <button onClick={() => copy(done.map(r => `${applyCase(r.hash!, hashCase)}  ${r.file.name}`).join("\n"), "all")}
              className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${copied === "all" ? p.btnSuccess : p.btnBase}`}>
              {copied === "all" ? "✓ Copied" : "Copy All"}
            </button>
          </>}

          {hasFiles &&
            <button onClick={reset}
              className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${p.btnBase} hover:border-red-400 hover:text-red-400`}>
              Reset
            </button>
          }

          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            className={`w-8 h-8 flex items-center justify-center border rounded-lg transition-all ${p.btnBase}`}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* ── BATCH PROGRESS BAR (multi-file) ──────────────────────────────── */}
      {totalFiles > 1 && (
        <div className={`border-b ${p.batchBar} px-5 py-2.5 flex items-center gap-4 shrink-0`}>
          <div className="flex-1">
            <div className={`h-1.5 ${p.progress} rounded-full overflow-hidden`}>
              <div className={`h-full ${p.progressFg} rounded-full transition-all duration-500`}
                style={{ width: `${(batchProgress * 100).toFixed(1)}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className={`text-xs font-semibold ${p.text}`}>
              {doneCount} / {totalFiles} files
            </span>
            {isActive && currentSpeed > 0 && (
              <span className={`text-xs ${p.textMuted}`}>
                {fmtSpd(currentSpeed)} combined
              </span>
            )}
            {batchETA != null && batchETA > 0 && (
              <span className={`text-xs font-semibold ${p.accent}`}>
                ETA {fmtTime(batchETA)}
              </span>
            )}
            {queuedCount > 0 && (
              <span className={`text-xs ${p.textMuted}`}>
                {queuedCount} queued
              </span>
            )}
            {activeFiles.length > 1 && (
              <span className={`text-xs font-semibold text-violet-400`}>
                ⚡ {activeFiles.length} parallel
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── BODY ─────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 py-5 space-y-3">

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files)); }}
            className={`border-2 border-dashed rounded-xl cursor-pointer select-none transition-all ${dragging ? p.dropActive : p.dropzone} ${hasFiles ? "py-3" : "py-12"}`}
          >
            <input ref={fileRef} type="file" multiple className="hidden"
              onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            {hasFiles ? (
              <div className="flex items-center justify-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke={dragging ? p.accentHex : theme === "dark" ? "#555" : "#aaa"} strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p className={`text-sm font-medium ${dragging ? p.accent : p.textMuted}`}>
                  {dragging ? "Drop to add files" : "Drop more files or click — ⌘O"}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${theme === "dark" ? "bg-[#252528]" : "bg-gray-100"}`}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                    stroke={dragging ? p.accentHex : theme === "dark" ? "#555" : "#999"} strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div className="text-center">
                  <p className={`text-base font-semibold ${p.text}`}>
                    {dragging ? "Release to hash files" : "Drag & drop files here"}
                  </p>
                  <p className={`text-sm mt-1 ${p.textMuted}`}>
                    or click to browse · 2TB+ · up to {MAX_PARALLEL} files hashed in parallel
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── File cards ── */}
          {results.map((r, idx) => {
            const hash        = r.hash ? applyCase(r.hash, hashCase) : null;
            const isDragging  = dragIdx === idx;
            const isDropTgt   = dragOver === idx && dragIdx !== idx;
            const trimmed     = r.expectedHash.trim();
            const verMatch: boolean | null = hash && trimmed
              ? hash.toLowerCase() === trimmed.toLowerCase() : null;

            return (
              <div key={r.id}
                draggable={r.status !== "hashing"}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={e => onCardDragOver(e, idx)}
                onDrop={() => onCardDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOver(null); }}
                className={`rounded-xl border transition-all ${p.card} ${p.cardHover} ${isDragging ? "opacity-40 scale-[0.99]" : ""} ${isDropTgt ? "border-sky-500 shadow-[0_0_0_2px_rgba(56,189,248,0.15)]" : ""}`}
              >
                {/* Top row */}
                <div className="flex items-center gap-2 px-4 pt-3 pb-0">
                  <span className={`cursor-grab active:cursor-grabbing ${p.textMuted} text-xl select-none shrink-0`}>⠿</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    r.status === "done"    ? "bg-emerald-400" :
                    r.status === "hashing" ? "bg-sky-400 animate-pulse" :
                    r.status === "error"   ? "bg-red-400" :
                    theme === "dark"       ? "bg-[#333]" : "bg-gray-300"
                  }`} />
                  <p className={`flex-1 text-sm font-semibold ${p.text} truncate`} title={r.file.name}>{r.file.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded font-mono border ${p.textMuted} ${theme === "dark" ? "border-[#333] bg-[#252528]" : "border-gray-200 bg-gray-50"} shrink-0`}>
                    {r.file.name.split(".").pop()?.toUpperCase() ?? "—"}
                  </span>
                  {r.status === "hashing"
                    ? <button onClick={() => cancelFile(r.id)}
                        className="text-xs font-semibold text-red-400 hover:text-red-300 shrink-0">Cancel</button>
                    : <button onClick={() => setResults(prev => prev.filter((_, i) => i !== idx))}
                        className={`shrink-0 transition-colors ${p.textMuted} hover:text-red-400`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                  }
                </div>

                {/* File size */}
                <div className="px-4 pt-3">
                  <div className={`rounded-lg px-4 py-2.5 border ${p.insetBg} flex items-center justify-between gap-3`}>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${p.textMuted}`}>File Size</p>
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className={`text-2xl font-bold tabular-nums ${p.sizeColor}`}>{fmtBytes(r.file.size, 3)}</span>
                        <span className={`text-xs font-mono ${p.textMuted}`}>{fmtExact(r.file.size)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => copy(`${fmtBytes(r.file.size, 3)} (${fmtExact(r.file.size)})`, `size-${r.id}`)}
                      className={`shrink-0 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${copied === `size-${r.id}` ? p.btnSuccess : p.btnBase}`}>
                      {copied === `size-${r.id}` ? "✓" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* Progress + sparkline */}
                {r.status === "hashing" && (
                  <div className="px-4 pt-3">
                    <div className={`h-1.5 ${p.progress} rounded-full overflow-hidden`}>
                      <div className={`h-full ${p.progressFg} rounded-full transition-all duration-200`}
                        style={{ width: `${(r.progress * 100).toFixed(1)}%` }} />
                    </div>
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-semibold tabular-nums ${p.textSub}`}>
                          {(r.progress * 100).toFixed(1)}%
                        </span>
                        <span className={`text-xs font-semibold tabular-nums ${p.textSub}`} style={{ color: p.speedHex }}>
                          {fmtSpd(r.speed)}
                        </span>
                        {r.estimatedRemaining != null && (
                          <span className={`text-xs ${p.textMuted}`}>ETA {fmtTime(r.estimatedRemaining)}</span>
                        )}
                      </div>
                      <Sparkline data={r.speedHistory} stroke={p.speedHex} />
                    </div>
                  </div>
                )}

                {/* MD5 + inline verify */}
                {r.status === "done" && hash && (
                  <div className="px-4 pt-3 pb-4 space-y-2">
                    <div className={`rounded-lg px-4 py-2.5 border ${p.insetBg} flex items-start justify-between gap-4`}>
                      <div className="min-w-0">
                        <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${p.textMuted}`}>MD5 Checksum</p>
                        <p className={`text-base font-semibold break-all leading-relaxed ${p.hashColor}`}
                          style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
                          {hash}
                        </p>
                      </div>
                      <button onClick={() => copy(hash, r.id)}
                        className={`shrink-0 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-all ${copied === r.id ? p.btnSuccess : p.btnBase}`}>
                        {copied === r.id ? "✓" : "Copy"}
                      </button>
                    </div>

                    {/* Inline verify */}
                    <div className={`rounded-lg border ${p.insetBg} overflow-hidden`}>
                      <div className="flex items-center">
                        <p className={`text-[10px] font-bold uppercase tracking-widest px-3 shrink-0 ${p.textMuted}`}>Verify</p>
                        <input
                          value={r.expectedHash}
                          onChange={e => setExpected(r.id, e.target.value)}
                          placeholder="Paste expected MD5 to verify…"
                          className={`flex-1 py-2 pr-2 text-xs bg-transparent focus:outline-none ${p.text} placeholder:text-[#555]`}
                          style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace" }}
                        />
                        {trimmed && (
                          <button onClick={() => setExpected(r.id, "")}
                            className={`px-2 text-xs ${p.textMuted} hover:text-red-400 shrink-0`}>✕</button>
                        )}
                        <button
                          onClick={async () => { const t = await navigator.clipboard.readText().catch(() => ""); setExpected(r.id, t.trim()); }}
                          className={`px-3 py-2 text-xs font-semibold border-l ${theme === "dark" ? "border-[#2a2a2d] text-[#777] hover:text-white" : "border-[#e0e0e4] text-[#999] hover:text-[#333]"} transition-colors shrink-0`}>
                          Paste
                        </button>
                      </div>
                      {verMatch !== null && (
                        <div className={`flex items-center gap-2 px-3 py-2 border-t text-xs font-bold ${theme === "dark" ? "border-[#2a2a2d]" : "border-[#e0e0e4]"} ${verMatch ? p.matchBox : p.mismatchBox}`}>
                          <span>{verMatch ? "✓" : "✗"}</span>
                          <span>{verMatch ? "MATCH — checksums are identical" : "MISMATCH — files differ"}</span>
                        </div>
                      )}
                    </div>

                    {r.elapsed != null && (
                      <div className="flex items-center justify-between px-1">
                        <p className={`text-xs ${p.textMuted}`}>
                          Done in <span className={`font-semibold ${p.textSub}`}>{r.elapsed.toFixed(2)}s</span>
                          &nbsp;·&nbsp; avg <span className={`font-semibold ${p.textSub}`}>{fmtSpd(r.file.size / r.elapsed)}</span>
                        </p>
                        {/* Mini replay sparkline of the full run */}
                        <Sparkline data={r.speedHistory} stroke={p.speedHex} />
                      </div>
                    )}
                  </div>
                )}

                {r.status === "error" && (
                  <div className="px-4 pb-4 pt-3">
                    <p className="text-sm font-semibold text-red-400">{r.error ?? "Error"}</p>
                  </div>
                )}
                {r.status === "idle" && (
                  <div className="px-4 pb-3 pt-2">
                    <p className={`text-sm ${p.textMuted}`}>In queue — waiting to start</p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Benchmark result */}
          {(bench || benching) && (
            <div className={`rounded-xl border p-5 ${p.card}`}>
              <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${p.textMuted}`}>⚡ Speed Benchmark — 256 MB WASM</p>
              {benching && <p className={`text-sm animate-pulse ${p.textMuted}`}>Running…</p>}
              {bench && (
                <div className="space-y-3">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className={`text-3xl font-bold tabular-nums ${p.sizeColor}`}>{fmtSpd(bench.speedBps)}</span>
                    <span className={`text-sm ${p.textMuted}`}>on this machine</span>
                  </div>
                  <div className={`flex items-start gap-4 p-3 rounded-lg border ${p.insetBg}`}>
                    <div className="shrink-0">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${p.textMuted}`}>2 TB Estimate</p>
                      <p className={`text-2xl font-bold ${p.text}`}>{fmtTime(bench.estimatedSeconds)}</p>
                    </div>
                    <p className={`text-xs leading-relaxed pt-1 ${p.textMuted}`}>
                      Pure CPU/WASM hash speed. Actual wall time depends on disk read bandwidth —
                      NVMe can match this; spinning drives cap at ~150–250 MB/s.
                    </p>
                  </div>
                  <button onClick={runBenchmark} className={`text-xs font-semibold ${p.textMuted}`}>↺ Run again</button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── STATUS BAR ──────────────────────────────────────────────────── */}
      <footer className={`border-t ${p.statusBar} px-5 py-2 flex items-center gap-3 shrink-0 flex-wrap`}>
        <Stat label="Files" value={`${doneCount} / ${totalFiles}`} p={p} active={hasDone} />
        <div className={`w-px h-3.5 ${p.sep}`} />
        <Stat label="Total size" value={hasDone ? fmtBytes(totalBytes) : "—"} p={p} />
        <div className={`w-px h-3.5 ${p.sep}`} />
        <Stat label="Avg speed" value={avgSpeed > 0 ? fmtSpd(avgSpeed) : "—"} p={p} />
        <div className={`w-px h-3.5 ${p.sep}`} />
        <Stat label="Session" value={fmtTime(sessionSec)} p={p} />
        {isActive && <>
          <div className={`w-px h-3.5 ${p.sep}`} />
          <Stat label="Live" value={fmtSpd(currentSpeed)} p={p} accent />
        </>}
        {batchETA != null && batchETA > 1 && <>
          <div className={`w-px h-3.5 ${p.sep}`} />
          <Stat label="Batch ETA" value={fmtTime(batchETA)} p={p} accent />
        </>}
        <div className="flex-1" />
        <button onClick={() => setShowShortcuts(true)}
          className={`text-[10px] px-2 py-1 rounded border transition-all ${p.kbd}`}>
          ? shortcuts
        </button>
        {totalFiles > 1 && (
          <div className="flex items-center gap-2">
            <div className={`w-20 h-1 ${p.progress} rounded-full overflow-hidden`}>
              <div className={`h-full ${p.progressFg} rounded-full transition-all`}
                style={{ width: `${(batchProgress * 100).toFixed(0)}%` }} />
            </div>
            <span className={`text-xs font-semibold ${p.textMuted}`}>{(batchProgress * 100).toFixed(0)}%</span>
          </div>
        )}
      </footer>
    </div>
  );
}

type PaletteType = ReturnType<typeof palette>;
function Stat({ label, value, p, active, accent }: {
  label: string; value: string; p: PaletteType; active?: boolean; accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xs ${p.statLabel}`}>{label}</span>
      <span className={`text-xs font-semibold ${accent ? "text-amber-400" : active ? p.textSub : p.statLabel}`}>{value}</span>
    </div>
  );
}
