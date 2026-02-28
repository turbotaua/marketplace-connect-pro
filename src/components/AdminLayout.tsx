import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Plus, Search, Settings, PanelLeftClose, PanelLeft, LogOut, Store, Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "@supabase/supabase-js";

const mainNav = [
  { to: "/", label: "Dilovod AI", icon: Sparkles },
];

const toolsNav = [
  { to: "/marketplaces", label: "XML та Маркетплейси", icon: Store },
];

const AdminLayout = ({ children }: { children: React.ReactNode }) => {
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

  return (
    <div className="flex min-h-screen w-full">
      <aside
        className={cn(
          "flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-r-0"
        )}
      >
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

        <nav className="px-3 py-2 space-y-0.5">
          {mainNav.map((item) => (
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

        <div className="px-3 pt-4 pb-1">
          <span className="px-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Інструменти
          </span>
        </div>
        <nav className="px-3 space-y-0.5 flex-1">
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
