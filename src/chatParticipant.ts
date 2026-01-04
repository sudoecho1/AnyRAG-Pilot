import * as vscode from 'vscode';
import { MCPClient, SearchResult, IndexSource, SearchResultItem } from './mcpClient.js';

interface ChatContext {
    query: string;
    results: SearchResult;
    embeddingModel: string;
}

export class ChatParticipant {
    private conversationContext: Map<string, ChatContext[]> = new Map();
    
    constructor(private mcpClient: MCPClient) {}

    async handleRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<vscode.ChatResult> {
        try {
            const query = request.prompt;

            if (!query.trim()) {
                stream.markdown('Please provide a search query or question.');
                return { metadata: { command: 'empty' } };
            }

            // Show searching indicator
            stream.progress('Searching indexed content...');

            // Get embedding model from config
            const config = vscode.workspace.getConfiguration('anyragPilot');
            const embeddingModel = config.get<string>('embeddingModel', 'all-MiniLM-L6-v2');
            const searchResults = config.get<number>('searchResults', 50);

            // First check what sources are available
            const indexStatus = await this.mcpClient.showIndex();
            console.log('Index status:', JSON.stringify(indexStatus, null, 2));
            
            // Ensure we have active sources
            const activeSources = indexStatus.sources?.filter((s: IndexSource) => s.active) || [];
            if (activeSources.length === 0 && indexStatus.sources?.length > 0) {
                stream.markdown('⚠️ You have indexed sources but none are activated. Activating all sources...\n\n');
                // Activate all sources
                for (const source of indexStatus.sources) {
                    await this.mcpClient.activateSource(source.source_id);
                }
            }
            
            // Search using MCP server
            const searchResult: SearchResult = await this.mcpClient.search({
                query,
                n_results: searchResults,
                model_name: embeddingModel
            });
            
            console.log('Search result:', JSON.stringify({
                documentCount: searchResult.results?.length || 0,
                query,
                fullResult: searchResult
            }));

            if (!searchResult.results || searchResult.results.length === 0) {
                stream.markdown('No relevant content found in indexed sources. Try indexing your workspace or GitHub repositories first.\n\n');
                stream.markdown('**Quick Start:**\n');
                stream.markdown('- Run `AnyRAG Pilot: Index Workspace` to index your current project\n');
                stream.markdown('- Run `AnyRAG Pilot: Index GitHub Repo` to index external repositories\n');
                stream.markdown('- Run `AnyRAG Pilot: Show Indexed Sources` to view what\'s indexed\n');
                return { metadata: { command: 'search', resultCount: 0 } };
            }

            // Store context for follow-up questions
            const conversationId = context.history.length > 0 ? 'current' : 'current';
            if (!this.conversationContext.has(conversationId)) {
                this.conversationContext.set(conversationId, []);
            }
            this.conversationContext.get(conversationId)!.push({
                query,
                results: searchResult,
                embeddingModel
            });

            // Group results by source for later reference
            const resultsBySource = new Map<string, Array<{item: SearchResultItem, similarity: string}>>();
            for (const item of searchResult.results) {
                const similarity = (item.similarity_score * 100).toFixed(1);
                const source = item.file_path;
                if (!resultsBySource.has(source)) {
                    resultsBySource.set(source, []);
                }
                resultsBySource.get(source)!.push({ item, similarity });
            }

            // Build context from search results for LLM
            const contextChunks = searchResult.results.map((item, idx) => {
                const fileName = item.file_path.split('/').pop() || item.file_path;
                return `[${idx + 1}] From ${fileName}:\n${item.document}\n`;
            }).join('\n');

            // Use VS Code's language model to generate a response
            const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
            if (models.length === 0) {
                // Fallback to showing search results if no LLM available
                stream.markdown(`## 🔍 Found ${searchResult.results.length} relevant results\n\n`);
                stream.markdown('*Note: Install GitHub Copilot or another language model extension for AI-generated answers.*\n\n');
                this.displaySearchResults(searchResult, resultsBySource, stream);
                return { metadata: { command: 'search', resultCount: searchResult.results.length } };
            }

            const model = models[0];

            // Generate AI response using search results as context
            stream.progress('Generating response...');

            const messages = [
                vscode.LanguageModelChatMessage.User(
                    `You are a helpful AI assistant with access to the user's indexed code and documentation. Answer the following question based on the provided context.\n\nContext from indexed sources:\n${contextChunks}\n\nUser question: ${query}\n\nProvide a clear, concise answer based on the context. If the context doesn't contain enough information, say so. Reference specific sources when relevant.`
                )
            ];

            const chatResponse = await model.sendRequest(messages, {}, token);

            // Stream the LLM response
            for await (const fragment of chatResponse.text) {
                stream.markdown(fragment);
            }

            // Add source references (show top 3 only)
            stream.markdown('\n\n---\n\n### 📚 Sources\n\n');
            let sourceCount = 0;
            for (const [source, results] of resultsBySource.entries()) {
                if (sourceCount >= 3) break;
                const fileName = source.split('/').pop() || source;
                const avgSimilarity = (results.reduce((sum: number, r: any) => sum + parseFloat(r.similarity), 0) / results.length).toFixed(1);
                stream.markdown(`- **${fileName}** (${results.length} chunk${results.length > 1 ? 's' : ''}, ${avgSimilarity}% relevant)\n`);
                sourceCount++;
            }

            return {
                metadata: {
                    command: 'search',
                    resultCount: searchResult.results.length,
                    sources: Array.from(resultsBySource.keys())
                }
            };

        } catch (error) {
            stream.markdown(`❌ **Error occurred during search**\n\n`);
            stream.markdown(`\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\`\n\n`);
            stream.markdown('**Troubleshooting:**\n');
            stream.markdown('- Ensure you have indexed content using `Index Workspace` or `Index GitHub Repo`\n');
            stream.markdown('- Check that the MCP server is running properly\n');
            stream.markdown('- Try running `Show License Info` to verify your setup\n');
            return { metadata: { command: 'error' } };
        }
    }

