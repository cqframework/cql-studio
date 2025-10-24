// Author: Preston Lee

export enum ThemeType {
    AUTOMATIC = 'automatic',
    LIGHT = 'light',
    DARK = 'dark'
}

export class Settings {
    public experimental: boolean = false;
    public developer: boolean = false;
    public theme_preferred: ThemeType = ThemeType.AUTOMATIC;
    public validateSchema: boolean = false;
    public enableElmTranslation: boolean = false;
    public runnerApiBaseUrl: string = '';
    public fhirBaseUrl: string = '';
    public runnerFhirBaseUrl: string = '';
    public translationBaseUrl: string = '';
    public defaultTestResultsIndexUrl: string = '';
    public terminologyBaseUrl: string = '';
    public terminologyVsacApiKey: string = '';
    
    // AI Settings
    public ollamaBaseUrl: string = '';
    public ollamaModel: string = '';
    public mcpBaseUrl: string = '';
    public enableAiAssistant: boolean = false;
    public useMCPTools: boolean = false;

    public static DEFAULT_THEME = ThemeType.AUTOMATIC;
}
