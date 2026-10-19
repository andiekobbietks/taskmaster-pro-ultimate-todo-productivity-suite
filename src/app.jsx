/**
 * TaskMaster Pro front end.
 *
 * This file used to live inline in public/index.html inside a
 * <script type="text/babel"> tag and was transpiled in the BROWSER on every
 * page load by @babel/standalone. It is now a real module that esbuild bundles
 * at build time into public/assets/app.js.
 *
 * Error handling note (this is the point of the api() helper): every request
 * below reports failure to the UI. Previously all nine call sites swallowed
 * errors with console.error, so a failed request left the screen silently
 * stale — the exact failure mode the app's own readiness gate G-TRUST-01
 * ("users see failures instead of silent staleness") exists to prevent.
 */

import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2, Circle, Plus, Trash2, Pin, Calendar, Tag, Search,
  Sun, Moon, Briefcase, User, Sparkles, Inbox, Folder,
  Clock, Play, Pause, RotateCcw, BarChart3, CheckSquare, AlertCircle,
  Flame, MoreHorizontal, ArrowRight, X, Menu, Settings, Check, HelpCircle
} from "lucide-react";
import { api, describeError } from "./lib/api.js";

/**
 * A dismissible banner that tells the person what failed and offers a retry.
 * Rendered once, at the app level, so every request can use it.
 */
