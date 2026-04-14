import React from 'react';
import { format } from 'date-fns';

function Message({ message, isOwn }) {
  const timestamp = message.createdAt || message.timestamp;
  
  return (
    <div className={`message ${isOwn ? 'sent' : 'received'}`}>
      <div className="message-bubble">
        <div className="message-text">{message.message}</div>
        <div className="message-time">
          {timestamp ? format(new Date(timestamp), 'HH:mm') : 'Just now'}
          {isOwn && message.read && <span style={{ marginLeft: '5px' }}>✓✓</span>}
          {isOwn && !message.read && <span style={{ marginLeft: '5px' }}>✓</span>}
        </div>
      </div>
    </div>
  );
}

export default Message;