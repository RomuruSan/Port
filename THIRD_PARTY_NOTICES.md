# Componentes de terceiros

O Port RE inclui Electron 44.9.1 (MIT, com componentes Chromium e suas próprias licenças), 7-Zip 26.04 distribuído por `7zip-bin-full` 26.4.1 e `extract-zip` 2.0.1 (BSD-2-Clause). As licenças presentes nos pacotes são mantidas na distribuição. O 7-Zip usa LGPL e condições específicas descritas em seu arquivo de licença; consulte também https://www.7-zip.org/license.txt.

A configuração opcional baixa Ghidra 12.1.4 (Apache-2.0) do repositório oficial NationalSecurityAgency/ghidra e Temurin OpenJDK 21.0.12.1 (GPLv2 com Classpath Exception e demais avisos da distribuição) do repositório oficial adoptium/temurin21-binaries. Esses componentes são extraídos integralmente, preservando arquivos de licença. Eles não são incluídos no instalador básico. Os URLs e SHA-256 fixados estão em `src/toolchain.js`.

Fontes e informações: https://github.com/electron/electron · https://github.com/ip7z/7zip · https://github.com/NationalSecurityAgency/ghidra · https://github.com/adoptium/temurin21-binaries.

Nenhum jogo, BIOS, dump de flash ou chave é distribuído com o aplicativo. Os pequenos programas MIPS/PowerPC e os discos criados nos testes são fixtures sintéticas do projeto.
