import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import policy from './policy.cjs';
const { HOSTED_ORIGIN, allowedRequest, excludedDeploymentRequest, excludedDeploymentConsole, safeResult, junit, consoleIssue } = policy;
test('[NORMAL] [FAILURE] [SG2-25:AC2] hosted read-only guard permits normal auth but blocks booking, profile and implicit review writes', () => {
  for (const path of ['/api/auth/login','/api/auth/logout']) assert.equal(allowedRequest(HOSTED_ORIGIN+path,'POST','fetch'),true);
  assert.equal(allowedRequest(HOSTED_ORIGIN+'/api/profile','GET','fetch'),true);
  for (const [method,path] of [['PATCH','/api/event-requests/22/review'],['PUT','/api/profile'],['POST','/api/venue-booking-requests'],['DELETE','/api/event-requests/23']]) assert.equal(allowedRequest(HOSTED_ORIGIN+path,method,'fetch'),false);
});
test('[FAILURE] [BOUNDARY] [SG2-25:AC2] hosted guard refuses alternate origins and lookalike hosts while allowing only existing static font reads', () => {
  for (const url of ['https://team2-spm-server.vercel.app/','https://example.test/','https://fonts.gstatic.com.evil.test/font','https://fonts.gstatic.com:444/font','invalid']) assert.equal(allowedRequest(url,'GET','document'),false);
  assert.equal(allowedRequest('https://fonts.googleapis.com/css2','GET','stylesheet'),true);
  assert.equal(allowedRequest('https://fonts.gstatic.com/font.woff2','GET','font'),true);
  assert.equal(allowedRequest('https://fonts.googleapis.com/','GET','document'),false);
  const feedback='https://vercel.live/_next-live/feedback/feedback.js';
  assert.equal(allowedRequest(feedback,'GET','script'),false);
  assert.equal(excludedDeploymentRequest(feedback,'GET','script'),true);
  for (const [url,method,type] of [[feedback+'?other=1','GET','script'],[feedback,'POST','script'],[feedback,'GET','document'],['https://vercel.live/other.js','GET','script']]) assert.equal(excludedDeploymentRequest(url,method,type),false);
  assert.equal(excludedDeploymentConsole('error','Failed to load resource: net::ERR_FAILED',feedback,true),true);
  assert.equal(excludedDeploymentConsole('error','Failed to load resource: net::ERR_FAILED',feedback,false),false);
  assert.equal(excludedDeploymentConsole('error','Failed to load resource: net::ERR_FAILED',HOSTED_ORIGIN+'/api/profile',true),false);
  assert.equal(excludedDeploymentConsole('error','Application crashed',feedback,true),false);
  const observed='Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector';
  assert.equal(excludedDeploymentConsole('error',observed,feedback,true),true);
  assert.equal(excludedDeploymentConsole('error',observed,feedback,false),false);
  assert.equal(excludedDeploymentConsole('error',observed,HOSTED_ORIGIN+'/assets/app.js',true),false);
  assert.equal(excludedDeploymentConsole('error',observed+'.other',feedback,true),false);
});
test('[FAILURE] [SG2-25:AC2] hosted JSON and JUnit omit password, token, raw failure steps, config and unsafe attachments', () => {
  const secret='PRIVATE_PASSWORD_AND_TOKEN_SENTINEL';
  const issue=consoleIssue('body '+secret+' event.organiser3@connectsphere.test Bearer abcdef eyJabc.def.ghi',HOSTED_ORIGIN+'/'+secret+'?token='+secret,true,[secret]);
  assert.equal(issue.knownMessage,null);
  assert.equal(JSON.stringify(issue).includes(secret),false);
  assert.equal(JSON.stringify(issue).includes('event.organiser3@connectsphere.test'),false);
  assert.equal(issue.source.includes('?'),false);
  const known=consoleIssue('Failed to load resource: the server responded with a status of 404 (Not Found)',HOSTED_ORIGIN+'/favicon.ico?private='+secret,true,[secret]);
  assert.equal(known.code,'browser-resource-http-error');
  assert.equal(known.source,HOSTED_ORIGIN+'/favicon.ico');
  assert.equal(known.knownMessage,'Failed to load resource: HTTP 404');
  const preauth=consoleIssue('Failed to load resource: net::ERR_FAILED',HOSTED_ORIGIN+'/api/auth/login',false,[secret]);
  assert.equal(preauth.knownMessage,null);
  const result=safeResult({title:'HOSTED-ROLE-1 '+secret,annotations:[{type:'hosted-page',description:'profile-readonly'},{type:'secret',description:secret},{type:'hosted-exclusion',description:'vercel-feedback-script-blocked'},{type:'hosted-phase',description:'role-identity'},{type:'hosted-phase',description:secret},{type:'hosted-cause',description:'network-failure'},{type:'hosted-cause',description:secret},{type:'hosted-flag',description:'network-failure'},{type:'hosted-http-status',description:'429'},{type:'hosted-http-status',description:secret},{type:'hosted-console-issue',description:JSON.stringify(issue)},{type:'hosted-console-issue',description:JSON.stringify(known)},{type:'hosted-console-issue',description:secret},{type:'hosted-event-target-count',description:secret},{type:'hosted-event-target-count',description:'1'}]},
    {status:'failed',duration:12,error:{message:secret},errors:[secret],stdout:[secret],steps:[secret],attachments:[{path:'/proof/media/role.png',contentType:'image/png'},{path:'/proof/trace.zip',contentType:'application/zip'},{path:'/elsewhere/secret.png',contentType:'image/png'},{path:'/proof/../outside.png',contentType:'image/png'}]},'/proof');
  assert.deepEqual(result.media,[{type:'image/png',path:'media/role.png'}]);
  assert.deepEqual(result.pages,['profile-readonly']);
  assert.equal(result.deploymentFeedbackExcluded,true);
  assert.deepEqual(result.diagnostics.phases,['role-identity']);
  assert.equal(result.diagnostics.lastPhase,'role-identity');
  assert.equal(result.diagnostics.authenticatedBannerVisible,false);
  assert.equal(result.diagnostics.failureCause,'network-failure');
  assert.equal(result.diagnostics.networkFailure,true);
  assert.deepEqual(result.diagnostics.httpStatuses,[429]);
  assert.equal(result.diagnostics.event22CardCount,1);
  assert.equal(result.diagnostics.consoleIssues.length,2);
  assert.equal(result.diagnostics.consoleIssues[0].knownMessage,null);
  assert.equal(result.diagnostics.consoleIssues[1].source,HOSTED_ORIGIN+'/favicon.ico');
  for(const output of [JSON.stringify(result),junit([result])]) assert.equal(output.includes(secret),false);
});


test('[FAILURE] [SG2-25:AC2] optional hosted execution refuses missing runtime credentials before starting Playwright', () => {
  const run=spawnSync(process.execPath,['.github/scripts/test-hosted-roles.mjs'],{encoding:'utf8',env:{...process.env,SPM_QA_PASSWORD:'',SPM_HOSTED_QA_OPT_IN:''},timeout:10000});
  assert.equal(run.status,2);
  assert.equal(run.stdout,'');
  assert.match(run.stderr,/runtime password/);
});
