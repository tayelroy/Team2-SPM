const { resolve, relative, sep } = require('node:path');
const { createHash } = require('node:crypto');
// No application-origin fallback or credential persistence is supported.
const HOSTED_ORIGIN = 'https://team2-spm-server-git-hotfix-ui-bug-de-e658c2-tayelroys-projects.vercel.app';
const ROLES = {
  organiser: { label: 'Event Organiser', email: 'event.organiser3@connectsphere.test', nav: ['My events', 'New request', 'My drafts', 'Event detail'] },
  coordinator: { label: 'Event Coordinator', email: 'event.coordinator2@connectsphere.test', nav: ['Dashboard', 'Venues', 'Find venues', 'Venue Availability', 'Venue holds'] },
  venue: { label: 'Venue Staff', email: 'venue.staff1@connectsphere.test', nav: ['Dashboard', 'Venue Availability', 'Catalogue', 'Venue holds', 'Capacity exceptions'] },
  support: { label: 'Technical Support Staff', email: 'technical.support1@connectsphere.test', nav: ['Dashboard', 'Venue Availability', 'Equipment'] },
  lead: { label: 'Event Coordinator Lead', email: 'event.coordinator.lead1@connectsphere.test', nav: ['Dashboard', 'Unassigned queue', 'Assign coordinators'] },
  safety: { label: 'Safety Officer', email: 'safety.officer1@connectsphere.test', nav: ['Dashboard'] },
  attendee: { label: 'Attendee', email: 'attendee1@connectsphere.test', nav: ['My registrations', 'Event page'] },
};
// Observed optional Vercel toolbar injection. It is excluded, never allowed to
// execute or contact its service. Exact URL/type only: no host-wide exemption.
const FEEDBACK_SCRIPT = 'https://vercel.live/_next-live/feedback/feedback.js';
function excludedDeploymentRequest(raw, method, resourceType) {
  return raw === FEEDBACK_SCRIPT && method === 'GET' && resourceType === 'script';
}
function excludedDeploymentConsole(type, message, sourceUrl, wasBlocked) {
  return wasBlocked && type === 'error' && sourceUrl === FEEDBACK_SCRIPT
    && /^Failed to load resource: net::ERR_(?:FAILED|BLOCKED_BY_CLIENT(?:\.Inspector)?)$/.test(message);
}
function allowedRequest(raw, method, resourceType) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.origin === HOSTED_ORIGIN) {
    if (['GET', 'HEAD'].includes(method)) return true;
    return method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(url.pathname);
  }
  // The application's existing fonts are static resources, never another app.
  return method === 'GET' && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin) && ['stylesheet', 'font'].includes(resourceType);
}
const PHASES = ['preflight','route-guard','landing','open-login','email-input','password-input','submit-login',
  'authenticated-banner','role-identity','permissions-ready','navigation-contract','page-settle',
  'page-evidence','page-navigation','calendar-detail','event-detail','event-history','profile-read',
  'notifications-read','logout','complete','event-card-locate','event-target-unique','event-target-click','event-detail-visible','event-readiness-visible'];
const CAUSES = ['cross-origin-blocked','write-blocked','websocket-blocked','network-failure',
  'http-error','page-exception','console-error','origin-mismatch','authentication-check-failed','page-check-failed'];
