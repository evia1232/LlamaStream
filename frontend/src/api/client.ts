import axios from 'axios';
import { getApiBase } from '../lib/apiUrl';

export const api = axios.create({
  baseURL: getApiBase(),
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only force logout on a real auth rejection — never on offline/network failures
    if (err.response?.status === 401 && typeof navigator !== 'undefined' && navigator.onLine) {
      localStorage.removeItem('token');
      localStorage.removeItem('llamastream_user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default api;
