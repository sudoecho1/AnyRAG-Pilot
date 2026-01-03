import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as vscode from 'vscode';

export interface IndexFolderParams extends Record<string, unknown> {
    folder_path: string;
    file_extensions?: string[];
    exclude_dirs?: string[];
    tags?: string[];
    model_name?: string;
}

export interface IndexGitHubRepoParams extends Record<string, unknown> {
    repo_url: string;
    branch?: string;
    file_extensions?: string[];
    tags?: string[];
    model_name?: string;
}

export interface SearchParams extends Record<string, unknown> {
    query: string;
    n_results?: number;
    model_name?: string;
}

export interface IndexSource {
    source_id: string;
    source_type: string;
    source_path: string;
    document_count: number;
    chunk_count: number;
    indexed_at: string;
    tags?: string[];
    active: boolean;
}

export interface SearchResult {
    documents: string[][];
    metadatas: Array<Record<string, any>>;
    distances: number[][];
}

export class MCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;

    constructor(private pythonPath: string, private launcherPath: string, private storageDir: string) {}

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

        // No timeout - let indexing complete however long it takes
        const result = await this.client.callTool({
            name: 'index_folder',
            arguments: params as Record<string, unknown>,
            _meta: {
                progressToken: 'folder-index'
            }
        }, {
            timeout: 0 // Disable timeout
        } as any);

        return (result.content as any)[0];
    }

    async indexGitHubRepo(params: IndexGitHubRepoParams): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        // No timeout - GitHub cloning and indexing can take a long time
        const result = await this.client.callTool({
            name: 'index_github_repo',
            arguments: params as Record<string, unknown>,
            _meta: {
                progressToken: 'github-index'
            }
        }, {
            timeout: 0 // Disable timeout
        } as any);

        return (result.content as any)[0];
    }

    async search(params: SearchParams): Promise<SearchResult> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'search',
            arguments: params as Record<string, unknown>
        });

        return JSON.parse((result.content as any)[0].text);
    }

    async showIndex(activeOnly: boolean = false, tags?: string[]): Promise<{ sources: IndexSource[] }> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'show_index',
            arguments: { active_only: activeOnly, tags } as Record<string, unknown>
        });

        return JSON.parse((result.content as any)[0].text);
    }

    async clearIndex(): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'clear_index',
            arguments: {} as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async removeSource(sourceId: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'remove_source',
            arguments: { source_id: sourceId } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async activateSource(sourceId: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'activate_source',
            arguments: { source_id: sourceId } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }

    async deactivateSource(sourceId: string): Promise<any> {
        if (!this.client) {
            throw new Error('MCP client not connected');
        }

        const result = await this.client.callTool({
            name: 'deactivate_source',
            arguments: { source_id: sourceId } as Record<string, unknown>
        });

        return (result.content as any)[0];
    }
}
