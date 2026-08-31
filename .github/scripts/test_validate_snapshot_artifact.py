#!/usr/bin/env python3

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("validate_snapshot_artifact.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("snapshot_validator", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

SHA = "a" * 40
VERSION = f"0.0.0-snapshot-{SHA}-20260720123456"


def tar_bytes(
    members: list[dict[str, object]],
    *,
    format: int = tarfile.PAX_FORMAT,
    global_pax_headers: dict[str, str] | None = None,
) -> bytes:
    output = io.BytesIO()
    with tarfile.open(
        fileobj=output,
        mode="w",
        format=format,
        pax_headers=global_pax_headers,
    ) as archive:
        for value in members:
            name = str(value["name"])
            data = bytes(value.get("data", b""))
            info = tarfile.TarInfo(name)
            info.type = bytes(value.get("type", tarfile.REGTYPE))
            info.mode = int(value.get("mode", 0o644))
            info.linkname = str(value.get("linkname", ""))
            info.pax_headers = dict(value.get("pax_headers", {}))
            if info.type == tarfile.DIRTYPE:
                info.size = 0
                archive.addfile(info)
            else:
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data) if data else None)
    return output.getvalue()


def package_json(
    *,
    name: str = validator.PACKAGE_NAME,
    version: str = VERSION,
    private: bool = False,
    publish_config: object | None = None,
) -> bytes:
    value: dict[str, object] = {"name": name, "version": version}
    if private:
        value["private"] = True
    if publish_config is not None:
        value["publishConfig"] = publish_config
    return json.dumps(value, separators=(",", ":")).encode()


def valid_members(**manifest_options: object) -> list[dict[str, object]]:
    return [
        {"name": "package/package.json", "data": package_json(**manifest_options)},
        {"name": "package/dist/index.mjs", "data": b"export {};\n"},
    ]


