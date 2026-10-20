# Port — Haunting Ground para PC

Aplicativo local para analisar uma ISO de **Haunting Ground (PS2, EUA)** e preparar uma pasta com o motor nativo [OpenHuey](https://github.com/ArnautDaniel/OpenHuey) e os dados importados do jogo. Você usa o navegador para fazer a preparação e depois abre o executável resultante para jogar.

Esta primeira versão integra um projeto nativo específico. **Não é um conversor universal de ISO/PKG**, não usa PCSX2/RPCS3 e ainda não oferece suporte a outros jogos ou a PS3. Os dados do jogo não são incluídos.

**Escolha por onde começar:**

- [Antes de começar](#antes-de-começar)
- [Passo a passo no Windows](#passo-a-passo-no-windows)
- [Passo a passo no Linux](#passo-a-passo-no-linux)
- [Selecionar a ISO e preparar o jogo](#selecionar-a-iso-e-preparar-o-jogo)
- [Abrir o jogo e usar novamente](#abrir-o-jogo-e-usar-novamente)
- [Resolver problemas comuns](#resolver-problemas-comuns)
- [Ambiente de desenvolvimento na nuvem](#ambiente-de-desenvolvimento-na-nuvem)

## Antes de começar

Separe estes itens:

| Item | O que você precisa |
| --- | --- |
| Computador | Windows x64 ou Linux x64, com ambiente gráfico para abrir o jogo |
| Node.js | Versão **22.12 ou mais recente**; o desenvolvimento foi validado com Node 24 |
| Código do Port | A pasta deste repositório, contendo `package.json` |
| Motor OpenHuey | A distribuição **do mesmo sistema** em que você vai preparar e abrir o jogo |
| Jogo | Sua ISO da edição americana de Haunting Ground, identificada como `SLUS_210.75` |
| Espaço livre | Espaço para uma cópia da ISO e para os dados importados; a ISO pode ter até **9 GiB** |

O motor é o programa que executa o jogo nativamente. O **Port** verifica a ISO e coordena a preparação; o **OpenHuey** faz a importação dos dados e executa o jogo. No motor fixado por este projeto, a execução gráfica solicita **OpenGL 4.6**.

Se você tem somente o disco físico, primeiro precisa gerar uma imagem `.iso` do seu disco usando um computador com leitor compatível. O Port não lê o DVD diretamente. Arquivos `.pkg`, `.chd`, `.zip` e `.rar` não são aceitos como entrada.

**Situação da validação:** o aplicativo e a compilação Linux foram testados, mas ainda falta validar a importação com uma ISO real, a jogabilidade e a execução no Windows. “Pasta preparada” confirma a importação, não que todas as partes do jogo funcionam.

O GitHub contém o código para você baixar. Abrir a página do repositório não inicia o aplicativo. Os passos abaixo executam o Port no seu próprio computador.

## Passo a passo no Windows

### 1. Instale o Node.js

1. Acesse o [site oficial do Node.js](https://nodejs.org/).
2. Instale uma versão LTS que atenda ao requisito de versão acima, incluindo o npm.
3. Depois da instalação, feche e abra novamente o PowerShell.
4. Confira a instalação:

```powershell
node --version
npm.cmd --version
```

Os dois comandos devem mostrar um número de versão. Usamos `npm.cmd` neste guia para evitar o bloqueio de `npm.ps1` em algumas configurações do PowerShell.

### 2. Baixe o Port

1. Abra [RomuruSan/Port](https://github.com/RomuruSan/Port).
2. Clique em **Code → Download ZIP**.
3. Extraia o ZIP. Neste exemplo, vamos usar `C:\Jogos\Port-main`.
4. Confira se `package.json`, `README.md`, `src` e `public` estão diretamente nessa pasta. Se aparecer outra pasta `Port-main` dentro dela, use a pasta interna que contém `package.json`.

Não execute o projeto de dentro do ZIP.

### 3. Baixe o motor OpenHuey para Windows

1. Abra a [página de releases do OpenHuey](https://github.com/ArnautDaniel/OpenHuey/releases/tag/openhuey-latest).
2. Expanda **Assets**, se necessário.
3. Baixe o arquivo `.zip` cujo nome contém **`windows-x64`**. O número da versão pode mudar. A opção **Source code** contém código-fonte, não o motor pronto para executar.
4. Extraia o pacote completo. Neste exemplo, vamos usar `C:\Jogos\OpenHuey`.
5. Confira a pasta. Ela deve conter `openhuey.exe`, a pasta `scripts` com `prelude.fs` e as DLLs fornecidas pela distribuição. Preserve também `licences` e os demais arquivos do pacote.

Se o ZIP criar uma pasta adicional, use como caminho a pasta que contém **diretamente** `openhuey.exe`. Não copie apenas o EXE: ele precisa dos scripts e das bibliotecas que o acompanham.

### 4. Instale e inicie o Port

Abra o PowerShell e execute os comandos abaixo. Se você escolheu outras pastas, ajuste os dois caminhos:

```powershell
cd 'C:\Jogos\Port-main'
npm.cmd ci --ignore-scripts --no-audit --no-fund
$env:PORT_ENGINE_DIR = 'C:\Jogos\OpenHuey'
npm.cmd start
```

O comando `npm.cmd ci` prepara o projeto usando o arquivo de lock. `PORT_ENGINE_DIR` informa onde você extraiu o motor. O último comando inicia o servidor local do Port.

Quando aparecer **“Port iniciado na porta 4317”**, mantenha essa janela aberta. Se ela for fechada, a interface deixa de responder.

### 5. Abra a interface

No navegador **desse mesmo computador**, digite este endereço na barra de endereços:

```text
http://127.0.0.1:4317
```

Confira se o canto superior mostra **Ambiente local** e se a área do OpenHuey não apresenta um aviso de configuração pendente. Continue em [Selecionar a ISO e preparar o jogo](#selecionar-a-iso-e-preparar-o-jogo).

## Passo a passo no Linux

### 1. Instale o Node.js e baixe o Port

Instale Node.js **22.12 ou mais recente**, com npm, usando uma opção apropriada à sua distribuição. Confira:

```sh
node --version
npm --version
```

Baixe o projeto em **Code → Download ZIP** no GitHub e extraia a pasta. Se você já usa Git, pode fazer o download assim:

```sh
git clone https://github.com/RomuruSan/Port.git
cd Port
```

Se baixou o ZIP, abra um terminal na pasta extraída que contém `package.json`. Se já tem o checkout, use a pasta existente.

### 2. Baixe o motor OpenHuey para Linux

1. Abra a [página de releases do OpenHuey](https://github.com/ArnautDaniel/OpenHuey/releases/tag/openhuey-latest).
2. Em **Assets**, baixe o pacote `.tar.gz` cujo nome contém **`linux-x86_64`**. Não selecione **Source code**.
3. Extraia o pacote completo. Neste exemplo, a pasta escolhida é `~/Jogos/OpenHuey`.
4. Confirme que essa pasta contém diretamente `openhuey`, `scripts/prelude.fs`, `lib` e as licenças fornecidas pelo projeto. Se houver outra pasta dentro dela, ajuste o caminho para a pasta que contém o executável.

As releases do OpenHuey são externas e podem mudar. A compatibilidade com sua distribuição depende dos requisitos dessa release e das bibliotecas gráficas disponíveis no computador.

### 3. Instale e inicie o Port

No terminal, dentro da pasta do Port que contém `package.json`, execute:

```sh
npm ci --ignore-scripts --no-audit --no-fund
PORT_ENGINE_DIR="$HOME/Jogos/OpenHuey" npm start
```

Troque o caminho se você extraiu o motor em outro local. Se o executável perdeu a permissão de execução durante a extração, restaure-a antes de iniciar:

```sh
chmod +x "$HOME/Jogos/OpenHuey/openhuey"
```

Quando aparecer **“Port iniciado na porta 4317”**, mantenha o terminal aberto. No navegador do mesmo computador, digite `http://127.0.0.1:4317` e continue abaixo.

## Selecionar a ISO e preparar o jogo

### 1. Selecione o arquivo

Na área **Comece pelo disco**, clique em **escolha um arquivo** ou arraste sua ISO para a caixa. Selecione o arquivo `.iso`, não a pasta onde ele está.

O Port armazena uma cópia da ISO e calcula seu SHA-256 enquanto recebe o arquivo. Quando o aplicativo está rodando no seu PC, esse envio acontece entre o navegador e o servidor local do próprio PC. A ISO não é publicada no GitHub.

Espere o envio terminar e a análise do disco aparecer. Não feche o terminal durante a operação.

### 2. Confira a compatibilidade

A seção **Conferência da imagem** mostra região, executável, tamanho e checksums. Para este perfil, o executável precisa ter:

| Verificação | Valor esperado |
| --- | --- |
| Edição | Haunting Ground — EUA |
| Identificação | `SLUS_210.75` |
| Tamanho do executável | `3650608` bytes |
| CRC32 do executável | `A295AF2B` |
| Arquivo de dados do disco | `DATA.CVM` |

Você não precisa digitar esses valores: a análise é automática. O tamanho acima é o do **executável dentro do disco**, não o tamanho total da ISO. O SHA-256 mostrado identifica a imagem enviada e não precisa ser igual ao CRC32 da tabela.

- **RECONHECIDA:** a imagem passou pelas verificações deste perfil; você pode avançar se o motor estiver disponível.
- **NÃO COMPATÍVEL:** leia o motivo exibido. Outras regiões, revisões ou modificações no executável podem ser recusadas, mesmo que o nome do arquivo diga “Haunting Ground”. Renomear a ISO não muda seu conteúdo.

Se você já enviou mais de uma imagem, use **ISOs já analisadas** para escolher uma delas sem enviar novamente.

### 3. Inicie a preparação

1. Na área **Prepare para PC**, escolha um nome para o projeto ou mantenha **Haunting Ground**.
2. Confira o **destino desta preparação**: ele corresponde ao sistema no qual o Port está rodando.
3. Clique em **Preparar jogo para PC**.
4. Acompanhe a área **Preparações**. O aplicativo primeiro copia o motor e depois importa os dados da ISO.
5. Se precisar acompanhar o que está acontecendo, abra **Ver registro do motor** no cartão da preparação.

O tempo depende do computador e dos dados do disco. Não há uma estimativa fixa. O aplicativo aceita uma operação por vez; aguarde a atual terminar antes de enviar outra ISO ou iniciar outro projeto.

O botão fica desabilitado quando falta uma ISO compatível, o motor não está configurado ou outra operação está em andamento.

### 4. Confira o resultado

Quando aparecer **Pasta preparada**, o cartão mostrará o caminho completo do executável resultante. Copie esse caminho para localizar a pasta no seu computador.

Cada preparação recebe uma pasta nova com um identificador próprio. O nome escolhido na interface serve para identificar o projeto; não é o nome da pasta no disco. Por padrão, o resultado fica em:

```text
Port-main/                         # ou Port/, se você usou git clone
  .port-data/
    projects/
      <identificador-do-projeto>/
        openhuey.exe               # Windows
        openhuey                   # Linux, no lugar do EXE
        scripts/
        lib/ ou arquivos .dll     # conforme a distribuição do motor
        licences/
        library/                   # dados importados do seu disco
        port-project.json          # informações da preparação
```

No Linux, pastas cujo nome começa com ponto costumam ficar ocultas. Use **Ctrl+H** no gerenciador de arquivos para mostrar `.port-data`, se necessário.

Uma preparação que falha não é marcada como pronta. Consulte o registro e resolva o motivo antes de criar outra. **Pasta preparada** confirma que o importador terminou e criou o manifesto da biblioteca; ainda é necessário abrir e testar o jogo.

## Abrir o jogo e usar novamente

### Abrir o jogo preparado

1. Localize a pasta indicada no cartão da preparação.
2. No Windows, abra `openhuey.exe`. No Linux, execute `openhuey` em um ambiente gráfico compatível.
3. Mantenha o executável junto de `scripts`, `library`, bibliotecas e licenças. Se quiser mover o resultado, mova **a pasta inteira**.
4. Verifique imagem, áudio, controles, troca de salas e salvamento. O aplicativo não faz essa validação automaticamente.

Depois de uma importação concluída, o motor usa os dados de `library/`; a ISO não precisa ser selecionada toda vez. Você pode abrir o executável preparado sem manter o servidor do Port funcionando.

O resultado serve para o **mesmo sistema** usado na preparação. Para preparar no Windows, rode o Port no Windows com o motor Windows. Uma preparação feita no Linux não produz um EXE Windows.

### Fechar e abrir o Port novamente

Depois que a operação atual terminar, volte ao terminal do Port e pressione **Ctrl+C** para encerrar o servidor. As ISOs armazenadas e as preparações já concluídas continuam no disco.

Nas próximas vezes, não é necessário baixar tudo nem executar `npm ci` novamente. Abra o terminal na pasta do projeto e repita a configuração do caminho do motor e o comando de inicialização.

**Windows — PowerShell:**

```powershell
cd 'C:\Jogos\Port-main'
$env:PORT_ENGINE_DIR = 'C:\Jogos\OpenHuey'
npm.cmd start
```

**Linux:**

```sh
cd /caminho/onde/voce/guardou/Port
PORT_ENGINE_DIR="$HOME/Jogos/OpenHuey" npm start
```

No exemplo Linux, substitua o caminho depois de `cd` pelo local real do projeto. No Windows, ajuste as duas pastas se usou locais diferentes. Depois, abra novamente o endereço local no navegador. O caminho do motor definido nesses comandos não é salvo automaticamente entre terminais.

### Liberar espaço e guardar seus dados

- **Remover ISO armazenada**, na interface, apaga a cópia mantida pelo Port. Seu arquivo original e as pastas já preparadas são preservados.
- A cópia da ISO fica em `.port-data/uploads/`; os resultados ficam em `.port-data/projects/`. Faça backup da pasta completa de uma preparação que queira guardar, incluindo `user/` quando ela for criada pelo motor para saves e configurações.
- O jogo preparado contém dados importados do seu disco. Mantenha esses dados separados do código do repositório; `.port-data/` já é ignorada pelo Git.

## Resolver problemas comuns

| Problema | Como resolver |
| --- | --- |
| `node` ou `npm` não é reconhecido | Instale o Node.js com npm e abra um terminal novo. Confira `node --version` e `npm.cmd --version` no Windows, ou `npm --version` no Linux. |
| O PowerShell bloqueia `npm.ps1` | Use `npm.cmd` nos comandos, como neste guia. Não é necessário alterar a política de execução do PowerShell. |
| Erro dizendo que `package.json` não existe | O terminal está na pasta errada. Entre na pasta extraída do Port que contém esse arquivo e repita o comando. |
| A página não abre ou mostra “Sem conexão” | Confirme que o terminal continua aberto e que o servidor informou a porta 4317. Digite o endereço no navegador do mesmo computador em que o comando está rodando. |
| `EADDRINUSE` ou “porta em uso” | O Port pode já estar aberto em outro terminal. Use a instância existente ou encerre-a com Ctrl+C antes de iniciar outra. Também é possível escolher outra porta, conforme o exemplo abaixo. |
| Motor nativo não configurado | Confira se `PORT_ENGINE_DIR` aponta para a pasta que contém diretamente `openhuey.exe` ou `openhuey`, além de `scripts/prelude.fs`. Ajuste o caminho e reinicie o servidor no mesmo terminal onde definiu a variável. |
| ISO não compatível | Leia o motivo na conferência da imagem. Este perfil aceita a edição americana e o executável exato da tabela acima. Outra região ou um executável modificado precisa de outro perfil. |
| Falta de espaço | Libere espaço na unidade onde o Port guarda os dados. A verificação inicial reserva pelo menos duas vezes o tamanho da ISO mais 1 GiB; os dados convertidos ainda podem exigir mais espaço. |
| Preparação interrompida | Abra **Ver registro do motor**. Confira os arquivos do motor e o espaço disponível. Se o app foi fechado durante a importação, inicie um novo projeto com a ISO já analisada. |
| O jogo não abre, falta uma DLL ou uma biblioteca `.so` | Preserve a pasta completa do motor e do resultado. Use o pacote do sistema correto e confira os requisitos da release do OpenHuey. |
| Erro de contexto OpenGL | A versão do motor fixada no projeto solicita OpenGL 4.6. Confira o suporte da GPU e do driver e execute em um desktop com suporte gráfico. |

Para usar outra porta, por exemplo **4320**, no Windows:

```powershell
$env:PORT = '4320'
$env:PORT_ENGINE_DIR = 'C:\Jogos\OpenHuey'
npm.cmd start
```

No Linux:

```sh
PORT=4320 PORT_ENGINE_DIR="$HOME/Jogos/OpenHuey" npm start
```

Nesse caso, digite `http://127.0.0.1:4320` no navegador do seu computador.

## Ambiente de desenvolvimento na nuvem

Esta seção é para o ambiente em `/workspace/Port`. Para usar o aplicativo no seu PC, siga os passos Windows ou Linux acima. A interface do onboarding na nuvem não oferece uma prévia gráfica do jogo.

Se o ambiente preparado foi restaurado e o motor está disponível no cache, basta iniciar o aplicativo:

```sh
cd /workspace/Port
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

Para reproduzir a instalação do motor nesse ambiente Linux:

```sh
cd /workspace/Port
python3 tools/setup_native.py
```

O instalador compila o OpenHuey no commit `fa1da63a21169f35eaeb98005c15ed2e3246f2d6`, usando CMake 3.31.10, Ninja 1.13.0, SDL3 e sndio dos pacotes assinados Debian 13. Todas as ferramentas, bibliotecas e saídas ficam em `/workspace/.cache/port`, fora do checkout; não usa `sudo`, não altera fontes ou arquivos de lock existentes e mantém a verificação de assinatura/checksum/TLS. Usa até quatro processos de compilação.

Esse instalador é para Linux x64 com glibc >= 2.38 e ferramentas Debian (`cc`, `git`, Python com venv, `dpkg-deb` e APT). Não execute esse instalador no Windows. O binário compilado depende da versão de glibc da máquina onde foi criado e de bibliotecas de desktop disponíveis no destino. Os filmes usam o FFmpeg do sistema. Não é uma compilação universal para todas as distribuições Linux.

O cache `OpenHuey/` é uma dependência de compilação, não um segundo projeto do usuário. Um cache alterado é preservado e bloqueia a substituição; use outro `PORT_CACHE_DIR` para uma instalação independente.

As releases externas podem mudar: registre sua versão e teste a importação. A versão de desenvolvimento validada nesta tarefa está fixada no instalador acima; a distribuição Windows e a jogabilidade ainda não foram validadas aqui.

## Dados e configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `4317` | Porta local do aplicativo |
| `PORT_CACHE_DIR` | `../.cache/port` relativo ao checkout | Ferramentas e compilação do motor |
| `PORT_ENGINE_DIR` | `<cache>/engine` | Distribuição OpenHuey do sistema atual |
| `PORT_DATA_DIR` | `.port-data/` no checkout | ISOs, metadados e preparações |

Não é necessária nenhuma credencial. As variáveis devem ser definidas no ambiente do terminal **antes de iniciar o servidor**; arquivos `.env` não são carregados automaticamente. Os caminhos padrão da tabela são relativos ao projeto; para valores personalizados, prefira caminhos absolutos. O servidor escuta somente na interface local e mantém os dados no computador em que está executando.

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
