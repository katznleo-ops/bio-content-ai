// Vercel serverless API for EduCator. Messages may include image/PDF inline data or text-file data URLs.
const ALLOWED_ORIGINS = new Set([
  'https://katznleo-ops.github.io',
  'https://bio-content-ai.vercel.app',
  'https://bio-content-ai-revised.vercel.app',
  ...(process.env.EXTRA_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const COMMIT = (process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 12);
const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const SYSTEM_PROMPT='You are EduCator, a warm, thoughtful tutor who helps learners understand subjects across math, science, writing, languages, history, technology, and everyday topics. Be patient, encouraging, accurate, and age-appropriate. Explain concepts clearly, ask helpful follow-up questions when needed, and carefully analyze any image or document the learner attaches. For text or source questions, guide learning rather than simply doing graded work. Format answers in Markdown: short paragraphs, ## headings for longer answers, bullet or numbered lists for steps, **bold** for key terms, and tables when comparing things. Write math in LaTeX with $...$ inline and $$...$$ for displayed equations. Keep answers focused; avoid unnecessary length.';
const JSON_PROMPT='You are EduCator, an expert curriculum designer and tutor. You generate structured study materials (learning plans, lessons, quizzes) for a learner. Respond ONLY with a single valid JSON object that matches the shape requested by the user message. Do not wrap it in code fences or add commentary. String values may use Markdown, and math must use LaTeX with $...$ (escape backslashes correctly for JSON). Make content accurate, well-ordered, and matched to the learner\'s level.';
const MAX_CONTEXT_LENGTH = 6000;
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
  const model=(process.env.GEMINI_MODEL||'gemini-2.5-flash').trim().replace(/^models\//,'');
  // format:'json' asks for a structured JSON object (lesson plans, quizzes); it is never streamed.
  const json=body?.format==='json';
  const stream=body?.stream===true&&!json;
  // Optional learner/notebook context (goal, level, plan, progress) appended to the system prompt.
  const context=typeof body?.context==='string'?body.context.trim().slice(0,MAX_CONTEXT_LENGTH):'';
  const system=(json?JSON_PROMPT:SYSTEM_PROMPT)+(context?`\n\n--- Learner context ---\n${context}`:'');
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`;
  const generationConfig=json?{temperature:0.6,maxOutputTokens:8192,responseMimeType:'application/json'}:{temperature:0.45,maxOutputTokens:4096};
  const payload=JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig});
  const textOf=(chunk)=>(chunk?.candidates?.[0]?.content?.parts||[]).filter(part=>!part.thought).map(part=>part.text||'').join('');
  try{
    const request=()=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:payload});
    let upstream=await request();
    // Gemini returns 503/429 when a model is briefly overloaded; retry a couple of times with backoff.
    for(let attempt=1;attempt<=2&&(upstream.status===503||upstream.status===429);attempt++){await new Promise(r=>setTimeout(r,attempt*1500));upstream=await request()}
    if(!upstream.ok){const data=await upstream.json().catch(()=>null);console.error('[educator] provider error',upstream.status,data?.error?.status||'UNKNOWN',data?.error?.message||'');return send(res,502,{error:upstream.status===503||upstream.status===429?'The tutor is very busy right now. Please try again in a moment.':'A response could not be generated right now.'})}
    if(!stream){
      const data=await upstream.json().catch(()=>null);const answer=textOf(data).trim();
      if(!answer)return send(res,502,{error:'No answer came back. Please try again.'});return send(res,200,{answer,model});
    }
    // Streaming: relay Gemini's SSE as newline-delimited JSON ({"t":"text"} lines, then {"done":true}).
    res.setHeader('X-EduCator-Commit',COMMIT);res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('X-Accel-Buffering','no');res.statusCode=200;
    const reader=upstream.body.getReader();const decoder=new TextDecoder();let buffer='',sent=0;
    const handle=(line)=>{if(!line.startsWith('data:'))return;let chunk;try{chunk=JSON.parse(line.slice(5))}catch{return}const t=textOf(chunk);if(t){sent+=t.length;res.write(JSON.stringify({t})+'\n')}};
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let nl;while((nl=buffer.indexOf('\n'))>=0){handle(buffer.slice(0,nl).trim());buffer=buffer.slice(nl+1)}}
      handle(buffer.trim());
      res.write(JSON.stringify(sent?{done:true,model}:{error:'No answer came back. Please try again.'})+'\n');
    }catch(error){console.error('[educator] stream interrupted',String(error));res.write(JSON.stringify({error:'The answer was interrupted. Please try again.'})+'\n')}
    return res.end();
  }catch(error){console.error('[educator] upstream request failed',String(error));if(res.headersSent)return res.end();return send(res,502,{error:'Could not reach the learning service. Please try again.'})}
}
