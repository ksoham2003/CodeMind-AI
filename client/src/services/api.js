import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 120000, // 2 minutes (cloning can be slow)
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for consistent error handling
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // Prefer explicit provider error messages when available
    const providerMessage =
      error.response?.data?.error?.error?.message ||
      error.response?.data?.error?.message ||
      error.response?.data?.error || null;

    const message =
      providerMessage ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred';

    const isAuthPage = ['/login', '/signup'].includes(window.location.pathname);

    // Check for unauthorized access only on protected routes; do not bounce auth pages back to login
    if (error.response?.status === 401 && !isAuthPage) {
      console.warn('[API] 401 Unauthorized - clearing token and redirecting', {
        path: window.location.pathname,
        status: error.response.status,
        url: error.config?.url,
      });
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }

    return Promise.reject(new Error(message));
  }
);

export default api;
