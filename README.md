# AnyRAG Pilot

**AI-powered semantic search for VS Code with GPU acceleration**

AnyRAG Pilot brings enterprise-grade Retrieval-Augmented Generation (RAG) to your development workflow. Index your workspace, GitHub repositories, and any content - then search with natural language through the @anyrag chat participant.

## ✨ Features

- 🤖 **@anyrag Chat Participant** - AI assistant with semantic search over indexed content
- 🚀 **GPU Accelerated** - CUDA/MPS support for lightning-fast embeddings
- 🔒 **Privacy First** - All processing happens locally on your machine
- 📚 **Index Anything** - Workspaces, GitHub repos, documentation
- 🎯 **Semantic Search** - Find relevant context using natural language
- 💾 **Persistent Storage** - Indices survive across sessions

## 💎 Pro Features ($20/month)

- ✨ Unlimited indexed documents (Free: 100 docs)
- 📦 Unlimited indexed sources (Free: 3 sources)  
- 💬 Conversation indexing for chat history search
- 🎯 Priority support

## 🚀 Quick Start

1. **Install the extension** from VS Code Marketplace
2. **Index your workspace**: `Ctrl+Shift+P` → `AnyRAG Pilot: Index Workspace`
3. **Ask questions**: Open chat and use `@anyrag what is the authentication flow?`

## 📋 Requirements

- VS Code 1.90.0 or higher
- Python 3.13+ (auto-detected or configure in settings)
- 4GB+ RAM (8GB+ recommended for large indices)
- Optional: NVIDIA GPU with CUDA for acceleration

## 🔧 Configuration

- `anyragPilot.embeddingModel` - Choose embedding model (default: all-MiniLM-L6-v2)
- `anyragPilot.pythonPath` - Manual Python path (auto-detected by default)
- `anyragPilot.enableGPU` - Enable GPU acceleration (default: true)

## 📝 License

Commercial software. See LICENSE for details.

## 🛟 Support

- GitHub Issues: https://github.com/sudoecho1/AnyRAG-Pilot/issues
- Pro Support: Direct developer access
