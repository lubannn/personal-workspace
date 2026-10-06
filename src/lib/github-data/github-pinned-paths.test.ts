import {describe,expect,it,vi} from 'vitest';
import {GitHubContentsAdapter} from './github-contents';
const commit='a'.repeat(40),path='data/health-metrics/example.json';
const blob={__typename:'Blob',oid:'b'.repeat(40),byteSize:2,isTruncated:false,text:'{}'};
const adapter=(fetcher:typeof fetch)=>new GitHubContentsAdapter({owner:'owner',repository:'private-data',token:'synthetic'},fetcher);
describe('bounded immutable health path reads',()=>{
 it('pins only requested paths to the exact commit and treats explicit null as absence',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:{repository:{blob0:blob,blob1:null}}}));
  expect(await adapter(fetcher).readTextsAtCommit(commit,[path,'data/health-metrics/absent.json'])).toEqual([{path,blobSha:blob.oid,sizeBytes:2,text:'{}'}]);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/graphql');
  const body=JSON.parse(String(fetcher.mock.calls[0][1]?.body));expect(body.variables).toMatchObject({expression0:`${commit}:${path}`,expression1:`${commit}:data/health-metrics/absent.json`});
 });
 it.each([{}, {blob0:{...blob,isTruncated:true}}, {blob0:{...blob,byteSize:3}}, {blob0:{...blob,__typename:'Tree'}}, {blob0:{...blob,oid:'bad'}}])('rejects incomplete or malformed source metadata instead of declaring paths absent: %j',async repository=>{
  await expect(adapter(vi.fn<typeof fetch>().mockResolvedValue(Response.json({data:{repository}}))).readTextsAtCommit(commit,[path])).rejects.toThrow();
 });
 it('returns a capability fallback on denied GraphQL and preserves rate limits',async()=>{
  expect(await adapter(vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {status:403}))).readTextsAtCommit(commit,[path])).toBeNull();
  await expect(adapter(vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, {status:429}))).readTextsAtCommit(commit,[path])).rejects.toMatchObject({code:'GITHUB_RATE_LIMITED'});
 });
 it('splits a large requested batch without a repository inventory',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(_url,init)=>{const {variables}=JSON.parse(String(init?.body));return Response.json({data:{repository:Object.fromEntries(Object.keys(variables).filter(k=>k.startsWith('expression')).map(k=>[`blob${k.slice(10)}`,null]))}})});
  expect(await adapter(fetcher).readTextsAtCommit(commit,Array.from({length:51},(_,i)=>`data/health-metrics/${i}.json`))).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(3);
 });
});
