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
- importação por arrastar e soltar de Actors e Itens do mundo para fichas vinculadas na Biblioteca do Mestre;
- biblioteca reutilizável de personagens, locais, cidades, itens, encontros, facções e publicações;
- cidades com mapas privados navegáveis, zoom e marcadores vinculados às fichas de locais;
- imagens escolhidas pelo File Picker, abertas no visualizador do Foundry e com enquadramento ajustável por zoom e posição;
- salvamento automático do roteiro e das fichas da biblioteca;
- Diário dos Jogadores em formato de rede social e wiki pesquisável da campanha;
- seção **O Grupo** para apresentar os personagens jogadores, suas imagens, biografias, histórias, objetivos e relações;
- publicação controlada de personagens, locais, cidades, itens, facções, encontros, relatos e comércios conhecidos;
- integração opcional com comerciantes do Item Piles e do Item Piles: Symbaroum;
- criação direta de **Comerciante/Loja** na Biblioteca do Mestre usando o tipo de Actor e os padrões configurados pelo Item Piles;
- catálogo e compra diretamente no Diário dos Jogadores, usando preços, moedas, estoque e transferências do Item Piles;
- categoria **Comércio** preenchida automaticamente com os comerciantes do provedor Item Piles ativo;
- integração opcional com PopOut no Foundry v13 e janelas destacáveis nativas no v14.

## Compatibilidade

- Foundry VTT v13 como versão mínima e atualmente verificada;
- preparado para Foundry VTT v14, ainda aguardando validação manual completa;
- compatível com qualquer sistema de jogo;
- preparação e Biblioteca do Mestre privadas, com uma interface separada e somente leitura para conteúdo publicado aos jogadores.

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

## Diário dos Jogadores

O Diário dos Jogadores é uma interface separada do Diário do Mestre, apresentada como o mural e a wiki da campanha. Os jogadores podem pesquisar pelo nome de uma cidade, personagem, lugar ou item, navegar por categorias e abrir cada descoberta em uma página de leitura própria.

O mestre controla o que aparece nesse diário pela opção **Publicar na wiki da campanha** presente nas fichas da Biblioteca do Mestre. O tipo **Publicação** serve para relatos de sessão, notícias, crônicas e outros textos do mural. O módulo cria um segundo `JournalEntry` com propriedade padrão `OBSERVER` e copia apenas os campos públicos permitidos para cada tipo; segredos, consequências reservadas e anotações privadas não são publicados.

Para preencher **O Grupo**, crie registros do tipo **Personagem do grupo** na Biblioteca do Mestre. Cada ficha pode receber imagem, Actor vinculado, papel no grupo, biografia, história, personalidade, objetivos e relações. Depois de publicada, ela aparece na primeira seção do menu dos jogadores.

Também é possível arrastar um Actor ou Item diretamente para a Biblioteca do Mestre. O módulo cria uma ficha com o mesmo nome, imagem e UUID, evitando duplicações. Quando o mestre solta o documento no Diário dos Jogadores, essa mesma ficha é criada na biblioteca privada e publicada imediatamente. A página pública mantém uma referência ao registro privado e continua sendo atualizada ou removida por ele.

Quando uma variante compatível do Item Piles estiver ativa, a janela **Criar registro na biblioteca** oferece **Comerciante/Loja**. Essa opção pede ao próprio Item Piles que crie o Actor comerciante usando o tipo e os parâmetros configurados para o sistema atual; em seguida, o Diário cria um **Local** do tipo Loja já vinculado ao novo comerciante. Também é possível configurar manualmente um Local existente. O artigo público exibe o catálogo dentro do Diário dos Jogadores e permite comprar diretamente para o personagem atribuído ao usuário. Preços alternativos, moedas, estoque, troco e transferências continuam sob responsabilidade da API do Item Piles. A ficha completa da variante ativa permanece disponível como alternativa. As duas variantes usam o mesmo namespace público e não devem ser ativadas simultaneamente no mesmo mundo; em caso de conflito, a criação e o comércio são desabilitados até que somente uma permaneça ativa.

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
