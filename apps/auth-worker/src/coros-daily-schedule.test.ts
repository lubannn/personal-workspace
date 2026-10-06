import {afterEach,describe,expect,it} from 'vitest';
import {queueScheduledCorosDailySync} from './coros-daily-schedule';
import {initializeBulkHealthProgress} from './coros-health-history';
import {initializeActivityProgress,initialSyncProgress,recordCheckedRange,syncProgressDomains} from './coros-sync-state';
import {syncTestDatabase} from './coros-sync-test-helpers';
const now=new Date('2024-02-01T00:00:00Z');
let fixture:ReturnType<typeof syncTestDatabase>|undefined;
afterEach(()=>{fixture?.sqlite.close();fixture=undefined});
function setup(state:'enabled'|'paused'='enabled'){
 fixture=syncTestDatabase();fixture.connection(state);
 const p=initialSyncProgress('2024-01-01','Asia/Shanghai');p.request={sequence:1,through:'2024-01-31'};p.verifyHistoricalCoverage=true;
 p.health={...p.domains.sleep};initializeActivityProgress(p);initializeBulkHealthProgress(p);
 for(const d of syncProgressDomains(p)){d.backfillNext='2024-02-01';d.backfillThrough='2024-01-31';recordCheckedRange(d,'2024-01-01','2024-01-31')}
 fixture.job(p);return fixture;
}
describe('daily observations after initial history',()=>{
 it('queues once at 08:00 without editing progress or a live lease',async()=>{
  const f=setup();const before=f.saved()!.progress;
  f.sqlite.prepare('UPDATE coros_sync_jobs SET lease_token=?,lease_until=?').run('existing-owner','2024-02-01T00:10:00Z');
  expect(await queueScheduledCorosDailySync(f.env,new Date('2024-01-31T23:59:00Z'))).toBe(false);
  expect(await queueScheduledCorosDailySync(f.env,now)).toBe(true);
  expect(await queueScheduledCorosDailySync(f.env,new Date('2024-02-01T12:00:00Z'))).toBe(false);
  expect(f.saved()).toMatchObject({request_seq:2,daily_requested_date:'2024-02-01',lease_token:'existing-owner',progress:before});
 });
 it('continues the initial scope without opening recurring observations while any evidence gap remains',async()=>{
  const f=setup(),p=f.saved()!.progress;p.health!.checkedRanges=[{from:'2024-01-02',through:'2024-01-31'}];f.saveProgress(p);
  expect(await queueScheduledCorosDailySync(f.env,now)).toBe(false);expect(f.saved()!.request_seq).toBe(1);
 });
 it('does not start a new observation while paused',async()=>{
  const f=setup('paused');expect(await queueScheduledCorosDailySync(f.env,now)).toBe(false);expect(f.saved()!.request_seq).toBe(1);
 });
});
