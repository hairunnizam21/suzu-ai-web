# Suzu AI ⚡

AI Chatbot website with Google login, powered by Fiqstr API (Claude & GPT models).

![Suzu AI](https://img.shields.io/badge/Suzu-AI-6366f1?style=for-the-badge)

## Features

- **Google Login** — Firebase Authentication
- **Multiple AI Models** — Claude Opus, Claude Sonnet, GPT 5.4/5.5 via Fiqstr API
- **Streaming Responses** — Real-time AI responses with Server-Sent Events
- **Chat History** — All conversations saved per user in SQLite database
- **Model Selector** — Switch between AI models easily
- **Dark Theme** — Modern dark UI design
- **Mobile Responsive** — Works on phone and desktop
- **Markdown Support** — AI responses with code blocks, tables, lists

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | Firebase (Google login) |
| AI | Fiqstr API (OpenAI-compatible) |

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/hairunnizam21/suzu-ai.git
cd suzu-ai
```

### 2. Install dependencies

```bash
npm run install:all
```

### 3. Setup environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
PORT=3001
NODE_ENV=development
AI_API_BASE_URL=https://core.fiqstr.com/v1
AI_API_KEY=your-fiqstr-api-key
AI_DEFAULT_MODEL=fiqstr/claude-sonnet-4.6
FIREBASE_PROJECT_ID=suzu-ai-39dc5
```

### 4. Run in development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

### 5. Build for production

```bash
npm run build
```

### 6. Run in production

```bash
NODE_ENV=production npm start
```

## Deploy to VPS (DigitalOcean)

### Prerequisites on your VPS

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build tools (for better-sqlite3)
sudo apt-get install -y build-essential python3

# Install Nginx
sudo apt-get install -y nginx

# Install PM2 (process manager)
sudo npm install -g pm2
```

### Deploy steps

```bash
# 1. Clone on your server
cd /var/www
git clone https://github.com/hairunnizam21/suzu-ai.git
cd suzu-ai

# 2. Install dependencies
npm run install:all

# 3. Setup env
cp .env.example .env
nano .env  # fill in your API key

# 4. Build frontend
npm run build

# 5. Start with PM2
NODE_ENV=production pm2 start server/index.js --name suzu-ai
pm2 save
pm2 startup
```

### Nginx config

Create `/etc/nginx/sites-available/suzu-ai`:

```nginx
server {
    listen 80;
    server_name suzu-ai.online;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;  # Important for SSE streaming
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/suzu-ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Setup SSL (HTTPS)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d suzu-ai.online
```

### Point domain (Hostinger)

1. Login to Hostinger DNS settings
2. Set A record: `@` → Your VPS IP address
3. Set A record: `www` → Your VPS IP address

## Project Structure

```
suzu-ai/
├── server/
│   ├── index.js          # Express server entry
│   ├── db.js             # SQLite database
│   ├── middleware/
│   │   └── auth.js       # Firebase auth verification
│   └── routes/
│       ├── auth.js       # Auth endpoints
│       ├── chat.js       # Chat & conversations API
│       └── models.js     # Available models
├── client/
│   ├── src/
│   │   ├── App.jsx       # Main app component
│   │   ├── App.css       # Styles
│   │   ├── firebase.js   # Firebase config
│   │   ├── api.js        # API client
│   │   └── components/
│   │       ├── LoginPage.jsx
│   │       ├── Sidebar.jsx
│   │       └── ChatWindow.jsx
│   └── index.html
├── .env.example
├── package.json
└── README.md
```

## License

MIT
