import hashlib
import base64
import json
import os
import sys
import zipfile


def safe_rel_path(entry_name: str) -> str | None:
    if not entry_name or "\x00" in entry_name:
        return None
    norm = entry_name.replace("\\", "/").lstrip("/")
    if not norm or norm.endswith("/"):
        return None
    parts = norm.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    if parts[0] == "__MACOSX" or parts[-1] == ".DS_Store":
        return None
    return "/".join(parts)


def confined_target(base_dir: str, rel_path: str) -> str | None:
    base_real = os.path.realpath(base_dir)
    target = os.path.realpath(os.path.join(base_real, *rel_path.split("/")))
    if not target.startswith(base_real + os.sep):
        return None
    return target


def extract_apk(apk_path: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    index = []
    extracted_bytes = 0
    # Cap extracted editable/inspectable source tree bytes at 300 MB while indexing all 1 GB entries
    max_extract_bytes = 300 * 1024 * 1024

    with zipfile.ZipFile(apk_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = safe_rel_path(info.filename)
            if not rel:
                continue

            index.append({
                "path": rel,
                "size": info.file_size,
                "compressedSize": info.compress_size,
            })

            is_manifest = rel == "AndroidManifest.xml"
            is_dex = rel.startswith("classes") and rel.endswith(".dex") and "/" not in rel
            is_assets = rel.startswith("assets/") and info.file_size <= 25 * 1024 * 1024
            is_res = rel.startswith("res/") and info.file_size <= 10 * 1024 * 1024 and (
                rel.endswith(".xml")
                or rel.endswith(".png")
                or rel.endswith(".jpg")
                or rel.endswith(".jpeg")
                or rel.endswith(".webp")
                or rel.endswith(".json")
                or rel.endswith(".txt")
            )
            # Also support source ZIPs
            is_source_zip_file = (
                rel.endswith(".xml")
                or rel.endswith(".java")
                or rel.endswith(".kt")
                or rel.endswith(".gradle")
                or rel.endswith(".properties")
                or rel.endswith(".html")
                or rel.endswith(".htm")
                or rel.endswith(".css")
                or rel.endswith(".js")
                or rel.endswith(".json")
            ) and info.file_size <= 15 * 1024 * 1024

            if not (is_manifest or is_dex or is_assets or is_res or is_source_zip_file):
                continue

            if extracted_bytes + info.file_size > max_extract_bytes:
                continue

            target = confined_target(out_dir, rel)
            if not target:
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info, "r") as src, open(target, "wb") as dst:
                while True:
                    chunk = src.read(1024 * 1024)
                    if not chunk:
                        break
                    dst.write(chunk)
            extracted_bytes += info.file_size

    with open(os.path.join(out_dir, "_apk_entries_index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)


def sha256_file_b64(file_path: str) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(4 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return base64.b64encode(h.digest()).decode("ascii")


def rebuild_apk(
    base_apk_path: str,
    www_dir: str,
    out_apk_path: str,
    patched_manifest_path: str,
    bridge_config_path: str,
    digests_out_path: str,
) -> None:
    os.makedirs(os.path.dirname(out_apk_path), exist_ok=True)

    with zipfile.ZipFile(base_apk_path, "r") as src_zip:
        src_names = [i.filename for i in src_zip.infolist() if not i.is_dir()]
        is_capacitor = any(n.startswith("assets/public/") for n in src_names)
        target_prefix = "assets/public/" if is_capacitor else "assets/www/"

        digests = []
        has_patched_manifest = bool(patched_manifest_path and os.path.isfile(patched_manifest_path))

        with zipfile.ZipFile(out_apk_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as dst_zip:
            # 1. Copy base entries excluding META-INF signatures and old web assets
            for info in src_zip.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if name.startswith("META-INF/") and (
                    name == "META-INF/MANIFEST.MF"
                    or name.upper().endswith((".SF", ".RSA", ".DSA", ".EC"))
                ):
                    continue
                if name.startswith("assets/www/") or (is_capacitor and name.startswith("assets/public/")):
                    continue
                if name == "assets/apkbridge-config.json":
                    continue
                if name == "AndroidManifest.xml" and has_patched_manifest:
                    continue

                # Preserve uncompressed storage for resources.arsc / .so libs when originally stored
                compress_type = (
                    zipfile.ZIP_STORED
                    if info.compress_type == zipfile.ZIP_STORED
                    else zipfile.ZIP_DEFLATED
                )
                h = hashlib.sha256()
                out_info = zipfile.ZipInfo(filename=name, date_time=info.date_time)
                out_info.compress_type = compress_type

                with src_zip.open(info, "r") as entry_src, dst_zip.open(out_info, "w") as entry_dst:
                    while True:
                        chunk = entry_src.read(4 * 1024 * 1024)
                        if not chunk:
                            break
                        h.update(chunk)
                        entry_dst.write(chunk)

                if not name.startswith("META-INF/"):
                    digests.append({
                        "name": name,
                        "sha256": base64.b64encode(h.digest()).decode("ascii"),
                    })

            # 2. Write patched AndroidManifest.xml if provided
            if has_patched_manifest:
                dst_zip.write(patched_manifest_path, "AndroidManifest.xml", compress_type=zipfile.ZIP_DEFLATED)
                digests.append({
                    "name": "AndroidManifest.xml",
                    "sha256": sha256_file_b64(patched_manifest_path),
                })

            # 3. Write connected website files into assets/www/ (or assets/public/)
            if os.path.isdir(www_dir):
                for root, _dirs, files in os.walk(www_dir):
                    for fname in sorted(files):
                        full = os.path.join(root, fname)
                        rel = os.path.relpath(full, www_dir).replace("\\", "/")
                        arc_name = f"{target_prefix}{rel}"
                        dst_zip.write(full, arc_name, compress_type=zipfile.ZIP_DEFLATED)
                        digests.append({
                            "name": arc_name,
                            "sha256": sha256_file_b64(full),
                        })

            # 4. Write bridge config JSON
            if bridge_config_path and os.path.isfile(bridge_config_path):
                dst_zip.write(
                    bridge_config_path,
                    "assets/apkbridge-config.json",
                    compress_type=zipfile.ZIP_DEFLATED,
                )
                digests.append({
                    "name": "assets/apkbridge-config.json",
                    "sha256": sha256_file_b64(bridge_config_path),
                })

    digests.sort(key=lambda d: d["name"])
    with open(digests_out_path, "w", encoding="utf-8") as f:
        json.dump(digests, f)


def append_meta_inf(apk_path: str, meta_dir: str) -> None:
    with zipfile.ZipFile(apk_path, "a", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname in ("MANIFEST.MF", "CERT.SF", "CERT.RSA"):
            fpath = os.path.join(meta_dir, fname)
            if os.path.isfile(fpath):
                zf.write(fpath, f"META-INF/{fname}")


def build_source_zip(source_dir: str, out_zip_path: str) -> None:
    os.makedirs(os.path.dirname(out_zip_path), exist_ok=True)
    with zipfile.ZipFile(out_zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, _dirs, files in os.walk(source_dir):
            for fname in sorted(files):
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, source_dir).replace("\\", "/")
                zf.write(full, rel)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "extract":
        extract_apk(sys.argv[2], sys.argv[3])
    elif cmd == "rebuild":
        rebuild_apk(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7])
    elif cmd == "append_meta":
        append_meta_inf(sys.argv[2], sys.argv[3])
    elif cmd == "zip_dir":
        build_source_zip(sys.argv[2], sys.argv[3])
    else:
        raise ValueError(f"Unknown command: {cmd}")