class ArtifactFixture:
    def __init__(
        self,
        root: Path,
        *,
        raw_tar: bytes | None = None,
        archive: bytes | None = None,
        metadata_version: str = VERSION,
        metadata_sha: str = SHA,
        metadata_overrides: dict[str, object] | None = None,
    ):
        self.directory = root / "artifact"
        self.directory.mkdir()
        self.tarball = self.directory / validator.TARBALL_NAME
        self.metadata = self.directory / validator.METADATA_NAME
        payload = archive if archive is not None else gzip.compress(raw_tar or tar_bytes(valid_members()))
        self.tarball.write_bytes(payload)
        value: dict[str, object] = {
            "sha": metadata_sha,
            "packageName": validator.PACKAGE_NAME,
            "version": metadata_version,
            "filename": validator.TARBALL_NAME,
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
        if metadata_overrides:
            value.update(metadata_overrides)
        self.metadata.write_text(json.dumps(value), encoding="utf-8")

    def validate(self, sha: str = SHA) -> tuple[str, str]:
        return validator.validate(self.tarball, self.metadata, sha)


class SnapshotArtifactValidatorTests(unittest.TestCase):
    def fixture(self, **options: object) -> tuple[tempfile.TemporaryDirectory[str], ArtifactFixture]:
        temporary = tempfile.TemporaryDirectory()
        return temporary, ArtifactFixture(Path(temporary.name), **options)

    def assert_rejected(self, fixture: ArtifactFixture, pattern: str | None = None) -> None:
        with self.assertRaises(validator.ValidationError) as caught:
            fixture.validate()
        if pattern:
            self.assertIn(pattern, str(caught.exception))

    def test_accepts_a_minimal_yarn_style_package_and_emits_canonical_outputs(self) -> None:
        temporary, fixture = self.fixture()
        self.addCleanup(temporary.cleanup)
        self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))
        output = Path(temporary.name) / "github-output"
        result = validator.main(
            [
                "--tarball",
                str(fixture.tarball),
                "--metadata",
                str(fixture.metadata),
                "--authorized-sha",
                SHA,
                "--github-output",
                str(output),
            ]
        )
        self.assertEqual(result, 0)
        self.assertEqual(
            output.read_text(encoding="utf-8"),
            f"package_name={validator.PACKAGE_NAME}\nversion={VERSION}\n",
        )

    def test_rejects_malformed_gzip_tar_metadata_and_package_json(self) -> None:
        cases = {
            "gzip": {"archive": b"not gzip"},
            "tar": {"archive": gzip.compress(b"not tar" + bytes(1024))},
            "metadata": {},
            "package": {"raw_tar": tar_bytes([{"name": "package/package.json", "data": b"{"}])},
        }
        for name, options in cases.items():
            with self.subTest(name=name):
                temporary, fixture = self.fixture(**options)
                try:
                    if name == "metadata":
                        fixture.metadata.write_bytes(b"{")
                    self.assert_rejected(fixture)
                finally:
                    temporary.cleanup()

    def test_rejects_missing_and_duplicate_package_manifests(self) -> None:
        cases = [
            [{"name": "package/index.js", "data": b""}],
            [
                {"name": "package/package.json", "data": package_json()},
                {"name": "package/package.json", "data": package_json()},
            ],
        ]
        for members in cases:
            temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
            try:
                self.assert_rejected(fixture, "package/package.json")
            finally:
                temporary.cleanup()

    def test_rejects_unsafe_paths_and_npmrc_at_any_depth_or_case(self) -> None:
        names = [
            "/package/file.js",
            "package\\file.js",
            "package/../file.js",
            "package/./file.js",
            "other/file.js",
            "package/.npmrc",
            "package/nested/.NPMRC",
            "package/" + "a" * (validator.MAX_PATH_BYTES + 1),
        ]
        for name in names:
            with self.subTest(name=name):
                members = valid_members() + [{"name": name, "data": b"x"}]
                temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
                try:
                    self.assert_rejected(fixture)
                finally:
                    temporary.cleanup()

    def test_rejects_links_devices_fifo_sparse_and_unknown_types(self) -> None:
        types = [
            tarfile.SYMTYPE,
            tarfile.LNKTYPE,
            tarfile.CHRTYPE,
            tarfile.BLKTYPE,
            tarfile.FIFOTYPE,
            tarfile.GNUTYPE_SPARSE,
            b"Z",
        ]
        for member_type in types:
            with self.subTest(member_type=member_type):
                members = valid_members() + [
                    {"name": "package/hostile", "type": member_type, "data": b""}
                ]
                temporary, fixture = self.fixture(
                    raw_tar=tar_bytes(members, format=tarfile.GNU_FORMAT)
                )
                try:
                    self.assert_rejected(fixture)
                finally:
                    temporary.cleanup()

    def test_rejects_sparse_pax_metadata(self) -> None:
        members = valid_members() + [
            {
                "name": "package/sparse",
                "data": b"x",
                "pax_headers": {"GNU.sparse.map": "0,1"},
            }
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        self.addCleanup(temporary.cleanup)
        self.assert_rejected(fixture, "sparse")

    def test_rejects_compressed_metadata_member_and_cumulative_size_overages(self) -> None:
        temporary, fixture = self.fixture()
        try:
            fixture.tarball.write_bytes(b"x" * (validator.MAX_COMPRESSED_BYTES + 1))
            self.assert_rejected(fixture, "tarball exceeds")
        finally:
            temporary.cleanup()

        temporary, fixture = self.fixture()
        try:
            with fixture.tarball.open("wb") as stream:
                stream.truncate(validator.MAX_COMPRESSED_BYTES)
            self.assertEqual(
                validator._regular_file_size(
                    fixture.tarball,
                    validator.MAX_COMPRESSED_BYTES,
                    "tarball",
                ),
                validator.MAX_COMPRESSED_BYTES,
            )
        finally:
            temporary.cleanup()

        temporary, fixture = self.fixture()
        try:
            metadata = fixture.metadata.read_bytes()
            fixture.metadata.write_bytes(
                metadata + b" " * (validator.MAX_METADATA_BYTES - len(metadata))
            )
            self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))
        finally:
            temporary.cleanup()

        temporary, fixture = self.fixture()
        try:
            fixture.metadata.write_bytes(b" " * (validator.MAX_METADATA_BYTES + 1))
            self.assert_rejected(fixture, "metadata exceeds")
        finally:
            temporary.cleanup()

        base_members = valid_members()
        base_bytes = sum(len(bytes(member.get("data", b""))) for member in base_members)
        remaining = validator.MAX_REGULAR_BYTES - base_bytes
        exact_cumulative_members = base_members + [
            {
                "name": f"package/exact-cumulative-{index}",
                "data": bytes(min(validator.MAX_MEMBER_BYTES, remaining - index * validator.MAX_MEMBER_BYTES)),
            }
            for index in range(5)
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(exact_cumulative_members))
        try:
            self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))
        finally:
            temporary.cleanup()

        members = valid_members() + [
            {"name": "package/large", "data": bytes(validator.MAX_MEMBER_BYTES + 1)}
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        try:
            self.assert_rejected(fixture, "regular member")
        finally:
            temporary.cleanup()

        members = valid_members() + [
            {"name": f"package/large-{index}", "data": bytes(9 * 1024 * 1024)}
            for index in range(6)
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        try:
            self.assert_rejected(fixture, "cumulative")
        finally:
            temporary.cleanup()

        padded_manifest = package_json() + b" " * validator.MAX_PACKAGE_JSON_BYTES
        temporary, fixture = self.fixture(
            raw_tar=tar_bytes([{"name": "package/package.json", "data": padded_manifest}])
        )
        try:
            self.assert_rejected(fixture, "package/package.json exceeds")
        finally:
            temporary.cleanup()

    def test_accepts_a_regular_member_at_the_exact_member_size_boundary(self) -> None:
        members = valid_members() + [
            {"name": "package/exact", "data": bytes(validator.MAX_MEMBER_BYTES)}
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        self.addCleanup(temporary.cleanup)
        self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))

    def test_accepts_package_json_and_path_at_their_exact_boundaries(self) -> None:
        manifest = package_json()
        manifest += b" " * (validator.MAX_PACKAGE_JSON_BYTES - len(manifest))
        exact_path = "package/" + "a" * (validator.MAX_PATH_BYTES - len("package/"))
        members = [
            {"name": "package/package.json", "data": manifest},
            {"name": exact_path, "data": b"x"},
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        self.addCleanup(temporary.cleanup)
        self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))

    def test_rejects_too_many_physical_headers(self) -> None:
        exact_members = valid_members() + [
            {"name": f"package/empty-{index}", "data": b""}
            for index in range(validator.MAX_PHYSICAL_HEADERS - len(valid_members()))
        ]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(exact_members))
        try:
            self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))
        finally:
            temporary.cleanup()

        members = exact_members + [{"name": "package/one-too-many", "data": b""}]
        temporary, fixture = self.fixture(raw_tar=tar_bytes(members))
        self.addCleanup(temporary.cleanup)
        self.assert_rejected(fixture, "physical headers")

    def test_guards_gnu_extension_body_at_the_exact_boundary(self) -> None:
        exact_name = "package/" + "x" * (validator.MAX_EXTENSION_BYTES - len("package/") - 1)
        over_name = exact_name + "x"
        temporary, fixture = self.fixture(
            raw_tar=tar_bytes(
                valid_members() + [{"name": exact_name, "data": b""}],
                format=tarfile.GNU_FORMAT,
            )
        )
        try:
            with self.assertRaises(validator.ValidationError) as caught:
                fixture.validate()
            self.assertIn("unsafe archive path", str(caught.exception))
            self.assertNotIn("tar extension exceeds", str(caught.exception))
        finally:
            temporary.cleanup()

        temporary, fixture = self.fixture(
            raw_tar=tar_bytes(
                valid_members() + [{"name": over_name, "data": b""}],
                format=tarfile.GNU_FORMAT,
            )
        )
        try:
            self.assert_rejected(fixture, "tar extension exceeds")
        finally:
            temporary.cleanup()

    def test_rejects_oversized_pax_global_pax_and_gnu_longname_extensions(self) -> None:
        cases = [
            tar_bytes(
                valid_members()
                + [{"name": "package/pax", "data": b"", "pax_headers": {"comment": "x" * 70_000}}]
            ),
            tar_bytes(valid_members(), global_pax_headers={"comment": "x" * 70_000}),
            tar_bytes(
                valid_members() + [{"name": "package/" + "x" * 70_000, "data": b""}],
                format=tarfile.GNU_FORMAT,
            ),
            tar_bytes(
                valid_members()
                + [
                    {
                        "name": "package/link",
                        "type": tarfile.SYMTYPE,
                        "linkname": "x" * 70_000,
                        "data": b"",
                    }
                ],
                format=tarfile.GNU_FORMAT,
            ),
        ]
        # The final case covers the link type itself; the first three exercise
        # physical x/g/L extension guards before tarfile consumes their bodies.
        for raw_tar in cases:
            temporary, fixture = self.fixture(raw_tar=raw_tar)
            try:
                self.assert_rejected(fixture)
            finally:
                temporary.cleanup()

    def test_rejects_expanded_stream_overage_and_bad_tar_termination(self) -> None:
        base = tar_bytes(valid_members())
        exact_expanded = base + bytes(validator.MAX_EXPANDED_BYTES - len(base))
        temporary, fixture = self.fixture(archive=gzip.compress(exact_expanded))
        try:
            self.assertEqual(fixture.validate(), (validator.PACKAGE_NAME, VERSION))
        finally:
            temporary.cleanup()

        expanded = base + bytes(validator.MAX_EXPANDED_BYTES)
        cases = [
            gzip.compress(expanded),
            gzip.compress(base + tar_bytes(valid_members())),
            gzip.compress(base + b"X" * 512),
            gzip.compress(base) + gzip.compress(base),
            gzip.compress(base)[:-4],
        ]
        for archive in cases:
            temporary, fixture = self.fixture(archive=archive)
            try:
                self.assert_rejected(fixture)
            finally:
                temporary.cleanup()

    def test_rejects_extra_entries_directories_and_symlinked_inputs(self) -> None:
        temporary, fixture = self.fixture()
        try:
            (fixture.directory / "extra").write_text("x", encoding="utf-8")
            self.assert_rejected(fixture, "exactly")
        finally:
            temporary.cleanup()

        temporary, fixture = self.fixture()
        try:
            (fixture.directory / "extra").mkdir()
            self.assert_rejected(fixture, "exactly")
        finally:
            temporary.cleanup()

        if hasattr(os, "symlink"):
            temporary, fixture = self.fixture()
            try:
                fixture.tarball.unlink()
                try:
                    os.symlink(fixture.metadata, fixture.tarball)
                except OSError:
                    self.skipTest("symlinks are unavailable for this user")
                self.assert_rejected(fixture)
            finally:
                temporary.cleanup()

    def test_rejects_digest_sha_metadata_shape_and_package_identity_mismatches(self) -> None:
        cases = [
            ({"sha256": "0" * 64}, None, SHA),
            ({}, None, "b" * 40),
            ({"packageName": "other"}, None, SHA),
            ({"filename": "other.tgz"}, None, SHA),
            ({"extra": "field"}, None, SHA),
            ({}, {"name": "other"}, SHA),
            ({}, {"private": True}, SHA),
        ]
        for overrides, manifest_options, authorized_sha in cases:
            temporary = tempfile.TemporaryDirectory()
            try:
                raw_tar = tar_bytes(valid_members(**(manifest_options or {})))
                fixture = ArtifactFixture(
                    Path(temporary.name),
                    raw_tar=raw_tar,
                    metadata_overrides=overrides,
                )
                with self.assertRaises(validator.ValidationError):
                    fixture.validate(authorized_sha)
            finally:
                temporary.cleanup()

    def test_rejects_every_publish_config_object_including_proxy_and_tls_fields(self) -> None:
        values = [
            {},
            {"registry": "https://registry.npmjs.org/"},
            {"proxy": "http://example.invalid"},
            {"https-proxy": "http://example.invalid"},
            {"ca": "attacker"},
            {"strict-ssl": False},
        ]
        for publish_config in values:
            with self.subTest(publish_config=publish_config):
                temporary, fixture = self.fixture(
                    raw_tar=tar_bytes(valid_members(publish_config=publish_config))
                )
                try:
                    self.assert_rejected(fixture, "publishConfig")
                finally:
                    temporary.cleanup()

    def test_rejects_noncanonical_snapshot_versions(self) -> None:
        versions = [
            "1.0.0-snapshot-20260720123456",
            "0.0.0-snapshot",
            "0.0.0-next-20260720123456",
            "0.0.0-snapshot-20260720",
            "0.0.0-snapshot-2026072012345x",
            "0.0.0-snapshot-20260720123456-extra",
            "0.0.0-snapshot-20260720123456+build",
            f"0.0.0-snapshot-{'b' * 39}-20260720123456",
            f"0.0.0-snapshot-{'b' * 41}-20260720123456",
        ]
        for version in versions:
            with self.subTest(version=version):
                temporary, fixture = self.fixture(
                    raw_tar=tar_bytes(valid_members(version=version)),
                    metadata_version=version,
                )
                try:
                    self.assert_rejected(fixture)
                finally:
                    temporary.cleanup()

    def test_rejects_snapshot_version_for_another_commit(self) -> None:
        version = f"0.0.0-snapshot-{'b' * 40}-20260720123456"
        temporary, fixture = self.fixture(
            raw_tar=tar_bytes(valid_members(version=version)),
            metadata_version=version,
        )
        self.addCleanup(temporary.cleanup)
        self.assert_rejected(fixture, "authorized commit")

    def test_does_not_emit_outputs_after_a_failed_invariant(self) -> None:
        temporary, fixture = self.fixture(metadata_overrides={"sha256": "0" * 64})
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / "github-output"
        self.assertEqual(
            validator.main(
                [
                    "--tarball",
                    str(fixture.tarball),
                    "--metadata",
                    str(fixture.metadata),
                    "--authorized-sha",
                    SHA,
                    "--github-output",
                    str(output),
                ]
            ),
            1,
        )
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
