import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, PanelLeftClose, PanelLeft, LogOut, Store, Sparkles, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Session } from "@supabase/supabase-js";
import type { ChatSession } from "@/hooks/useChatSessions";

interface AdminLayoutProps {
  children: React.ReactNode;
  chatSessions?: ChatSession[];
  currentSessionId?: string | null;
  onSelectSession?: (id: string) => void;
  onNewChat?: () => void;
}

const toolsNav = [
  { to: "/marketplaces", label: "XML та Маркетплейси", icon: Store },
];

const AdminLayout = ({
  children,
  chatSessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
}: AdminLayoutProps) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      if (!session) navigate("/auth");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground font-light">Завантаження...</p>
    </div>
  );
  if (!session) return null;

  const userName = session.user?.email?.split("@")[0] || "User";
  const isOnChat = location.pathname === "/";

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "Сьогодні";
    if (days === 1) return "Вчора";
    if (days < 7) return `${days} дн. тому`;
    return d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
  };

  // Group sessions by date
  const groupedSessions = (chatSessions || []).reduce<Record<string, ChatSession[]>>((acc, s) => {
    const label = formatDate(s.last_active_at);
    if (!acc[label]) acc[label] = [];
    acc[label].push(s);
    return acc;
  }, {});

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between p-4 pb-2">
          <h1 className="text-xl font-normal tracking-tight text-sidebar-accent-foreground"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
            Turbotyk
          </h1>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-sidebar-accent transition-colors"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* New Chat button */}
        <div className="px-3 py-2">
          <button
            onClick={() => {
              if (onNewChat) onNewChat();
              if (location.pathname !== "/") navigate("/");
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full",
              isOnChat && !currentSessionId
                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-accent/60"
            )}
          >
            <Plus className="h-4 w-4" />
            Новий чат
          </button>
        </div>

        {/* Chat History */}
        {isOnChat && chatSessions && chatSessions.length > 0 && (
          <ScrollArea className="flex-1 px-3">
            {Object.entries(groupedSessions).map(([dateLabel, group]) => (
              <div key={dateLabel} className="mb-3">
                <p className="px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-1">
                  {dateLabel}
                </p>
                <div className="space-y-0.5">
                  {group.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        if (onSelectSession) onSelectSession(s.id);
                        if (location.pathname !== "/") navigate("/");
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors w-full text-left",
                        currentSessionId === s.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                      )}
                    >
                      <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{s.title || "Нова розмова"}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </ScrollArea>
        )}

        {/* If not on chat page or no sessions, show spacer */}
        {(!isOnChat || !chatSessions || chatSessions.length === 0) && (
          <div className="flex-1" />
        )}

        {/* Tools */}
        <div className="px-3 pt-2 pb-1">
          <span className="px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Інструменти
          </span>
        </div>
        <nav className="px-3 space-y-0.5 pb-2">
          {toolsNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                location.pathname === item.to
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-sidebar-accent-foreground capitalize">{userName}</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded-md text-muted-foreground hover:bg-sidebar-accent transition-colors"
              title="Вийти"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 bg-background overflow-auto relative">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-4 left-4 z-10 p-2 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
        )}
        {children}
      </main>
    </div>
  );
};

export default AdminLayout;
