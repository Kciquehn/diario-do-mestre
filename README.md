# Diário do Mestre

Módulo privado e independente de sistema para preparar aventuras e consultar o roteiro durante uma sessão no Foundry Virtual Tabletop.

## Recursos

- uma única janela com abas para aventuras, biblioteca, preparação e roteiro;
- roteiro visual dividido em cenas, colunas e cartões;
- texto rico com `Ctrl+B` para negrito e `Ctrl+I` para itálico;
- comandos `/diálogo`, `/seleção` e `/teste`;
- testes configuráveis com sucesso, falha, resultados numéricos e descrição;
- menções com `@` para registros da biblioteca, Atores e Itens;
- vínculos persistentes por UUID, sem duplicar Documents do sistema;
- biblioteca de personagens, locais, itens, encontros e facções;
- imagens escolhidas pelo File Picker e abertas no visualizador do Foundry;
- salvamento automático do roteiro e das fichas da biblioteca;
- colunas redimensionáveis pelas bordas direita e inferior;
- integração opcional com PopOut no Foundry v13 e janelas destacáveis nativas no v14.

## Compatibilidade

- Foundry VTT v13 como versão mínima e atualmente verificada;
- fluxo preparado para Foundry VTT v14 usando as APIs públicas comuns e o destacamento nativo de `ApplicationV2`;
- qualquer sistema de jogo;
- interface exclusiva do mestre.

O manifesto permanecerá com `verified: 13` até a validação manual completa no Foundry v14.

## Instalação

Depois que a primeira GitHub Release estiver publicada, use este manifesto no instalador de módulos do Foundry:

```text
https://github.com/Kciquehn/diario-do-mestre/releases/latest/download/module.json
```

Para instalação manual, baixe `diario-do-mestre.zip` na página de releases e extraia o conteúdo na pasta `Data/modules/diario-do-mestre`.

## Uso

1. Ative **Diário do Mestre** no mundo.
2. Entre como mestre e abra a aba **Diário** da barra lateral.
3. Clique em **Abrir Diário do Mestre**.
4. Crie uma aventura e abra seu preparador ou roteiro.
5. Use a Biblioteca do Mestre para guardar referências reutilizáveis.

As aventuras e fichas são páginas de um `JournalEntry` criado pelo módulo. Sua propriedade padrão é `NONE`, portanto o conteúdo não é compartilhado com jogadores. Todas as operações de escrita e exclusão também verificam se o usuário é mestre.

## Roteiro e comandos

Digite `/` em um campo de texto para abrir o menu de blocos:

- **Diálogo:** trecho destacado e em itálico;
- **Seleção:** item marcável; `Enter` cria o próximo item;
- **Teste:** bloco com título e resultados opcionais.

Digite `@` para procurar registros da Biblioteca do Mestre. Também é possível arrastar um `Actor` ou `Item` do Foundry para o editor. As referências são persistidas por UUID.

## Outro monitor

No Foundry v13, ative o módulo opcional **PopOut!** e acesse o Foundry por um navegador comum, como `http://localhost:30000`. O PopOut não funciona dentro do aplicativo desktop Electron.

No Foundry v14, o Diário usa o destacamento nativo de janelas. O botão **Outro monitor** destaca a janela unificada mantendo a aba atual aberta.

## Desenvolvimento

O projeto não possui dependências de runtime ou de build.

```powershell
npm run validate
npm run build
```

- `npm run validate` confere manifesto, caminhos, idiomas, imports, sintaxe JavaScript, blocos Handlebars, codificação e APIs proibidas;
- `npm run build` repete a validação e cria `dist/diario-do-mestre.zip` e `dist/module.json`.

## Publicação

O workflow `.github/workflows/release.yml` publica automaticamente os dois arquivos de `dist` quando uma tag compatível com a versão do manifesto é enviada:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

O repositório precisa existir em `https://github.com/Kciquehn/diario-do-mestre` antes do primeiro push. Não crie a tag antes de concluir o teste manual da versão correspondente.

## Relatórios e alterações

- Problemas: <https://github.com/Kciquehn/diario-do-mestre/issues>
- Histórico: [CHANGELOG.md](CHANGELOG.md)
