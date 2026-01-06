import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { MCPClient } from './mcpClient';

interface ChatSession {
    sessionId: string;
    creationDate: number;
    lastMessageDate: number;
    customTitle?: string;
    requests: ChatRequest[];
}

interface ChatRequest {
    message: ChatMessage;
    response: any[];
    timestamp: number;
    agent?: { id: string };
}

interface ChatMessage {
    text: string;
    parts?: Array<{ text: string; kind: string }>;
}

export class ChatSessionIndexer {
    constructor(private mcpClient: MCPClient) {}

    /**
     * Get the chatSessions directory path for the current workspace
     */
    private async getChatSessionsPath(context: vscode.ExtensionContext): Promise<string | undefined> {
        if (!context.storageUri) {
            return undefined;
        }

        // The chatSessions folder is at the same level as the extension's storage folder
        // Extension storage: ~/.config/Code/User/workspaceStorage/<hash>/anyrag.anyrag-pilot
        // Chat sessions: ~/.config/Code/User/workspaceStorage/<hash>/chatSessions
        const storagePath = context.storageUri.fsPath;
        const workspaceStoragePath = path.dirname(storagePath);
        const chatSessionsPath = path.join(workspaceStoragePath, 'chatSessions');

        try {
            await fs.access(chatSessionsPath);
            return chatSessionsPath;
        } catch {
            return undefined;
        }
    }

    /**
     * List all chat sessions with their metadata
     */
    async listChatSessions(context: vscode.ExtensionContext): Promise<Array<{
        sessionId: string;
        title: string;
        date: Date;
        requestCount: number;
        filePath: string;
    }>> {
        const chatSessionsPath = await this.getChatSessionsPath(context);
        if (!chatSessionsPath) {
            return [];
        }

        try {
            const files = await fs.readdir(chatSessionsPath);
            const sessions: Array<{
                sessionId: string;
                title: string;
                date: Date;
                requestCount: number;
                filePath: string;
            }> = [];

            for (const file of files) {
                if (!file.endsWith('.json')) {
                    continue;
                }

                const filePath = path.join(chatSessionsPath, file);
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const session: ChatSession = JSON.parse(content);

                    sessions.push({
                        sessionId: session.sessionId,
                        title: session.customTitle || 'Untitled Chat',
                        date: new Date(session.lastMessageDate || session.creationDate),
                        requestCount: session.requests?.length || 0,
                        filePath
                    });
                } catch (err) {
                    console.error(`Failed to read session ${file}:`, err);
                }
            }

            // Sort by date, most recent first
            sessions.sort((a, b) => b.date.getTime() - a.date.getTime());
            return sessions;
        } catch (err) {
            console.error('Failed to list chat sessions:', err);
            return [];
        }
    }

    /**
     * Convert a chat session to text format for indexing
     */
    private chatSessionToText(session: ChatSession): string {
        const lines: string[] = [];
        
        lines.push(`# Chat: ${session.customTitle || 'Untitled'}`);
        lines.push(`Date: ${new Date(session.creationDate).toISOString()}`);
        lines.push('');

        for (const request of session.requests || []) {
            const timestamp = new Date(request.timestamp).toLocaleString();
            const userMessage = request.message?.text || '';
            
            // Extract agent (participant) name
            const agentId = request.agent?.id || 'copilot';
            const agentName = agentId === 'github.copilot' ? '@github' : `@${agentId}`;

            lines.push(`[${timestamp}] User to ${agentName}:`);
            lines.push(userMessage);
            lines.push('');

            // Extract response text from response array
            if (request.response && Array.isArray(request.response)) {
                const responseParts: string[] = [];
                
                for (const part of request.response) {
                    if (part.kind === 'markdownContent' && part.content) {
                        responseParts.push(part.content.value || part.content.toString());
                    } else if (part.kind === 'inlineReference' && part.inlineReference) {
                        // Include file references
                        const ref = part.inlineReference;
                        if (ref.name) {
                            responseParts.push(`[Reference: ${ref.name}]`);
                        }
                    } else if (part.kind === 'command' && part.command) {
                        responseParts.push(`[Command: ${part.command.title}]`);
                    }
                }

                if (responseParts.length > 0) {
                    lines.push(`${agentName} response:`);
                    lines.push(responseParts.join('\n\n'));
                    lines.push('');
                }
            }

            lines.push('---');
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Index a specific chat session
     */
    async indexChatSession(filePath: string, indexName: string): Promise<void> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const session: ChatSession = JSON.parse(content);

            const chatText = this.chatSessionToText(session);
            const chatName = `chat-${session.sessionId}-${session.customTitle || 'untitled'}`;
            
            await this.mcpClient.indexChat({
                content: chatText,
                chat_name: chatName,
                tags: ['copilot-chat', 'conversation'],
                index_name: indexName
            });

        } catch (err) {
            throw new Error(`Failed to index chat session: ${err}`);
        }
    }

    /**
     * Show quick pick to select and index a chat session
     */
    async selectAndIndexChatSession(context: vscode.ExtensionContext, indexName: string): Promise<void> {
        const sessions = await this.listChatSessions(context);

        if (sessions.length === 0) {
            vscode.window.showInformationMessage('No chat sessions found in this workspace.');
            return;
        }

        const items = sessions.map(session => ({
            label: session.title,
            description: `${session.requestCount} messages • ${session.date.toLocaleDateString()}`,
            detail: session.sessionId,
            session
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a chat session to index'
        });

        if (!selected) {
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Indexing chat: ${selected.session.title}`,
                cancellable: false
            }, async () => {
                await this.indexChatSession(selected.session.filePath, indexName);
            });

            vscode.window.showInformationMessage(`Successfully indexed chat: ${selected.session.title}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to index chat: ${err}`);
        }
    }
}
