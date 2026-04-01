import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Breadcrumbs } from './Breadcrumbs';
import { cn } from '@/utils/cn';

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <TopBar sidebarCollapsed={sidebarCollapsed} />

      <main
        className={cn(
          'pt-16 transition-all duration-300',
          sidebarCollapsed ? 'ml-16' : 'ml-64'
        )}
      >
        <div className="container mx-auto p-6 space-y-6">
          <Breadcrumbs />
          <Outlet />
        </div>
        <footer className="fixed bottom-0 right-0 p-2 text-xs text-muted-foreground bg-background/50 backdrop-blur-sm">
          Build: {__BUILD_ID__}
        </footer>
      </main>
    </div>
  );
}
