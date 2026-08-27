// Author: Preston Lee

import { CqlEnvironment } from './environment.model';

export enum ThemeType {
    AUTOMATIC = 'automatic',
    LIGHT = 'light',
    DARK = 'dark'
}

export type ActiveEnvironmentSource = 'personal' | 'workspace';

export type AiProviderType = 'ollama' | 'openai' | 'openai-compatible';

export interface ActiveWorkspaceEnvironmentRef {
    workspaceId: string;
    environmentId: string;
}

export class Settings {
    public settingsVersion: number = 3;
    public experimental: boolean = false;
    public developer: boolean = false;
    public theme_preferred: ThemeType = ThemeType.AUTOMATIC;
    public validateSchema: boolean = false;
    public runnerApiBaseUrl: string = '';
    public runnerFhirBaseUrl: string = '';
    public defaultTestResultsIndexUrl: string = '';
    public environments: CqlEnvironment[] = [];
    public activeEnvironmentId: string = 'default';
    public activeEnvironmentSource: ActiveEnvironmentSource = 'personal';
    public activeWorkspaceEnvironment: ActiveWorkspaceEnvironmentRef | null = null;

    /** FHIR NPM package registry (normative default https://packages.fhir.org). */
    public fhirPackageRegistryBaseUrl: string = '';

    /** VSAC (NLM CTS / vsac.nlm.nih.gov) — UMLS API key auth; VSAC Browser always calls NLM via CQL Studio Server (no CORS). */
    public vsacFhirBaseUrl: string = '';
    public vsacApiUsername: string = 'apikey';
    public vsacApiPassword: string = '';
    
    // AI Settings
    public aiProvider: AiProviderType = 'ollama';
    public ollamaBaseUrl: string = '';
    public ollamaModel: string = '';
    public ollamaApiKey: string = '';
    public openaiModel: string = '';
    public openaiApiKey: string = '';
    public compatibleProviderName: string = '';
    public compatibleProviderBaseUrl: string = '';
    public compatibleProviderModel: string = '';
    public compatibleProviderApiKey: string = '';
    public serverBaseUrl: string = '';
    public searxngBaseUrl: string = '';
    public enableAiAssistant: boolean = false;
    public useMCPTools: boolean = false;
    public allowAiWriteOperations: boolean = false;
    public autoApplyCodeEdits: boolean = false;
    public enableAiCodePrediction: boolean = false;
    public requireDiffPreview: boolean = false;
    public planActSeparateModels: boolean = false;

    public static DEFAULT_THEME = ThemeType.AUTOMATIC;
}
