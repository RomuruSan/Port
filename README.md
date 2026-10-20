# Port RE — Engenharia reversa de PS2 e PS3

Aplicativo de desktop para **Windows 10/11 de 64 bits**, com instalador, interface em português e análise local de ISO/UDF, executáveis ELF e dumps de BIOS/flash.

**O Port RE não recupera integralmente o código-fonte original de um jogo.** Ele identifica e extrai executáveis e integra o Ghidra para gerar assembly e pseudocódigo aproximado. Nomes, comentários, tipos e estruturas removidos na compilação podem estar irrecuperáveis. A BIOS contém firmware do console, não os arquivos-fonte dos jogos.

Esta versão substitui o antigo preparador de Haunting Ground/OpenHuey. Não usa emuladores, não converte jogos automaticamente em ports nativos e não inclui jogos, BIOS ou chaves.

## 1. Baixar e instalar no Windows

1. Abra a página de [Releases](https://github.com/RomuruSan/Port/releases).
2. Em **Assets** da versão 0.3.0, baixe **[Port-RE-0.3.0-Windows-x64-Setup.exe](https://github.com/RomuruSan/Port/releases/download/v0.3.0/Port-RE-0.3.0-Windows-x64-Setup.exe)**. Não selecione os arquivos “Source code”.
3. Execute o instalador, escolha a pasta e conclua a instalação.
4. Abra **Port RE** pelo atalho no menu Iniciar ou na área de trabalho.

O instalador inclui o runtime do aplicativo e o 7-Zip. **Você não precisa instalar Node.js, npm nem iniciar um servidor no navegador.** A instalação é por usuário e mantém os dados de análise separados do programa.

O instalador não tem assinatura de certificado de editor. O Windows pode informar que o editor é desconhecido. Confira a origem e o SHA-256 publicado com a release; não desative as proteções do sistema.

Se ainda não houver uma release disponível, consulte os **Artifacts** das execuções bem-sucedidas do workflow [Windows installer](https://github.com/RomuruSan/Port/actions/workflows/windows-installer.yml). É necessário estar conectado ao GitHub para baixar artefatos.

## 2. Fazer a primeira análise

Na tela inicial, escolha um dos tipos:

| Botão | Entrada | Resultado |
| --- | --- | --- |
| **Imagem ISO → Selecionar ISO** | ISO9660/UDF legível, `.iso` ou `.img` | Inventário, identificação de PS2/PS3 e tentativa de extrair o executável principal |
| **Executável → Selecionar arquivo** | ELF acessível, `EBOOT.BIN`, SELF, SPRX ou IRX | Formato, processador, segmentos, seções, símbolos presentes, hash e amostra de strings |
| **BIOS / flash → Selecionar dump** | Um dump BIN, ROM ou IMG que você já tenha | ROMDIR/ROMVER de PS2 quando válidas, módulos, hash e strings; outros dumps ficam como não confirmados |

1. Selecione o arquivo no diálogo do Windows.
2. Confira nome e caminho na interface.
3. Clique em **Analisar arquivo** e aguarde.
4. Confira **Visão geral**. O projeto também aparece em **Projetos recentes**.

Os originais são lidos, e os resultados ficam na pasta de dados do aplicativo. O Port RE não executa o jogo nem a BIOS. A ISO é lida sem carregar a imagem inteira na memória.

## 3. Entender as abas

- **Visão geral:** formato, processador, entrada, estruturas, hash e limitações. Para firmware, ROMVER e módulos identificados.
- **Arquivos do disco:** inventário da ISO. Desmarque **Somente candidatos a executável** para pesquisar outros arquivos. Clique em **Extrair e analisar** para analisar outro arquivo.
- **Strings:** amostra de textos ASCII com offsets. Strings não são código-fonte; textos Unicode e strings fora da amostra podem não aparecer.
- **Pseudocódigo:** funções exportadas depois de executar o Ghidra.

No PS2, o boot ELF normalmente é identificado pelo `BOOT2` em `SYSTEM.CNF`. No PS3, `EBOOT.BIN` pode ser um contêiner **SELF**, não um ELF acessível. O app identifica essa situação e não habilita sua decompilação integrada.

**Não há descriptografia de SELF, PKG, discos ou regiões de flash.** Forneça um ELF acessível para a decompilação. Renomear um arquivo criptografado para `.elf` não resolve essa limitação.

## 4. Preparar o Ghidra e o Java

A análise básica já funciona sem Ghidra. Para gerar pseudocódigo:

1. Clique em **Ferramentas** na lateral.
2. No Windows x64, clique em **Baixar e configurar Ghidra + Java**.
3. Reserve pelo menos **2 GiB livres** para as ferramentas e mais espaço para os projetos.
4. Aguarde os downloads e a extração, mantendo a conexão.
5. O app verifica os SHA-256 oficiais fixados antes de usar os arquivos. Um download com hash incorreto é descartado.
6. Ao terminar, confira o indicador **Ghidra disponível**.

São usados **Ghidra 12.1.4** e **Temurin JDK 21.0.12.1**, dos repositórios oficiais. Eles ficam na pasta de dados do app, sem precisar alterar o Java global do Windows.

Se já tem as ferramentas, use **Selecionar pasta existente**. Para Ghidra, escolha a pasta extraída que contém `Ghidra` e `support`. Para JDK, escolha a pasta que contém `bin/java.exe`, não `bin` em si. O Java precisa atender aos requisitos da sua distribuição Ghidra. Um pacote “Source code” não é uma distribuição pronta.

A instalação automática é para Windows x64. No desenvolvimento Linux, configure as pastas manualmente.

## 5. Buscar o código do jogo e escolher onde salvar

1. Faça a análise inicial da ISO e configure Ghidra + Java conforme as etapas acima.
2. Na área **Código e material para port**, clique em **Buscar código e salvar…**.
3. No diálogo do Windows, escolha onde guardar os resultados, por exemplo `D:\Projetos\HauntingGround`. O aplicativo criará uma **subpasta nova** dentro dessa pasta, sem substituir exportações anteriores.
4. Aguarde a verificação dos arquivos e a decompilação em sequência. O app verifica assinaturas ELF/SELF/PKG no início dos arquivos, inclusive `.DAT` e arquivos sem extensão. Candidatos por nome também são analisados.
5. Confira a cobertura na interface: arquivos verificados, formatos sem suporte, funções decompiladas, falhas, avisos e limites. Um executável que falha não impede os seguintes.
6. Ao terminar, clique em **Abrir resultados salvos**. Comece por **`COBERTURA.md`**, **`LEIA-ME-PORT-WINDOWS.md`** e **`manifest.json`**.

Para apenas copiar os resultados que já existem, clique em **Salvar resultados atuais…** e escolha outra pasta. Isso não refaz a análise nem exige Ghidra. **Exportar relatório** continua disponível para salvar somente Markdown/JSON.

O padrão nas novas instalações é **0 = tentar todas as funções descobertas por executável**, sujeito aos limites de tempo e tamanho. Configurações antigas são preservadas: em **Ferramentas**, selecione 0 para ampliar a tentativa. “Todas as funções descobertas” não significa todo o código original do jogo.

A varredura lê até **8 GiB de arquivos novos por execução**, no máximo **512 MiB por arquivo**, e mantém até **1.000 arquivos de código**. Arquivos criptografados, grandes demais ou adiados ficam listados como pendentes. Execute novamente para continuar os adiados pelo orçamento; análises concluídas são reutilizadas. Contêineres internos, scripts proprietários e código embutido em outros offsets não são decodificados automaticamente. `no-signature` significa apenas ausência dessas assinaturas no início, não ausência de código.

Use **Cancelar** para interromper. Resultados anteriores ficam no projeto interno; exportações interrompidas são removidas da pasta escolhida. Abra novamente o projeto e use **Salvar resultados atuais…** para guardar o que já foi obtido. Uma nova busca retoma arquivos pendentes e tenta novamente executáveis que falharam ou atingiram limites.

### Decompilar somente um executável

1. Abra um projeto analisado.
2. Em **EXECUTÁVEL**, escolha um ELF analisável.
3. Confira se o Ghidra está disponível.
4. Clique em **Decompilar com Ghidra**.
5. Acompanhe **Ver registro da operação**. A autoanálise pode levar minutos e pode ser cancelada.
6. Abra **Pseudocódigo** e selecione uma função na lista.

Cada exportação cria uma pasta nova e mantém um projeto Ghidra para investigação manual. Pseudocódigo pode conter erros e não é um projeto pronto para recompilar ou portar.

O perfil genérico MIPS usa registradores de 64 bits, endereços de 32 bits e ABI o32. Ele não implementa automaticamente todas as extensões MMI/VU do R5900. SPU pode exigir um módulo adicional, não disponível na instalação padrão do Ghidra.

| Contagem | Significado |
| --- | --- |
| **Funções descobertas** | Reconhecidas por esta autoanálise; outras podem continuar não identificadas |
| **Exportações tentadas** | Funções incluídas na tentativa de exportação |
| **Decompiladas** | O Ghidra produziu pseudocódigo; ele ainda precisa ser revisado |
| **Funções com avisos** | Pseudocódigo com avisos ou instruções problemáticas |
| **Falhas** | O Ghidra não produziu pseudocódigo para essas funções |
| **Limite atingido** | A exportação não cobriu todas as funções descobertas ou atingiu outro limite |

Em **Ferramentas**, use **0 para todas as funções descobertas** ou limite de **1 a 10.000** por executável. A lista visual mostra até 1.000 funções por filtro; `functions-index.jsonl` enumera todas as funções descobertas, incluindo as não exportadas. O índice não inclui funções que o Ghidra não identificou.

O exportador limita cada função a 20 segundos, a autoanálise a 5 minutos e cada execução Ghidra a 30 minutos. Limita pseudocódigo por função a 1 Mi de caracteres, o total de pseudocódigo a 48 Mi e o assembly a 96 Mi. O limite de JSON pode encerrar a exportação antes disso. O assembly inclui instruções definidas fora das funções reconhecidas; bytes não interpretados continuam nos binários copiados. Limites e falhas ficam no resumo. Uma operação sem falhas não comprova que todo o código foi recuperado.

## 6. Exportar e localizar os resultados

O pacote salvo na pasta escolhida tem esta estrutura:

```text
<jogo>-port-<identificador>/
  LEIA-ME-PORT-WINDOWS.md       # próximos passos para desenvolver o port
  COBERTURA.md / coverage.json # pendências, falhas, limites e contagens
  manifest.json               # lista de arquivos exportados e SHA-256
  report.json / RELATORIO.md   # metadados, strings e resultados disponíveis
  inventory.json              # inventário completo da ISO
  evidence/                   # SYSTEM.CNF / PARAM.SFO quando disponíveis
  executables/<numero>-<nome>/
    binary/                   # cópia do executável identificado
    metadata.json             # formato, hash, segmentos e resultados
    strings.json / symbols.json
    ghidra/                   # quando a decompilação terminou
      project/                # .gpr e .rep para continuar no Ghidra
      export/
        pseudocode.c
        disassembly.txt
        functions.json
        functions-index.jsonl
        summary.json
    ghidra-partial/            # se existirem resultados de tentativa interrompida
```

Os caminhos dos executáveis em `report.json` são relativos à cópia exportada; os caminhos originais ficam como referência. O pacote contém os arquivos de código identificados e resultados disponíveis, não todos os recursos do disco. Reserve espaço para binários e projetos Ghidra, além das ferramentas.

**Para criar um port nativo para Windows 10/11:** revise funções e tipos no Ghidra, reconstrua módulos, substitua APIs de gráficos/áudio/controles/armazenamento do console e implemente carregadores dos recursos. Depois será necessário criar e testar um projeto de build para PC. `pseudocode.c` é material de referência e pode não compilar; não existe conversão automática de ISO para um jogo nativo pronto neste aplicativo.

O projeto de trabalho interno continua disponível:

- **Exportar relatório:** salva Markdown ou JSON pelo diálogo do Windows.
- **Abrir pasta:** abre a pasta do projeto no Explorador.

```text
projects/<identificador>/
  report.json                  # estruturas, hashes, strings e resultados
  evidence/                    # SYSTEM.CNF ou PARAM.SFO
  artifacts/                   # executáveis extraídos
  ghidra/<identificador>/
    project/                   # projeto Ghidra para continuar a análise
    export/
      pseudocode.c             # aproximação; pode não compilar
      disassembly.txt          # assembly das funções exportadas
      functions.json           # resultados individuais
      functions-index.jsonl    # todas as funções descobertas, inclusive pendentes
      summary.json             # contagens e limitações
```

No Windows instalado, os dados ficam por padrão em **`%APPDATA%\Port RE`**. Use **Abrir pasta** para localizar um projeto. A desinstalação preserva os dados; faça backup do que quiser guardar.

Relatórios podem conter caminhos pessoais, strings e pseudocódigo dos arquivos analisados. Eles não são enviados automaticamente ao GitHub.

## 7. O que a análise de BIOS faz

Uma ROMDIR válida permite identificar módulos e a ROMVER de PS2. O app também calcula SHA-256 e coleta strings. Isso não recupera os arquivos-fonte dos jogos. Módulos de BIOS não são tratados automaticamente como ELF.

Dumps de flash de PS3 têm layouts próprios e podem conter assinaturas e regiões criptografadas. Sem identificação válida, o app mostra **Não confirmada**, em vez de inventar um modelo ou uma versão.

## Problemas comuns

| Situação | Próxima ação |
| --- | --- |
| Decompilação desabilitada | Selecione um ELF analisável e configure Ghidra/JDK. ISO, BIOS bruta, PKG e SELF não são entradas diretas do decompilador integrado. |
| ISO não abre | Confira se é ISO9660/UDF legível. Criptografia, formatos diferentes e imagens truncadas podem impedir a leitura. |
| Download das ferramentas falhou | Confira conexão e espaço livre. Tente novamente depois de resolver a causa. Arquivos com checksum incorreto não são reutilizados. |
| JDK compatível não encontrado | Selecione a pasta do JDK correto. JRE sozinho ou Java antigo pode não atender ao Ghidra. |
| Função com avisos ou `halt_baddata` | Existem instruções ou fluxos não interpretados corretamente. Revise o processador e o projeto no Ghidra. |
| O executável é SELF | O app não descriptografa o contêiner. É necessário um ELF acessível. |
| Firmware não identificado | A identificação exige estruturas válidas, não só nome ou tamanho. Hashes e strings são evidência inicial. |
| Análise demora ou foi cancelada | Consulte o registro. Entradas originais são preservadas e resultados parciais não são declarados completos. |

## Desenvolvimento e instalador

Para desenvolver, use Node.js >= 22.12 (validado com Node 24). Isso **não é exigido do usuário do instalador**.

```sh
npm ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm test
npm start
```

Electron 44 usa o instalador explícito acima. Em ambientes que precisam de proxy, use `node --use-env-proxy node_modules/electron/install.js`. Preserve verificações TLS e checksums.

Para gerar o instalador:

```sh
npm run dist:win
```

O arquivo fica em `dist/Port-RE-0.3.0-Windows-x64-Setup.exe`. O workflow Windows executa os testes, uma busca/decompilação/exportação real de programas sintéticos e uma verificação de inicialização do app empacotado antes de publicar artefatos. O build é sem assinatura de editor.

Para validar a integração real com Ghidra em pequenos programas sintéticos:

```sh
PORT_RE_GHIDRA_DIR=/caminho/para/ghidra npm run verify:ghidra
```

É necessário JDK compatível. Os testes não usam jogos comerciais: comprovam a integração com MIPS/PowerPC básicos, não a decompilação de todos os jogos de PS2/PS3.

### Ambiente de desenvolvimento na nuvem

`npm start` usa `../.cache/port-re/dev-data` durante desenvolvimento. O instalador usa a pasta de dados do usuário. `PORT_RE_DATA_DIR` escolhe outro diretório; `PORT_RE_GHIDRA_DIR` indica um Ghidra existente e `JAVA_HOME` um JDK.

A interface desktop precisa de display. Em contêiner Linux sem desktop, use Xvfb. `PORT_RE_DISABLE_SANDBOX=1` existe somente para testes nesse ambiente; o instalador Windows não usa essa opção. Não é uma página web hospedada nem uma prévia de localhost.

Cada tarefa de nuvem já é isolada. Use o checkout existente em `/workspace/Port`; não crie um Git worktree.

## Componentes

Consulte [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). São usados Electron, 7-Zip e, opcionalmente, Ghidra e Temurin JDK. Cada componente mantém sua licença. Este projeto não é afiliado à Sony.