    private displaySearchResults(searchResult: SearchResult, resultsBySource: Map<string, Array<{item: SearchResultItem, similarity: string}>>, stream: vscode.ChatResponseStream) {
        // Stream results grouped by source
        for (const [source, results] of resultsBySource.entries()) {
            const fileName = source.split('/').pop() || source;
            const totalSimilarity = results.reduce((sum, r) => sum + parseFloat(r.similarity), 0);
            const avgSimilarity = (totalSimilarity / results.length).toFixed(1);
            
            stream.markdown(`### 📄 ${fileName} (${results.length} chunk${results.length > 1 ? 's' : ''}, avg ${avgSimilarity}% relevant)\n\n`);
            
            for (const result of results) {
                stream.markdown(`**Rank #${result.item.rank}** (${result.similarity}% match):\n\n`);
                
                // Show first 400 chars with smart truncation
                let preview = result.item.document.substring(0, 400);
                if (result.item.document.length > 400) {
                    const lastSpace = preview.lastIndexOf(' ');
                    if (lastSpace > 300) {
                        preview = preview.substring(0, lastSpace);
                    }
                    preview += '...';
                }
                
                stream.markdown('```\n');
                stream.markdown(preview);
                stream.markdown('\n```\n\n');
            }
        }

        // Add context-aware suggestions
        stream.markdown('---\n\n');
        stream.markdown('### 💡 Suggested Actions\n\n');
        
        const hasCode = searchResult.results.some(item => 
            item.document.includes('function') || item.document.includes('class') || item.document.includes('def ')
        );
        
        if (hasCode) {
            stream.markdown('- Ask "Explain how this code works" for detailed analysis\n');
            stream.markdown('- Ask "What are potential bugs in this code?" for code review\n');
        } else {
            stream.markdown('- Ask follow-up questions to explore the content further\n');
            stream.markdown('- Use "Show more details about X" to dive deeper\n');
        }
        
        stream.markdown('- Run `Show Indexed Sources` to see all available context\n');
    }
}
