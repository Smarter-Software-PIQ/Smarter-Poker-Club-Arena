#!/usr/bin/env python3
"""Bind a locally exported Docker tag and store-native ID to its OCI config."""
import hashlib
import json
import re
import sys
import tarfile

DIGEST = r"sha256:[0-9a-f]{64}"
TAG = r"club-arena-prestage:[1-9][0-9]*-[1-9][0-9]*"
METADATA_LIMIT = 2 * 1024 * 1024


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha256(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def config_identity(stream, tag, native_id):
    require(re.fullmatch(TAG, tag) and re.fullmatch(DIGEST, native_id), "invalid transport coordinates")
    objects = {}
    records = None
    with tarfile.open(fileobj=stream, mode="r|*") as archive:
        for member in archive:
            name = member.name.removeprefix("./")
            if not member.isfile() or member.size > METADATA_LIMIT:
                continue
            is_image_metadata = re.fullmatch(r"(?:blobs/sha256/[0-9a-f]{64}|[0-9a-f]{64}\.json)", name)
            if name != "manifest.json" and not is_image_metadata:
                continue
            raw = archive.extractfile(member).read()
            if name == "manifest.json":
                require(records is None, "duplicate Docker manifest")
                records = json.loads(raw)
            elif raw.lstrip().startswith(b"{"):
                digest = sha256(raw)
                require(name in (digest[7:] + ".json", "blobs/sha256/" + digest[7:]), "content digest mismatch")
                require(digest not in objects and len(objects) < 32, "ambiguous or excessive metadata")
                objects[digest] = json.loads(raw)
    require(isinstance(records, list) and len(records) == 1, "expected one exported image")
    record = records[0]
    require(record.get("RepoTags") in ([tag], ["docker.io/library/" + tag]), "unexpected exported tag")
    path = record["Config"]
    match = re.fullmatch(r"(?:blobs/sha256/([0-9a-f]{64})|([0-9a-f]{64})\.json)", path)
    require(match, "invalid config reference")
    config = "sha256:" + (match[1] or match[2])
    rootfs = objects[config]["rootfs"]
    layers = rootfs["diff_ids"]
    require(rootfs["type"] == "layers" and layers and all(re.fullmatch(DIGEST, value) for value in layers)
            and len(layers) == len(record["Layers"]), "invalid image rootfs")
    if native_id != config:
        # The containerd image store uses the manifest ID. Its config must
        # identify precisely the same bytes and uncompressed rootfs layers.
        manifest = objects[native_id]
        require(manifest["schemaVersion"] == 2 and manifest["config"]["digest"] == config
                and len(manifest["layers"]) == len(layers), "native manifest does not bind the config")
    return config


if __name__ == "__main__":
    try:
        print(config_identity(sys.stdin.buffer, *sys.argv[1:]))
    except (KeyError, TypeError, ValueError, OSError, tarfile.TarError) as error:
        sys.exit(f"Engine transport proof refused: {error}")
