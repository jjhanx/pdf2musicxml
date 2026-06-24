"""TrOMR(또는 mock) 토큰 시퀀스 생성 — staff 크롭 단위."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from ai_engine.config import AiOmrConfig
from ai_engine.staff_splitter import StaffImage
from ai_engine.system_splitter import SystemImage

logger = logging.getLogger(__name__)


class OmrImage(Protocol):
    width: int
    height: int
    rgb_bytes: bytes
    page_index: int
    system_index: int


@dataclass
class OmrTokenResult:
    tokens: list[str]
    backend: str
    confidence: float = 1.0
    staff_index: int | None = None


class TrOmrEngine:
    def __init__(self, config: AiOmrConfig) -> None:
        self.config = config
        self._model = None

    def recognize(self, image: OmrImage, staff_index: int | None = None) -> OmrTokenResult:
        backend = self.config.backend
        if backend == "mock":
            return self._recognize_mock(image, staff_index)
        return self._recognize_tromr(image, staff_index)

    def recognize_system(self, system: SystemImage) -> OmrTokenResult:
        return self.recognize(system, staff_index=None)

    def _recognize_mock(self, image: OmrImage, staff_index: int | None) -> OmrTokenResult:
        """파이프라인 검증용 — staff별 온쉼 한 마디."""
        si = staff_index if staff_index is not None else 0
        prefix = f"staff{si}-"
        clef = "clef-F4" if si >= 4 else "clef-G2"
        tokens = [
            f"{prefix}{clef}",
            f"{prefix}timeSignature-4/4",
            f"{prefix}rest-whole",
        ]
        return OmrTokenResult(tokens=tokens, backend="mock", confidence=0.0, staff_index=si)

    def _recognize_tromr(self, image: OmrImage, staff_index: int | None) -> OmrTokenResult:
        try:
            tokens = self._run_tromr_model(image)
            if staff_index is not None:
                tokens = [_ensure_staff_prefix(t, staff_index) for t in tokens]
            return OmrTokenResult(
                tokens=tokens, backend="tromr", confidence=0.85, staff_index=staff_index
            )
        except Exception as exc:
            logger.error("TrOMR failed (%s)", exc)
            raise RuntimeError(f"TrOMR inference failed: {exc}") from exc

    def _run_tromr_model(self, image: OmrImage) -> list[str]:
        import torch
        from PIL import Image

        if self._model is None:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel

            model_id = self.config.model_id
            logger.info("Loading TrOMR model %s …", model_id)
            processor = TrOCRProcessor.from_pretrained(model_id)
            model = VisionEncoderDecoderModel.from_pretrained(model_id)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model.to(device)
            model.eval()
            self._model = (processor, model, device)

        processor, model, device = self._model
        img = Image.frombytes("RGB", (image.width, image.height), image.rgb_bytes)
        pixel_values = processor(images=img, return_tensors="pt").pixel_values.to(device)
        with torch.no_grad():
            generated = model.generate(pixel_values, max_new_tokens=768)
        text = processor.batch_decode(generated, skip_special_tokens=True)[0]
        return _split_tromr_output(text)


def _ensure_staff_prefix(token: str, staff_index: int) -> str:
    t = token.strip()
    lower = t.lower()
    if lower.startswith("staff") and lower[5:6].isdigit():
        return t
    return f"staff{staff_index}-{t}"


def _split_tromr_output(text: str) -> list[str]:
    raw = text.replace("\n", " ").strip()
    if not raw:
        return ["rest-whole"]
    parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
    return parts if parts else ["rest-whole"]
