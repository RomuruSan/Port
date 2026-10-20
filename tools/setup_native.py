#!/usr/bin/env python3
"""Prepare the pinned OpenHuey engine on Debian 13 without system-wide writes."""
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("PORT_CACHE_DIR", ROOT.parent / ".cache" / "port")).resolve()
COMMIT = "fa1da63a21169f35eaeb98005c15ed2e3246f2d6"
PACKAGES = ["libsdl3-dev=3.2.10+ds-1", "libsdl3-0=3.2.10+ds-1", "libsndio7.0=1.10.0-0.1"]


def run(args, **kwargs):
    print("+ " + " ".join(str(arg) for arg in args), flush=True)
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def main():
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "AMD64"):
        raise RuntimeError("Este instalador é para Linux x64. No Windows, extraia a distribuição Windows do OpenHuey e configure PORT_ENGINE_DIR. Consulte o README.")
    if platform.libc_ver()[0] != "glibc" or tuple(map(int, platform.libc_ver()[1].split(".")[:2])) < (2, 38):
        raise RuntimeError("Este instalador usa bibliotecas Debian 13 e exige glibc >= 2.38. Para outros sistemas, use a distribuição oficial ou compile o OpenHuey com o SDL3 do sistema.")
    for name in ("git", "cc", "dpkg-deb", "/usr/bin/apt-get"):
        if not shutil.which(name):
            raise RuntimeError(f"Pré-requisito ausente: {name}")
    CACHE.mkdir(parents=True, exist_ok=True)
    tools = CACHE / "tools"
    if not (tools / "bin" / "python").exists():
        venv.create(tools, with_pip=True)
    run([tools / "bin/python", "-m", "pip", "install", "--no-input", "--disable-pip-version-check", "--cache-dir", CACHE / "pip", "cmake==3.31.10", "ninja==1.13.0"])

    apt = CACHE / "apt"
    for part in ("empty", "lists/partial", "cache/archives/partial"):
        (apt / part).mkdir(parents=True, exist_ok=True)
    (apt / "sources.list").write_text("deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main\n")
    (apt / "apt.conf").write_text(
        f'Dir::Etc::parts "{apt / "empty"}";\n'
        'Dir::Etc::main "/dev/null";\n'
        f'Dir::Etc::sourcelist "{apt / "sources.list"}";\n'
        f'Dir::Etc::sourceparts "{apt / "empty"}";\n'
        f'Dir::State::lists "{apt / "lists"}";\n'
        f'Dir::Cache "{apt / "cache"}";\n'
    )
    apt_env = dict(os.environ, APT_CONFIG=str(apt / "apt.conf"))
    run(["/usr/bin/apt-get", "update"], env=apt_env)
    packages = CACHE / "packages"
    packages.mkdir(exist_ok=True)
    # APT authenticates the repository metadata and checks the packages' checksums.
    run(["/usr/bin/apt-get", "download", *PACKAGES], cwd=packages, env=apt_env)
    sysroot = CACHE / "sysroot"
    for name in ("libsdl3-dev_3.2.10+ds-1_amd64.deb", "libsdl3-0_3.2.10+ds-1_amd64.deb", "libsndio7.0_1.10.0-0.1_amd64.deb"):
        run(["dpkg-deb", "-x", packages / name, sysroot])

    source = CACHE / "OpenHuey"
    if not source.exists():
        run(["git", "clone", "--no-checkout", "--depth", "1", "https://github.com/ArnautDaniel/OpenHuey.git", source])
        run(["git", "-C", source, "fetch", "--depth", "1", "origin", COMMIT])
        run(["git", "-C", source, "checkout", "--detach", COMMIT])
    actual = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if actual != COMMIT:
        raise RuntimeError("O cache do OpenHuey está em outro commit. Ele foi preservado. Use um novo PORT_CACHE_DIR para instalar esta versão.")
    if subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD"]).returncode:
        raise RuntimeError("O código do motor no cache tem alterações. Elas foram preservadas; use um novo PORT_CACHE_DIR.")

    cmake = tools / "bin/cmake"
    native_build = CACHE / "build"
    lib = sysroot / "usr/lib/x86_64-linux-gnu"
    run([cmake, "-S", source / "openhuey-src", "-B", native_build, "-G", "Ninja",
         f"-DCMAKE_MAKE_PROGRAM={tools / 'bin/ninja'}", "-DCMAKE_BUILD_TYPE=RelWithDebInfo",
         f"-DCMAKE_PREFIX_PATH={sysroot / 'usr'}", f"-DCMAKE_BUILD_RPATH=$ORIGIN/lib;{lib}",
         f"-DCMAKE_EXE_LINKER_FLAGS=-Wl,--disable-new-dtags,-rpath-link,{lib}"])
    run([cmake, "--build", native_build, "--parallel", "4"])
    # These four upstream tests exercise the Forth language and actors without game data.
    run([tools / "bin/ctest", "--test-dir", native_build, "-R", "^test_", "--output-on-failure", "--parallel", "4"])

    engine = CACHE / "engine"
    if (engine / "library").exists() or (engine / "user").exists():
        raise RuntimeError("O diretório de distribuição contém dados ou saves. Ele foi preservado. Use um novo PORT_CACHE_DIR.")
    engine.mkdir(exist_ok=True)
    (engine / "lib").mkdir(exist_ok=True)
    (engine / "licences").mkdir(exist_ok=True)
    shutil.copy2(native_build / "openhuey", engine / "openhuey")
    shutil.copytree(source / "openhuey-src/scripts", engine / "scripts", dirs_exist_ok=True)
    shutil.copytree(source / "openhuey-src/docs", engine / "docs", dirs_exist_ok=True)
    shutil.copy2((lib / "libSDL3.so.0").resolve(), engine / "lib/libSDL3.so.0")
    shutil.copy2((lib / "libsndio.so.7").resolve(), engine / "lib/libsndio.so.7")
    shutil.copy2(source / "LICENSE", engine / "licences/OpenHuey-LICENSE.txt")
    for package in ("libsdl3-0", "libsndio7.0"):
        shutil.copy2(sysroot / f"usr/share/doc/{package}/copyright", engine / f"licences/{package}-copyright.txt")
    (engine / "engine.json").write_text(json.dumps({
        "name": "OpenHuey", "version": f"0.1.11-{COMMIT[:7]}", "sourceCommit": COMMIT,
        "upstream": "https://github.com/ArnautDaniel/OpenHuey", "target": "linux-x64",
        "buildLibc": " ".join(platform.libc_ver()), "gameDataIncluded": False,
    }, indent=2))
    # The actual native program must load its libraries and reject a missing disc.
    smoke_dir = CACHE / "smoke-import"
    smoke_dir.mkdir(exist_ok=True)
    smoke = subprocess.run([engine / "openhuey", "--hidden", "--import", CACHE / "nonexistent-disc.iso"],
                           env=dict(os.environ, OPENHUEY_HOME=str(smoke_dir)), capture_output=True, text=True)
    if smoke.returncode != 1 or "error while loading shared libraries" in smoke.stderr:
        raise RuntimeError(f"O motor não passou na verificação de inicialização: {smoke.stderr}")
    print(f"\nMotor nativo compilado: {engine}\n4 testes do núcleo passaram. A execução do jogo exige a ISO de Haunting Ground (EUA).")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Instalação não concluída: {error}", file=sys.stderr)
        sys.exit(1)
