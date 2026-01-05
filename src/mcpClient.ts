import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';

export interface IndexFolderParams extends Record<string, unknown> {
    folder_path: string;
    file_extensions?: string[];
    exclude_dirs?: string[];
    tags?: string[];
    model_name?: string;
    index_name?: string;
}

export interface IndexGitHubRepoParams extends Record<string, unknown> {
    repo_url: string;
    branch?: string;
    file_extensions?: string[];
    tags?: string[];
    model_name?: string;
    index_name?: string;
}

export interface IndexChatParams extends Record<string, unknown> {
    content: string;
    chat_name: string;
    tags?: string[];
    model_name?: string;
    chunk_size?: number;
    index_name?: string;
}

export interface IndexFileParams extends Record<string, unknown> {
    file_path: string;
    tags?: string[];
    model_name?: string;
    chunk_size?: number;
    index_name?: string;
}

export interface SearchParams extends Record<string, unknown> {
    query: string;
    n_results?: number;
    model_name?: string;
    index_name?: string;
}

export interface IndexSource {
    source_id: string;
    source_type: string;
    source_path: string;
    document_count?: number;
    chunk_count: number;
    indexed_at?: string;
    tags?: string[];
    active: boolean;
}

export interface SearchResultItem {
    rank: number;
    document: string;
    file_path: string;
    chunk_index: number;
    similarity_score: number;
}

export interface SearchResult {
    query: string;
    results: SearchResultItem[];
    total_results: number;
}

