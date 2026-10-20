export const profile = Object.freeze({
  id: 'haunting-ground-usa',
  title: 'Haunting Ground',
  console: 'PlayStation 2',
  region: 'EUA',
  serial: 'SLUS_210.75',
  executableSize: 3650608,
  executableCrc32: 'A295AF2B',
  engine: 'OpenHuey',
  upstream: 'https://github.com/ArnautDaniel/OpenHuey',
  upstreamCommit: 'fa1da63a21169f35eaeb98005c15ed2e3246f2d6',
  targets: ['Windows x64', 'Linux x64'],
});

export function compatibility(disc) {
  if (disc.serial !== profile.serial) {
    return { supported: false, reason: `Este perfil requer Haunting Ground (EUA), ${profile.serial}. A imagem informa ${disc.serial || 'um executável não identificado'}.` };
  }
  if (disc.executable.sizeBytes !== profile.executableSize || disc.executable.crc32 !== profile.executableCrc32) {
    return { supported: false, reason: 'O executável difere da edição americana esperada. Imagens modificadas ou outras revisões precisam de um perfil próprio.' };
  }
  return { supported: true, reason: 'Executável da edição americana reconhecido pelo tamanho e CRC32. A execução do jogo ainda depende da importação e validação no PC.' };
}
