![AnyRAG Pilot Logo](icon-large.png)

# AnyRAG Pilot

**AI-powered semantic search for VS Code with GPU acceleration**

AnyRAG Pilot brings enterprise-grade Retrieval-Augmented Generation (RAG) to your development workflow. Index your workspace, GitHub repositories, and any content - then search with natural language.

## 🎯 Two Ways to Use

### **@anyrag Chat Participant** - Focused RAG Search
**Use when you want answers ONLY from your indexed content**
- ✅ Guaranteed to search your indexed code/docs only
- ✅ Always shows source attribution with similarity scores
- ✅ No contamination from general LLM knowledge
- 🎯 Perfect for: "How does MY authentication work?" "What's in MY config?"

### **GitHub Copilot + MCP** - Flexible AI Assistant
**Use when you want Copilot's full capabilities with optional RAG**
- ✅ Copilot decides when to use your indexed content
- ✅ Combines your code with general programming knowledge
- ✅ Broad capabilities beyond just code search
- 🌐 Perfect for: General coding help, best practices, mixed context questions

## ✨ Features

- 🎯 **@anyrag Chat Participant** - Targeted search of ONLY your indexed content with source attribution
- � **Hybrid Search** - Combines semantic understanding with exact keyword matching for better results
- �💬 **Chat Indexing** - Index conversations with `/indexchat` (Free: 1 chat, Pro: unlimited)
- 🚀 **GPU Accelerated** - CUDA/MPS support for lightning-fast embeddings
- 🔒 **Privacy First** - All processing happens locally on your machine
- 📚 **Index Anything** - Workspaces, GitHub repos, documentation, chat conversations
- 🔌 **Model Context Protocol** - Integrates with GitHub Copilot as MCP server
- 💾 **Persistent Storage** - Indices survive across sessions

## 💎 Pro Features ($10/month)

- ✨ Unlimited indexed documents (Free: 1000 docs)
- 📦 Unlimited indexed sources (Free: 3 sources)
- 💬 **Unlimited chat indexing** (Free: 1 chat)
- 🎨 **Custom embedding models** - Use any HuggingFace model (Free: 3 presets)
- 🗂️ **Multiple indices** - Organize content by project or use case
- 🏷️ **Chat naming & management** - Rename and organize indexed conversations
- 🎯 Priority support

