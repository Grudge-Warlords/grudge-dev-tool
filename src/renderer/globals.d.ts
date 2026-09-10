import type { GrudgeSession } from "../shared/ipc";
import type { Prompt3DReferenceImageSelection } from "../shared/prompt3d";
import type {
    Prompt3DAssetSource,
    Prompt3DApproveVisualRequest,
    Prompt3DBatchExportResult,
    Prompt3DBatchRequest,
    Prompt3DBatchStatus,
    Prompt3DFinishHistory,
    Prompt3DFinishJobStatus,
    Prompt3DFinishRequest,
    Prompt3DFinishVisualRejection,
    Prompt3DRejectFinishVisualRequest,
    Prompt3DVisualApproval,
    Prompt3DWorkflowArtifactRequest,
    Prompt3DWorkflowArtifactVerification,
    Prompt3DWorkflowExportResult,
    Prompt3DWorkflowLibraryAsset,
    Prompt3DWorkflowPortableExportRecord,
    Prompt3DWorkflowSaveResult,
} from "../shared/prompt3dWorkflow";

type Prompt3DWorkflowExportInvocationResult =
    | { canceled: true }
    | Prompt3DWorkflowExportResult;

/** Electron contextBridge API exposed at window.grudge by src/preload/preload.ts */
interface GrudgeElectronAPI {
    appNative: import("../shared/appNative").AppNativeAPI;
    appActions: { plan(request: import("../shared/appActions").AppActionRequest): Promise<import("../shared/appActions").AppActionDecision> };
    embeddedActions: import("../shared/embeddedActions").EmbeddedActionAPI;
    auth: {
        getSession(): Promise<GrudgeSession>;
        getHandoff?(): Promise<{
            token: string | null;
            grudgeId: string | null;
            username: string | null;
            email: string | null;
            puterUuid: string | null;
            signedIn: boolean;
            hasApiToken: boolean;
        }>;
        getPuterToken?(): Promise<string | null>;
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
    prompt3d: {
        chooseReferenceImage(): Promise<Prompt3DReferenceImageSelection | null>;
        chooseReferenceImages(): Promise<Prompt3DReferenceImageSelection[] | null>;
        finishStart(request: Prompt3DFinishRequest): Promise<Prompt3DFinishJobStatus>;
        finishHistory(): Promise<Prompt3DFinishHistory>;
        finishStatus(id: string): Promise<Prompt3DFinishJobStatus>;
        finishCancel(id: string): Promise<Prompt3DFinishJobStatus>;
        workflowApproveVisual(request: Prompt3DApproveVisualRequest): Promise<Prompt3DVisualApproval>;
        workflowRejectFinishVisual(request: Prompt3DRejectFinishVisualRequest): Promise<Prompt3DFinishVisualRejection>;
        workflowSave(source: Prompt3DAssetSource): Promise<Prompt3DWorkflowSaveResult>;
        workflowLibrary(): Promise<Prompt3DWorkflowLibraryAsset[]>;
        workflowExport(source: Prompt3DAssetSource): Promise<Prompt3DWorkflowExportInvocationResult>;
        workflowExportHistory(): Promise<Prompt3DWorkflowPortableExportRecord[]>;
        workflowVerifyArtifact(request: Prompt3DWorkflowArtifactRequest): Promise<Prompt3DWorkflowArtifactVerification>;
        batchStart(request: Prompt3DBatchRequest): Promise<Prompt3DBatchStatus>;
        batchStatus(id?: string): Promise<Prompt3DBatchStatus | null>;
        batchCancel(id: string): Promise<Prompt3DBatchStatus>;
        batchRetry(id: string, itemId?: string): Promise<Prompt3DBatchStatus>;
        batchExport(id: string): Promise<{ canceled: true } | Prompt3DBatchExportResult>;
        onFinishProgress(cb: (status: Prompt3DFinishJobStatus) => void): () => void;
        onBatchProgress(cb: (status: Prompt3DBatchStatus) => void): () => void;
        [key: string]: any;
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
