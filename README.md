# Port — Haunting Ground para PC

Aplicativo local para analisar uma ISO de **Haunting Ground (PS2, EUA)** e preparar uma pasta jogável com o motor nativo [OpenHuey](https://github.com/ArnautDaniel/OpenHuey). Interface em português, análise ISO9660, verificação do executável, importação de dados, acompanhamento do processo e histórico persistente.

Esta primeira versão integra um projeto nativo específico. **Não é um conversor universal de ISO/PKG**, não usa PCSX2/RPCS3 e ainda não oferece suporte a outros jogos ou a PS3. Os dados do jogo não são incluídos.

## Iniciar o aplicativo

Requer Node.js **22.12 ou mais recente** (validado com Node 24). Não há dependências npm externas.

```sh
cd /workspace/Port
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm start
```

O servidor escuta somente na interface local, na porta **4317**. No seu PC, abra o navegador usando o endereço local dessa porta. A interface do onboarding na nuvem não oferece uma prévia gráfica do jogo.

1. Configure o motor nativo conforme a seção seguinte.
2. Selecione a sua ISO. O envio para o aplicativo é feito em fluxo, sem carregar o disco inteiro na memória.
3. Confira o executável. O perfil aceita `SLUS_210.75`, tamanho `3650608` bytes, CRC32 `A295AF2B`, como o importador do OpenHuey.
4. Escolha **Preparar jogo para PC**. O programa copia o motor e seus scripts para uma pasta nova e executa a importação de dados do OpenHuey.
5. Após a importação, abra o executável exibido pela interface **no sistema de destino**. A pasta contém `library/`, scripts, licenças e o motor; não precisa da ISO para iniciar novamente.

Cada preparação usa uma pasta nova. Importações que falham não publicam uma pasta parcial, e o aplicativo não executa automaticamente o jogo. O SHA-256 mostrado identifica a ISO enviada; ele não é um certificado de compatibilidade. A indicação “pasta preparada” confirma a conclusão da importação e a presença do manifesto da biblioteca, não a jogabilidade.

## Configurar o motor

### Ambiente Linux desta tarefa

```sh
cd /workspace/Port
python3 tools/setup_native.py
```

O instalador compila o OpenHuey no commit `fa1da63a21169f35eaeb98005c15ed2e3246f2d6`, usando CMake 3.31.10, Ninja 1.13.0, SDL3 e sndio dos pacotes assinados Debian 13. Todas as ferramentas, bibliotecas e saídas ficam em `/workspace/.cache/port`, fora do checkout; não usa `sudo`, não altera fontes ou arquivos de lock existentes e mantém a verificação de assinatura/checksum/TLS. Usa até quatro processos de compilação.

Esse instalador é para Linux x64 com glibc >= 2.38 e ferramentas Debian (`cc`, `git`, Python com venv, `dpkg-deb` e APT). O binário compilado depende da versão de glibc da máquina onde foi criado e de bibliotecas de desktop disponíveis no destino. Os filmes usam o FFmpeg do sistema. Não é uma compilação universal para todas as distribuições Linux.

O cache `OpenHuey/` é uma dependência de compilação, não um segundo projeto do usuário. Um cache alterado é preservado e bloqueia a substituição; use outro `PORT_CACHE_DIR` para uma instalação independente.

### Windows ou outras instalações Linux

Use a distribuição correspondente ao seu sistema na [página de releases do OpenHuey](https://github.com/ArnautDaniel/OpenHuey/releases/tag/openhuey-latest), extraia a pasta completa e defina `PORT_ENGINE_DIR` para ela antes de iniciar o Port. Preserve `scripts/`, `lib/` ou as DLLs e `licences/` fornecidos pelo projeto.

PowerShell, por exemplo:

```powershell
$env:PORT_ENGINE_DIR = 'C:\OpenHuey'
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

Linux:

```sh
PORT_ENGINE_DIR=/caminho/para/openhuey npm start
```

O Port prepara uma pasta para **o mesmo sistema no qual está rodando**. Uma máquina Linux não produz um EXE Windows. A distribuição e a execução Windows precisam ser testadas em Windows; não foram validadas nesta máquina Linux. As releases externas podem mudar: registre sua versão e teste a importação, pois a versão de desenvolvimento validada está fixada no instalador acima.

## Dados e configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `4317` | Porta local do aplicativo |
| `PORT_CACHE_DIR` | `../.cache/port` relativo ao checkout | Ferramentas e compilação do motor |
| `PORT_ENGINE_DIR` | `<cache>/engine` | Distribuição OpenHuey do sistema atual |
| `PORT_DATA_DIR` | `.port-data/` no checkout | ISOs, metadados e preparações |

Não é necessária nenhuma credencial. Os caminhos são resolvidos a partir do projeto, independentemente do diretório de onde o comando é chamado. ISOs de até 9 GiB são aceitas; reserve espaço para a ISO e para os dados importados. A interface permite remover uma ISO armazenada sem apagar as pastas preparadas nem o arquivo original do computador. Não compartilhe uma pasta de preparação ou publique dados do seu jogo junto do código.

## Desenvolvimento e validação

```sh
npm run dev
npm test
/workspace/.cache/port/tools/bin/ctest --test-dir /workspace/.cache/port/build -R '^test_' --output-on-failure
```

Os testes do Port usam pequenas ISOs sintéticas e um importador de teste para verificar análise de arquivos, limites, bloqueio de edições incompatíveis, persistência, isolamento das pastas e tratamento de falhas. Essas fixtures **não são jogos** e não demonstram que Haunting Ground funciona. O importador de teste Unix não é executado em Windows.

Os quatro testes `test_*` do OpenHuey exercitam a linguagem e o núcleo de atores sem dados do jogo. Os outros testes de jogabilidade e conversão dependem dos dados originais. Não são desativados nem apresentados como aprovados quando os dados não estão disponíveis. Ainda é necessário importar a ISO real e testar gráficos, áudio, controles e progresso do jogo.

Cada tarefa de nuvem já é isolada. Use este checkout existente; não crie um Git worktree para iniciar o desenvolvimento.

## Créditos

O Port coordena análise e preparação; a implementação nativa de Haunting Ground é do **OpenHuey**, de ArnautDaniel e colaboradores, sob GPLv3. As licenças do motor e de suas bibliotecas são preservadas na distribuição e nas pastas preparadas. Este projeto não é afiliado à Capcom ou à Sony.
