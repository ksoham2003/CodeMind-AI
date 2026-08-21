import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const token = localStorage.getItem('token');

    if (!token) {
      setConnected(false);
      return;
    }

    const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 10000,
      auth: {
        token: token,
      },
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('connect_error', (err) => {
      console.warn('Socket connection error:', err.message);
      setConnected(false);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [user]);

  const joinProject = (projectId) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join:project', projectId);
    }
  };

  const leaveProject = (projectId) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave:project', projectId);
    }
  };

  const onIndexingProgress = (callback) => {
    socketRef.current?.on('indexing:progress', callback);
    return () => socketRef.current?.off('indexing:progress', callback);
  };

  return (
    <SocketContext.Provider value={{ connected, joinProject, leaveProject, onIndexingProgress }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
};
