import type { Env } from '../env';
import type { Config } from '../config';
import { HttpError, json, jsonBody, unprocessable } from '../http';
import { cacheTable, requirePurpose, purposeEnv, PURPOSES, type Purpose } from '../purpose';
import { snapshotBalances } from '../audit/totals';
import { connectionRows, bankHealth } from '../health';

export async function connections(env:Env,config:Config):Promise<Response>{
  return json((await connectionRows(env)).map(r=>({id:r.id,owner:r.owner,plaid_account:r.plaid_account,institution_name:r.institution_name,status:r.status,updated_at:r.updated_at,health:bankHealth(env,config,r)})));
}

export async function setup(env:Env,config:Config,url:URL):Promise<Response>{
  const item=url.searchParams.get('item_id');
  if(item!==null&&!/^\d+$/.test(item))throw unprocessable('item_id must be an integer');
  const [accounts,bills,points]=await env.DB.batch([
    env.DB.prepare(`SELECT a.id,a.owner,a.name,a.mask,a.type,a.subtype,a.purpose,a.inventory_only,a.is_manual,
      coalesce(a.institution_manual,i.institution_name) AS institution_name,coalesce(l.account_status,'open') AS account_status
      FROM accounts a JOIN items i ON i.id=a.item_id LEFT JOIN account_lifecycle l ON l.account_id=a.id
      WHERE ${item!==null?'a.item_id=?':'a.purpose IS NULL'} ORDER BY i.id,a.id`).bind(...(item!==null?[Number(item)]:[])),
    env.DB.prepare('SELECT id,owner,biller AS name FROM bills WHERE purpose IS NULL'),
    env.DB.prepare('SELECT id,owner,program AS name FROM point_balances WHERE purpose IS NULL'),
  ]);
  const label=(value:unknown)=>{const r=value as Record<string,unknown>;return {...r,owner_label:config.users.get(String(r.owner))||r.owner};};
  return json({accounts:accounts.results.map(label),standalone:item!==null?[]:[...bills.results.map(r=>({...label(r),kind:'bill'})),...points.results.map(r=>({...label(r),kind:'points'}))]});
}

function inheritedPreferences(env:Env,id:number,owner:string,item:number,purpose:Purpose):D1PreparedStatement[]{
  const marker=`purpose_seeded:${id}:${purpose}`;
  const once="NOT EXISTS (SELECT 1 FROM app_state WHERE key=?)";
  return [
    env.DB.prepare(`INSERT OR IGNORE INTO ${cacheTable('bucket_overrides',purpose)} SELECT b.* FROM legacy_purpose_bucket_overrides b
      WHERE b.merchant IN (SELECT upper(coalesce(nullif(merchant_name,''),name,'')) FROM transactions WHERE account_id=?) AND ${once}`).bind(id,marker),
    env.DB.prepare(`INSERT OR IGNORE INTO ${cacheTable('analytics_exclusions',purpose)} SELECT x.* FROM legacy_purpose_analytics_exclusions x
      WHERE ((kind='account' AND value=?) OR (kind='bank' AND value=?) OR (kind='tag' AND value IN
      (SELECT tag FROM transaction_tags tt JOIN transactions t ON t.id=tt.transaction_id WHERE t.account_id=?))) AND ${once}`).bind(String(id),String(item),id,marker),
    env.DB.prepare(`INSERT OR IGNORE INTO ${cacheTable('app_state',purpose)} (key,value,updated_at) SELECT key,value,updated_at FROM legacy_purpose_app_state WHERE key=? AND ${once}`).bind('retirement_profile:'+owner,marker),
    env.DB.prepare('INSERT OR IGNORE INTO app_state (key,value) VALUES (?,\'1\')').bind(marker),
  ];
}
export async function classify(env:Env,request:Request,singleId?:number):Promise<Response>{
  const b=await jsonBody(request) as {purpose?:unknown;accounts?:unknown;standalone?:unknown};
  if(!b||typeof b!=='object'||Array.isArray(b))throw unprocessable('Expected account classifications');
  const changes=singleId===undefined?b.accounts:[{id:singleId,purpose:b.purpose}];
  const other=b.standalone??[];
  if(!Array.isArray(changes)||changes.length>100||!Array.isArray(other)||other.length>100||!changes.length&&!other.length)throw unprocessable('Choose up to 100 individual accounts or standalone records');
  const seen=new Set<string>(),writes:D1PreparedStatement[]=[];
  for(const change of changes){
    if(!change||typeof change!=='object'||!Number.isSafeInteger(change.id)||change.id<1)throw unprocessable('Invalid account id');
    if(seen.has('a'+change.id))throw unprocessable('Each account must be classified once');seen.add('a'+change.id);
    const p=requirePurpose(change.purpose);
    const old=await env.DB.prepare('SELECT id,owner,item_id,purpose FROM accounts WHERE id=?').bind(change.id).first<{id:number;owner:string;item_id:number;purpose:Purpose|null}>();
    if(!old)throw new HttpError(404,'Account not found');
    if(old.purpose===p)continue;
    if(old.purpose){
      writes.push(env.DB.prepare(`INSERT OR IGNORE INTO ${cacheTable('analytics_exclusions',p)} SELECT * FROM ${cacheTable('analytics_exclusions',old.purpose)} WHERE kind='account' AND value=?`).bind(String(old.id)));
      writes.push(env.DB.prepare(`DELETE FROM ${cacheTable('analytics_exclusions',old.purpose)} WHERE kind='account' AND value=?`).bind(String(old.id)));
    }
    writes.push(env.DB.prepare('UPDATE accounts SET purpose=? WHERE id=?').bind(p,old.id));
    writes.push(...inheritedPreferences(env,old.id,old.owner,old.item_id,p));
  }
  for(const r of other){
    if(!r||!['bill','points'].includes(r.kind)||!Number.isSafeInteger(r.id))throw unprocessable('Invalid standalone record');
    const key=r.kind+r.id;if(seen.has(key))throw unprocessable('Each record must be classified once');seen.add(key);
    const table=r.kind==='bill'?'bills':'point_balances',p=requirePurpose(r.purpose);
    if(!await env.DB.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(r.id).first())throw new HttpError(404,'Record not found');
    writes.push(env.DB.prepare(`UPDATE ${table} SET purpose=? WHERE id=?`).bind(p,r.id));
  }
  if(writes.length){
    await env.DB.batch(writes);
    // Newly classified accounts may not have reached the hourly snapshot job yet.
    for(const purpose of PURPOSES)await snapshotBalances(purposeEnv(env,purpose));
  }
  return json({ok:true,message:'Classification saved. The account’s entire transaction, balance and bonus history moves with it. No records were duplicated.'});
}
