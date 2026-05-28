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
  fetchUsage,
} from './api';
import LoginPage from './components/LoginPage';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import ApkTools from './components/ApkTools';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingTool, setStreamingTool] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('fiqstr/claude-sonnet-4.6-thinking-agentic');
  const [view, setView] = useState('chat'); // 'chat' | 'apk'
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const u = await fetchUsage();
      setUsage(u);
    } catch (err) {
      console.error('Failed to load usage:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadModels();
      loadUsage();
    }
  }, [user, loadUsage]);

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
    let imageBase64 = null;
    if (imageFile) {
      imageBase64 = await fileToBase64(imageFile);
    }

    const userMsg = { role: 'user', content: content || '', image: imageBase64 || null };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreamingContent('');
    setStreamingTool(null);

    let fullResponse = '';

    try {
      await sendMessage(
        convId,
        content,
        (event) => {
          if (event.content) {
            fullResponse += event.content;
            setStreamingContent(fullResponse);
          }
          if (event.event === 'tool_call') {
            setStreamingTool({ phase: 'call', name: event.name, args: event.arguments });
          }
          if (event.event === 'tool_result') {
            setStreamingTool({ phase: 'result', name: event.name, result: event.result });
          }
          if (event.event === 'usage') {
            setUsage(event);
          }
          if (event.error) {
            throw new Error(event.error);
          }
        },
        imageBase64
      );

      setMessages((prev) => [...prev, { role: 'assistant', content: fullResponse }]);
      setStreamingContent('');
      setStreamingTool(null);
      loadConversations();
      loadUsage();
    } catch (err) {
      console.error('Send failed:', err);
      const msg =
        err.status === 429
          ? 'Daily token limit reached. Try again tomorrow.'
          : err.message || 'Sorry, something went wrong. Please try again.';
      setMessages((prev) => [...prev, { role: 'assistant', content: msg }]);
      setStreamingContent('');
      setStreamingTool(null);
      loadUsage();
    } finally {
      setIsLoading(false);
    }
  };

  const fileToBase64 = (file) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });

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
        onSelect={(id) => {
          setView('chat');
          handleSelectConversation(id);
        }}
        onNew={() => {
          setView('chat');
          handleNewChat();
        }}
        onDelete={handleDelete}
        user={user}
        onLogout={handleLogout}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        view={view}
        onViewChange={setView}
        usage={usage}
      />
      <main className="main-content">
        {view === 'chat' ? (
          <ChatWindow
            messages={messages}
            onSend={handleSend}
            isLoading={isLoading}
            streamingContent={streamingContent}
            streamingTool={streamingTool}
            selectedModel={selectedModel}
            models={models}
          />
        ) : (
          <ApkTools />
        )}
      </main>
    </div>
  );
}

export default App;
