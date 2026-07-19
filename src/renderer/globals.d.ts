import type { GrudgeSession } from "../shared/ipc";

/** Electron contextBridge API exposed at window.grudge by src/preload/preload.ts */
interface GrudgeElectronAPI {
    auth: {
        getSession(): Promise<GrudgeSession>;
        setSession(token: string, user: { uuid: string; username: string; email?: string }): Promise<{ grudgeId: string }>;
        clearSession(): Promise<void>;
        wipeIdentity(): Promise<void>;
        getPuterToken(): Promise<string | null>;
        /** Opens default browser to puter.com; resolves once the user signs in. */
        puterLogin(): Promise<{ grudgeId: string; user: { uuid: string; username: string; email?: string } }>;
        /** Subscribe to session-changed events pushed from the main process. Returns unsubscribe fn. */
        onSessionChanged(cb: (payload: { grudgeId: string; user: { uuid: string; username: string; email?: string } }) => void): () => void;
    };
    os: {
        list(req: any): Promise<any>;
        search(req: any): Promise<any>;
        assetMeta(req: any): Promise<any>;
        openExternal(url: string): Promise<void>;
    };
    app: {
        quit(): Promise<void>;
        hide(): Promise<void>;
    };
    onNav?: (cb: (route: string) => void) => () => void;
    [key: string]: any;
}

declare global {
    /** Injected by Vite define — matches `version` in package.json. */
    const __APP_VERSION__: string;
    interface Window {
        grudge: GrudgeElectronAPI;
        puter?: any;
    }
}
