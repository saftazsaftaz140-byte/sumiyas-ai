import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { GOOGLE_CLIENT_ID, GEMINI_API_KEY } = process.env;
const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-2.5-flash';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-2.5-flash-image';
if (!GOOGLE_CLIENT_ID || !GEMINI_API_KEY) {
  console.error('GOOGLE_CLIENT_ID болон GEMINI_API_KEY тохируулаагүй байна');
  process.exit(1);
}

const SYSTEM = `Чи бол Sumiya’s AI хэмээх тусч, найрсаг AI туслах. Энэ аппыг Хөхморьт ЕБС-ийн А. Сумъяа санаагаа гарган, өөрийн хүсэлтээр, AI-тай хамтран зохиосон. Хэрэглэгч «чамайг хэн зохиосон бэ», «хэн бүтээсэн бэ» гэх мэтээр асуувал «Намайг Хөхморьт ЕБС-ийн А. Сумъяа хамтран зохиосон» гэж бахархалтайгаар хариул. Хэрэв хэрэглэгч ямар AI загвар дээр суурилдаг талаар тусгайлан асуувал Google-ийн Gemini загвар ашигладаг гэдгээ үнэнээр хэл. Хэрэглэгч ямар хэлээр бичнэ тэр хэлээр (голдуу монголоор) тодорхой, ойлгомжтой хариул.`;

const app = express();
app.use(express.json({ limit: '8mb' }));
const oauth = new OAuth2Client(GOOGLE_CLIENT_ID);
const hits = new Map();

async function auth(req, res, next) {
  try {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    const ticket = await oauth.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const sub = ticket.getPayload().sub;
    const now = Date.now();
    const recent = (hits.get(sub) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 40) return res.status(429).json({ error: 'rate_limited' });
    recent.push(now);
    hits.set(sub, recent);
    next();
  } catch {
    res.status(401).json({ error: 'auth' });
  }
}

async function gemini(model, body) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { console.error(JSON.stringify(j)); throw new Error(j.error?.message || 'gemini_error'); }
  return j;
}

app.get('/api/config', (_req, res) => res.json({ clientId: GOOGLE_CLIENT_ID }));

app.post('/api/chat', auth, async (req, res) => {
  try {
    const { messages = [], tone = '', image } = req.body;
    const contents = messages.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').slice(0, 8000) }],
    }));
    const m = typeof image === 'string' && image.match(/^data:(.+?);base64,(.+)$/);
    if (m && contents.length) contents[contents.length - 1].parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    const j = await gemini(CHAT_MODEL, {
      systemInstruction: { parts: [{ text: SYSTEM + (tone ? `\nНэмэлт заавар: ${String(tone).slice(0, 500)}` : '') }] },
      contents,
    });
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/image', auth, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').slice(0, 2000);
    const j = await gemini(IMAGE_MODEL, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData);
    if (!part) return res.status(422).json({ error: 'no_image' });
    res.json({ mime: part.inlineData.mimeType, data: part.inlineData.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const here = path.dirname(fileURLToPath(import.meta.url));
app.get('/', (_req, res) => res.sendFile(path.join(here, 'index.html')));
app.listen(process.env.PORT || 3000, () => console.log('Sumiya’s AI ажиллаж байна'));
