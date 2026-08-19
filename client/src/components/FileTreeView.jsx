import { useState } from 'react';
import { Folder, FolderOpen, FileCode, ChevronRight, Search } from 'lucide-react';
import './FileTreeView.css';

function FileNode({ node, onFileSelect, searchTerm }) {
  const [isOpen, setIsOpen] = useState(node.name === 'root' || node.name === 'src' || node.name === 'components');

  if (node.type === 'file') {
    // Basic fuzzy match for search
    if (searchTerm && !node.name.toLowerCase().includes(searchTerm.toLowerCase())) {
      return null;
    }

    return (
      <div 
        className="file-node file-node-item"
        onClick={() => onFileSelect && onFileSelect(node.path)}
      >
        <FileCode size={14} className="node-icon file-icon" />
        <span className="node-name">{node.name}</span>
      </div>
    );
  }

  // Check if any children match search term (for directory visibility)
  const hasMatchingChildren = (dirNode) => {
    if (!searchTerm) return true;
    const check = (n) => {
      if (n.type === 'file') return n.name.toLowerCase().includes(searchTerm.toLowerCase());
      return n.children?.some(check);
    };
    return dirNode.children?.some(check);
  };

  if (!hasMatchingChildren(node)) return null;

  return (
    <div className="file-node directory-node">
      <div className="directory-header" onClick={() => setIsOpen(!isOpen)}>
        <ChevronRight 
          size={14} 
          className={`chevron-icon ${isOpen ? 'chevron-open' : ''}`} 
        />
        {isOpen ? (
          <FolderOpen size={14} className="node-icon folder-icon folder-icon--open" />
        ) : (
          <Folder size={14} className="node-icon folder-icon" />
        )}
        <span className="node-name">{node.name}</span>
      </div>

      {isOpen && node.children && (
        <div className="directory-children">
          {node.children
            .sort((a, b) => {
              // Folders first, then files
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child, idx) => (
              <FileNode 
                key={idx} 
                node={child} 
                onFileSelect={onFileSelect}
                searchTerm={searchTerm}
              />
            ))
          }
        </div>
      )}
    </div>
  );
}

export default function FileTreeView({ fileTree, onFileSelect }) {
  const [searchTerm, setSearchTerm] = useState('');

  if (!fileTree) {
    return (
      <div className="tree-empty">
        <p>No repository files loaded.</p>
      </div>
    );
  }

  return (
    <div className="file-tree-view">
      <div className="tree-search-container">
        <Search size={14} className="search-icon" />
        <input
          type="text"
          placeholder="Filter files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="tree-search-input"
        />
      </div>

      <div className="tree-scroll-area">
        {/* Render direct children of root directly to avoid redundant root folder node */}
        {fileTree.name === 'root' && fileTree.children ? (
          fileTree.children
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
            .map((child, idx) => (
              <FileNode 
                key={idx} 
                node={child} 
                onFileSelect={onFileSelect}
                searchTerm={searchTerm}
              />
            ))
        ) : (
          <FileNode 
            node={fileTree} 
            onFileSelect={onFileSelect}
            searchTerm={searchTerm}
          />
        )}
      </div>
    </div>
  );
}
