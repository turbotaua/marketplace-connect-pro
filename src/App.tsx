import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Dilovod from "./pages/Dilovod";
import Marketplaces from "./pages/Marketplaces";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dilovod />} />
          <Route path="/dilovod" element={<Navigate to="/" replace />} />
          <Route path="/marketplaces" element={<Marketplaces />} />
          {/* Legacy redirects */}
          <Route path="/dashboard" element={<Navigate to="/marketplaces" replace />} />
          <Route path="/prices" element={<Navigate to="/marketplaces" replace />} />
          <Route path="/categories" element={<Navigate to="/marketplaces" replace />} />
          <Route path="/logs" element={<Navigate to="/marketplaces" replace />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
