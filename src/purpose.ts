import type { Env } from './env';
import { PURPOSE_CACHES, PURPOSE_TABLES } from './purpose-schema';
import { unprocessable } from './http';

export type Purpose = 'personal'|'churning';
export const PURPOSES: Purpose[] = ['personal','churning'];
export function requirePurpose(value: unknown): Purpose {
  if(value!=='personal'&&value!=='churning')throw unprocessable('Choose Personal or Churning; combined purpose views are not supported');
  return value;
}
export function requestPurpose(request: Request): Purpose {
  const query=new URL(request.url).searchParams.getAll('purpose'),header=request.headers.get('x-minty-purpose');
  if(query.length>1)throw unprocessable('Choose one purpose');
  if(header&&query.length&&header!==query[0])throw unprocessable('Purpose header and query must match');
  return requirePurpose(header??query[0]??'personal');
}
type Token={raw:string;name:string;start:number;end:number;depth:number};
// Tokenize identifiers independently of string literals/comments. Financial table names in terms,
// merchant strings and JSON paths are never rewritten. SQL is internal application code, not user SQL.
function tokens(sql:string):Token[]{
  const re=/\s+|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|[a-zA-Z_][\w]*|\?[0-9]*|./g;
  const out:Token[]=[];let depth=0;
  for(const m of sql.matchAll(re)){const raw=m[0];if(/^\s|^--|^\/\*/.test(raw))continue;if(raw===')')depth--;
    const quoted=/^["`\[]/.test(raw),name=raw.startsWith("'")?'':(quoted?raw.slice(1,-1):raw).toLowerCase();
    out.push({raw,name,start:m.index!,end:m.index!+raw.length,depth});if(raw==='(')depth++;
  }return out;
}
const cacheSet=new Set<string>(PURPOSE_CACHES);
const schema=PURPOSE_TABLES as Record<string,{pk:readonly string[];parent:string|null}>;
const financialKey=(v:unknown)=>typeof v==='string'&&/^(audit_|networth_|retirement_profile:)/.test(v);
export const cacheTable=(table:string,purpose:Purpose)=>purpose==='personal'?table:`churning_${table}`;
export const purposeView=(table:string,purpose:Purpose)=>`purpose_${purpose}_${table}`;

/** One enforcement boundary for every financial handler, including nested reads, writes and caches.
 * Read views use account IDs, never Item/owner/type. Mutations retain real table constraints and
 * UPSERT semantics, but SQL input/output is guarded by the same views. Sync deliberately uses raw DB. */
export function scopeSql(source:string,purpose:Purpose,bindings:unknown[]=[]):string {
  let sql=source.trim().replace(/;$/,'');let ts=tokens(sql);
  if(ts.some(t=>t.raw===';'))throw new Error('Scoped statements must contain exactly one SQL statement');
  const main=ts.findIndex(t=>t.depth===0&&['select','insert','replace','update','delete'].includes(t.name));
  if(main<0)throw new Error('Unsupported scoped SQL operation');
  const kind=ts[main].name;
  let targetIndex=-1;
  if(kind==='insert'||kind==='replace')targetIndex=ts.findIndex((t,i)=>i>main&&t.depth===0&&t.name==='into')+1;
  else if(kind==='delete')targetIndex=ts.findIndex((t,i)=>i>main&&t.depth===0&&t.name==='from')+1;
  else if(kind==='update')targetIndex=main+1;
  if(targetIndex>=0&&ts[targetIndex+1]?.raw==='.')targetIndex+=2;
  const target=targetIndex>=0?ts[targetIndex]?.name:null;
  const spec=target?schema[target]:null;
  if(spec&&(kind==='update'||kind==='delete')){
    const stop=ts.find(t=>t.depth===0&&['returning','order','limit'].includes(t.name)&&t.start>ts[targetIndex].end)?.start??sql.length;
    const where=ts.find(t=>t.depth===0&&t.name==='where'&&t.start>ts[targetIndex].end&&t.start<stop);
    const cols=spec.pk.map(k=>`"${k}"`).join(',');
    const guard=`(${cols}) IN (SELECT ${cols} FROM ${purposeView(target!,purpose)})`;
    sql=where?`${sql.slice(0,where.start)} WHERE (${sql.slice(where.end,stop)}) AND ${guard} ${sql.slice(stop)}`:`${sql.slice(0,stop)} WHERE ${guard} ${sql.slice(stop)}`;
  }
  if(spec&&(kind==='insert'||kind==='replace')){
    const open=ts[targetIndex+1],close=ts.findIndex((t,i)=>i>targetIndex+1&&t.raw===')'&&t.depth===open?.depth);
    if(open?.raw!=='('||close<0)throw new Error('Scoped inserts must list columns explicitly');
    const cols=ts.slice(targetIndex+2,close).filter(t=>t.raw!==',').map(t=>t.name);
    const tail=ts.find((t,i)=>i>close&&t.depth===0&&(t.name==='returning'||t.name==='on'&&ts[i+1]?.name==='conflict'))?.start??sql.length;
    const input=sql.slice(ts[close].end,tail).trim();
    const parent=spec.parent;
    let guard:string;
    if(parent){
      if(!cols.includes(parent))throw new Error(`Scoped ${target} insert must include ${parent}`);
      const parentTable=parent==='account_id'?'accounts':parent==='transaction_id'?'transactions':parent==='offer_id'?'account_bonus_offers':'items';
      guard=`"${parent}" IN (SELECT id FROM ${purposeView(parentTable,purpose)})`;
    }else if(['bills','point_balances','accounts'].includes(target!)){
      if(!cols.includes('purpose'))throw new Error(`Scoped ${target} insert requires an explicit purpose`);
      guard=`purpose='${purpose}'`;
    }else throw new Error(`No scoped insert policy for ${target}`);
    sql=`WITH __purpose_input (${cols.map(c=>`"${c}"`).join(',')}) AS (${input}) ${sql.slice(0,ts[close].end)} SELECT * FROM __purpose_input WHERE ${guard} ${sql.slice(tail)}`;
  }
  ts=tokens(sql);
  const stateIsFinancial=bindings.some(financialKey)||/'(?:audit_|networth_|retirement_profile:)/.test(sql);
  // DML target and its qualifier must remain a real table so constraints/RETURNING/UPSERT work.
  const dml=ts.findIndex(t=>t.depth===0&&['insert','replace','update','delete'].includes(t.name));
  let actualTarget=-1;
  if(dml>=0){const k=ts[dml].name;actualTarget=k==='update'?dml+1:ts.findIndex((t,i)=>i>dml&&t.depth===0&&t.name===(k==='delete'?'from':'into'))+1;if(ts[actualTarget+1]?.raw==='.')actualTarget+=2;}
  const replacements:{start:number;end:number;value:string}[]=[];
  ts.forEach((t,i)=>{
    if(ts[i-1]?.name==='as')return; // e.g. count(*) AS accounts is an output column, not a table.
    let name:string|undefined;
    if(cacheSet.has(t.name))name=cacheTable(t.name,purpose);
    else if(t.name==='app_state'&&stateIsFinancial)name=cacheTable('app_state',purpose);
    else if(schema[t.name]&&i!==actualTarget&&!(dml>=0&&t.name===target&&ts[i+1]?.raw==='.'))name=purposeView(t.name,purpose);
    if(name&&name!==t.name)replacements.push({start:t.start,end:t.end,value:/^["`\[]/.test(t.raw)?`"${name}"`:name});
  });
  for(const r of replacements.reverse())sql=sql.slice(0,r.start)+r.value+sql.slice(r.end);
  return sql;
}

const originals=new WeakMap<object,{raw:D1Database;purpose:Purpose}>();
const databases=new WeakMap<object,Map<Purpose,D1Database>>();
export const rawDatabase=(db:D1Database)=>originals.get(db)?.raw??db;
export function purposeDatabase(input:D1Database,purpose:Purpose):D1Database {
  if(originals.get(input)?.purpose===purpose)return input;
  const raw=rawDatabase(input);let options=databases.get(raw);if(!options){options=new Map();databases.set(raw,options);}if(options.has(purpose))return options.get(purpose)!;
  const inner=new WeakMap<object,D1PreparedStatement>();
  function statement(sql:string,values:unknown[]=[]):D1PreparedStatement {
    let prepared=raw.prepare(scopeSql(sql,purpose,values));if(values.length)prepared=prepared.bind(...values);
    const wrap={bind:(...v:unknown[])=>statement(sql,v),all:()=>prepared.all(),run:()=>prepared.run(),first:(column?:string)=>column===undefined?prepared.first():prepared.first(column),raw:(opts?:{columnNames:true})=>opts?prepared.raw(opts):prepared.raw()};
    inner.set(wrap,prepared);return wrap as unknown as D1PreparedStatement;
  }
  const db={prepare:statement,batch:(stmts:D1PreparedStatement[])=>raw.batch(stmts.map(s=>{const p=inner.get(s);if(!p)throw new Error('Cannot mix scoped and unscoped statements');return p;})),exec:()=>{throw new Error('Raw SQL execution is disabled in financial views');},dump:()=>{throw new Error('Raw export is disabled in financial views');}} as unknown as D1Database;
  originals.set(db,{raw,purpose});options.set(purpose,db);return db;
}
export function purposeEnv(env:Env,purpose:Purpose=env.PURPOSE??'personal'):Env {
  return {...env,PURPOSE:purpose,DB:purposeDatabase(env.DB,purpose)};
}
