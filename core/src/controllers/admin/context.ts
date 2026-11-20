import type { Application } from 'express';
import type { Server } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
export {};

/**
 * AdminContext factory
 * Creates and holds all shared state for the admin server.
 */

export interface SessionUser {
    username: string;
    role: 'admin' | 'user';
    issuedAt: number;
}

export interface AdminContext {
    tokens: Set<string>;
    /** token → 会话用户；tokens 仍是它的键集合，兼容既有代码 */
    sessions: Map<string, SessionUser>;
    app: Application | null;
    server: Server | null;
    io: SocketIOServer | null;
    provider: any;
}

function createAdminContext(dataProvider: any): AdminContext {
    const tokens = new Set<string>();
    const sessions = new Map<string, SessionUser>();
    return {
        tokens,
        sessions,
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}

module.exports = { createAdminContext };
