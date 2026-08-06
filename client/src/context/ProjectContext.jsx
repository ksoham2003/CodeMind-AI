import { createContext, useContext, useState, useCallback } from 'react';
import { projectService } from '../services';

const ProjectContext = createContext(null);

export const ProjectProvider = ({ children }) => {
  const [projects, setProjects] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectService.getAll();
      setProjects(data.projects || []);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProject = useCallback((updatedProject) => {
    setProjects((prev) =>
      prev.map((p) => (p._id === updatedProject._id ? updatedProject : p))
    );
    if (activeProject?._id === updatedProject._id) {
      setActiveProject(updatedProject);
    }
  }, [activeProject]);

  const removeProject = useCallback((projectId) => {
    setProjects((prev) => prev.filter((p) => p._id !== projectId));
    if (activeProject?._id === projectId) setActiveProject(null);
  }, [activeProject]);

  return (
    <ProjectContext.Provider value={{
      projects, activeProject, loading,
      setActiveProject, fetchProjects, updateProject, removeProject,
    }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProjects = () => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider');
  return ctx;
};
