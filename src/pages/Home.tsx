import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { toolsRegistry } from '../toolsRegistry';

interface HomeProps {
  searchQuery: string;
}

export default function Home({ searchQuery }: HomeProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter tools based on search query
  const filteredTools = toolsRegistry.filter((tool) => {
    const query = searchQuery.toLowerCase().trim();
    return (
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query) ||
      tool.category.toLowerCase().includes(query)
    );
  });

  // Handle Get Link copy action
  const handleCopyLink = (e: React.MouseEvent, toolPath: string, toolId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const absoluteUrl = `${window.location.origin}${toolPath}`;
    navigator.clipboard.writeText(absoluteUrl).then(() => {
      setCopiedId(toolId);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch((err) => {
      console.error('Could not copy link: ', err);
    });
  };

  // Dynamic Lucide Icon Renderer
  const renderIcon = (iconName: string) => {
    // Dynamically retrieve the Lucide Icon component
    const IconComponent = (Icons as any)[iconName];
    if (IconComponent) {
      return <IconComponent size={20} strokeWidth={1.5} />;
    }
    // Fallback icon
    return <Icons.HelpCircle size={20} strokeWidth={1.5} />;
  };

  return (
    <div className="home-container fade-in">
      {/* Hero Welcome */}
      <div className="home-hero">
        <h1>LuTools</h1>
        <p>A beautiful collection of lightweight, high-performance, secure browser utilities.</p>
      </div>

      {/* Grid containing cards */}
      {filteredTools.length > 0 ? (
        <div className="tools-grid">
          {filteredTools.map((tool) => {
            const isCopied = copiedId === tool.id;
            return (
              <Link to={tool.path} key={tool.id} className="tool-card">
                <div className="card-icon-wrapper">
                  {renderIcon(tool.iconName)}
                </div>
                
                {/* Get Link Button */}
                <button
                  type="button"
                  onClick={(e) => handleCopyLink(e, tool.path, tool.id)}
                  className={`get-link-btn ${isCopied ? 'copied' : ''}`}
                  title="Copy direct link to this tool"
                >
                  {isCopied ? <Icons.Check size={12} /> : <Icons.Link2 size={12} />}
                  <span>{isCopied ? 'Copied' : 'Get Link'}</span>
                </button>

                <div className="card-meta">
                  <h3 className="card-title">{tool.name}</h3>
                  <p className="card-desc">{tool.description}</p>
                </div>
                <span className="card-tag">{tool.category}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="no-results fade-in">
          <Icons.Inbox size={48} strokeWidth={1} />
          <h3>No tools found</h3>
          <p>We couldn't find any tool matching "{searchQuery}". Try a different search term.</p>
        </div>
      )}
    </div>
  );
}
