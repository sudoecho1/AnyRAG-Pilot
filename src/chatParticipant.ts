import * as vscode from 'vscode';
import { MCPClient, SearchResult } from './mcpClient.js';

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
            const searchResults = config.get<number>('searchResults', 5);

            // Search using MCP server
            const searchResult: SearchResult = await this.mcpClient.search({
                query,
                n_results: searchResults,
                model_name: embeddingModel
            });

            if (!searchResult.documents || searchResult.documents[0].length === 0) {
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

            // Format and stream results with enhanced context
            stream.markdown(`## 🔍 Found ${searchResult.documents[0].length} relevant results\n\n`);

            // Group results by source
            const resultsBySource = new Map<string, Array<{doc: string, metadata: any, similarity: string, index: number}>>();
            
            for (let i = 0; i < searchResult.documents[0].length; i++) {
                const doc = searchResult.documents[0][i];
                const metadata = searchResult.metadatas[i];
                const distance = searchResult.distances[0][i];
                const similarity = ((1 - distance) * 100).toFixed(1);

                const source = metadata.source || metadata.file || 'Unknown';
                
                if (!resultsBySource.has(source)) {
                    resultsBySource.set(source, []);
                }
                
                resultsBySource.get(source)!.push({
                    doc,
                    metadata,
                    similarity,
                    index: i + 1
                });
            }

            // Stream results grouped by source
            for (const [source, results] of resultsBySource.entries()) {
                const fileName = source.split('/').pop() || source;
                const totalSimilarity = results.reduce((sum, r) => sum + parseFloat(r.similarity), 0);
                const avgSimilarity = (totalSimilarity / results.length).toFixed(1);
                
                stream.markdown(`### 📄 ${fileName} (${results.length} chunk${results.length > 1 ? 's' : ''}, avg ${avgSimilarity}% relevant)\n\n`);
                
                for (const result of results) {
                    stream.markdown(`**Chunk #${result.index}** (${result.similarity}% match):\n\n`);
                    
                    // Show first 400 chars with smart truncation
                    let preview = result.doc.substring(0, 400);
                    if (result.doc.length > 400) {
                        const lastSpace = preview.lastIndexOf(' ');
                        if (lastSpace > 300) {
                            preview = preview.substring(0, lastSpace);
                        }
                        preview += '...';
                    }
                    
                    stream.markdown('```\n');
                    stream.markdown(preview);
                    stream.markdown('\n```\n\n');
                    
                    // Add tags if available
                    if (result.metadata.tags && result.metadata.tags.length > 0) {
                        stream.markdown(`*Tags: ${result.metadata.tags.join(', ')}*\n\n`);
                    }
                }
            }

            // Add context-aware suggestions
            stream.markdown('---\n\n');
            stream.markdown('### 💡 Suggested Actions\n\n');
            
            const hasCode = searchResult.documents[0].some(doc => 
                doc.includes('function') || doc.includes('class') || doc.includes('def ')
            );
            
            if (hasCode) {
                stream.markdown('- Ask "Explain how this code works" for detailed analysis\n');
                stream.markdown('- Ask "What are potential bugs in this code?" for code review\n');
            } else {
                stream.markdown('- Ask follow-up questions to explore the content further\n');
                stream.markdown('- Use "Show more details about X" to dive deeper\n');
            }
            
            stream.markdown('- Run `Show Indexed Sources` to see all available context\n');

            return {
                metadata: {
                    command: 'search',
                    resultCount: searchResult.documents[0].length,
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
}
