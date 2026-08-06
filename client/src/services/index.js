import api from './api';

export const projectService = {
  getAll: () => api.get('/projects'),
  getById: (id) => api.get(`/projects/${id}`),
  delete: (id) => api.delete(`/projects/${id}`),
};

export const repositoryService = {
  addGithub: (url, name) => api.post('/repository/github', { url, name }),
  getById: (id) => api.get(`/repository/${id}`),
};

export const indexService = {
  start: (projectId) => api.post('/index/start', { projectId }),
  getStatus: (projectId) => api.get(`/index/status/${projectId}`),
};

export const chatService = {
  send: (projectId, question) => api.post('/chat', { projectId, question }),
  getHistory: (projectId, page = 1, limit = 50) =>
    api.get(`/chat/history/${projectId}?page=${page}&limit=${limit}`),
};
