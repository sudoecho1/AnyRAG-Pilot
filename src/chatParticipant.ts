import * as vscode from 'vscode';
import { MCPClient, SearchResult } from './mcpClient.js';

export class ChatParticipant {
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

            // Search using MCP server
            const searchResult: SearchResult = await this.mcpClient.search({
                query,
                n_results: 5,
                model_name: embeddingModel
            });

            if (!searchResult.documents || searchResult.documents[0].length === 0) {
                stream.markdown('No relevant content found in indexed sources. Try indexing your workspace or GitHub repositories first.');
                return { metadata: { command: 'search', resultCount: 0 } };
            }

            // Format and stream results
            stream.markdown(`Found ${searchResult.documents[0].length} relevant results:\\n\\n`);

            for (let i = 0; i < searchResult.documents[0].length; i++) {
                const doc = searchResult.documents[0][i];
                const metadata = searchResult.metadatas[i];
                const distance = searchResult.distances[0][i];
                const similarity = (1 - distance).toFixed(3);

                // Format source
                const source = metadata.source || 'Unknown';
                const fileName = metadata.file || source.split('/').pop() || 'Unknown';
                
                stream.markdown(`### Result ${i + 1} (Similarity: ${similarity})\\n`);
                stream.markdown(`**Source:** \`${fileName}\`\\n\\n`);
                stream.markdown('```\\n');
                stream.markdown(doc.substring(0, 500));
                if (doc.length > 500) {
                    stream.markdown('...\\n');
                }
                stream.markdown('```\\n\\n');
            }

            // Add helpful tip
            stream.markdown('---\\n*Tip: Use these results as context for your questions. Ask follow-up questions to explore further.*');

            return {
                metadata: {
                    command: 'search',
                    resultCount: searchResult.documents[0].length
                }
            };

        } catch (error) {
            stream.markdown(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
            return { metadata: { command: 'error' } };
        }
    }
}
