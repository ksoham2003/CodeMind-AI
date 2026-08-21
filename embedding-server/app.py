import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List

MODEL_NAME = os.environ.get('EMBEDDING_MODEL_NAME', 'all-MiniLM-L6-v2')

app = FastAPI(title='Local Embedding Server')


class TextIn(BaseModel):
    text: str


class BatchIn(BaseModel):
    texts: List[str]


@app.on_event('startup')
def load_model():
    global model
    model = SentenceTransformer(MODEL_NAME)


@app.post('/embed')
def embed(body: TextIn):
    try:
        vec = model.encode(body.text.replace('\n', ' '), show_progress_bar=False)
        return {'embedding': vec.tolist()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/embed/batch')
def embed_batch(body: BatchIn):
    try:
        texts = [t.replace('\n', ' ') for t in body.texts]
        vecs = model.encode(texts, show_progress_bar=False)
        return {'embeddings': [v.tolist() for v in vecs]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/health')
def health():
    return {'status': 'ok', 'model': MODEL_NAME}
