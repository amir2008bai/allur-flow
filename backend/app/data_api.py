"""API данных: какой набор активен, предпросмотр загрузки, применить, вернуть тестовые."""
from fastapi import APIRouter, File, HTTPException, UploadFile

from . import dataset
from .ingest_docx import IngestError

router = APIRouter(prefix="/api/data")
MAX_BYTES = 20 * 1024 * 1024


async def _read(f: UploadFile) -> bytes:
    # читаем по 1 МБ и обрываем сразу за лимитом: большой файл не попадает в память целиком
    buf = bytearray()
    while chunk := await f.read(1024 * 1024):
        buf += chunk
        if len(buf) > MAX_BYTES:
            raise HTTPException(413, "Файл больше 20 МБ")
    return bytes(buf)


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


@router.get("/twin-fit")
def twin_fit() -> dict:
    """Насколько двойник совпадает с журналом простоев и что изменила бы подгонка (без применения)."""
    from .dataset import status
    st = status()
    return {**_fit_cached(st["file"], str(st.get("activated_at"))), "dataset": st["file"], "is_test": st.get("is_test", True)}


from functools import lru_cache  # noqa: E402


@lru_cache(maxsize=4)
def _fit_cached(file: str, activated: str) -> dict:
    from .dataset import active_facts
    from .sim.params import BASE
    from .twin_calib import fit
    return fit(active_facts(), BASE, apply=False)
