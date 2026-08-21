import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ProjectProvider } from './context/ProjectContext';
import { SocketProvider } from './context/SocketContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import ProjectPage from './pages/ProjectPage';
import IndexingPage from './pages/IndexingPage';
import ArchitecturePage from './pages/ArchitecturePage';
import CostDashboard from './pages/CostDashboard';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import LandingPage from './pages/LandingPage';
import './App.css';
import './Auth.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function HomeOrLanding() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  if (!user) return <LandingPage />;
  return <HomePage />;
}

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
      <AuthProvider>
        <SocketProvider>
          <ProjectProvider>
            <div className="app-container">
              <Navbar />
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/" element={<HomeOrLanding />} />
                <Route path="/project/:id" element={
                  <ProtectedRoute>
                    <ProjectPage />
                  </ProtectedRoute>
                } />
                <Route path="/project/:id/indexing" element={
                  <ProtectedRoute>
                    <IndexingPage />
                  </ProtectedRoute>
                } />
                <Route path="/project/:id/architecture" element={
                  <ProtectedRoute>
                    <ArchitecturePage />
                  </ProtectedRoute>
                } />
                <Route path="/costs" element={
                  <ProtectedRoute>
                    <CostDashboard />
                  </ProtectedRoute>
                } />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </div>
          </ProjectProvider>
        </SocketProvider>
      </AuthProvider>
    </Router>
  );
}