function ErrorBanner({ error, onDismiss, onRetry }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,32rem)] rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/70 shadow-lg animate-scaleIn"
    >
      <div className="flex items-start gap-3 p-4">
        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            {error.context}
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-0.5 break-words">
            {error.message}
          </p>
          {error.status === 400 && (
            <p className="text-[11px] text-red-600/80 dark:text-red-400/80 mt-1">
              Your changes were not saved.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {error.retry && (
            <button
              onClick={error.retry}
              className="h-7 px-2.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          )}
          <button
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="p-1 rounded text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [todos, setTodos] = useState([]);
  const [lists, setLists] = useState([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, active: 0, highPriority: 0, dueToday: 0, pomodoros: 0 });

  // Single source of truth for "something failed". null when all is well.
  const [error, setError] = useState(null);

  const [activeTab, setActiveTab] = useState("all"); // 'all', 'today', 'upcoming', 'completed'
  const [activeListId, setActiveListId] = useState("all"); // 'all', 'inbox', 'work', etc.
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // New task form state
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");
  const [newListId, setNewListId] = useState("inbox");
  const [newTagsStr, setNewTagsStr] = useState("");
  const [newPomodoros, setNewPomodoros] = useState(1);
  const [isAddingOpen, setIsAddingOpen] = useState(false);

  // New list modal state
  const [isNewListOpen, setIsNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListColor, setNewListColor] = useState("#5E6AD2");

  // Pomodoro Timer state
  const [timerActive, setTimerActive] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(25 * 60);
  const [timerMode, setTimerMode] = useState("work"); // 'work', 'break'
  const [activeTodoForTimer, setActiveTodoForTimer] = useState(null);

  // Dark mode state
  const [darkMode, setDarkMode] = useState(false);

  // Hackathon Tracker state
  const [hackathons, setHackathons] = useState([]);
  const [hackathonView, setHackathonView] = useState(false);
  const [hackathonProfile, setHackathonProfile] = useState(null);
  const [isHackathonModalOpen, setIsHackathonModalOpen] = useState(false);
  const [editingHackathon, setEditingHackathon] = useState(null);
  const [settings, setSettings] = useState(null);
  const [settingsView, setSettingsView] = useState(false);
  const [settingsTab, setSettingsTab] = useState('storage');
  const [savingSettings, setSavingSettings] = useState(false);
  const [storageTestResult, setStorageTestResult] = useState(null);
  const [archiveSources, setArchiveSources] = useState([]);
  const [archiveView, setArchiveView] = useState(false);
  const [archiveUrl, setArchiveUrl] = useState('');
  const [archiveResult, setArchiveResult] = useState(null);
  const [checkingArchive, setCheckingArchive] = useState(false);
  const [attachments, setAttachments] = useState({});
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  /**
   * Build an error handler for one kind of work.
   *
   * @param context  what the user was doing, in plain words ("Saving your task")
   * @param retry    optional function the banner's Retry button should call
   */
  const fail = useCallback((context, retry) => (err) => {
    // Keep the console detail for developers…
    console.error(`[TaskMaster] ${context} failed:`, err);
    // …and tell the person, in words, what just happened.
    setError({ context, message: describeError(err), status: err?.status, retry });
  }, []);

  const clearError = () => setError(null);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  // Fetch hackathons on mount
  useEffect(() => {
    fetchHackathons();
    fetchSettings();
    fetchArchiveSources();
    fetchHackathonProfile();
  }, [fetchHackathons, fetchHackathonProfile]);

  // Timer countdown effect
  useEffect(() => {
    let interval = null;
    if (timerActive && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds(s => s - 1);
      }, 1000);
    } else if (timerSeconds === 0 && timerActive) {
      setTimerActive(false);
      alert(timerMode === "work" ? "Pomodoro session complete! Take a break." : "Break finished! Back to work.");
      if (timerMode === "work" && activeTodoForTimer) {
        incrementPomodoro(activeTodoForTimer);
      }
    }
    return () => clearInterval(interval);
  }, [timerActive, timerSeconds, timerMode, activeTodoForTimer]);

  const fetchTodos = useCallback(async () => {
    try {
      let url = "./api/todos?";
      if (activeTab === "active") url += "status=active&";
      if (activeTab === "completed") url += "status=completed&";
      if (priorityFilter !== "all") url += `priority=${priorityFilter}&`;
      if (activeListId !== "all") url += `listId=${activeListId}&`;
      if (searchQuery) url += `search=${encodeURIComponent(searchQuery)}&`;

      const data = await api(url);

      // Client-side date filters if needed
      let filtered = Array.isArray(data) ? data : [];
      const todayStr = new Date().toISOString().split('T')[0];
      if (activeTab === "today") {
        filtered = filtered.filter(t => t.due_date === todayStr);
      }

      setTodos(filtered);
      // A successful load clears any stale error about loading.
      setError(prev => (prev && prev.context === "Loading your tasks" ? null : prev));
    } catch (err) {
      fail("Loading your tasks", fetchTodos)(err);
    }
  }, [activeTab, activeListId, priorityFilter, searchQuery, fail]);

  const fetchHackathons = useCallback(async () => {
    try {
      const data = await api("./api/hackathons");
      setHackathons(Array.isArray(data) ? data : []);
    } catch (err) {
      fail("Loading hackathons", fetchHackathons)(err);
    }
  }, [fail]);

  const fetchAttachments = useCallback(async (ticketId) => {
    try {
      const data = await api(`./api/todos/${ticketId}/attachments`);
      setAttachments(prev => ({ ...prev, [ticketId]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      // No attachments yet
    }
  }, []);

  const uploadAttachment = useCallback(async (ticketId, file) => {
    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api(`./api/todos/${ticketId}/attachments`, {
        method: "POST",
        body: formData,
      });
      await fetchAttachments(ticketId);
    } catch (err) {
      fail("Uploading attachment", () => uploadAttachment(ticketId, file))(err);
    } finally {
      setUploadingAttachment(false);
    }
  }, [fetchAttachments, fail]);

  const deleteAttachment = useCallback(async (ticketId, attachmentId) => {
    try {
      await api(`./api/attachments/${attachmentId}`, { method: "DELETE" });
      await fetchAttachments(ticketId);
    } catch (err) {
      fail("Deleting attachment", () => deleteAttachment(ticketId, attachmentId))(err);
    }
  }, [fetchAttachments, fail]);

  const fetchArchiveSources = useCallback(async () => {
    try {
      const data = await api("./api/archive/sources");
      setArchiveSources(Array.isArray(data) ? data : []);
    } catch (err) {
      // No sources yet
    }
  }, []);

  const checkArchive = useCallback(async (url) => {
    setCheckingArchive(true);
    try {
      const data = await api(`./api/archive/check?url=${encodeURIComponent(url)}`);
      setArchiveResult(data);
    } catch (err) {
      setArchiveResult({ archived: false, url, error: err.message });
    } finally {
      setCheckingArchive(false);
    }
  }, []);

  const fetchArchiveForTicket = useCallback(async (ticketId, url) => {
    try {
      await api("./api/archive/fetch", {
        method: "POST",
        body: JSON.stringify({ url, ticket_id: ticketId }),
      });
      await fetchAttachments(ticketId);
    } catch (err) {
      fail("Fetching archive", () => fetchArchiveForTicket(ticketId, url))(err);
    }
  }, [fetchAttachments, fail]);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api("./api/settings");
      setSettings(data);
    } catch (err) {
      fail("Loading settings", fetchSettings)(err);
    }
  }, [fail]);

  const saveSettings = useCallback(async (updates) => {
    setSavingSettings(true);
    try {
      const data = await api("./api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setSettings(data);
    } catch (err) {
      fail("Saving settings", () => saveSettings(updates))(err);
    } finally {
      setSavingSettings(false);
    }
  }, [fail]);

  const testStorage = useCallback(async (provider, config) => {
    setStorageTestResult(null);
    try {
      const data = await api("./api/settings/test-storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...config }),
      });
      setStorageTestResult(data);
    } catch (err) {
      setStorageTestResult({ success: false, message: describeError(err) });
    }
  }, []);

  const fetchHackathonProfile = useCallback(async () => {
    try {
      const data = await api("./api/hackathons/profile");
      setHackathonProfile(data);
    } catch (err) {
      // Profile may not exist yet
    }
  }, []);

  const fetchLists = useCallback(async () => {
    try {
      const data = await api("./api/lists");
      setLists(Array.isArray(data) ? data : []);
    } catch (err) {
      fail("Loading your lists", fetchLists)(err);
    }
  }, [fail]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api("./api/stats");
      // Merge rather than replace, so a partial body cannot zero the widget.
      setStats(prev => ({ ...prev, ...(data && typeof data === "object" ? data : {}) }));
    } catch (err) {
      fail("Loading your stats", fetchStats)(err);
    }
  }, [fail]);

  useEffect(() => {
    fetchTodos();
    fetchLists();
    fetchStats();
  }, [fetchTodos, fetchLists, fetchStats]);

  const handleCreateTodo = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const tags = newTagsStr
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    try {
      // api() rejects on a non-2xx, so the old silent `if (res.ok)` skip is
      // replaced by a failure the person can actually see.
      await api("./api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          priority: newPriority,
          due_date: newDueDate || null,
          list_id: newListId,
          tags,
          estimated_pomodoros: newPomodoros
        })
      });

      // Only clear the form once the server has accepted it — otherwise the
      // typed text would be lost along with the failed request.
      setNewTitle("");
      setNewDesc("");
      setNewTagsStr("");
      setNewDueDate("");
      setIsAddingOpen(false);
      fetchTodos();
      fetchStats();
    } catch (err) {
      // Keep the modal open so nothing typed is lost.
      fail("Saving your task")(err);
    }
  };

  const toggleComplete = async (todo) => {
    try {
      await api(`./api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !todo.completed })
      });
      fetchTodos();
      fetchStats();
    } catch (err) {
      fail("Updating that task", () => toggleComplete(todo))(err);
    }
  };

  const togglePin = async (todo) => {
    try {
      await api(`./api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_pinned: !todo.is_pinned })
      });
      fetchTodos();
    } catch (err) {
      fail("Pinning that task", () => togglePin(todo))(err);
    }
  };

  const deleteTodo = async (id) => {
    try {
      await api(`./api/todos/${id}`, { method: "DELETE" });
      fetchTodos();
      fetchStats();
    } catch (err) {
      fail("Deleting that task", () => deleteTodo(id))(err);
    }
  };

  const incrementPomodoro = async (todo) => {
    try {
      await api(`./api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pomodoro_count: (todo.pomodoro_count || 0) + 1 })
      });
      fetchTodos();
      fetchStats();
    } catch (err) {
      fail("Recording a pomodoro", () => incrementPomodoro(todo))(err);
    }
  };

  const createList = async (e) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    try {
      await api("./api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName, color: newListColor })
      });
      setNewListName("");
      setIsNewListOpen(false);
      fetchLists();
    } catch (err) {
      // Keep the modal open so the name and colour are not lost.
      fail("Creating that list")(err);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getPriorityBadge = (p) => {
    switch (p) {
      case 'urgent': return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400">Urgent</span>;
      case 'high': return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">High</span>;
      case 'medium': return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">Medium</span>;
      default: return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">Low</span>;
    }
  };

      return (
        <div className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0A0E1A] text-[#0F172A] dark:text-[#F1F5F9]">
          {/* Topbar */}
          <header className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111827] sticky top-0 z-30 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white font-bold shadow-sm">
                <CheckSquare className="w-5 h-5" />
              </div>
              <span className="font-semibold text-base tracking-tight">TaskMaster Pro</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative w-64 md:w-80 hidden sm:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Search tasks, descriptions, tags... (⌘K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 transition-all"
                />
              </div>

              {/* Pomodoro Quick Widget */}
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs font-mono">
                <Clock className="w-3.5 h-3.5 text-brand-600 animate-pulse" />
                <span className="font-semibold">{formatTime(timerSeconds)}</span>
                <span className="text-neutral-400 text-[10px]">({timerMode})</span>
                <button 
                  onClick={() => setTimerActive(!timerActive)}
                  className="ml-1 p-1 rounded bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                >
                  {timerActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <button 
                  onClick={() => { setTimerActive(false); setTimerSeconds(timerMode === 'work' ? 25*60 : 5*60); }}
                  className="p-1 rounded text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>

              {/* Theme Toggle */}
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                aria-label="Toggle theme"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </header>

          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-[#F8FAFC] dark:bg-[#111827] flex flex-col hidden lg:flex">
              <div className="p-4">
                <button
                  onClick={() => setIsAddingOpen(true)}
                  className="w-full flex items-center justify-center gap-2 h-9 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm transition-all"
                >
                  <Plus className="w-4 h-4" />
                  New Task
                </button>
              </div>

              <div className="px-3 py-2 flex-1 overflow-y-auto space-y-6">
                {/* Views */}
                <div>
                  <div className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                    Overview
                  </div>
                  <div className="space-y-0.5">
                    <button
                      onClick={() => { setActiveTab("all"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeTab === "all" && activeListId === "all"
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <CheckSquare className="w-4 h-4 text-brand-600" />
                      <span>All Tasks</span>
                      <span className="ml-auto text-xs bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded-full text-neutral-600 dark:text-neutral-400">
                        {stats.total}
                      </span>
                    </button>

                    <button
                      onClick={() => { setActiveTab("today"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeTab === "today"
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <Calendar className="w-4 h-4 text-blue-500" />
                      <span>Due Today</span>
                      <span className="ml-auto text-xs bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                        {stats.dueToday}
                      </span>
                    </button>

                    <button
                      onClick={() => { setActiveTab("active"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeTab === "active"
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <Flame className="w-4 h-4 text-amber-500" />
                      <span>Active Focus</span>
                      <span className="ml-auto text-xs bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded-full">
                        {stats.active}
                      </span>
                    </button>

                    <button
                      onClick={() => { setActiveTab("completed"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeTab === "completed"
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <span>Completed</span>
                      <span className="ml-auto text-xs bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full">
                        {stats.completed}
                      </span>
                    </button>

                    <button
                      onClick={() => { setHackathonView(true); setActiveTab("all"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        hackathonView
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <Sparkles className="w-4 h-4 text-purple-500" />
                      <span>Hackathons</span>
                      <span className="ml-auto text-xs bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full">
                        {hackathons.length}
                      </span>
                    </button>

                    <button
                      onClick={() => { setSettingsView(true); setHackathonView(false); setArchiveView(false); setActiveTab("all"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        settingsView
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <svg className="w-4 h-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span>Settings</span>
                    </button>

                    <button
                      onClick={() => { setArchiveView(true); setHackathonView(false); setActiveTab("all"); setActiveListId("all"); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        archiveView
                          ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                      }`}
                    >
                      <svg className="w-4 h-4 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                      <span>Archives</span>
                      <span className="ml-auto text-xs bg-teal-100 dark:bg-teal-950 text-teal-600 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                        {archiveSources.length}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Lists & Categories */}
                <div>
                  <div className="flex items-center justify-between px-3 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      Lists & Projects
                    </span>
                    <button
                      onClick={() => setIsNewListOpen(true)}
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500"
                      title="Create List"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {lists.map(list => (
                      <button
                        key={list.id}
                        onClick={() => { setActiveListId(list.id); setActiveTab("all"); }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                          activeListId === list.id
                            ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 font-semibold"
                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 hover:text-neutral-900"
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
                        <span className="truncate">{list.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Productivity Stats Widget */}
                <div className="p-3 rounded-xl bg-white dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-neutral-500">
                    <span>Productivity Score</span>
                    <BarChart3 className="w-3.5 h-3.5 text-brand-600" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tracking-tight">
                      {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
                    </span>
                    <span className="text-xs text-neutral-400">tasks done</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-700 overflow-hidden">
                    <div 
                      className="h-full bg-brand-600 transition-all duration-500"
                      style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="pt-1 flex items-center justify-between text-[11px] text-neutral-500">
                    <span>Pomodoros: <strong className="font-mono text-brand-600">{stats.pomodoros}</strong></span>
                    <span>High Priority: <strong className="font-mono text-red-500">{stats.highPriority}</strong></span>
                  </div>
                </div>
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto p-6 lg:p-8">
              <div className="max-w-4xl mx-auto space-y-6">
                
                {/* Header Title & Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                      {activeTab === 'today' ? "Today's Agenda" :
                       activeTab === 'active' ? "Active Focus" :
                       activeTab === 'completed' ? "Completed Archive" :
                       activeListId !== 'all' ? lists.find(l => l.id === activeListId)?.name || "List Tasks" :
                       "All Tasks"}
                    </h1>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      {todos.length} {todos.length === 1 ? 'task' : 'tasks'} found in view. Keep momentum going.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Priority filter */}
                    <select
                      value={priorityFilter}
                      onChange={(e) => setPriorityFilter(e.target.value)}
                      className="h-9 px-3 rounded-md text-xs font-medium bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                    >
                      <option value="all">All Priorities</option>
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>

                    <button
                      onClick={() => setIsAddingOpen(true)}
                      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Add Task
                    </button>
                  </div>
                </div>

                {/* Settings View */}
                {settingsView && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-bold tracking-tight">Settings</h2>
                      <p className="text-sm text-neutral-500">Configure storage, email, notifications, and profile.</p>
                    </div>

                    {/* Settings tabs */}
                    <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 pb-2">
                      {['storage', 'profile', 'notifications', 'email'].map(tab => (
                        <button
                          key={tab}
                          onClick={() => setSettingsTab(tab)}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                            settingsTab === tab
                              ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400"
                              : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {/* Storage settings */}
                    {settingsTab === 'storage' && settings && (
                      <div className="space-y-4">
                        <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                          <h3 className="text-sm font-semibold mb-3">Storage backend</h3>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Provider</label>
                              <select
                                value={settings.storage?.provider || 'r2'}
                                onChange={(e) => saveSettings({ storage: { ...settings.storage, provider: e.target.value } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              >
                                <option value="r2">Cloudflare R2 (recommended)</option>
                                <option value="s3">Amazon S3</option>
                                <option value="azure">Azure Blob Storage</option>
                              </select>
                            </div>

                            {settings.storage?.provider === 'r2' && (
                              <div>
                                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">R2 bucket name</label>
                                <input
                                  type="text"
                                  value={settings.storage?.r2_bucket || ''}
                                  onChange={(e) => saveSettings({ storage: { ...settings.storage, r2_bucket: e.target.value } })}
                                  className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                                />
                              </div>
                            )}

                            {settings.storage?.provider === 's3' && (
                              <>
                                <div>
                                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">S3 bucket</label>
                                  <input type="text" value={settings.storage?.s3_bucket || ''} onChange={(e) => saveSettings({ storage: { ...settings.storage, s3_bucket: e.target.value } })} className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Region</label>
                                  <input type="text" value={settings.storage?.s3_region || 'eu-west-2'} onChange={(e) => saveSettings({ storage: { ...settings.storage, s3_region: e.target.value } })} className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                                </div>
                              </>
                            )}

                            {settings.storage?.provider === 'azure' && (
                              <>
                                <div>
                                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Storage account</label>
                                  <input type="text" value={settings.storage?.azure_account || ''} onChange={(e) => saveSettings({ storage: { ...settings.storage, azure_account: e.target.value } })} className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Container</label>
                                  <input type="text" value={settings.storage?.azure_container || ''} onChange={(e) => saveSettings({ storage: { ...settings.storage, azure_container: e.target.value } })} className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">SAS token</label>
                                  <input type="password" value={settings.storage?.azure_sas_token || ''} onChange={(e) => saveSettings({ storage: { ...settings.storage, azure_sas_token: e.target.value } })} className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none" />
                                </div>
                              </>
                            )}

                            <button
                              onClick={() => testStorage(settings.storage?.provider, settings.storage)}
                              className="h-8 px-3 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                            >
                              Test connection
                            </button>
                            {storageTestResult && (
                              <p className={`text-xs ${storageTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                                {storageTestResult.message}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Profile settings */}
                    {settingsTab === 'profile' && settings && (
                      <div className="space-y-4">
                        <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                          <h3 className="text-sm font-semibold mb-3">Eligibility profile</h3>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Citizenships (comma-separated ISO codes)</label>
                              <input
                                type="text"
                                value={(settings.profile?.citizenships || []).join(', ')}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, citizenships: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                              <p className="text-[11px] text-neutral-400 mt-1">e.g. IT, GB, DE</p>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Residencies (comma-separated ISO codes)</label>
                              <input
                                type="text"
                                value={(settings.profile?.residencies || []).join(', ')}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, residencies: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                              <p className="text-[11px] text-neutral-400 mt-1">e.g. GB</p>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Residency status</label>
                              <select
                                value={settings.profile?.residency_status || 'settled'}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, residency_status: e.target.value } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              >
                                <option value="settled">Settled</option>
                                <option value="pre-settled">Pre-settled</option>
                                <option value="visa">Visa</option>
                                <option value="citizen">Citizen</option>
                                <option value="none">None</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Age</label>
                              <input
                                type="number"
                                value={settings.profile?.age || 25}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, age: parseInt(e.target.value) || 25 } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={settings.profile?.is_student || false}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, is_student: e.target.checked } })}
                                className="rounded border-neutral-300"
                              />
                              <label className="text-sm text-neutral-600 dark:text-neutral-400">I am a student</label>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Team size</label>
                              <input
                                type="number"
                                value={settings.profile?.team_size || 1}
                                onChange={(e) => saveSettings({ profile: { ...settings.profile, team_size: parseInt(e.target.value) || 1 } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Notifications settings */}
                    {settingsTab === 'notifications' && settings && (
                      <div className="space-y-4">
                        <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                          <h3 className="text-sm font-semibold mb-3">Notifications</h3>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">Daily digest</p>
                                <p className="text-xs text-neutral-500">Morning summary of deadlines and conflicts</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={settings.notifications?.daily_digest ?? true}
                                onChange={(e) => saveSettings({ notifications: { ...settings.notifications, daily_digest: e.target.checked } })}
                                className="rounded border-neutral-300"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">Conflict alerts</p>
                                <p className="text-xs text-neutral-500">Warn when deadlines overlap</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={settings.notifications?.conflict_alerts ?? true}
                                onChange={(e) => saveSettings({ notifications: { ...settings.notifications, conflict_alerts: e.target.checked } })}
                                className="rounded border-neutral-300"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium">Deadline reminders</p>
                                <p className="text-xs text-neutral-500">Remind before deadlines</p>
                              </div>
                              <input
                                type="checkbox"
                                checked={settings.notifications?.deadline_reminders ?? true}
                                onChange={(e) => saveSettings({ notifications: { ...settings.notifications, deadline_reminders: e.target.checked } })}
                                className="rounded border-neutral-300"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Digest time</label>
                              <input
                                type="time"
                                value={settings.notifications?.digest_time || '08:00'}
                                onChange={(e) => saveSettings({ notifications: { ...settings.notifications, digest_time: e.target.value } })}
                                className="h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Email settings */}
                    {settingsTab === 'email' && settings && (
                      <div className="space-y-4">
                        <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                          <h3 className="text-sm font-semibold mb-3">Email inbox</h3>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Inbox address</label>
                              <input
                                type="email"
                                value={settings.email?.inbox_address || ''}
                                onChange={(e) => saveSettings({ email: { ...settings.email, inbox_address: e.target.value } })}
                                placeholder="hackathons@yourdomain.com"
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">IMAP host</label>
                              <input
                                type="text"
                                value={settings.email?.imap_host || 'imap.mail.yahoo.com'}
                                onChange={(e) => saveSettings({ email: { ...settings.email, imap_host: e.target.value } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">IMAP port</label>
                              <input
                                type="number"
                                value={settings.email?.imap_port || 993}
                                onChange={(e) => saveSettings({ email: { ...settings.email, imap_port: parseInt(e.target.value) || 993 } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">IMAP username</label>
                              <input
                                type="text"
                                value={settings.email?.imap_user || ''}
                                onChange={(e) => saveSettings({ email: { ...settings.email, imap_user: e.target.value } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">IMAP password (app password)</label>
                              <input
                                type="password"
                                value={settings.email?.imap_password || ''}
                                onChange={(e) => saveSettings({ email: { ...settings.email, imap_password: e.target.value } })}
                                className="w-full h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Reset button */}
                    <div className="pt-4 border-t border-neutral-200 dark:border-neutral-800">
                      <button
                        onClick={async () => {
                          if (confirm('Reset all settings to defaults?')) {
                            await api("./api/settings/reset", { method: "POST" });
                            fetchSettings();
                          }
                        }}
                        className="h-8 px-3 rounded-md text-xs font-medium bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
                      >
                        Reset to defaults
                      </button>
                    </div>
                  </div>
                )}

                {/* Archive View */}
                {archiveView && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold tracking-tight">Web Archive Integration</h2>
                        <p className="text-sm text-neutral-500">Fetch hackathon pages from web archives. No scraping, no ToS issues.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={fetchArchiveSources}
                          className="h-8 px-3 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>

                    {/* URL checker */}
                    <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                      <h3 className="text-sm font-semibold mb-2">Check if a page is archived</h3>
                      <div className="flex items-center gap-2">
                        <input
                          type="url"
                          value={archiveUrl}
                          onChange={(e) => setArchiveUrl(e.target.value)}
                          placeholder="https://devpost.com/hackathons/..."
                          className="flex-1 h-9 px-3 rounded-md text-sm bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                        />
                        <button
                          onClick={() => checkArchive(archiveUrl)}
                          disabled={checkingArchive || !archiveUrl}
                          className="h-9 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                        >
                          {checkingArchive ? 'Checking...' : 'Check'}
                        </button>
                      </div>
                      {archiveResult && (
                        <div className={`mt-3 p-3 rounded-lg text-sm ${archiveResult.archived ? 'bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800'}`}>
                          {archiveResult.archived ? (
                            <div>
                              <p className="font-medium text-green-700 dark:text-green-400">Archived!</p>
                              <p className="text-xs text-green-600 dark:text-green-500 mt-1">Snapshot: {archiveResult.timestamp}</p>
                              <p className="text-xs text-neutral-500 mt-1 break-all">{archiveResult.snapshot_url}</p>
                              {archiveResult.extracted && Object.keys(archiveResult.extracted).length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {Object.entries(archiveResult.extracted).map(([k, v]) => (
                                    <p key={k} className="text-xs"><span className="font-medium">{k}:</span> {v}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-red-700 dark:text-red-400">Not found in archive</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Archive sources */}
                    <div className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                      <h3 className="text-sm font-semibold mb-2">Archive sources</h3>
                      {archiveSources.length === 0 ? (
                        <p className="text-xs text-neutral-500">No archive sources configured. Wayback Machine is available by default.</p>
                      ) : (
                        <div className="space-y-2">
                          {archiveSources.map(src => (
                            <div key={src.id} className="flex items-center justify-between p-2 rounded bg-neutral-50 dark:bg-neutral-800/50">
                              <div>
                                <span className="text-sm font-medium">{src.name}</span>
                                <span className="text-[10px] text-neutral-400 ml-2">{src.type}</span>
                              </div>
                              <span className={`text-[10px] font-medium ${src.enabled ? 'text-green-600' : 'text-neutral-400'}`}>
                                {src.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Instructions */}
                    <div className="p-4 bg-neutral-50 dark:bg-neutral-800/30 rounded-xl border border-neutral-200 dark:border-neutral-800">
                      <h3 className="text-sm font-semibold mb-2">How to use</h3>
                      <ol className="text-xs text-neutral-500 space-y-1 list-decimal list-inside">
                        <li>Paste a hackathon URL above and click "Check"</li>
                        <li>If archived, click "Fetch" on the hackathon card to import the snapshot</li>
                        <li>The archived page is stored as an attachment (immutable record)</li>
                        <li>Deadlines, prizes, and rules are extracted automatically</li>
                      </ol>
                    </div>
                  </div>
                )}

                {/* Hackathon View */}
                {hackathonView && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-bold tracking-tight">Hackathon Tracker</h2>
                        <p className="text-sm text-neutral-500">Track deadlines, eligibility, and submissions.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={fetchHackathons}
                          className="h-8 px-3 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        >
                          Refresh
                        </button>
                        <button
                          onClick={() => { setEditingHackathon(null); setIsHackathonModalOpen(true); }}
                          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Hackathon
                        </button>
                      </div>
                    </div>

                    {hackathons.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 px-6 text-center bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800">
                        <Sparkles className="w-10 h-10 text-purple-400 mb-3" />
                        <h3 className="text-base font-semibold">No hackathons yet</h3>
                        <p className="text-sm text-neutral-500 mt-1 max-w-xs">
                          Add hackathons to track deadlines, eligibility, and submissions.
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {hackathons.map(h => {
                          const deadline = h.submission_deadline || h.end_date;
                          const daysLeft = deadline ? Math.ceil((new Date(deadline) - new Date()) / (1000 * 60 * 60 * 24)) : null;
                          return (
                            <div key={h.id} className="p-4 bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm font-semibold tracking-tight">{h.name}</h3>
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
                                      {h.platform}
                                    </span>
                                    {h.status === 'open' && (
                                      <span className="text-[10px] font-medium uppercase tracking-wider text-green-600 bg-green-50 dark:bg-green-950/50 px-1.5 py-0.5 rounded">
                                        Open
                                      </span>
                                    )}
                                  </div>
                                  {h.description && (
                                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{h.description}</p>
                                  )}
                                  <div className="flex items-center gap-3 mt-2 text-[11px] text-neutral-500">
                                    {h.prize && (
                                      <span className="font-medium text-amber-600">{h.prize}</span>
                                    )}
                                    {deadline && (
                                      <span className={`inline-flex items-center gap-1 ${daysLeft !== null && daysLeft <= 3 ? 'text-red-500 font-medium' : ''}`}>
                                        <Calendar className="w-3 h-3" />
                                        {daysLeft !== null && daysLeft >= 0 ? `${daysLeft}d left` : 'Ended'}
                                      </span>
                                    )}
                                  </div>

                                  {h.url && (
                                    <div className="mt-2">
                                      <button
                                        onClick={() => fetchArchiveForTicket(h.id, h.url)}
                                        className="text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:underline"
                                      >
                                        Fetch from Wayback Archive
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Attachments */}
                                {attachments[h.id] && attachments[h.id].length > 0 && (
                                  <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {attachments[h.id].map(att => (
                                        <button
                                          key={att.id}
                                          onClick={() => setPreviewAttachment(att)}
                                          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/50 px-2 py-1 rounded hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                                        >
                                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                          {att.filename.length > 20 ? att.filename.slice(0, 20) + '...' : att.filename}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => { setEditingHackathon(h); setIsHackathonModalOpen(true); }}
                                    className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 transition-colors"
                                    title="Edit"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (confirm('Delete this hackathon?')) {
                                        await api(`./api/hackathons/${h.id}`, { method: 'DELETE' });
                                        fetchHackathons();
                                      }
                                    }}
                                    className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Upload attachment button */}
                    <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800">
                      <label className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-colors cursor-pointer ${uploadingAttachment ? 'bg-neutral-200 text-neutral-400' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        {uploadingAttachment ? 'Uploading...' : 'Attach Screenshot'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && editingHackathon) {
                              uploadAttachment(editingHackathon.id, file);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Attachment Preview Modal */}
                {previewAttachment && (
                  <div className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn" onClick={() => setPreviewAttachment(null)}>
                    <div className="bg-white dark:bg-[#111827] rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-800 max-w-4xl w-full max-h-[90vh] overflow-hidden animate-scaleIn" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                        <h3 className="text-sm font-semibold truncate">{previewAttachment.filename}</h3>
                        <div className="flex items-center gap-2">
                          <a
                            href={`./api/attachments/${previewAttachment.id}`}
                            download={previewAttachment.filename}
                            className="h-7 px-2.5 rounded-md text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                          >
                            Download
                          </a>
                          <button onClick={() => setPreviewAttachment(null)} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      </div>
                      <div className="p-4 overflow-auto max-h-[calc(90vh-60px)]">
                        <img
                          src={`./api/attachments/${previewAttachment.id}`}
                          alt={previewAttachment.filename}
                          className="max-w-full h-auto rounded-lg border border-neutral-200 dark:border-neutral-700"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Task List */}
                {!hackathonView && !archiveView && !settingsView && (
                <div className="space-y-3">
                  {todos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 px-6 text-center bg-white dark:bg-[#111827] rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-xs">
                      <div className="w-12 h-12 rounded-full bg-brand-50 dark:bg-brand-950/50 flex items-center justify-center text-brand-600 mb-4">
                        <CheckSquare className="w-6 h-6" />
                      </div>
                      <h3 className="text-base font-semibold">No tasks found</h3>
                      <p className="text-sm text-neutral-500 mt-1 max-w-xs">
                        You're all caught up! Create a new task or switch filters to see more.
                      </p>
                      <button
                        onClick={() => setIsAddingOpen(true)}
                        className="mt-5 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Create Task
                      </button>
                    </div>
                  ) : (
                    todos.map(todo => (
                      <div
                        key={todo.id}
                        className={`group flex items-start gap-3 p-4 bg-white dark:bg-[#111827] rounded-xl border transition-all duration-150 hover:shadow-sm ${
                          todo.completed 
                            ? "border-neutral-200 dark:border-neutral-800 opacity-60 bg-neutral-50/50 dark:bg-neutral-900/30" 
                            : todo.is_pinned 
                              ? "border-brand-500/50 dark:border-brand-500/40 ring-1 ring-brand-500/20" 
                              : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={() => toggleComplete(todo)}
                          className="mt-0.5 text-neutral-400 hover:text-brand-600 transition-colors shrink-0"
                        >
                          {todo.completed ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600 fill-green-50 dark:fill-green-950/40" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </button>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium tracking-tight ${todo.completed ? 'line-through text-neutral-500 dark:text-neutral-500' : ''}`}>
                              {todo.title}
                            </span>
                            {getPriorityBadge(todo.priority)}
                            {todo.due_date && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded">
                                <Calendar className="w-3 h-3" />
                                {todo.due_date}
                              </span>
                            )}
                          </div>

                          {todo.description && (
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2">
                              {todo.description}
                            </p>
                          )}

                          {/* Tags & Pomodoro count */}
                          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-xs">
                            {todo.tags && todo.tags.length > 0 && todo.tags.map((tag, idx) => (
                              <span key={idx} className="inline-flex items-center gap-1 text-[11px] text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/50 px-2 py-0.5 rounded font-medium">
                                <Tag className="w-2.5 h-2.5" />
                                {tag}
                              </span>
                            ))}

                            <div className="inline-flex items-center gap-1 text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded font-mono">
                              <Flame className="w-3 h-3 text-red-500" />
                              <span>{todo.pomodoro_count || 0} pomodoros</span>
                              <button
                                onClick={() => {
                                  setActiveTodoForTimer(todo);
                                  setTimerActive(true);
                                }}
                                title="Start Pomodoro for this task"
                                className="ml-1 text-brand-600 hover:underline font-sans font-medium"
                              >
                                [Focus]
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => togglePin(todo)}
                            title={todo.is_pinned ? "Unpin" : "Pin to top"}
                            className={`p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors ${todo.is_pinned ? 'text-brand-600' : 'text-neutral-400'}`}
                          >
                            <Pin className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteTodo(todo.id)}
                            title="Delete task"
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-neutral-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

              </div>
            </main>
          </div>

          {/* New Task Modal / Drawer */}
          {isAddingOpen && (
            <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-fadeIn">
              <div className="w-full max-w-lg bg-white dark:bg-[#111827] rounded-xl shadow-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden animate-scaleIn">
                <div className="flex items-center justify-between p-5 border-b border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-base font-semibold">Create New Task</h3>
                  <button onClick={() => setIsAddingOpen(false)} className="p-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={handleCreateTodo} className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Task Title *</label>
                    <input
                      type="text"
                      placeholder="e.g. Design landing page hero section"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      required
                      autoFocus
                      className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Description (Optional)</label>
                    <textarea
                      placeholder="Add details, steps or context..."
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={3}
                      className="w-full p-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 resize-y"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Priority</label>
                      <select
                        value={newPriority}
                        onChange={(e) => setNewPriority(e.target.value)}
                        className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">List / Project</label>
                      <select
                        value={newListId}
                        onChange={(e) => setNewListId(e.target.value)}
                        className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none"
                      >
                        {lists.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Due Date</label>
                      <input
                        type="date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Tags (comma separated)</label>
                      <input
                        type="text"
                        placeholder="design, frontend, urgent"
                        value={newTagsStr}
                        onChange={(e) => setNewTagsStr(e.target.value)}
                        className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-200 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={() => setIsAddingOpen(false)}
                      className="h-9 px-4 rounded-md text-sm font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="h-9 px-4 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
                    >
                      Create Task
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* New List Modal */}
          {isNewListOpen && (
            <div className="fixed inset-0 z-50 bg-neutral-900/40 backdrop-blur-[2px] flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white dark:bg-[#111827] rounded-xl shadow-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-base font-semibold">Create New List</h3>
                  <button onClick={() => setIsNewListOpen(false)} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <form onSubmit={createList} className="p-4 space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">List Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Side Hustle"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      required
                      autoFocus
                      className="w-full h-9 px-3 rounded-md text-sm bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">Color Theme</label>
                    <div className="flex items-center gap-2">
                      {["#5E6AD2", "#2563EB", "#16A34A", "#9333EA", "#CA8A04", "#DC2626"].map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNewListColor(color)}
                          className={`w-7 h-7 rounded-full border-2 transition-transform ${newListColor === color ? 'scale-110 border-white shadow-md' : 'border-transparent'}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={() => setIsNewListOpen(false)}
                      className="h-8 px-3 rounded-md text-sm font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700"
                    >
                      Create List
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Failures are surfaced here instead of vanishing into the console. */}
          <ErrorBanner error={error} onDismiss={clearError} />
        </div>
      );
}

createRoot(document.getElementById("root")).render(<App />);
