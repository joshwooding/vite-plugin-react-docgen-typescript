#!/usr/bin/env python3
"""Validate an untrusted snapshot package without extracting or executing it."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import zlib


PACKAGE_NAME = "@joshwooding/vite-plugin-react-docgen-typescript"
TARBALL_NAME = "package.tgz"
METADATA_NAME = "metadata.json"

MAX_COMPRESSED_BYTES = 25 * 1024 * 1024
MAX_METADATA_BYTES = 8 * 1024
MAX_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_PHYSICAL_HEADERS = 5_000
MAX_MEMBER_BYTES = 10 * 1024 * 1024
MAX_REGULAR_BYTES = 50 * 1024 * 1024
MAX_EXTENSION_BYTES = 64 * 1024
MAX_PACKAGE_JSON_BYTES = 256 * 1024
MAX_PATH_BYTES = 512

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SNAPSHOT_VERSION_RE = re.compile(
    r"^0\.0\.0-snapshot-(?P<commit>[0-9a-f]{40})-(?P<datetime>\d{14})$"
)
SEMVER_RE = re.compile(
    r"^(?:0|[1-9]\d*)\."
    r"(?:0|[1-9]\d*)\."
    r"(?:0|[1-9]\d*)"
    r"(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

_ZERO_BLOCK = bytes(512)
_EXTENSION_TYPES = {b"x", b"g", b"L", b"K"}
_SPARSE_PAX_PREFIXES = ("GNU.sparse", "SCHILY.realsize")


class ValidationError(Exception):
    """The downloaded artifact violated a required invariant."""


def _regular_file_size(path: Path, maximum: int, label: str) -> int:
    try:
        info = path.lstat()
    except OSError as error:
        raise ValidationError(f"cannot inspect {label}: {error}") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ValidationError(f"{label} must be a non-symlink regular file")
    if info.st_size > maximum:
        raise ValidationError(f"{label} exceeds {maximum} bytes")
    return info.st_size


def _validate_download_directory(tarball: Path, metadata: Path) -> None:
    if tarball.name != TARBALL_NAME or metadata.name != METADATA_NAME:
        raise ValidationError("artifact inputs must use the fixed basenames")
    if tarball.parent != metadata.parent:
        raise ValidationError("artifact inputs must share one download directory")
    try:
        directory_info = tarball.parent.lstat()
        entries = list(tarball.parent.iterdir())
    except OSError as error:
        raise ValidationError(f"cannot inspect artifact directory: {error}") from error
    if stat.S_ISLNK(directory_info.st_mode) or not stat.S_ISDIR(directory_info.st_mode):
        raise ValidationError("artifact directory must be a non-symlink directory")
    if {entry.name for entry in entries} != {TARBALL_NAME, METADATA_NAME} or len(entries) != 2:
        raise ValidationError("artifact directory must contain exactly package.tgz and metadata.json")
    _regular_file_size(tarball, MAX_COMPRESSED_BYTES, "tarball")
    _regular_file_size(metadata, MAX_METADATA_BYTES, "metadata")


def _load_metadata(path: Path, authorized_sha: str) -> dict[str, str]:
    if not SHA_RE.fullmatch(authorized_sha):
        raise ValidationError("authorized SHA must be 40 lowercase hexadecimal characters")
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"metadata is not valid UTF-8 JSON: {error}") from error
    if not isinstance(value, dict):
        raise ValidationError("metadata must be a JSON object")
    required = {"sha", "packageName", "version", "filename", "sha256"}
    if set(value) != required or any(not isinstance(value[key], str) for key in required):
        raise ValidationError("metadata must contain only the five canonical string fields")
    if value["sha"] != authorized_sha:
        raise ValidationError("metadata SHA does not match the authorized pull request SHA")
    if value["packageName"] != PACKAGE_NAME or value["filename"] != TARBALL_NAME:
        raise ValidationError("metadata package identity is not allowlisted")
    if not re.fullmatch(r"[0-9a-f]{64}", value["sha256"]):
        raise ValidationError("metadata digest is not lowercase SHA-256")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class _BoundedSingleGzip(io.RawIOBase):
    """Incrementally decompress exactly one gzip member under a hard byte cap."""

    def __init__(self, path: Path):
        self._stream = path.open("rb")
        self._decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
        self._compressed = b""
        self._output = bytearray()
        self._expanded = 0
        self._input_eof = False
        self._finished = False

    def readable(self) -> bool:
        return True

    def close(self) -> None:
        self._stream.close()
        super().close()

    def _fill(self, requested: int) -> None:
        while len(self._output) < requested and not self._finished:
            if not self._compressed and not self._input_eof:
                self._compressed = self._stream.read(64 * 1024)
                if not self._compressed:
                    self._input_eof = True

            if self._input_eof and not self._compressed:
                if not self._decoder.eof:
                    raise ValidationError("gzip stream is truncated")
                self._finished = True
                break

            remaining = MAX_EXPANDED_BYTES - self._expanded
            if remaining <= 0:
                raise ValidationError(f"expanded tar stream exceeds {MAX_EXPANDED_BYTES} bytes")
            try:
                produced = self._decoder.decompress(self._compressed, remaining)
            except zlib.error as error:
                raise ValidationError(f"invalid gzip stream: {error}") from error
            self._compressed = self._decoder.unconsumed_tail
            if self._decoder.unused_data:
                raise ValidationError("compressed bytes or a concatenated gzip member follow the first member")
            self._expanded += len(produced)
            self._output.extend(produced)

            if self._decoder.eof:
                trailing = self._compressed or self._stream.read(1)
                if trailing:
                    raise ValidationError("compressed bytes or a concatenated gzip member follow the first member")
                self._compressed = b""
                self._input_eof = True
                self._finished = True
            elif not produced and self._input_eof and not self._compressed:
                raise ValidationError("gzip stream is truncated")

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunks = [bytes(self._output)]
            self._output.clear()
            while not self._finished:
                self._fill(64 * 1024)
                chunks.append(bytes(self._output))
                self._output.clear()
            return b"".join(chunks)
        if size == 0:
            return b""
        self._fill(size)
        result = bytes(self._output[:size])
        del self._output[:size]
        return result


def _parse_tar_size(field: bytes) -> int:
    if len(field) != 12:
        raise ValidationError("invalid tar size field")
    if field[0] & 0x80:
        value = int.from_bytes(bytes([field[0] & 0x7F]) + field[1:], "big")
    else:
        stripped = field.strip(b" \0")
        if not stripped:
            return 0
        if any(byte < ord("0") or byte > ord("7") for byte in stripped):
            raise ValidationError("invalid tar size encoding")
        value = int(stripped, 8)
    if value < 0:
        raise ValidationError("negative tar member size")
    return value


class _GuardedTarStream(io.RawIOBase):
    """Validate physical tar headers before exposing their bodies to tarfile."""

    def __init__(self, source: _BoundedSingleGzip):
        self._source = source
        self._output = bytearray()
        self._body_blocks = 0
        self._header_count = 0
        self._zero_blocks = 0
        self._after_eof = False
        self._source_eof = False

    @property
    def header_count(self) -> int:
        return self._header_count

    def readable(self) -> bool:
        return True

    def _next_block(self) -> None:
        block = self._source.read(512)
        if not block:
            self._source_eof = True
            if not self._after_eof:
                raise ValidationError("tar stream is missing its two-block end marker")
            return
        if len(block) != 512:
            raise ValidationError("tar stream ends with a partial physical block")

        if self._after_eof:
            if block != _ZERO_BLOCK:
                raise ValidationError("a second archive or non-zero data follows tar EOF")
        elif self._body_blocks:
            self._body_blocks -= 1
        elif block == _ZERO_BLOCK:
            self._zero_blocks += 1
            if self._zero_blocks == 2:
                self._after_eof = True
        else:
            if self._zero_blocks:
                raise ValidationError("a non-zero header follows an incomplete tar EOF marker")
            self._header_count += 1
            if self._header_count > MAX_PHYSICAL_HEADERS:
                raise ValidationError(f"tar stream exceeds {MAX_PHYSICAL_HEADERS} physical headers")
            member_size = _parse_tar_size(block[124:136])
            type_flag = block[156:157] or b"\0"
            if type_flag in _EXTENSION_TYPES and member_size > MAX_EXTENSION_BYTES:
                raise ValidationError(f"tar extension exceeds {MAX_EXTENSION_BYTES} bytes")
            self._body_blocks = (member_size + 511) // 512
        self._output.extend(block)

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            while not self._source_eof:
                self._next_block()
            result = bytes(self._output)
            self._output.clear()
            return result
        if size == 0:
            return b""
        while len(self._output) < size and not self._source_eof:
            self._next_block()
        result = bytes(self._output[:size])
        del self._output[:size]
        return result

    def drain(self) -> None:
        while self.read(64 * 1024):
            pass


def _validate_member_path(name: str) -> None:
    try:
        encoded = name.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValidationError("archive path is not valid UTF-8") from error
    if not name or len(encoded) > MAX_PATH_BYTES or "\\" in name or name.startswith("/"):
        raise ValidationError(f"unsafe archive path: {name!r}")
    parts = name.rstrip("/").split("/")
    if not parts or parts[0] != "package" or any(part in {"", ".", ".."} for part in parts):
        raise ValidationError(f"archive path escapes the package root: {name!r}")
    if PurePosixPath(name).is_absolute() or any(part.casefold() == ".npmrc" for part in parts):
        raise ValidationError(f"forbidden archive path: {name!r}")


def _validate_version(version: object, authorized_sha: str | None = None) -> str:
    if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
        raise ValidationError("package version is not valid SemVer 2.0")
    match = SNAPSHOT_VERSION_RE.fullmatch(version)
    if not match:
        raise ValidationError("package version is not an allowlisted snapshot version")
    if authorized_sha is not None and match.group("commit") != authorized_sha:
        raise ValidationError("package version does not match the authorized commit")
    return version


def _validate_tarball(path: Path, expected_version: str) -> tuple[str, str]:
    package_json: dict[str, object] | None = None
    regular_bytes = 0
    gzip_stream = _BoundedSingleGzip(path)
    guarded_stream = _GuardedTarStream(gzip_stream)
    try:
        try:
            archive = tarfile.open(fileobj=guarded_stream, mode="r|")
            with archive:
                for member in archive:
                    _validate_member_path(member.name)
                    if any(key.startswith(_SPARSE_PAX_PREFIXES) for key in member.pax_headers):
                        raise ValidationError("sparse PAX metadata is forbidden")
                    if member.type == tarfile.GNUTYPE_SPARSE:
                        raise ValidationError("GNU sparse members are forbidden")
                    if not (member.isfile() or member.isdir()):
                        raise ValidationError(f"forbidden tar member type for {member.name!r}")
                    if member.isdir():
                        continue
                    if member.size > MAX_MEMBER_BYTES:
                        raise ValidationError(f"regular member exceeds {MAX_MEMBER_BYTES} bytes")
                    regular_bytes += member.size
                    if regular_bytes > MAX_REGULAR_BYTES:
                        raise ValidationError(f"regular members exceed {MAX_REGULAR_BYTES} cumulative bytes")
                    if member.name == "package/package.json":
                        if package_json is not None:
                            raise ValidationError("package/package.json occurs more than once")
                        if member.size > MAX_PACKAGE_JSON_BYTES:
                            raise ValidationError("package/package.json exceeds its size cap")
                        extracted = archive.extractfile(member)
                        if extracted is None:
                            raise ValidationError("package/package.json cannot be streamed")
                        raw = extracted.read(MAX_PACKAGE_JSON_BYTES + 1)
                        if len(raw) != member.size:
                            raise ValidationError("package/package.json size does not match its header")
                        try:
                            parsed = json.loads(raw)
                        except (UnicodeDecodeError, json.JSONDecodeError) as error:
                            raise ValidationError(f"package/package.json is invalid UTF-8 JSON: {error}") from error
                        if not isinstance(parsed, dict):
                            raise ValidationError("package/package.json must be an object")
                        package_json = parsed
        except (tarfile.TarError, OSError) as error:
            raise ValidationError(f"invalid tar stream: {error}") from error
        guarded_stream.drain()
    finally:
        gzip_stream.close()

    if package_json is None:
        raise ValidationError("package/package.json is missing")
    if package_json.get("name") != PACKAGE_NAME:
        raise ValidationError("package name is not allowlisted")
    version = _validate_version(package_json.get("version"))
    if version != expected_version:
        raise ValidationError("package version does not match metadata")
    if package_json.get("private") is True:
        raise ValidationError("private packages cannot be published")
    if "publishConfig" in package_json:
        raise ValidationError("publishConfig is forbidden in snapshot artifacts")
    return PACKAGE_NAME, version


def validate(tarball: Path, metadata_path: Path, authorized_sha: str) -> tuple[str, str]:
    _validate_download_directory(tarball, metadata_path)
    metadata = _load_metadata(metadata_path, authorized_sha)
    if _sha256(tarball) != metadata["sha256"]:
        raise ValidationError("tarball digest does not match metadata")
    expected_version = _validate_version(metadata["version"], authorized_sha)
    return _validate_tarball(tarball, expected_version)


def _append_outputs(path: Path, package_name: str, version: str) -> None:
    with path.open("a", encoding="utf-8", newline="\n") as output:
        output.write(f"package_name={package_name}\n")
        output.write(f"version={version}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tarball", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--authorized-sha", required=True)
    parser.add_argument("--github-output", type=Path)
    arguments = parser.parse_args(argv)
    try:
        package_name, version = validate(
            arguments.tarball,
            arguments.metadata,
            arguments.authorized_sha,
        )
        if arguments.github_output is not None:
            _append_outputs(arguments.github_output, package_name, version)
    except ValidationError as error:
        print(f"snapshot artifact rejected: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
