import React from 'react';
import { ChatPanel } from '../components/chat/ChatPanel.js';

export const AssistantPage: React.FC = () => {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <ChatPanel />
    </div>
  );
};

export default AssistantPage;