**[Upgrade to Pro →](https://anyrag.sudoecho.com/upgrade)**

## 🚀 Quick Start

1. **Install the extension** from VS Code Marketplace
2. **Wait for initial setup** (first launch only) - The extension will install Python dependencies, which may take 2-5 minutes. You'll see a progress notification.
3. **Index your workspace**: `Ctrl+Shift+P` → `AnyRAG Pilot: Index Workspace`
4. **Ask focused questions**: Open chat and use `@anyrag how does authentication work in this codebase?`
   - @anyrag searches ONLY your indexed content and shows sources
   - Regular Copilot chat can use indexed content OR general knowledge
5. **Index conversations**: In chat, use `/indexchat` to save your conversation for future search

### 💬 Chat Commands

Use these commands in the `@anyrag` chat participant:

- `/indexchat` - Index the current conversation with an auto-generated name
- `/indexchat my-chat-name` - Index with a custom name for easy reference

**Managing Indexed Chats:**
- View chats: `Ctrl+Shift+P` → `AnyRAG Pilot: Show Indexed Sources`
- Rename chats: Select a chat source → `Rename Chat`
- Re-run `/indexchat` anytime to update with new messages (replaces old version)

## 📋 Requirements

- VS Code 1.90.0 or higher
- **GitHub Copilot Chat extension** (required for @anyrag chat participant)
- Python 3.13+ (auto-detected or configure in settings)
- 4GB+ RAM (8GB+ recommended for large indices)
- Optional: NVIDIA GPU with CUDA for acceleration

## 🔧 Configuration

### Search Modes

AnyRAG offers three search strategies to match different query types:

- **Semantic** (default) - Vector similarity search
  - ✅ Best for: Conceptual queries, "how does X work?", understanding relationships
  - ❌ May miss: Specific names, exact identifiers, proper nouns
  
- **Keyword** - Exact text matching with ChromaDB's `$contains`
  - ✅ Best for: Finding specific names, identifiers, machine names (e.g., "HTB: Previous")
  - ❌ May miss: Conceptually related content that doesn't use exact terms
  
- **Hybrid** - Combines both approaches with score fusion
  - ✅ Best for: Mixed queries, when you're not sure which mode to use
  - ⚡ Keyword matches get a 0.3 boost to appear higher in results
  - 🎯 Gets the best of both semantic understanding and exact matching

**Configure in Settings:** `anyragPilot.defaultSearchMode`

**Important:** The `defaultSearchMode` setting applies to `@anyrag` chat participant queries. When using AnyRAG MCP tools directly (via GitHub Copilot without @anyrag), you must explicitly specify the `search_mode` parameter in tool calls, as MCP tools use `semantic` by default.

**Note:** For best keyword/hybrid results, use concise queries with exact terms you're looking for.

### Community Tier Settings

- `anyragPilot.embeddingModel` - Choose from 3 preset models:
  - `all-MiniLM-L6-v2` (default) - Fast, 384d
  - `all-MiniLM-L12-v2` - Balanced, 384d
  - `all-mpnet-base-v2` - Best quality, 768d
- `anyragPilot.pythonPath` - Manual Python path (auto-detected by default)
- `anyragPilot.enableGPU` - Enable GPU acceleration (default: true)
- `anyragPilot.searchResults` - Number of search results (default: 20)
- `anyragPilot.defaultSearchMode` - Search strategy (default: semantic):
  - `semantic` - Vector similarity search for conceptual queries
  - `keyword` - Exact text matching for specific names/identifiers  
  - `hybrid` - Combined approach with keyword boosting (best for mixed queries)

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

## 🗂️ Multi-Index Support (Pro)

**Pro tier** users can create multiple indices with different embedding models to organize content by project, language, or use case.

### Quick Start

1. **Create an index**: `Ctrl+Shift+P` → `AnyRAG Pilot: Create Index`
2. **Switch indices**: Click the database icon in the status bar (bottom right)
3. **Manage indices**: Actions available in the index switcher (rename, delete)

Your **active index** (shown in status bar) is automatically used by all commands and searches. Changes persist across sessions.

### Example Use Cases

**Different embedding models:**
- `code-specialized` - Uses BAAI/bge-large-en-v1.5 for code
- `docs-quality` - Uses all-mpnet-base-v2 for documentation
- `fast-search` - Uses all-MiniLM-L6-v2 for quick searches

**Separate projects/clients:**
- `client-acme` - Acme Corp project
- `client-beta` - Beta Inc project
- `personal-projects` - Your side projects

Each index has its own embedding model and completely separate content.

## 🗂️ Managing Sources & Tags

Every time you index content (workspace, GitHub repo, file, or chat), AnyRAG creates a **source** - a logical grouping of that content. Sources can be organized with tags and activated/deactivated to control what's searched.

### Viewing Sources

`Ctrl+Shift+P` → `AnyRAG Pilot: Show Indexed Sources`

Displays all indexed content with:
- **Type indicators**: 📁 Folder, 📦 Repo, 📄 File
- **Active status**: Green checkmark for active sources
- **Chunk count**: Number of indexed segments
- **Tags**: Organization labels

### Source Actions

Click any source to:
- **Add/Remove Tags** - Organize with labels like `docs`, `python`, `important`
- **Activate/Deactivate** - Control which sources are searched
- **Rename** - Change chat conversation names
- **Remove** - Delete source and all its data

### Active vs Inactive Sources

Only **active sources** are included in searches. This lets you:
- Focus searches on relevant content
- Switch contexts quickly using tags
- Keep indexed content without searching it

**Community Tier Limitation:**
- Only **1 source can be active at a time**
- Must deactivate current source before activating another
- Pro: Unlimited active sources

### Using Tags Effectively

**Tag during indexing:**
```
Index Workspace → Auto-tagged: workspace, [folder-name]
Index GitHub Repo → Auto-tagged: github
Index File → Auto-tagged: file, [filename]
```

**Organize within your project:**
- `core` - Main application code
- `dependencies` - Third-party libraries
- `docs` - Documentation files
- `tests` - Test files
- `deprecated` - Old code to keep but not search

**Community users:** Switch between sources using tags (only 1 active at a time)
- Working on code: Activate `core` tagged sources
- Reading docs: Deactivate `core`, activate `docs`
- Need library reference: Activate `dependencies`

## 📝 License

MIT License - See [LICENSE](LICENSE) for details.

## 🛟 Support

- **GitHub Issues**: [Report bugs & request features](https://github.com/sudoecho1/AnyRAG-Pilot/issues)
- **Pro Support**: [Upgrade for priority support](https://anyrag.sudoecho.com/upgrade)
- **Documentation**: [Full documentation](https://github.com/sudoecho1/AnyRAG-Pilot#readme)
- Pro Support: Direct developer access
