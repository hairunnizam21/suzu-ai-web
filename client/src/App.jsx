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
  fetchMe,
  apkUpload,
  apkDecompile,
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
  const [streamingTool, setStreamingTool] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('fiqstr/claude-sonnet-4.6-thinking-agentic');
  const [usage, setUsage] = useState(null);
  const [plan, setPlan] = useState('free');
  const [planExpiresAt, setPlanExpiresAt] = useState(null);

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

  const loadMe = useCallback(async () => {
    try {
      const me = await fetchMe();
      if (me?.plan) setPlan(me.plan);
      setPlanExpiresAt(me?.plan_expires_at || null);
      if (me?.usage) setUsage(me.usage);
    } catch (err) {
      console.error('Failed to load /me:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadConversations();
      loadModels();
      loadUsage();
      loadMe();
    }
  }, [user, loadUsage, loadMe]);

  // Deep-link: ?conv=<id> loads a specific conversation (only owner can read)
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const convId = params.get('conv');
    if (convId) {
      handleSelectConversation(convId).catch(() => {});
      // Clean the param from the URL so refreshes don't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete('conv');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setStreamingContent('');
    setStreamingTool(null);
    setIsLoading(false);
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
    setStreamingContent('');
    setStreamingTool(null);
    setIsLoading(false);
    try {
      const conv = await createConversation(selectedModel);
      setConversations((prev) => [conv, ...prev]);
      setActiveConvId(conv.id);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleSendApk = async (file, note) => {
    try {
      let convId = activeConvId;
      if (!convId) {
        const conv = await createConversation(selectedModel);
        setConversations((prev) => [conv, ...prev]);
        setActiveConvId(conv.id);
        setMessages([]);
        convId = conv.id;
      }

      // Show a placeholder user message so the user gets immediate feedback
      const sizeMB = (file.size / 1024 / 1024).toFixed(2);
      const placeholder = `📦 Uploading APK: ${file.name} (${sizeMB} MB)…`;
      setMessages((prev) => [...prev, { role: 'user', content: placeholder }]);
      setIsLoading(true);

      const project = await apkUpload(file);
      setMessages((prev) => {
        const next = prev.slice(0, -1);
        next.push({ role: 'user', content: `📦 Uploaded ‘${file.name}’ — decompiling…` });
        return next;
      });
      try {
        await apkDecompile(project.id);
      } catch (e) {
        console.warn('Auto-decompile failed; AI can retry via tool', e);
      }

      const finalUserText =
        (note && note.trim())
          ? `${note}\n\n(Attached APK project_id: ${project.id}, name: ${project.name})`
          : `Saya attach APK: ‘${project.name}’. project_id: ${project.id}. Sila analyze APK ini secara reverse-engineering: ringkaskan package, version, SDK, permissions berbahaya, components, URL/endpoint, suspicious APIs. Selepas itu cadangkan modifications yang berguna.`;

      // Replace the placeholder with the final user message so it persists correctly
      setMessages((prev) => {
        const next = prev.slice(0, -1);
        return next;
      });
      setIsLoading(false);
      await sendAndStream(convId, finalUserText, null);
    } catch (err) {
      console.error('APK send failed', err);
      setMessages((prev) => [...prev, { role: 'assistant', content: 'APK upload/decompile failed: ' + (err.message || err) }]);
      setIsLoading(false);
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
        err.status === 429 || (err.message && err.message.includes('rate_limit'))
          ? 'Rate limit tercapai. Cuba lagi sebentar.'
          : err.status === 500 && err.message?.includes('Too many requests')
          ? 'Server sibuk. Cuba lagi dalam beberapa saat.'
          : err.message || 'Maaf, ada masalah. Sila cuba lagi.';
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
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={handleDelete}
        user={user}
        onLogout={handleLogout}
        models={models}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        usage={usage}
        plan={plan}
        planExpiresAt={planExpiresAt}
      />
      <main className="main-content">
        <ChatWindow
          messages={messages}
          onSend={handleSend}
          onSendApk={handleSendApk}
          isLoading={isLoading}
          streamingContent={streamingContent}
          streamingTool={streamingTool}
          selectedModel={selectedModel}
          models={models}
          user={user}
        />
      </main>
    </div>
  );
}

export default App;
