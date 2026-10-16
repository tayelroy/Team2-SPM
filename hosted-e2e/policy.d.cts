declare const HOSTED_ORIGIN: string;
declare const ROLES: Record<'organiser'|'coordinator'|'venue'|'support'|'lead'|'safety'|'attendee', { label: string; email: string; nav: string[] }>;
declare function allowedRequest(url: string, method: string, resourceType: string): boolean;
declare function excludedDeploymentRequest(url: string, method: string, resourceType: string): boolean;
declare function excludedDeploymentConsole(type: string, message: string, sourceUrl: string, wasBlocked: boolean): boolean;
declare function consoleIssue(message: string, sourceUrl: string, authenticated: boolean, secrets?: string[]): { authenticated: boolean; code: string; messageSha256: string; source: string; knownMessage: string|null };
declare const policy: { HOSTED_ORIGIN: typeof HOSTED_ORIGIN; ROLES: typeof ROLES; allowedRequest: typeof allowedRequest; excludedDeploymentRequest: typeof excludedDeploymentRequest; excludedDeploymentConsole: typeof excludedDeploymentConsole; consoleIssue: typeof consoleIssue };
export = policy;
