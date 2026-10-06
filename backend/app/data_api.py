"""API данных: какой набор активен, предпросмотр загрузки, применить, вернуть тестовые."""
from fastapi import APIRouter, File, HTTPException, UploadFile

from . import dataset
from .ingest_docx import IngestError

router = APIRouter(prefix="/api/data")
MAX_BYTES = 20 * 1024 * 1024


async def _read(f: UploadFile) -> bytes:
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Файл больше 20 МБ")
    return data


@router.get("/status")
def status() -> dict:
    return dataset.status()


@router.post("/preview")
async def preview(file: UploadFile = File(...)) -> dict:
    try:
        return dataset.preview(file.filename or "data", await _read(file))
    except IngestError as e:
        raise HTTPException(422, str(e))


@router.post("/activate")
async def activate(file: UploadFile = File(...)) -> dict:
    try:
        return dataset.activate(file.filename or "data", await _read(file))
    except IngestError as e:
        raise HTTPException(422, str(e))


@router.post("/reset")
def reset() -> dict:
    return dataset.reset_to_test()
