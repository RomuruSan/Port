#!/usr/bin/env python3
"""Prepare the virtual display in this Debian cloud machine without system writes."""
from pathlib import Path
import os
import platform
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2] / '.cache' / 'port-re'
binary = root / 'xvfb/usr/bin/Xvfb'
if platform.system() != 'Linux' or platform.machine() != 'x86_64':
    raise SystemExit('Este auxiliar é específico do ambiente Linux x64 na nuvem.')
if binary.is_file():
    print(f'Display virtual disponível: {binary}')
    raise SystemExit(0)
apt = root / 'apt'
for part in ['lists/partial', 'cache/archives/partial', 'empty']:
    (apt / part).mkdir(parents=True, exist_ok=True)
(apt / 'sources.list').write_text('deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main\n')
(apt / 'apt.conf').write_text(
    f'Dir::Etc::parts "{apt}/empty";\nDir::Etc::main "/dev/null";\n'
    f'Dir::Etc::sourcelist "{apt}/sources.list";\nDir::Etc::sourceparts "{apt}/empty";\n'
    f'Dir::State::lists "{apt}/lists";\nDir::Cache "{apt}/cache";\n')
environment = dict(os.environ, APT_CONFIG=str(apt / 'apt.conf'))
subprocess.run(['/usr/bin/apt-get', 'update'], env=environment, check=True)
listing = subprocess.check_output(['/usr/bin/apt-cache', 'madison', 'xvfb'], env=environment, text=True)
available = [line.split('|')[1].strip() for line in listing.splitlines() if '|' in line]
if not available:
    raise SystemExit('Nenhuma versão autenticada do Xvfb disponível no repositório configurado.')
with tempfile.TemporaryDirectory(prefix='xvfb-download-', dir=root) as temporary:
    # Select a repository version instead of a potentially newer installed package entry.
    subprocess.run(['/usr/bin/apt-get', 'download', f'xvfb={available[0]}'], cwd=temporary, env=environment, check=True)
    packages = list(Path(temporary).glob('xvfb_*.deb'))
    if len(packages) != 1:
        raise SystemExit('Pacote Xvfb não identificado com segurança.')
    subprocess.run(['dpkg-deb', '-x', str(packages[0]), str(root / 'xvfb')], check=True)
dependencies = subprocess.check_output(['ldd', str(binary)], text=True)
if 'not found' in dependencies:
    raise SystemExit('Há bibliotecas do display ausentes na máquina base.\n' + '\n'.join(line for line in dependencies.splitlines() if 'not found' in line))
print(f'Display virtual preparado com pacotes autenticados: {binary}')
