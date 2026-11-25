"""Extract plain text from student documents so the AI assistant can read them.

PDF uses the `pypdf` package; DOCX and PPTX are read with the standard library
(they are zip files of XML); plain text and code files are read directly.
Scanned/image-only PDFs have no text layer and cannot be read this way.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from typing import List, Tuple

TEXT_EXT = {"txt", "md", "csv", "py", "js", "ts", "java", "c", "cpp", "json"}
EXTRACTABLE = TEXT_EXT | {"pdf", "docx", "pptx"}
MAX_PART_BYTES = 50 * 1024 * 1024
MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


class DocumentError(ValueError):
    """The document could not be turned into text (message is safe to show)."""


def extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def extractable(filename: str) -> bool:
    return extension(filename) in EXTRACTABLE


def _xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    if zf.getinfo(name).file_size > MAX_PART_BYTES:
        raise DocumentError("this document is too large to read")
    return ET.fromstring(zf.read(name))


def _lines(root: ET.Element, para: str, text: str) -> List[str]:
    out = []
    for p in root.iter(para):
        line = "".join(t.text or "" for t in p.iter(text)).strip()
        if line:
            out.append(line)
    return out


def _docx(path: str) -> str:
    with zipfile.ZipFile(path) as zf:
        return "\n".join(_lines(_xml(zf, "word/document.xml"), W + "p", W + "t"))


def _pptx(path: str) -> str:
    with zipfile.ZipFile(path) as zf:
        number = lambda name: int(re.search(r"(\d+)\.xml$", name).group(1))
        slides = sorted((n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=number)
        parts = [f"[Slide {number(n)}]\n" + "\n".join(_lines(_xml(zf, n), A + "p", A + "t")) for n in slides]
    return "\n\n".join(parts)


def _pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        raise DocumentError("PDF reading needs the pypdf package: run 'pip install pypdf'") from None
    try:
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise DocumentError("this PDF is password protected")
        pages = []
        for number, page in enumerate(reader.pages[:300], start=1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append(f"[Page {number}]\n{text}")
        return "\n\n".join(pages)
    except DocumentError:
        raise
    except Exception as exc:  # pypdf raises many different errors on damaged files
        raise DocumentError("could not read this PDF") from exc


def extract_text(path: str, ext: str) -> str:
    try:
        if ext == "pdf":
            return _pdf(path)
        if ext == "docx":
            return _docx(path)
        if ext == "pptx":
            return _pptx(path)
        if ext in TEXT_EXT:
            with open(path, "rb") as fh:
                return fh.read(MAX_TEXT_FILE_BYTES).decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise DocumentError(f"could not read this .{ext} file (is it damaged, or an old format?)") from exc
    raise DocumentError(f".{ext} files can't be read by the assistant")


def fit_documents(docs: List[Tuple[str, str]], total_chars: int = 90_000) -> Tuple[List[Tuple[str, str]], List[str]]:
    """Share a character budget between documents; report what was cut."""
    if not docs:
        return [], []
    per_doc, out, notes = total_chars // len(docs), [], []
    for name, text in docs:
        if len(text) > per_doc:
            text = text[:per_doc]
            notes.append(f"{name}: only the first {per_doc:,} characters were sent to the assistant")
        out.append((name, text))
    return out, notes
