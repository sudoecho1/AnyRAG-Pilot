# Change Log

All notable changes to the "AnyRAG Pilot" extension will be documented in this file.

## [0.1.7] - 2026-01-26

### Fixed
- MCP tools now properly appear in GitHub Copilot Chat
- Switched from settings-based MCP registration to official `vscode.lm.registerMcpServerDefinitionProvider` API
- Improved extension best practices compliance

## [0.1.6] - 2026-01-17

### Bug Fixes
- Fixed venv creation to respect `anyragPilot.pythonPath` configuration setting
- Support both directory paths and direct executable paths for Python configuration
- Resolves issue where system Python was used instead of pyenv or other configured Python versions

## [0.1.3] - 2026-01-08

### Documentation
- Updated README with comprehensive multi-index documentation
- Added "Managing Sources & Tags" section explaining source organization
- Clarified difference between index names (Pro) and tags (all tiers)
- Improved examples to better distinguish index vs tag use cases

### Bug Fixes
- Removed debug notification popups from extension activation and index switching
- Fixed corrupted emoji characters in README markdown

## [0.1.0] - 2026-01-06

### Initial Release 🚀

**Two Ways to Use:**
- **@anyrag Chat Participant** - Focused RAG search of ONLY your indexed content with source attribution
- **GitHub Copilot + MCP** - Flexible AI assistant with optional RAG integration

**Core Features:**
- 🎯 @anyrag chat participant - Guaranteed index-only search with similarity scores and sources
- 📚 Index workspaces, folders, files, and GitHub repositories
- 💬 Chat conversation indexing with `/indexchat` command (Free: 1 chat)
- 🚀 GPU acceleration support (CUDA/MPS)
- 🔒 Privacy-first local processing
- 🔌 Model Context Protocol (MCP) server for GitHub Copilot integration
- 💾 Persistent vector storage with ChromaDB

**Pro Features ($20/month):**
- ✨ Unlimited indexed documents (Free: 1000 docs)
- 📦 Unlimited indexed sources (Free: 3 sources)
- 💬 Unlimited chat indexing (Free: 1 chat)
- 🎨 Custom embedding models from HuggingFace (Free: 3 presets)
- 🗂️ Multiple indices with independent configurations
- 🏷️ Chat renaming and management
- 🎯 Priority support

**Available Commands:**
- Index Workspace/Folder/File
- Index GitHub Repository  
- Show Indexed Sources (with tag management, activation controls, chat renaming)
- Clear Index
- Create/Switch/List/Delete Indices (Pro)
- Activate/Deactivate Pro License
- Upgrade to Pro

**Configuration Options:**
- Choose from 3 preset embedding models (Community) or any HuggingFace model (Pro)
- Python path auto-detection
- GPU acceleration toggle
- Configurable search result count

**Architecture:**
- Model Context Protocol (MCP) integration for Copilot
- Single source of truth license validation via Python server
- Efficient caching with 24-hour license validation TTL
- Tag-based source organization
