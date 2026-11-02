import os
import re
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