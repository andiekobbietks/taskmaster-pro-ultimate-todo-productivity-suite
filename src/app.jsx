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
                                </div>
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
                  </div>
                )}

                {/* Task List */}
                {!hackathonView && (
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