function consoleIssue(message, sourceUrl, authenticated, secrets = []) {
  const redact = value => {
    let text = String(value);
    for (const secret of secrets.filter(secret => typeof secret === 'string' && secret.length)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
      .replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT]');
  };
  let source = 'unavailable';
  try {
    const url = new URL(sourceUrl);
    if (['https:','http:'].includes(url.protocol)) source = redact(url.origin + url.pathname).slice(0,240);
  } catch { /* no raw location fallback */ }
  let code = 'unclassified-console-error';
  let knownMessage = null;
  // Retain literal text only from a narrow browser-message vocabulary after
  // authentication. Unknown messages (which may contain payloads) are hashed.
  if (authenticated) {
    const network = /^Failed to load resource: net::(ERR_[A-Z_]+)$/.exec(message);
    const http = /^Failed to load resource: the server responded with a status of ([45]\d{2})(?: \([^)]*\))?$/.exec(message);
    const react = /^(?:Error: )?Minified React error #(\d+);/.exec(message);
    if (network) { code = 'browser-resource-network-error'; knownMessage = 'Failed to load resource: net::' + network[1]; }
    else if (http) { code = 'browser-resource-http-error'; knownMessage = 'Failed to load resource: HTTP ' + http[1]; }
    else if (react) { code = 'react-minified-error'; knownMessage = 'Minified React error #' + react[1]; }
  }
  return { authenticated: !!authenticated, code, messageSha256: createHash('sha256').update(String(message)).digest('hex'),
    source, knownMessage: knownMessage ? redact(knownMessage).slice(0,120) : null };
}
function safeConsoleIssues(annotations) {
  return annotations.filter(a => a.type === 'hosted-console-issue').slice(0,5).flatMap(a => {
    try {
      const issue = JSON.parse(a.description);
      if (typeof issue.authenticated !== 'boolean' || !/^[a-f0-9]{64}$/.test(issue.messageSha256)
          || !['unclassified-console-error','browser-resource-network-error','browser-resource-http-error','react-minified-error'].includes(issue.code)
          || typeof issue.source !== 'string' || issue.source.length > 240 || /[?#\n\r]/.test(issue.source)) return [];
      // Only outputs constructed by consoleIssue can enter a report. No
      // arbitrary annotation text or unknown-message excerpt is forwarded.
      const known = issue.authenticated && typeof issue.knownMessage === 'string'
        && /^(?:Failed to load resource: (?:net::ERR_[A-Z_]+|HTTP [45]\d{2})|Minified React error #\d+)$/.test(issue.knownMessage) ? issue.knownMessage : null;
      return [{ authenticated: issue.authenticated, code: issue.code, messageSha256: issue.messageSha256, source: issue.source, knownMessage: known }];
    } catch { return []; }
  });
}
function roleId(title) { return /HOSTED-ROLE-[1-7]\b/.exec(title)?.[0] ?? 'HOSTED-RUN'; }
function safeResult(test, result, root) {
  const id = roleId(test.title);
  const role = Object.values(ROLES)[Number(id.at(-1)) - 1]?.label ?? 'Runner';
  const targetCount = test.annotations.find(a => a.type === 'hosted-event-target-count' && /^(?:[0-9]|[1-9][0-9]|100)$/.test(a.description ?? ''));
  // Never serialize errors, call logs, steps, stdout, response bodies or config/env.
  return { id, role, status: ['passed','failed','timedOut','skipped','interrupted'].includes(result.status) ? result.status : 'failed',
    durationMs: result.duration,
    pages: test.annotations.filter(a => a.type === 'hosted-page' && /^[a-z0-9-]+$/.test(a.description ?? '')).map(a => a.description),
    diagnostics: {
      phases: test.annotations.filter(a => a.type === 'hosted-phase' && PHASES.includes(a.description)).map(a => a.description),
      lastPhase: test.annotations.filter(a => a.type === 'hosted-phase' && PHASES.includes(a.description)).at(-1)?.description ?? null,
      authenticatedBannerVisible: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'authenticated-banner-visible'),
      roleIdentityMatched: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'role-identity-matched'),
      failureCause: test.annotations.find(a => a.type === 'hosted-cause' && CAUSES.includes(a.description))?.description ?? null,
      crossOriginBlocked: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'cross-origin-blocked'),
      writeBlocked: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'write-blocked'),
      networkFailure: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'network-failure'),
      httpError: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'http-error'),
      pageException: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'page-exception'),
      consoleError: test.annotations.some(a => a.type === 'hosted-flag' && a.description === 'console-error'),
      consoleIssues: safeConsoleIssues(test.annotations),
      event22CardCount: targetCount ? Number(targetCount.description) : null,
      httpStatuses: [...new Set(test.annotations.filter(a => a.type === 'hosted-http-status' && /^[45]\d{2}$/.test(a.description ?? '')).map(a => Number(a.description)))]
    },
    deploymentFeedbackExcluded: test.annotations.some(a => a.type === 'hosted-exclusion' && a.description === 'vercel-feedback-script-blocked'),
    issue: result.status === 'passed' ? null : 'Read-only role smoke did not complete; raw errors and sign-in call logs withheld.',
    media: result.attachments.filter(a => a.path && ['image/png','video/webm'].includes(a.contentType)
      && resolve(a.path).startsWith(resolve(root) + sep)).map(a => ({ type: a.contentType, path: relative(root, a.path) })) };
}
function junit(records) {
  const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="Hosted read-only roles" tests="' + records.length + '">' + records.map(r =>
    `<testcase name="${xml(r.id)}" classname="${xml(r.role)}" time="${r.durationMs / 1000}">${r.status === 'passed' ? '' : r.status === 'skipped' ? '<skipped/>' : '<failure message="Read-only role smoke incomplete; sensitive details withheld."/>'}</testcase>`).join('') + '</testsuite>\n';
}

module.exports = { HOSTED_ORIGIN, ROLES, allowedRequest, excludedDeploymentRequest, excludedDeploymentConsole, consoleIssue, roleId, safeResult, junit };
