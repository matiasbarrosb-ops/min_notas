// Vercel Serverless Function: lee un programa (PDF o texto dictado) con Claude y devuelve el ramo en JSON.
// Variables de entorno en Vercel: SUPABASE_URL, SUPABASE_ANON_KEY y UNA de estas:
//   GEMINI_API_KEY    (gratis, de aistudio.google.com)  <- se usa primero si existe
//   ANTHROPIC_API_KEY (de pago, de console.anthropic.com)
// Solo usuarios con sesión iniciada pueden usarla (se verifica el token de Supabase).

const PROMPT = `Eres un asistente que convierte el programa de un ramo universitario chileno (escala de notas 1,0 a 7,0; se aprueba con 3,95) en JSON para una calculadora de notas.
Devuelve SOLO un objeto JSON (sin texto antes ni después) con esta forma:
{"sigla":"MAT1630","nombre":"Cálculo III","periodo":"2026-2","combinacion":"ponderado"|"minimos",
 "eximicion":null|{"parte":"np","umbral":5.5,"sinRojos":false},
 "partes":[{"id":"p","nombre":"Nota final","peso":1,"minimo":null,
   "items":[{"id":"i1","nombre":"Interrogación 1","peso":0.2,"fecha":"2026-09-08"|null,"examen":false,"reemplazable":false,
     "sub":null|[{"id":"c1","nombre":"Control 1","fecha":null}]}]}],
 "reglas":["frases cortas con reglas importantes"],"dudas":["lo que no quedó claro"]}
Reglas:
- Los pesos de los items DENTRO de cada parte suman 1. Los pesos de las partes suman 1.
- Usa UNA parte si la nota final es un promedio ponderado simple. Usa varias partes con "combinacion":"minimos" cuando hay componentes que se aprueban por separado (ej. cátedra y laboratorio, o nota de presentación y examen reprobatorio); pon "minimo":3.95 en las partes que exigen nota mínima.
- Si el examen es reprobatorio, ponlo en su propia parte (id "exp") con minimo 3.95, y la nota de presentación en otra parte (id "np").
- Marca "examen":true en el examen final. "reemplazable":true en evaluaciones que, si se faltan justificadamente, se reemplazan por el examen.
- Usa "sub" cuando una evaluación es el promedio de varias (ej. controles); en ese caso el item padre tiene el peso y los sub no tienen peso.
- Si hay eximición, completa "eximicion" con el id de la parte de presentación y el umbral numérico; "sinRojos":true si exige no tener notas bajo 4,0.
- Fechas en formato AAAA-MM-DD solo si aparecen; si no, null.
- Si algo no está en el programa, NO lo inventes: pon tu mejor supuesto y explícalo en "dudas".
- Escribe en español.`;

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

async function conGemini(body) {
  const parts = [];
  if (body.tipo === 'pdf' && body.data) parts.push({ inline_data: { mime_type: 'application/pdf', data: body.data } }, { text: PROMPT + '\n\nEl programa es el PDF adjunto.' });
  else parts.push({ text: PROMPT + '\n\n<programa>\n' + String(body.texto || body.textoPdf || '').slice(0, 60000) + '\n</programa>' });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } })
  });
  const j = await r.json();
  if (r.status === 429) throw new Error('Se alcanzó el límite gratuito de la IA por ahora. Espera un rato o crea el ramo a mano.');
  if (!r.ok) throw new Error('La IA no respondió: ' + (j.error?.message || r.status));
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    // 1) Verificar que la persona inició sesión
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Inicia sesión para usar la IA.' });
    const u = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY } });
    if (!u.ok) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a entrar.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!(body.tipo === 'pdf' && body.data) && String(body.texto || body.textoPdf || '').trim().length < 20) return res.status(400).json({ error: 'Falta el texto del programa.' });

    // 2a) Gemini (gratis) si hay key
    if (process.env.GEMINI_API_KEY) {
      try {
        const txt = await conGemini(body);
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) return res.status(502).json({ error: 'La IA no devolvió un ramo válido. Prueba de nuevo o hazlo a mano.' });
        return res.status(200).json({ ramo: JSON.parse(m[0]) });
      } catch (e) { return res.status(502).json({ error: e.message }); }
    }
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Falta configurar la IA (GEMINI_API_KEY en Vercel).' });

    // 2b) Claude (de pago)
    const content = [];
    if (body.tipo === 'pdf' && body.data) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.data } });
      content.push({ type: 'text', text: PROMPT + '\n\nEl programa es el PDF adjunto.' });
    } else {
      const texto = String(body.texto || body.textoPdf || '').slice(0, 60000);
      if (texto.trim().length < 20) return res.status(400).json({ error: 'Falta el texto del programa.' });
      content.push({ type: 'text', text: PROMPT + '\n\n<programa>\n' + texto + '\n</programa>' });
    }

    // 3) Llamar a la API de Claude
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'La IA no respondió: ' + (j.error?.message || r.status) });
    const txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'La IA no devolvió un ramo válido. Prueba de nuevo o hazlo a mano.' });
    return res.status(200).json({ ramo: JSON.parse(m[0]) });
  } catch (e) {
    return res.status(500).json({ error: 'Error: ' + e.message });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } };
