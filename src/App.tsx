import { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import Home from './pages/Home';
import { toolsRegistry } from './toolsRegistry';

// Inner App component to use location and handle routing
function AppContent() {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  // Reset search query when changing route/page
  useEffect(() => {
    setSearchQuery('');
  }, [location.pathname]);

  // Shortcut key handling (Ctrl+K or / to focus search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === '/' && document.activeElement !== searchInputRef.current) {
        // Only if we aren't already typing in some text input
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isHome = location.pathname === '/';
  const currentTool = toolsRegistry.find((tool) => tool.path === location.pathname);
  const headerLabel = currentTool ? currentTool.name : 'LuTools';

  return (
    <div className={`app-container ${!isHome ? 'has-active-tool' : ''}`}>
      {/* Fixed Glassmorphic Header */}
      <header className="app-header">
        <div className="header-brand-group">
          <Link to="/" className="brand-logo-link">
            <div className="brand-logo">Lu</div>
          </Link>
          <div className="brand-titles">
            <span className="brand-label">{headerLabel}</span>
            {!isHome && currentTool && (
              <span className="brand-subtitle">{currentTool.description}</span>
            )}
          </div>
        </div>

        {/* Show search bar only on Home page */}
        {isHome && (
          <div className="search-container">
            <div className="search-input-wrapper">
              <Search className="search-icon" size={16} />
              <input
                type="text"
                ref={searchInputRef}
                className="search-field"
                placeholder="Search tools..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="search-shortcut">/</span>
            </div>
          </div>
        )}
      </header>

      {/* Main Platform Body */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home searchQuery={searchQuery} />} />
          {toolsRegistry.map((tool) => {
            const ToolComponent = tool.component;
            return (
              <Route 
                key={tool.id} 
                path={tool.path} 
                element={<ToolComponent />} 
              />
            );
          })}
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
