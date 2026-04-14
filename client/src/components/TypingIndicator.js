import React from 'react';

function TypingIndicator({ username }) {
  return (
    <div className="typing-indicator">
      {username} is typing...
    </div>
  );
}

export default TypingIndicator;