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
- 🎨 **Custom embedding models** - Use any HuggingFace model (Free: 3 presets)
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

### Community Tier Settings

- `anyragPilot.embeddingModel` - Choose from 3 preset models:
  - `all-MiniLM-L6-v2` (default) - Fast, 384d
  - `all-MiniLM-L12-v2` - Balanced, 384d
  - `all-mpnet-base-v2` - Best quality, 768d
- `anyragPilot.pythonPath` - Manual Python path (auto-detected by default)
- `anyragPilot.enableGPU` - Enable GPU acceleration (default: true)
- `anyragPilot.searchResults` - Number of search results (default: 20)

### Pro Tier Settings

- `anyragPilot.embeddingModel` - Select "custom" to use any HuggingFace model
- `anyragPilot.customEmbeddingModel` - Enter model name (e.g., `BAAI/bge-large-en-v1.5`)

### 🔍 Finding Compatible Embedding Models (Pro)

**✅ Compatible models must have:**
- `sentence-transformers` library tag on HuggingFace
- Model type: "Sentence Transformers"
- Purpose: Text/sentence embeddings (not generation or classification)

**Quick way to find models:**
```
https://huggingface.co/models?library=sentence-transformers&sort=downloads
```

**Recommended custom models:**
- `BAAI/bge-large-en-v1.5` - Excellent for code (1024d)
- `thenlper/gte-large` - High quality, multilingual (1024d)
- `intfloat/e5-large-v2` - Strong general purpose (1024d)
- `sentence-transformers/multi-qa-mpnet-base-dot-v1` - Great for Q&A (768d)

**⚠️ Incompatible models (will error):**
- GPT, LLaMA, Mistral (text generation)
- BERT classification models
- Any model without sentence-transformers support

AnyRAG validates models automatically and provides clear error messages for incompatible models.

## �️ Multi-Index Support (Pro)

**Pro tier** supports creating and managing multiple indices with different embedding models. This lets you organize content by project, language, or use case.

### Creating and Switching Indices

1. **Create index**: `Ctrl+Shift+P` → `AnyRAG Pilot: Create Index`
2. **Switch index**: Click the index name in the status bar (bottom right) or use `Ctrl+Shift+P` → `AnyRAG Pilot: Switch Index`
3. **View all indices**: `Ctrl+Shift+P` → `AnyRAG Pilot: List Indices`

### Multi-Index Workflows

**⚠️ Important**: Multi-index behavior varies based on how you interact with AnyRAG:

| Interaction Method | Active Index Behavior |
|---|---|
| **Command Palette** commands | ✅ Uses active index from status bar |
| **`@anyrag` chat participant** | ✅ Uses active index from status bar |
| **Copilot Chat (direct MCP)** | ⚠️ Always uses "default" index* |

\* When using Copilot Chat directly (without `@anyrag`), you must explicitly specify the index:
- ❌ "index fastapi/fastapi" → Goes to "default" index
- ✅ "index fastapi/fastapi into the test index" → Goes to "test" index

**Recommended workflow for multi-index:**
- Use Command Palette commands (e.g., "Index GitHub Repo", "Index Folder")
- Or use `@anyrag` chat participant which respects your active index

### Why This Limitation?

The global MCP server (used by Copilot Chat) runs as a separate process and doesn't have access to VS Code extension state like the active index. Command Palette commands and `@anyrag` run through the extension and have full access to your active index selection.

## �📝 License

Commercial software. See LICENSE for details.

## 🛟 Support

- GitHub Issues: https://github.com/sudoecho1/AnyRAG-Pilot/issues
- Pro Support: Direct developer access
