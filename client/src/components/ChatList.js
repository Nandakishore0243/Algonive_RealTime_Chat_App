import React from 'react';

function ChatList({ users, selectedUser, onSelectUser }) {
  const getUserId = (user) => user?.id || user?._id;
  const getUserName = (user) => user?.username;

  if (users.length === 0) {
    return (
      <div className="users-list">
        <div style={{ padding: '20px', textAlign: 'center', color: '#95a5a6' }}>
          No users found
        </div>
      </div>
    );
  }

  return (
    <div className="users-list">
      {users.map(user => (
        <div
          key={getUserId(user)}
          className={`user-item ${getUserId(selectedUser) === getUserId(user) ? 'active' : ''}`}
          onClick={() => onSelectUser(user)}
        >
          <div className="user-avatar-small">
            {getUserName(user)?.charAt(0).toUpperCase()}
            {user.isOnline && <span className="online-indicator"></span>}
          </div>
          <div className="user-info-text">
            <h4>{getUserName(user)}</h4>
            <p style={{ color: user.isOnline ? '#2ecc71' : '#95a5a6' }}>
              {user.isOnline ? 'Online' : 'Offline'}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ChatList;