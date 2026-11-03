import os
import re
import json
import asyncio
import urllib.request
import time
import uuid
import tempfile
import edge_tts
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

# Middleware global que resolve em definitivo os pedidos do Edge (CORS e Private Network)
@app.middleware("http")
async def add_cors_and_private_network_headers(request: Request, call_next):
    if request.method == "OPTIONS":
        response = Response(status_code=200)
    else:
        response = await call_next(request)

    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS, PUT, DELETE"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# Diretório temporário seguro para ficheiros de áudio
AUDIO_DIR = os.path.join(tempfile.gettempdir(), "leitor_pdf_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

# Limpeza automática: áudios são temporários, não precisam ficar acumulando
AUDIO_MAX_AGE = 60 * 60        # apaga áudios com mais de 1 hora
CLEANUP_INTERVAL = 5 * 60      # verifica no máximo a cada 5 minutos
_last_cleanup = 0.0

def cleanup_old_audio(max_age=AUDIO_MAX_AGE, force=False):
    global _last_cleanup
    now = time.time()
    if not force and now - _last_cleanup < CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    for name in os.listdir(AUDIO_DIR):
        path = os.path.join(AUDIO_DIR, name)
        try:
            if name.endswith(".mp3") and now - os.path.getmtime(path) > max_age:
                os.remove(path)
        except OSError:
            pass  # arquivo em uso ou já removido: segue o jogo

# Ao iniciar o servidor, apaga tudo que sobrou da execução anterior
cleanup_old_audio(max_age=0, force=True)

# Limites simples para o servidor não ser abusado quando estiver aberto por túnel
MAX_TEXT_CHARS = 2000            # uma frase nunca precisa de mais que isso
RATE_WINDOW = 60                 # janela de 1 minuto
RATE_MAX_REQUESTS = 90           # pedidos por minuto, por visitante
_hits = {}

def client_key(request: Request) -> str:
    # atrás do túnel o IP real vem nestes cabeçalhos
    return (request.headers.get("cf-connecting-ip")
            or request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else "local"))

def too_many_requests(key: str) -> bool:
    now = time.time()
    recent = [t for t in _hits.get(key, []) if now - t < RATE_WINDOW]
    recent.append(now)
    _hits[key] = recent
    if len(_hits) > 2000:  # não deixa a tabela crescer sem fim
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW]:
            _hits.pop(k, None)
    return len(recent) > RATE_MAX_REQUESTS

# ---- Minha voz (VoiceStudio, no próprio PC) ----
# O VoiceStudio roda local e expõe uma API compatível com a da OpenAI. O servidor pede o áudio a ele,
# uma frase por vez (a placa de vídeo é pequena e trava se receber vários pedidos juntos).
VS_URL = os.environ.get("VOICESTUDIO_URL", "http://127.0.0.1:3900")
VS_VOICE = os.environ.get("VOICESTUDIO_VOICE", "8919b44a")        # id do perfil de voz clonada
VS_MODEL = os.environ.get("VOICESTUDIO_MODEL", "moss-tts-nano")    # motor rápido o bastante para ler
VS_VOICE_ID = "voicestudio"       # nome que o app usa na lista de vozes
VS_MAX_WAITING = 8                # fila máxima de frases esperando a vez
_vs_lock = None
_vs_waiting = 0

def _vs_request(text: str) -> bytes:
    body = json.dumps({"model": VS_MODEL, "input": text, "voice": VS_VOICE, "response_format": "mp3"}).encode("utf-8")
    r = urllib.request.Request(VS_URL + "/v1/audio/speech", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=300) as resp:
        return resp.read()

async def synthesize_voicestudio(text: str, filepath: str) -> None:
    global _vs_lock, _vs_waiting
    if _vs_lock is None:
        _vs_lock = asyncio.Lock()
    if _vs_waiting >= VS_MAX_WAITING:
        raise HTTPException(status_code=429, detail="Fila da voz cheia. Tente de novo em instantes.")
    _vs_waiting += 1
    try:
        async with _vs_lock:
            data = await asyncio.to_thread(_vs_request, text)
    except Exception as e:
        print(f"Erro VoiceStudio: {e}")
        raise HTTPException(status_code=503, detail="VoiceStudio indisponível. Abra o programa no PC.")
    finally:
        _vs_waiting -= 1
    with open(filepath, "wb") as f:
        f.write(data)

class TTSRequest(BaseModel):
    text: str
    voice: str = "pt-BR-FranciscaNeural"
    rate: str = "+0%"

@app.post("/synthesize")
async def synthesize(req: TTSRequest, request: Request):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")
    if len(req.text) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail="Texto muito longo")
    if too_many_requests(client_key(request)):
        raise HTTPException(status_code=429, detail="Muitos pedidos. Tente de novo em instantes.")

    cleanup_old_audio()

    filename = f"{uuid.uuid4().hex}.mp3"
    filepath = os.path.join(AUDIO_DIR, filename)

    if req.voice == VS_VOICE_ID:
        await synthesize_voicestudio(req.text, filepath)
        return {"audio_url": f"/audio/{filename}"}

    try:
        communicate = edge_tts.Communicate(req.text, req.voice, rate=req.rate)
        await communicate.save(filepath)

        # caminho relativo: o app completa com o endereço do servidor (funciona também atrás de túnel HTTPS)
        return {"audio_url": f"/audio/{filename}"}
    except Exception as e:
        print(f"Erro TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio/{filename}")
async def get_audio(filename: str):
    # só aceita nomes no formato que o próprio servidor gera
    if not re.fullmatch(r"[0-9a-f]{32}\.mp3", filename):
        raise HTTPException(status_code=404, detail="Ficheiro não encontrado")
    filepath = os.path.join(AUDIO_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath, media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Ficheiro não encontrado")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)