export class MCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private progressCallback: ((current: number, total: number) => void) | null = null;

    constructor(private pythonPath: string, private launcherPath: string, private storageDir: string) {}

    setProgressCallback(callback: (current: number, total: number) => void) {
        this.progressCallback = callback;
    }

    async connect(licenseKey?: string): Promise<void> {
        const env: Record<string, string> = {};
        Object.keys(process.env).forEach(key => {
            const value = process.env[key];
            if (value !== undefined) {
                env[key] = value;
            }
        });
        
        if (licenseKey) {
            env.ANYRAG_LICENSE_KEY = licenseKey;
        }
        
        // Pass storage directory via environment variable
        env.ANYRAG_STORAGE_DIR = this.storageDir;

        this.transport = new StdioClientTransport({
            command: this.pythonPath,
            args: [this.launcherPath],
            env
        });

        this.client = new Client({
            name: 'anyrag-pilot',
            version: '1.0.0'
        }, {
            capabilities: {}
        });

        await this.client.connect(this.transport);
        
        // Access stderr after connection
        const transportAny = this.transport as any;
        if (transportAny._process?.stderr) {
            console.log('Setting up stderr listener for progress updates');
            transportAny._process.stderr.on('data', (data: Buffer) => {
                const output = data.toString();
                // Parse: "Processing file 816/821"
                const match = output.match(/Processing file (\d+)\/(\d+)/);
                if (match && this.progressCallback) {
                    const current = parseInt(match[1], 10);
                    const total = parseInt(match[2], 10);
                    console.log(`Progress update: ${current}/${total}`);
                    this.progressCallback(current, total);
                }
            });
        } else {
            console.log('stderr not available on transport');
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.close();
            this.client = null;
        }
        if (this.transport) {
            await this.transport.close();
            this.transport = null;
        }
    }

    async indexFolder(params: IndexFolderParams): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        // Remove undefined values to avoid schema validation errors
        const cleanParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                cleanParams[key] = value;
            }
        }

        // No timeout - let indexing complete however long it takes
        const result = await this.client.callTool({
            name: 'index_folder',
            arguments: cleanParams
        });

        return JSON.parse((result.content as any)[0].text);
    }

    async indexGitHubRepo(params: IndexGitHubRepoParams): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        // Remove undefined values to avoid schema validation errors
        const cleanParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                cleanParams[key] = value;
            }
        }

        // No timeout - let indexing complete however long it takes
        const result = await this.client.callTool({
            name: 'index_github_repo',
            arguments: cleanParams
        });

        return JSON.parse((result.content as any)[0].text);
    }

    async indexChat(params: IndexChatParams): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const cleanParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                cleanParams[key] = value;
            }
        }

        const result = await this.client.callTool({
            name: 'index_chat',
            arguments: cleanParams

        });

        return JSON.parse((result.content as any)[0].text);
    }

    async indexFile(params: IndexFileParams): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const cleanParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                cleanParams[key] = value;
            }
        }

        const result = await this.client.callTool({
            name: 'index_file',
            arguments: cleanParams

        });

        // DEBUG: Log the raw response text
        const rawText = (result.content as any)[0].text;
        console.log('MCPClient.indexFile rawText:', rawText);

        return JSON.parse(rawText);
    }

    async search(params: SearchParams): Promise<SearchResult> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'search',
            arguments: params as Record<string, unknown>
        });

        const rawText = (result.content as any)[0].text;
        
        // Check if the response is an error message
        if (rawText.startsWith('Error')) {
            throw new Error(rawText);
        }
        
        try {
            return JSON.parse(rawText);
        } catch (e) {
            throw new Error(`Failed to parse search results: ${rawText.substring(0, 200)}`);
        }
    }

    async showIndex(activeOnly: boolean = false, tags?: string[], indexName: string = 'default'): Promise<{ sources: IndexSource[] }> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'show_index',
            arguments: { active_only: activeOnly, tags, index_name: indexName } as Record<string, unknown>
        });

        return JSON.parse((result.content as any)[0].text);
    }

    async getIndexInfo(indexName: string = 'default'): Promise<{ success: boolean; index_name: string; model_name: string; document_count: number }> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'get_index_info',
            arguments: { index_name: indexName } as Record<string, unknown>
        });

        const rawText = (result.content as any)[0].text;
        
        // Check if the response is an error message
        if (rawText.startsWith('Error') || rawText.startsWith('Unknown')) {
            throw new Error(rawText);
        }
        
        try {
            return JSON.parse(rawText);
        } catch (e) {
            throw new Error(`Failed to parse index info: ${rawText.substring(0, 200)}`);
        }
    }

    async clearIndex(indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'clear_index',
            arguments: { index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async removeSource(sourceId: string, indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'remove_source',
            arguments: { source_id: sourceId, index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async activateSource(sourceId: string, indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'activate_source',
            arguments: { source_id: sourceId, index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async deactivateSource(sourceId: string, indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'deactivate_source',
            arguments: { source_id: sourceId, index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async addTags(sourceId: string, tags: string[], indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'add_tags',
            arguments: { source_id: sourceId, tags, index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async removeTags(sourceId: string, tags: string[], indexName: string = 'default'): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'remove_tags',
            arguments: { source_id: sourceId, tags, index_name: indexName } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    // Index management methods
    async createIndex(indexName: string, modelName?: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const cleanParams: Record<string, unknown> = { index_name: indexName };
        if (modelName) {
            cleanParams.model_name = modelName;
        }

        const result = await this.client.callTool({
            name: 'create_index',
            arguments: cleanParams
        });

        const content = (result.content as any)[0];
        if (content.type === 'text') {
            return JSON.parse(content.text);
        }
        return content;
    }

    async listIndices(): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'list_indices',
            arguments: {} as Record<string, unknown>
        });

        const content = (result.content as any)[0];
        if (content.type === 'text') {
            return JSON.parse(content.text);
        }
        return content;
    }

    async deleteIndex(indexName: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'delete_index_by_name',
            arguments: { index_name: indexName } as Record<string, unknown>
        });

        const content = (result.content as any)[0];
        if (content.type === 'text') {
            return JSON.parse(content.text);
        }
        return content;
    }

    async renameIndex(oldName: string, newName: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'rename_index',
            arguments: { old_name: oldName, new_name: newName } as Record<string, unknown>
        });

        const content = (result.content as any)[0];
        if (content.type === 'text') {
            return JSON.parse(content.text);
        }
        return content;
    }
}
