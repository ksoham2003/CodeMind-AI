import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ProjectProvider } from './context/ProjectContext';
import { SocketProvider } from './context/SocketContext';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ProjectPage from './pages/ProjectPage';
import IndexingPage from './pages/IndexingPage';
import './App.css';

function NotFoundPage() {
  return (
    <div className="not-found">
      <h2>404 — Page Not Found</h2>
      <a href="/" className="btn btn-primary">Go Home</a>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <SocketProvider>
        <ProjectProvider>
          <div className="app-container">
            <Navbar />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/project/:id" element={<ProjectPage />} />
              <Route path="/project/:id/indexing" element={<IndexingPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        </ProjectProvider>
      </SocketProvider>
    </Router>
  );
}
