// Vercel serverless API for EduCator. Messages may include image/PDF inline data or text-file data URLs.
const ALLOWED_ORIGINS = new Set([
  'https://katznleo-ops.github.io',
  'https://bio-content-ai.vercel.app',
  ...(process.env.EXTRA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 12);
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/markdown','text/csv']);
function send(res,status,body){res.setHeader('X-EduCator-Commit',COMMIT);return res.status(status).json(body)}
function parseAttachment(file,budget){
  if(!file||typeof file.name!=='string'||typeof file.type!=='string'||typeof file.data!=='string'||!ALLOWED_MIME.has(file.type))return null;
  const match=file.data.match(/^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if(!match||match[1]!==file.type)return null;
  const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>MAX_ATTACHMENT_BYTES||budget.total+bytes.length>MAX_ATTACHMENT_BYTES)return null;
  budget.total+=bytes.length;
  if(file.type.startsWith('image/')||file.type==='application/pdf')return{name:file.name,type:file.type,part:{inline_data:{mime_type:file.type,data:bytes.toString('base64')}}};
  const text=bytes.toString('utf8');if(text.includes('\u0000')||text.length>MAX_MESSAGE_LENGTH)return null;
  return{name:file.name,type:file.type,part:{text:`\n\n[Attached file: ${file.name}]\n${text}`}};
}
function readMessages(body){
  if(typeof body?.prompt==='string'){const text=body.prompt.trim();return text&&text.length<=MAX_MESSAGE_LENGTH?[{role:'user',parts:[{text}]}]:null}
  if(!Array.isArray(body?.messages)||!body.messages.length||body.messages.length>MAX_MESSAGES)return null;
  const budget={total:0},messages=[];
  for(const item of body.messages){
    if(!item||!['user','model'].includes(item.role)||typeof item.text!=='string')return null;
    const text=item.text.trim();if(text.length>MAX_MESSAGE_LENGTH)return null;
    const role=item.role;const parts=[];if(text)parts.push({text});
    if(item.attachments!==undefined){if(!Array.isArray(item.attachments)||item.attachments.length>4)return null;for(const file of item.attachments){const attachment=parseAttachment(file,budget);if(!attachment)return null;if(attachment.part.text)parts.push(attachment.part);else parts.push(attachment.part)}}
    if(!parts.length)return null;
    if(messages.length===0&&role!=='user')continue;
    if(messages.length&&messages[messages.length-1].role===role){messages[messages.length-1].parts.push(...parts)}else messages.push({role,parts});
  }
  if(!messages.length||messages[0].role!=='user')return null;
  const textBytes=messages.reduce((total,message)=>total+message.parts.reduce((sum,part)=>sum+(part.text?.length||0),0),0);
  if(textBytes>24000)return null;
  return messages;
}
export default async function handler(req,res){
  const origin=req.headers.origin;if(origin&&ALLOWED_ORIGINS.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS')return res.status(204).end();if(req.method!=='POST'){res.setHeader('Allow','POST, OPTIONS');return send(res,405,{error:'Method not allowed'})}
  let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{body=null}}
  const contents=readMessages(body);if(!contents)return send(res,400,{error:'Send up to 30 valid messages with supported attachments (max 2 MB total).'});
  const apiKey=(process.env.GEMINI_API_KEY||'').trim();if(!apiKey)return send(res,500,{error:'The learning service is not configured yet.'});
  const model=(process.env.GEMINI_MODEL||'gemini-2.5-flash').trim().replace(/^models\//,'');const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try{
    const upstream=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify({systemInstruction:{parts:[{text:'You are EduCator, a warm, thoughtful tutor who helps learners understand subjects across math, science, writing, languages, history, technology, and everyday topics. Be patient, encouraging, accurate, and age-appropriate. Explain concepts clearly, ask helpful follow-up questions when needed, and carefully analyze any image or document the learner attaches. For text or source questions, guide learning rather than simply doing graded work.'}]},contents,generationConfig:{temperature:0.45,maxOutputTokens:4096}})});
    const data=await upstream.json().catch(()=>null);if(!upstream.ok){console.error('[educator] provider error',upstream.status,data?.error?.status||'UNKNOWN');return send(res,502,{error:'A response could not be generated right now.',/* TEMP DEBUG: remove once the Gemini 502 is fixed */debug:{upstreamStatus:upstream.status,errorStatus:data?.error?.status||null,errorMessage:data?.error?.message||null,model}})}
    const answer=(data?.candidates?.[0]?.content?.parts||[]).filter(part=>!part.thought).map(part=>part.text||'').join('').trim();if(!answer)return send(res,502,{error:'No answer came back. Please try again.'});return send(res,200,{answer,model});
  }catch(error){console.error('[educator] upstream request failed',String(error));return send(res,502,{error:'Could not reach the learning service. Please try again.'})}
}
