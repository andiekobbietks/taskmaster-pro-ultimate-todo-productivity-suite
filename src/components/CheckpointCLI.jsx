import { useEffect, useRef, useState } from "react";
import { Terminal, X, Minus, Plus, RotateCcw, Play, Trash2, Download } from "lucide-react";

const BANNER = [
  "TaskMaster Pro — Checkpoint CLI",
  "Commands: /help  /status  /logs  /checkpoint <tag>  /rollback <tag>  /forward <tag>  /export",
  "",
];

export default function CheckpointCLI() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [history, setHistory] = useState(BANNER.map((l) => ({ type: "stdout", text: l })));
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [history, open, minimized]);

  const api = async (path, opts = {}) => {
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  const push = (text, type = "stdout") => setHistory((h) => [...h, { type, text }]);

  const run = async (raw) => {
    const line = raw.trim();
    if (!line) return;
    push(`tm> ${line}`, "stdin");
    setInput("");

    const [cmd, ...rest] = line.replace(/^\//, "").split(/\s+/);
    const arg = rest.join(" ");

    try {
      switch (cmd) {
        case "help":
        case "?":
          push("/status            — server health");
          push("/logs [n]          — last n diagnostics rows");
          push("/checkpoint <tag>  — snapshot current state");
          push("/rollback <tag>    — restore latest checkpoint with tag");
          push("/forward <tag>     — alias for /rollback");
          push("/delete <id>       — delete a checkpoint by id");
          push("/export            — download diagnostics JSON");
          push("/clear             — clear CLI output");
          break;

        case "status": {
          const [health, checks] = await Promise.all([
            api("/health").catch(() => ({ status: "unreachable" })),
            api("/api/checkpoints").catch(() => ({ checkpoints: [] })),
          ]);
          push(`server: ${health.status || "unknown"}`);
          push(`checkpoints: ${checks.checkpoints?.length || 0}`);
          break;
        }

        case "logs": {
          const limit = parseInt(arg, 10) || 20;
          const data = await api(`/api/diagnostics?limit=${limit}`);
          const rows = data.diagnostics || [];
          if (rows.length === 0) {
            push("(no diagnostics logged yet)");
          } else {
            rows.reverse().forEach((r) => {
              const ts = new Date(r.ts).toLocaleTimeString();
              push(`[${ts}] ${r.level.toUpperCase()} ${r.source}: ${r.message}`);
            });
          }
          break;
        }

        case "checkpoint": {
          const tag = arg || "manual";
          const data = await api("/api/checkpoints", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag, label: tag }),
          });
          push(`created checkpoint ${data.id} (${data.tag})`);
          break;
        }

        case "rollback":
        case "forward": {
          const tag = arg || "manual";
          const data = await api("/api/checkpoints/forward", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tag }),
          });
          push(`restored ${data.restored_tables?.length || 0} tables from ${data.id}`);
          break;
        }

        case "delete": {
          if (!arg) { push("usage: /delete <id>", "stderr"); break; }
          await api(`/api/checkpoints/${arg}`, { method: "DELETE" });
          push(`deleted ${arg}`);
          break;
        }

        case "export": {
          const data = await api("/api/diagnostics?limit=200");
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `diagnostics-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          push("downloaded diagnostics.json (local only)");
          break;
        }

        case "clear":
          setHistory(BANNER.map((l) => ({ type: "stdout", text: l })));
          break;

        default:
          push(`unknown command: /${cmd}. Type /help for commands.`, "stderr");
      }
    } catch (err) {
      push(`error: ${err.message}`, "stderr");
      try {
        await fetch("/api/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level: "error", source: "cli", message: err.message }),
        });
      } catch {
        // ignore
      }
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-lg hover:bg-neutral-800 transition-colors"
      >
        <Terminal className="w-4 h-4" />
        Checkpoint CLI
      </button>
    );
  }

  return (
    <div
      className={`fixed right-4 bottom-4 z-50 w-80 ${minimized ? "h-10" : "h-96"} bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl flex flex-col overflow-hidden`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-200">
          <Terminal className="w-3.5 h-3.5" />
          Checkpoint CLI
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized((m) => !m)} className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700">
            {minimized ? <Plus className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          </button>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1">
            {history.map((h, i) => (
              <div
                key={i}
                className={
                  h.type === "stdin"
                    ? "text-brand-600"
                    : h.type === "stderr"
                    ? "text-red-500"
                    : "text-neutral-700 dark:text-neutral-300"
                }
              >
                {h.text}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="p-2 border-t border-neutral-200 dark:border-neutral-700 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run(input)}
              placeholder="/help"
              className="flex-1 min-w-0 h-8 px-2 rounded-md bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
            <button
              onClick={() => run(input)}
              className="h-8 px-2 rounded-md bg-brand-600 text-white hover:bg-brand-700"
            >
              <Play className="w-3 h-3" />
            </button>
          </div>

          <div className="px-3 pb-2 flex gap-2 text-[10px] text-neutral-400">
            <button onClick={() => run("/checkpoint auto")} className="hover:text-brand-600 flex items-center gap-0.5">
              <Plus className="w-3 h-3" /> checkpoint
            </button>
            <button onClick={() => run("/rollback auto")} className="hover:text-brand-600 flex items-center gap-0.5">
              <RotateCcw className="w-3 h-3" /> rollback
            </button>
            <button onClick={() => run("/logs 10")} className="hover:text-brand-600 flex items-center gap-0.5">
              <Trash2 className="w-3 h-3" /> logs
            </button>
            <button onClick={() => run("/export")} className="hover:text-brand-600 flex items-center gap-0.5">
              <Download className="w-3 h-3" /> export
            </button>
          </div>
        </>
      )}
    </div>
  );
}
