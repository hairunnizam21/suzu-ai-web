import { useState, useEffect, useCallback } from 'react';
import { auth, loginWithGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  fetchConversations,
  createConversation,
  fetchMessages,
  sendMessage,
  deleteConversation,
  fetchModels,
} from './api';
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('fiqstr/claude-opus-4.7-thinking-agentic');

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load conversations and models when user logs in
  useEffect(() => {
    if (user) {
      loadConversations();
      loadModels();
    }
  }, [user]);

  const loadConversations = async () => {
    try {
      const convs = await fetchConversations();
      setConversations(convs);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  };

  const loadModels = async () => {
    try {
      const m = await fetchModels();
      setModels(m);
    } catch (err) {
      console.error('Failed to load models:', err);
    }
  };

  const handleSelectConversation = useCallback(async (convId) => {
    setActiveConvId(convId);
    try {
      const data = await fetchMessages(convId);
      setMessages(data.messages);
      if (data.conversation?.model) {
        setSelectedModel(data.conversation.model);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, []);

  const handleNewChat = async () => {
    try {
      const conv = await createConversation(selectedModel);
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleSend = async (content, imageFile) => {
    if (!activeConvId) {
      try {
        const conv = await createConversation(selectedModel);
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        setMessages([]);
        await sendAndStream(conv.id, content, imageFile);
      } catch (err) {
        console.error('Failed to create conversation:', err);
      }
      return;
    }
    await sendAndStream(activeConvId, content, imageFile);
  };

  const sendAndStream = async (convId, content, imageFile) => {
    let imageUrl = null;
    let imageBase64 = null;
    if (imageFile) {
      imageBase64 = await fileToBase64(imageFile);
      imageUrl = imageBase64;
    }

    const userMsg = { role: 'user', content: content || '(image)', imageUrl };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreamingContent('');

    let fullResponse = '';

    try {
      await sendMessage(convId, content, (chunk) => {
        fullResponse += chunk;
        setStreamingContent(fullResponse);
      }, imageBase64);

      setMessages((prev) => [...prev, { role: 'assistant', content: fullResponse }]);
      setStreamingContent('');
      loadConversations();
    } catch (err) {
      console.error('Send failed:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
      setStreamingContent('');
    } finally {
      setIsLoading(false);
    }
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  };

  const handleDelete = async (convId) => {
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setConversations([]);
    setMessages([]);
    setActiveConvId(null);
  };

  if (authLoading) {
    return (
      <div className="loading-screen">
        <span className="logo-icon spinning">⚡</span>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />;
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={handleDelete}
        user={user}
        onLogout={handleLogout}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
      />
      <main className="main-content">
        <ChatWindow
          messages={messages}
          onSend={handleSend}
          isLoading={isLoading}
          streamingContent={streamingContent}
          selectedModel={selectedModel}
          models={models}
        />
      </main>
    </div>
  );
}

export default App;
