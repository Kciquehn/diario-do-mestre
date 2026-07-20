# Diário do Mestre

[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v13-ff6400)](https://foundryvtt.com/)
[![GitHub Release](https://img.shields.io/github/v/release/Kciquehn/diario-do-mestre?display_name=tag)](https://github.com/Kciquehn/diario-do-mestre/releases/latest)

Um preparador de aventuras privado, independente de sistema e integrado ao Foundry Virtual Tabletop. Organize o roteiro da sessão, personagens, locais, pistas, testes e referências sem compartilhar suas anotações com os jogadores.

## Principais recursos

- janela unificada com abas para aventuras, biblioteca, preparação e roteiro;
- roteiro visual dividido em cenas, colunas redimensionáveis e cartões;
- texto rico com `Ctrl+B` para negrito e `Ctrl+I` para itálico;
- comandos `/diálogo`, `/seleção` e `/teste`;
- testes com sucesso, falha, resultados numéricos e descrições opcionais;
- menções com `@` para registros da biblioteca, Atores e Itens;
- referências persistentes por UUID, sem duplicar Documents do sistema;
- biblioteca reutilizável de personagens, locais, itens, encontros e facções;
- imagens escolhidas pelo File Picker e abertas no visualizador do Foundry;
- salvamento automático do roteiro e das fichas da biblioteca;
- integração opcional com PopOut no Foundry v13 e janelas destacáveis nativas no v14.

## Compatibilidade

- Foundry VTT v13 como versão mínima e atualmente verificada;
- preparado para Foundry VTT v14, ainda aguardando validação manual completa;
- compatível com qualquer sistema de jogo;
- interface e conteúdo exclusivos do mestre.

## Instalação

No Foundry VTT, abra **Módulos complementares**, clique em **Instalar módulo** e cole este endereço no campo de manifesto:

```text
https://github.com/Kciquehn/diario-do-mestre/releases/latest/download/module.json
```

Para instalar manualmente, baixe `diario-do-mestre.zip` na [página de releases](https://github.com/Kciquehn/diario-do-mestre/releases/latest) e extraia seu conteúdo em `Data/modules/diario-do-mestre`.

## Como usar

1. Ative **Diário do Mestre** no mundo.
2. Entre como mestre e abra a aba **Diário** da barra lateral.
3. Clique em **Abrir Diário do Mestre**.
4. Crie uma aventura e abra seu preparador ou roteiro.
5. Use a Biblioteca do Mestre para guardar referências que podem reaparecer em diferentes cenas.

As aventuras e fichas são armazenadas como páginas de um `JournalEntry` privado criado pelo módulo. A propriedade padrão é `NONE`, e as operações de criação, edição e exclusão verificam se o usuário é mestre.

## Roteiro e comandos

Digite `/` em um campo de texto para abrir o menu de conteúdo:

- **Diálogo:** trecho destacado e em itálico;
- **Seleção:** item marcável; `Enter` cria o próximo item;
- **Teste:** bloco com título e resultados opcionais.

Digite `@` para procurar registros da Biblioteca do Mestre. Também é possível arrastar um `Actor` ou `Item` do Foundry para o editor. As referências são salvas por UUID.

## Outro monitor

No Foundry v13, ative o módulo opcional **PopOut!** e acesse o Foundry por um navegador comum, como `http://localhost:30000`. O PopOut não funciona dentro do aplicativo desktop Electron.

No Foundry v14, o Diário usa o destacamento nativo de `ApplicationV2`. O botão **Outro monitor** destaca a janela unificada mantendo a aba atual aberta.

## Desenvolvimento

O projeto não possui dependências de runtime ou build.

```powershell
npm run validate
npm run build
```

- `npm run validate` confere manifesto, caminhos, idiomas, imports, sintaxe JavaScript, blocos Handlebars, codificação e APIs proibidas;
- `npm run build` repete a validação e cria `dist/diario-do-mestre.zip` e `dist/module.json`.

## Suporte e histórico

- [Relatar um problema](https://github.com/Kciquehn/diario-do-mestre/issues)
- [Histórico de alterações](CHANGELOG.md)
