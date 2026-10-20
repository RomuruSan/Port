# Fixtures de análise

`elf-fixture.js` cria programas originais mínimos em MIPS e PowerPC: retornar o argumento mais um. `disc-fixture.js` cria discos ISO9660, PARAM.SFO e uma ROMDIR sintéticos. Não há dados de jogos ou BIOS reais.

`synthetic-ps3-udf.iso.gz` é uma imagem UDF 2.60 criada com **pycdlib 1.14.0**, comprimida com gzip. Contém somente o ELF PowerPC e PARAM.SFO gerados pelas fixtures acima, com título “Synthetic Console Test” e identificador `TEST00001`. Seu objetivo é testar a leitura UDF usando um escritor de sistema de arquivos independente. O arquivo descomprimido tem 567296 bytes.

Os testes e esses arquivos não são incluídos no instalador do aplicativo.
