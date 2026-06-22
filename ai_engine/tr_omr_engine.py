"""TrOMR(또는 mock) 토큰 시퀀스 생성."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from ai_engine.config import AiOmrConfig
from ai_engine.system_splitter import SystemImage

logger = logging.getLogger(__name__)


@dataclass
class OmrTokenResult:
    tokens: list[str]
    backend: str
    confidence: float = 1.0


class TrOmrEngine:
    def __init__(self, config: AiOmrConfig) -> None:
        self.config = config
        self._model = None

    def recognize_system(self, system: SystemImage) -> OmrTokenResult:
        backend = self.config.backend
        if backend == "tromr":
            return self._recognize_tromr(system)
        return self._recognize_mock(system)

    def _recognize_mock(self, system: SystemImage) -> OmrTokenResult:
        """모델 없이 파이프라인 연결 검증용 — 마디당 온쉼."""
        measure_no = system.page_index * 4 + system.system_index + 1
        tokens = [
            "clef-G2",
            "timeSignature-4/4",
            "rest-whole",
            "barline",
        ]
        logger.info(
            "mock OMR page=%s system=%s → measure~%s tokens=%s",
            system.page_index,
            system.system_index,
            measure_no,
            len(tokens),
        )
        return OmrTokenResult(tokens=tokens, backend="mock", confidence=0.0)

    def _recognize_tromr(self, system: SystemImage) -> OmrTokenResult:
        try:
            tokens = self._run_tromr_model(system)
            return OmrTokenResult(tokens=tokens, backend="tromr", confidence=0.85)
        except Exception as exc:
            logger.warning("TrOMR failed (%s), falling back to mock", exc)
            return self._recognize_mock(system)

    def _run_tromr_model(self, system: SystemImage) -> list[str]:
        """HuggingFace TrOMR — torch/transformers 설치 시 사용."""
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
            self._model = (processor, model, device)

        processor, model, device = self._model
        img = Image.frombytes("RGB", (system.width, system.height), system.rgb_bytes)
        pixel_values = processor(images=img, return_tensors="pt").pixel_values.to(device)
        with torch.no_grad():
            generated = model.generate(pixel_values, max_new_tokens=512)
        text = processor.batch_decode(generated, skip_special_tokens=True)[0]
        return _split_tromr_output(text)


def _split_tromr_output(text: str) -> list[str]:
    """모델 출력 문자열 → 토큰 리스트."""
    raw = text.replace("\n", " ").strip()
    if not raw:
        return ["clef-G2", "timeSignature-4/4", "rest-whole"]
    # 공백·쉼표 구분
    parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
    return parts if parts else ["rest-whole"]
