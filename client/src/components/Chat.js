import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import io from 'socket.io-client';
import axios from 'axios';
import Message from './Message';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import ChatList from './ChatList';
import { FiLogOut, FiUsers, FiVolume2, FiVolumeX, FiSearch } from 'react-icons/fi';
import toast from 'react-hot-toast';

function Chat() {
  const { user, logout } = useAuth();
  const [socket, setSocket] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUser, setTypingUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const messagesEndRef = useRef(null);
  const notificationSound = useRef(null);

  useEffect(() => {
    notificationSound.current = new Audio('/notification.mp3');
    notificationSound.current.load();
    return () => {
      if (notificationSound.current) {
        notificationSound.current.pause();
      }
    };
  }, []);

  const getUserId = (userObj) => userObj?.id || userObj?._id;
  const getUserName = (userObj) => userObj?.username;

  const fetchUsers = useCallback(async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    }
  }, []);

  const fetchMessages = useCallback(async (userId) => {
    setLoading(true);
    try {
      const response = await axios.get(`http://localhost:5000/api/messages/${userId}`);
      setMessages(response.data);
    } catch (error) {
      console.error('Error fetching messages:', error);
      toast.error('Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, []);

  const markMessagesAsRead = useCallback(async (userId) => {
    try {
      await axios.post(`http://localhost:5000/api/messages/read/${userId}`);
    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !user) return;
    
    const newSocket = io('http://localhost:5000', {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true
    });
    
    setSocket(newSocket);
    
    newSocket.on('connect', () => {
      setIsConnected(true);
      newSocket.emit('user-online', user.id);
      setTimeout(() => {
        newSocket.emit('get-online-users');
        fetchUsers();
      }, 500);
    });
    
    newSocket.on('connect_error', () => {
      setIsConnected(false);
      toast.error('Connection error. Retrying...');
    });
    
    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });
    
    newSocket.on('online-users-list', (onlineUserIds) => {
      setUsers(prev => prev.map(u => ({
        ...u,
        isOnline: onlineUserIds.includes(getUserId(u))
      })));
    });
    
    newSocket.on('private-message', (message) => {
      setMessages(prev => {
        if (prev.some(m => m._id === message._id)) return prev;
        return [...prev, message];
      });
      
      if (selectedUser && getUserId(selectedUser) === message.from && soundEnabled && notificationSound.current) {
        notificationSound.current.currentTime = 0;
        notificationSound.current.play().catch(e => console.log('Audio play failed:', e));
        toast(`${message.username} sent you a message`, { icon: '💬', duration: 3000 });
      }
      
      if (selectedUser && getUserId(selectedUser) === message.from) {
        markMessagesAsRead(message.from);
      }
    });
    
    newSocket.on('message-sent', (message) => {
      setMessages(prev => {
        if (prev.some(m => m._id === message._id)) return prev;
        return [...prev, message];
      });
    });
    
    newSocket.on('message-error', () => {
      toast.error('Failed to send message');
    });
    
    newSocket.on('user-typing', ({ from, isTyping }) => {
      if (selectedUser && getUserId(selectedUser) === from) {
        setTypingUser(isTyping ? from : null);
      }
    });
    
    newSocket.on('user-status-change', ({ userId, status }) => {
      setUsers(prev => prev.map(u => ({
        ...u,
        isOnline: getUserId(u) === userId ? status === 'online' : u.isOnline
      })));
    });
    
    return () => {
      newSocket.disconnect();
    };
  }, [user, fetchUsers, selectedUser, markMessagesAsRead, soundEnabled]);

  useEffect(() => {
    if (selectedUser) {
      const userId = getUserId(selectedUser);
      fetchMessages(userId);
      markMessagesAsRead(userId);
    }
  }, [selectedUser, fetchMessages, markMessagesAsRead]);

  const sendMessage = (text) => {
    if (!text.trim()) {
      toast.error('Cannot send empty message');
      return;
    }
    
    if (!selectedUser) {
      toast.error('Please select a user to chat with');
      return;
    }
    
    if (!socket || !isConnected) {
      toast.error('Not connected to server');
      return;
    }
    
    const receiverId = getUserId(selectedUser);
    
    socket.emit('private-message', {
      to: receiverId,
      from: user.id,
      message: text,
      username: user.username
    });
  };

  const handleTyping = (isTypingActive) => {
    if (!selectedUser || !socket || !isConnected) return;
    
    const receiverId = getUserId(selectedUser);
    
    if (isTypingActive) {
      socket.emit('typing-start', {
        to: receiverId,
        from: user.id,
        username: user.username
      });
    } else {
      socket.emit('typing-stop', {
        to: receiverId,
        from: user.id
      });
    }
  };

  const handleLogout = () => {
    if (socket) {
      socket.disconnect();
    }
    logout();
  };

  const filteredUsers = users.filter(u => 
    getUserName(u).toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="chat-container">
      <div className="chat-sidebar">
        <div className="sidebar-header">
          <div className="user-info">
            <div className="user-avatar">
              {user?.username?.charAt(0).toUpperCase()}
            </div>
            <div className="user-details">
              <h3>{user?.username}</h3>
              <p className="user-status">
                {isConnected ? 'Online' : 'Connecting...'}
              </p>
            </div>
            <button onClick={handleLogout} className="logout-button">
              <FiLogOut size={20} />
            </button>
          </div>
          <div className="search-box">
            <FiSearch />
            <input 
              type="text" 
              placeholder="Search users..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <ChatList 
          users={filteredUsers}
          selectedUser={selectedUser}
          onSelectUser={setSelectedUser}
        />
      </div>
      
      <div className="chat-main">
        {selectedUser ? (
          <>
            <div className="chat-header">
              <div className="chat-user-info">
                <div className="user-avatar-small" style={{width: '48px', height: '48px', fontSize: '20px'}}>
                  {getUserName(selectedUser).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3>{getUserName(selectedUser)}</h3>
                  <p style={{ fontSize: '12px', color: selectedUser.isOnline ? '#2ecc71' : '#666' }}>
                    {selectedUser.isOnline ? '● Online' : '○ Offline'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '8px',
                  color: '#666'
                }}
                title={soundEnabled ? 'Mute notifications' : 'Unmute notifications'}
              >
                {soundEnabled ? <FiVolume2 /> : <FiVolumeX />}
              </button>
            </div>
            
            <div className="messages-container">
              {loading ? (
                <div style={{textAlign: 'center', padding: '20px'}}>
                  <div className="loading-spinner"></div>
                </div>
              ) : (
                <>
                  {messages.length === 0 && (
                    <div style={{textAlign: 'center', padding: '40px', color: '#999'}}>
                      No messages yet. Send a message to start the conversation!
                    </div>
                  )}
                  {messages.map((msg, idx) => (
                    <Message
                      key={msg._id || idx}
                      message={msg}
                      isOwn={msg.from === user.id}
                    />
                  ))}
                  {typingUser && <TypingIndicator username={getUserName(selectedUser)} />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
            
            <MessageInput
              onSendMessage={sendMessage}
              onTyping={handleTyping}
            />
          </>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#999',
            textAlign: 'center',
            padding: '20px'
          }}>
            <FiUsers size={64} />
            <h3 style={{marginTop: '20px'}}>Select a user to start chatting</h3>
            <p style={{marginTop: '10px'}}>Click on any user from the sidebar to begin messaging</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;