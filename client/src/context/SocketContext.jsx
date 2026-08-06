import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // If VITE_API_URL is not set, we default to empty string so it connects to the same host/port serving the app
    const socket = io(import.meta.env.VITE_API_URL || '', {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

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
