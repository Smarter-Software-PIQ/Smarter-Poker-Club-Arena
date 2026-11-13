// Test preload only (node --import): replaces global fetch so the REAL trusted
// scripts run unchanged against a recorded pull request. Every call is logged.
import fs from 'node:fs';
const pr=JSON.parse(process.env.STUB_PR||'null'),log=process.env.STUB_LOG,appId=process.env.REPORTER_APP_ID;
globalThis.fetch=async(url,init={})=>{
 const method=init.method||'GET';
 fs.appendFileSync(log,JSON.stringify({method,url:String(url)})+'\n');
 const json=body=>({ok:true,status:200,json:async()=>body});
 if(method==='DELETE'&&String(url).endsWith('/installation/token'))return {ok:true,status:204,json:async()=>({})};
 if(method==='GET'&&/\/pulls\/\d+$/.test(url))return json(pr);
 if(method==='POST'&&String(url).endsWith('/check-runs')){const b=JSON.parse(init.body);return json({id:77,head_sha:b.head_sha,app:{id:Number(appId)}});}
 return {ok:false,status:500,json:async()=>({})};
};
