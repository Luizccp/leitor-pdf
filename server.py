import os
import uuid
import tempfile
import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI()

# Permite chamadas do frontend hospedado em qualquer domínio
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Diretório temporário seguro para ficheiros de áudio
AUDIO_DIR = os.path.join(tempfile.gettempdir(), "leitor_pdf_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

class TTSRequest(BaseModel):
    text: str
    voice: str = "pt-BR-FranciscaNeural"
    rate: str = "+0%"

@app.post("/synthesize")
async def synthesize(req: TTSRequest, request: Request):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio")

    filename = f"{uuid.uuid4().hex}.mp3"
    filepath = os.path.join(AUDIO_DIR, filename)

    try:
        communicate = edge_tts.Communicate(req.text, req.voice, rate=req.rate)
        await communicate.save(filepath)

        # Constrói o URL dinamicamente (seja em localhost ou no domínio da nuvem)
        base_url = str(request.base_url).rstrip('/')
        return {"audio_url": f"{base_url}/audio/{filename}"}
    except Exception as e:
        print(f"Erro TTS: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/audio/{filename}")
async def get_audio(filename: str):
    filepath = os.path.join(AUDIO_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath, media_type="audio/mpeg")
    raise HTTPException(status_code=404, detail="Ficheiro não encontrado")

if __name__ == "__main__":
    import uvicorn
    # Lê a porta atribuída pela nuvem ou usa a 8000 por defeito localmente
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)